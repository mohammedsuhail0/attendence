import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get student's attendance records with session and class details
    const { data: records, error } = await supabase
      .from('attendance_records')
      .select('*, attendance_sessions(*, classes(*))')
      .eq('student_id', user.id)
      .order('marked_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ records });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
