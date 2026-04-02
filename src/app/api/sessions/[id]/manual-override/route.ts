import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ManualOverrideAttendanceSchema } from '@/lib/schemas/attendance';

const PHOTO_BUCKET = 'student-photos';
const PHOTO_PREFIX = 'it24';

function isProfileRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function getOwnedSession(sessionId: string, teacherId: string) {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from('attendance_sessions')
    .select('id, class_id, teacher_id, status')
    .eq('id', sessionId)
    .eq('teacher_id', teacherId)
    .single();
  return session;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await getOwnedSession(id, user.id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const admin = createAdminClient();
    let photoColumnAvailable = true;
    const primaryEnrollmentQuery = await admin
      .from('enrollments')
      .select(
        'student_id, profiles!enrollments_student_id_fkey(id, full_name, roll_number, email, photo_path)'
      )
      .eq('class_id', session.class_id);
    let enrollmentError = primaryEnrollmentQuery.error;
    let enrollments: Array<{ student_id: string; profiles: unknown }> =
      ((primaryEnrollmentQuery.data as Array<{ student_id: string; profiles: unknown }>) ||
        []);

    // Backward-compatible fallback when the migration has not been applied yet.
    if (enrollmentError && String(enrollmentError.message).includes('photo_path')) {
      photoColumnAvailable = false;
      const fallback = await admin
        .from('enrollments')
        .select(
          'student_id, profiles!enrollments_student_id_fkey(id, full_name, roll_number, email)'
        )
        .eq('class_id', session.class_id);
      enrollments =
        (fallback.data as Array<{ student_id: string; profiles: unknown }>) || [];
      enrollmentError = fallback.error;
    }

    if (enrollmentError) {
      return NextResponse.json({ error: enrollmentError.message }, { status: 500 });
    }

    const { data: records, error: recordError } = await admin
      .from('attendance_records')
      .select('student_id, status')
      .eq('session_id', session.id);

    if (recordError) {
      return NextResponse.json({ error: recordError.message }, { status: 500 });
    }

    const statusByStudentId = new Map(
      (records || []).map((record) => [record.student_id, record.status])
    );

    const students = await Promise.all(
      (enrollments || []).map(async (enrollment) => {
        const rawProfile = enrollment.profiles;
        const profileCandidate = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
        const profile = isProfileRecord(profileCandidate) ? profileCandidate : null;
        let photo_url: string | null = null;
        const rollNumber = profile && typeof profile.roll_number === 'string' ? profile.roll_number : '';
        const photoPath =
          photoColumnAvailable &&
          profile &&
          typeof profile.photo_path === 'string'
            ? profile.photo_path
            : null;
        const canonicalPhotoPath = rollNumber ? `${PHOTO_PREFIX}/${rollNumber}.png` : null;
        const candidatePhotoPaths = [canonicalPhotoPath, photoPath].filter(
          (value, index, arr): value is string =>
            Boolean(value) && arr.indexOf(value) === index
        );

        for (const candidatePath of candidatePhotoPaths) {
          const { data: signedUrlData, error: signedUrlError } = await admin.storage
            .from(PHOTO_BUCKET)
            .createSignedUrl(candidatePath, 60 * 60);
          if (!signedUrlError && signedUrlData?.signedUrl) {
            photo_url = signedUrlData.signedUrl;
            break;
          }
        }

        return {
          student_id: enrollment.student_id,
          full_name: profile?.full_name || '',
          roll_number: profile?.roll_number || '',
          email: profile?.email || '',
          photo_path: photoPath || null,
          photo_url,
          attendance_status: statusByStudentId.get(enrollment.student_id) || 'not_marked',
        };
      })
    );

    students.sort((left, right) =>
      String(left.roll_number || '').localeCompare(String(right.roll_number || ''))
    );

    return NextResponse.json({
      session_status: session.status,
      students,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await getOwnedSession(id, user.id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status !== 'active') {
      return NextResponse.json({ error: 'Session is already closed' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = ManualOverrideAttendanceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { student_id } = parsed.data;
    const admin = createAdminClient();

    const { data: enrollment } = await admin
      .from('enrollments')
      .select('id')
      .eq('class_id', session.class_id)
      .eq('student_id', student_id)
      .single();

    if (!enrollment) {
      return NextResponse.json(
        { error: 'Student is not enrolled in this class' },
        { status: 403 }
      );
    }

    const { error: upsertError } = await admin
      .from('attendance_records')
      .upsert(
        {
          session_id: session.id,
          student_id,
          status: 'present',
          mark_mode: 'manual_override',
          marked_by: user.id,
        },
        { onConflict: 'session_id,student_id' }
      );

    if (upsertError) {
      const isLegacySchema =
        String(upsertError.message).includes('mark_mode') ||
        String(upsertError.message).includes('marked_by');
      if (isLegacySchema) {
        const { error: fallbackError } = await admin
          .from('attendance_records')
          .upsert(
            {
              session_id: session.id,
              student_id,
              status: 'present',
            },
            { onConflict: 'session_id,student_id' }
          );
        if (fallbackError) {
          return NextResponse.json({ error: fallbackError.message }, { status: 500 });
        }
      } else {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ message: 'Attendance marked via manual override' });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
