import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
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

    // Verify teacher owns this session
    const { data: session } = await supabase
      .from('attendance_sessions')
      .select('id, teacher_id')
      .eq('id', id)
      .eq('teacher_id', user.id)
      .single();

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Get attendance records with student profiles
    const { data: records, error } = await supabase
      .from('attendance_records')
      .select('*, profiles!attendance_records_student_id_fkey(full_name, roll_number, email)')
      .eq('session_id', id)
      .order('marked_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ records });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
