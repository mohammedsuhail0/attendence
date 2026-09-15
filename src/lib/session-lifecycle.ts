import { createAdminClient } from '@/lib/supabase/admin';

export const AUTO_CLOSE_SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes (half an hour)

export function isSessionExpiredByAge(createdAt: string | Date): boolean {
  const createdMs = new Date(createdAt).getTime();
  if (isNaN(createdMs)) return false;
  return Date.now() - createdMs >= AUTO_CLOSE_SESSION_MAX_AGE_MS;
}

export async function closeSessionAndMarkAbsent(
  admin: ReturnType<typeof createAdminClient>,
  {
    sessionId,
    classId,
    teacherId,
  }: {
    sessionId: string;
    classId: string;
    teacherId: string;
  }
) {
  await admin
    .from('attendance_sessions')
    .update({ status: 'closed' })
    .eq('id', sessionId);

  const { data: enrollments } = await admin
    .from('enrollments')
    .select('student_id')
    .eq('class_id', classId);

  const { data: presentRecords } = await admin
    .from('attendance_records')
    .select('student_id')
    .eq('session_id', sessionId);

  const presentIds = new Set((presentRecords ?? []).map((r) => r.student_id));
  const absentStudents = (enrollments ?? [])
    .filter((e) => !presentIds.has(e.student_id))
    .map((e) => ({
      session_id: sessionId,
      student_id: e.student_id,
      status: 'absent' as const,
      mark_mode: 'auto_absent' as const,
      marked_by: teacherId,
    }));

  if (absentStudents.length === 0) return;

  const { error: insertError } = await admin
    .from('attendance_records')
    .insert(absentStudents);

  if (!insertError) return;

  const isLegacySchema =
    String(insertError.message).includes('mark_mode') ||
    String(insertError.message).includes('marked_by');

  if (!isLegacySchema) return;

  const fallbackRows = absentStudents.map((row) => ({
    session_id: row.session_id,
    student_id: row.student_id,
    status: row.status,
  }));

  await admin
    .from('attendance_records')
    .insert(fallbackRows);
}
