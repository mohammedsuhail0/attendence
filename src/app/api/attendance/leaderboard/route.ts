import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const PHOTO_BUCKET = 'student-photos';
const PHOTO_PREFIX = 'it24';

function isDirectImageSource(value: string | null): value is string {
  if (!value) return false;
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:image/') ||
    value.startsWith('blob:')
  );
}

async function resolvePhotoUrl(
  admin: ReturnType<typeof createAdminClient>,
  photoPath: string | null,
  rollNumber: string | null
): Promise<string | null> {
  if (isDirectImageSource(photoPath)) {
    return photoPath;
  }

  const canonicalPhotoPath = rollNumber ? `${PHOTO_PREFIX}/${rollNumber}.png` : null;
  const candidatePhotoPaths = [photoPath, canonicalPhotoPath].filter(
    (value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index
  );

  for (const candidatePath of candidatePhotoPaths) {
    const { data: signedUrlData, error: signedUrlError } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(candidatePath, 60 * 60);

    if (!signedUrlError && signedUrlData?.signedUrl) {
      return signedUrlData.signedUrl;
    }
  }

  return null;
}

type StudentRow = {
  id: string;
  full_name: string;
  roll_number: string | null;
  photo_path: string | null;
};

type AttendanceRow = {
  student_id: string;
  status: string;
};

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'student') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();

    const { data: students, error: studentsError } = await admin
      .from('profiles')
      .select('id, full_name, roll_number, photo_path')
      .eq('role', 'student')
      .order('full_name', { ascending: true });

    if (studentsError) {
      return NextResponse.json({ error: studentsError.message }, { status: 500 });
    }

    const { data: records, error: recordsError } = await admin
      .from('attendance_records')
      .select('student_id, status');

    if (recordsError) {
      return NextResponse.json({ error: recordsError.message }, { status: 500 });
    }

    const statsByStudentId = new Map<string, { total: number; present: number }>();

    for (const record of (records || []) as AttendanceRow[]) {
      const existing = statsByStudentId.get(record.student_id) || { total: 0, present: 0 };
      existing.total += 1;
      if (record.status === 'present') {
        existing.present += 1;
      }
      statsByStudentId.set(record.student_id, existing);
    }

    const leaderboardBase = ((students || []) as StudentRow[])
      .map((student) => {
        const stats = statsByStudentId.get(student.id) || { total: 0, present: 0 };
        const percentage = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

        return {
          student_id: student.id,
          full_name: student.full_name,
          roll_number: student.roll_number,
          photo_path: student.photo_path,
          total: stats.total,
          present: stats.present,
          percentage,
        };
      })
      .sort((left, right) => {
        if (right.percentage !== left.percentage) return right.percentage - left.percentage;
        if (right.present !== left.present) return right.present - left.present;
        return left.full_name.localeCompare(right.full_name);
      });

    const leaderboard = await Promise.all(
      leaderboardBase.map(async (entry) => ({
        ...entry,
        photo_path: await resolvePhotoUrl(admin, entry.photo_path, entry.roll_number),
      }))
    );

    return NextResponse.json(
      { leaderboard, metric: 'attendance_percentage' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
