import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get session and verify ownership
    const { data: session } = await supabase
      .from('attendance_sessions')
      .select('*, classes(*)')
      .eq('id', id)
      .eq('teacher_id', user.id)
      .single();

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status === 'closed') {
      return NextResponse.json({ error: 'Session already closed' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Close the session
    await admin
      .from('attendance_sessions')
      .update({ status: 'closed' })
      .eq('id', id);

    // Get enrolled students who haven't marked attendance
    const { data: enrollments } = await admin
      .from('enrollments')
      .select('student_id')
      .eq('class_id', session.class_id);

    const { data: presentRecords } = await admin
      .from('attendance_records')
      .select('student_id')
      .eq('session_id', id);

    const presentIds = new Set((presentRecords ?? []).map((r) => r.student_id));
    const absentStudents = (enrollments ?? [])
      .filter((e) => !presentIds.has(e.student_id))
      .map((e) => ({
        session_id: id,
        student_id: e.student_id,
        status: 'absent' as const,
      }));

    // Bulk insert absent records
    if (absentStudents.length > 0) {
      await admin.from('attendance_records').insert(absentStudents);
    }

    return NextResponse.json({
      message: 'Session closed',
      present: presentIds.size,
      absent: absentStudents.length,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
