import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CreateSessionSchema } from '@/lib/schemas/session';
import {
  generateToken,
  getDateStringInTimeZone,
  TOKEN_VALIDITY_SECONDS,
} from '@/lib/utils';
import { findCurriculumClass } from '@/lib/curriculum';
import {
  closeSessionAndMarkAbsent,
  isSessionExpiredByAge,
} from '@/lib/session-lifecycle';
import { inMemorySessions, inMemoryRecords } from '@/lib/demo-sessions';
import type { AttendanceSession } from '@/types/database';

async function getAuthContext() {
  const cookieStore = await cookies();
  const demoCookie = cookieStore.get('nova_demo_auth')?.value;
  let demoUser = null;
  if (demoCookie) {
    try {
      demoUser = JSON.parse(demoCookie);
    } catch {
      // ignore
    }
  }

  let user = null;
  try {
    const supabase = await createClient();
    const userRes = await supabase.auth.getUser();
    user = userRes.data?.user;
  } catch {
    // Supabase down
  }

  return { user, demoUser };
}

export async function POST(request: Request) {
  try {
    const { user, demoUser } = await getAuthContext();
    const effectiveUserId = user?.id || demoUser?.id;

    if (!effectiveUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate input
    const body = await request.json();
    const parsed = CreateSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { class_id, period, session_date } = parsed.data;
    const today = getDateStringInTimeZone();

    if (session_date !== today) {
      return NextResponse.json(
        { error: 'Sessions can only be created for today' },
        { status: 400 }
      );
    }

    // If Supabase is connected, try DB flow
    if (user) {
      try {
        const admin = createAdminClient();
        const { data: profile } = await admin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        let classRecordId = class_id;

        const { data: cls } = await admin
          .from('classes')
          .select('id, department, section, subject')
          .eq('id', class_id)
          .maybeSingle();

        if (!cls) {
          const canonical = findCurriculumClass(class_id);
          if (canonical) {
            const { data: upsertedClass, error: upsertErr } = await admin
              .from('classes')
              .upsert(
                {
                  id: canonical.id,
                  department: canonical.department,
                  section: canonical.section,
                  subject: canonical.subject,
                  teacher_id: user.id,
                },
                { onConflict: 'id' }
              )
              .select('id')
              .maybeSingle();

            if (upsertErr) {
              const { data: existingClassByDetails } = await admin
                .from('classes')
                .select('id')
                .eq('department', canonical.department)
                .eq('section', canonical.section)
                .eq('subject', canonical.subject)
                .maybeSingle();
              if (existingClassByDetails) {
                classRecordId = existingClassByDetails.id;
              }
            } else if (upsertedClass) {
              classRecordId = upsertedClass.id;
            }
          }
        }

        const normalizedRole = profile?.role?.trim().toLowerCase();
        if (normalizedRole && normalizedRole !== 'teacher' && normalizedRole !== 'admin') {
          return NextResponse.json({ error: 'Only faculty can create sessions' }, { status: 403 });
        }

        const { data: existing } = await admin
          .from('attendance_sessions')
          .select('*')
          .eq('class_id', classRecordId)
          .eq('period', period)
          .eq('session_date', session_date)
          .maybeSingle();

        if (existing) {
          if (existing.status === 'active') {
            return NextResponse.json({
              session: existing,
              message: 'Active session already exists for this class and period',
            }, { status: 200 });
          }

          const token = generateToken();
          const now = new Date();
          const tokenExpiresAt = new Date(now.getTime() + TOKEN_VALIDITY_SECONDS * 1000).toISOString();
          const { data: reactivated, error: reactivateErr } = await admin
            .from('attendance_sessions')
            .update({
              status: 'active',
              token,
              token_expires_at: tokenExpiresAt,
              updated_at: now.toISOString(),
            })
            .eq('id', existing.id)
            .select()
            .single();

          if (!reactivateErr && reactivated) {
            return NextResponse.json({ session: reactivated, message: 'Session re-opened' }, { status: 200 });
          }
        }

        const token = generateToken();
        const now = new Date();
        const tokenExpiresAt = new Date(now.getTime() + TOKEN_VALIDITY_SECONDS * 1000).toISOString();

        const { data: session, error } = await admin
          .from('attendance_sessions')
          .insert({
            class_id: classRecordId,
            teacher_id: user.id,
            token,
            period,
            session_date,
            token_expires_at: tokenExpiresAt,
            status: 'active',
          })
          .select()
          .single();

        if (!error && session) {
          return NextResponse.json({ session }, { status: 201 });
        }
      } catch {
        // Fall back to offline demo session
      }
    }

    // Emergency Offline Demo Fallback
    const token = generateToken();
    const now = new Date();
    const tokenExpiresAt = new Date(now.getTime() + TOKEN_VALIDITY_SECONDS * 1000).toISOString();
    const sessionId = `demo-sess-${Date.now()}`;

    const demoSession: AttendanceSession = {
      id: sessionId,
      class_id,
      teacher_id: effectiveUserId,
      token,
      period,
      session_date,
      token_expires_at: tokenExpiresAt,
      status: 'active',
      created_at: now.toISOString(),
    };

    inMemorySessions.set(sessionId, demoSession);
    return NextResponse.json({ session: demoSession, isOfflineDemo: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { user, demoUser } = await getAuthContext();
    const effectiveUserId = user?.id || demoUser?.id;

    if (!effectiveUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user) {
      try {
        const admin = createAdminClient();
        let { data: sessions, error } = await admin
          .from('attendance_sessions')
          .select('*, classes(*)')
          .eq('teacher_id', user.id)
          .order('created_at', { ascending: false });

        if (!error && sessions) {
          const today = getDateStringInTimeZone();
          const staleActiveSessions = sessions.filter(
            (session) =>
              session.status === 'active' &&
              (session.session_date < today ||
                isSessionExpiredByAge(session.created_at))
          );

          if (staleActiveSessions.length > 0) {
            await Promise.all(
              staleActiveSessions.map((session) =>
                closeSessionAndMarkAbsent(admin, {
                  sessionId: session.id,
                  classId: session.class_id,
                  teacherId: user.id,
                })
              )
            );

            const refreshed = await admin
              .from('attendance_sessions')
              .select('*, classes(*)')
              .eq('teacher_id', user.id)
              .order('created_at', { ascending: false });

            sessions = refreshed.data || [];
          }

          const sessionIds = sessions.map((session) => session.id);
          const { data: records } = await admin
            .from('attendance_records')
            .select('session_id, status, mark_mode')
            .in('session_id', sessionIds);

          const summaryBySessionId = new Map<
            string,
            {
              total: number;
              present: number;
              absent: number;
              biometric: number;
              manual_override: number;
              auto_absent: number;
            }
          >();

          for (const sessionId of sessionIds) {
            summaryBySessionId.set(sessionId, {
              total: 0,
              present: 0,
              absent: 0,
              biometric: 0,
              manual_override: 0,
              auto_absent: 0,
            });
          }

          for (const record of records || []) {
            const summary = summaryBySessionId.get(record.session_id);
            if (!summary) continue;
            summary.total += 1;
            if (record.status === 'present') summary.present += 1;
            if (record.status === 'absent') summary.absent += 1;
          }

          const sessionsWithSummary = sessions.map((session) => ({
            ...session,
            attendance_summary: summaryBySessionId.get(session.id) || {
              total: 0,
              present: 0,
              absent: 0,
              biometric: 0,
              manual_override: 0,
              auto_absent: 0,
            },
          }));

          return NextResponse.json({ sessions: sessionsWithSummary });
        }
      } catch {
        // Fallback to in-memory sessions
      }
    }

    // Offline demo sessions
    const demoSessionsList = Array.from(inMemorySessions.values()).map((s) => ({
      ...s,
      attendance_summary: {
        total: 5,
        present: 0,
        absent: 0,
        biometric: 0,
        manual_override: 0,
        auto_absent: 0,
      },
    }));

    return NextResponse.json({ sessions: demoSessionsList, isOfflineDemo: true });
  } catch {
    return NextResponse.json({ sessions: [], isOfflineDemo: true });
  }
}
