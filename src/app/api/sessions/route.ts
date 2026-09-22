import { NextResponse } from 'next/server';
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

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    // Load profile with admin client to bypass RLS
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

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

    let classRecordId = class_id;

    // Check if class exists in database
    const { data: cls } = await admin
      .from('classes')
      .select('id, department, section, subject')
      .eq('id', class_id)
      .maybeSingle();

    if (!cls) {
      // Check if it's one of our canonical curriculum classes
      const canonical = findCurriculumClass(class_id);
      if (canonical) {
        // Upsert into classes table in Supabase so foreign key constraint passes
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
          // If upsert conflicted on department/section/subject constraint, find existing
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
      } else {
        return NextResponse.json({ error: 'Class not found' }, { status: 404 });
      }
    }

    const normalizedRole = profile?.role?.trim().toLowerCase();
    if (normalizedRole && normalizedRole !== 'teacher' && normalizedRole !== 'admin') {
      return NextResponse.json({ error: 'Only faculty can create sessions' }, { status: 403 });
    }

    // Check for duplicate session (same class, period, date)
    const { data: existing } = await admin
      .from('attendance_sessions')
      .select('*')
      .eq('class_id', classRecordId)
      .eq('period', period)
      .eq('session_date', session_date)
      .maybeSingle();

    if (existing) {
      // If it exists and is active, return it directly so teacher doesn't get blocked with 409!
      if (existing.status === 'active') {
        return NextResponse.json({
          session: existing,
          message: 'Active session already exists for this class and period',
        }, { status: 200 });
      }

      // If it exists but was closed, re-activate it with a fresh token!
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

    // Generate token and expiry
    const token = generateToken();
    const now = new Date();
    const tokenExpiresAt = new Date(now.getTime() + TOKEN_VALIDITY_SECONDS * 1000).toISOString();

    // Create session using admin client
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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get teacher's sessions
    let { data: sessions, error } = await admin
      .from('attendance_sessions')
      .select('*, classes(*)')
      .eq('teacher_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ sessions: [] });
    }

    const today = getDateStringInTimeZone();
    const staleActiveSessions = sessions.filter(
      (session) =>
        session.status === 'active' &&
        (session.session_date < today ||
          isSessionExpiredByAge(session.created_at))
    );

    // Any active session left over from a previous day or open for >= 30 mins is stale.
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
      error = refreshed.error;

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!sessions || sessions.length === 0) {
        return NextResponse.json({ sessions: [] });
      }
    }

    const sessionIds = sessions.map((session) => session.id);
    const { data: records, error: recordsError } = await admin
      .from('attendance_records')
      .select('session_id, status, mark_mode')
      .in('session_id', sessionIds);

    if (recordsError) {
      return NextResponse.json({ error: recordsError.message }, { status: 500 });
    }

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

      // Keep old records meaningful even before mark_mode existed.
      const inferredMode =
        record.mark_mode ||
        (record.status === 'absent' ? 'auto_absent' : 'biometric');

      if (inferredMode === 'biometric') summary.biometric += 1;
      if (inferredMode === 'manual_override') summary.manual_override += 1;
      if (inferredMode === 'auto_absent') summary.auto_absent += 1;
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
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
