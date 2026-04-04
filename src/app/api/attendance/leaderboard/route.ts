import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();

    // 1. Get the current student's class
    const { data: enrollment, error: enrollmentError } = await admin
      .from('enrollments')
      .select('class_id')
      .eq('student_id', user.id)
      .limit(1)
      .maybeSingle();

    if (enrollmentError || !enrollment) {
      return NextResponse.json({ leaderboard: [] });
    }

    const { class_id } = enrollment;

    // 2. Get total attendance sessions for this class
    const { count: totalSessions, error: sessionError } = await admin
      .from('attendance_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', class_id);

    if (sessionError) throw sessionError;

    // 3. Get all students in this class with their profile data
    const { data: classmates, error: classmatesError } = await admin
      .from('enrollments')
      .select('student_id, profiles!inner(id, full_name, photo_path, custom_photo_path)')
      .eq('class_id', class_id);

    if (classmatesError) throw classmatesError;

    // 4. Get attendance records for all students in those sessions
    // First, get all session IDs for this class
    const { data: sessions } = await admin
      .from('attendance_sessions')
      .select('id')
      .eq('class_id', class_id);
    
    const sessionIds = sessions?.map(s => s.id) || [];

    if (sessionIds.length === 0) {
      return NextResponse.json({
        leaderboard: classmates.map(c => ({
          id: c.student_id,
          full_name: (c.profiles as any).full_name,
          photo_path: (c.profiles as any).photo_path,
          custom_photo_path: (c.profiles as any).custom_photo_path,
          percentage: 0
        }))
      });
    }

    // Get counts of 'present' records for these students in these sessions
    const { data: attendanceCounts, error: countsError } = await admin
      .from('attendance_records')
      .select('student_id, status')
      .in('session_id', sessionIds)
      .eq('status', 'present');

    if (countsError) throw countsError;

    // 5. Aggregate and calculate percentages
    const presentCountsMap = new Map<string, number>();
    attendanceCounts?.forEach(record => {
      presentCountsMap.set(record.student_id, (presentCountsMap.get(record.student_id) || 0) + 1);
    });

    const leaderboard = classmates.map(c => {
      const p = c.profiles as any;
      const present = presentCountsMap.get(c.student_id) || 0;
      const percentage = totalSessions ? Math.round((present / (totalSessions as number)) * 100) : 0;
      return {
        id: c.student_id,
        full_name: p.full_name,
        photo_path: p.photo_path,
        custom_photo_path: p.custom_photo_path,
        percentage
      };
    });

    // Sort by percentage descending
    leaderboard.sort((a, b) => b.percentage - a.percentage);

    return NextResponse.json({ leaderboard: leaderboard.slice(0, 20) }); // Top 20
  } catch (err: any) {
    console.error('Leaderboard error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
