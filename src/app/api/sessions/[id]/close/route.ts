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
        mark_mode: 'auto_absent' as const,
        marked_by: user.id,
      }));

    // Bulk insert absent records
    if (absentStudents.length > 0) {
      const { error: insertError } = await admin
        .from('attendance_records')
        .insert(absentStudents);
      if (insertError) {
        const isLegacySchema =
          String(insertError.message).includes('mark_mode') ||
          String(insertError.message).includes('marked_by');
        if (isLegacySchema) {
          const fallbackRows = absentStudents.map((row) => ({
            session_id: row.session_id,
            student_id: row.student_id,
            status: row.status,
          }));
          const { error: fallbackError } = await admin
            .from('attendance_records')
            .insert(fallbackRows);
          if (fallbackError) {
            return NextResponse.json({ error: fallbackError.message }, { status: 500 });
          }
        } else {
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }
      }
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
