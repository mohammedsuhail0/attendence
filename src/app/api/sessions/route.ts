import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CreateSessionSchema } from '@/lib/schemas/session';
import {
  generateToken,
  getDateStringInTimeZone,
  TOKEN_VALIDITY_SECONDS,
} from '@/lib/utils';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load profile so we can keep the teacher-only intent, but do not rely on
    // a stale role value alone. Class ownership is the stronger authorization
    // check further below.
    const { data: profile } = await supabase
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

    // Check if teacher owns this class
    const { data: cls } = await supabase
      .from('classes')
      .select('id')
      .eq('id', class_id)
      .eq('teacher_id', user.id)
      .single();

    if (!cls) {
      return NextResponse.json({ error: 'Class not found or not yours' }, { status: 404 });
    }

    const normalizedRole = profile?.role?.trim().toLowerCase();
    if (normalizedRole && normalizedRole !== 'teacher') {
      return NextResponse.json({ error: 'Only teachers can create sessions' }, { status: 403 });
    }

    // Check for duplicate session (same class, period, date)
    const { data: existing } = await supabase
      .from('attendance_sessions')
      .select('id')
      .eq('class_id', class_id)
      .eq('period', period)
      .eq('session_date', session_date)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'Session already exists for this class/period/date' },
        { status: 409 }
      );
    }

    // Generate token and expiry
    const token = generateToken();
    const now = new Date();
    const tokenExpiresAt = new Date(now.getTime() + TOKEN_VALIDITY_SECONDS * 1000).toISOString();

    // Create session
    const { data: session, error } = await supabase
      .from('attendance_sessions')
      .insert({
        class_id,
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
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get teacher's sessions
    const { data: sessions, error } = await supabase
      .from('attendance_sessions')
      .select('*, classes(*)')
      .eq('teacher_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
