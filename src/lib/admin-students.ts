import { createAdminClient } from '@/lib/supabase/admin';
import { getNextMonthKey } from '@/lib/utils';

export type DepartmentStudentSummary = {
  slno: number;
  student_id: string;
  roll_number: string;
  full_name: string;
  total_attendance: number;
  total_sessions: number;
  attendance_percentage: number;
};

export type AddStudentInput = {
  department: string;
  year: string;
  rollNumber: string;
  fullName: string;
  password: string;
  email?: string;
};

function normalizeRollNumber(rollNumber: string) {
  return rollNumber.trim().replace(/\s+/g, '').toUpperCase();
}

function normalizeYear(year: string) {
  return year.trim();
}

function getMonthRange(month: string) {
  const startDate = `${month}-01`;
  const endDate = `${getNextMonthKey(month)}-01`;
  return { startDate, endDate };
}

export async function getDepartmentStudentsMonthlySummary(input: {
  department: string;
  year: string;
  month: string;
}): Promise<DepartmentStudentSummary[]> {
  const admin = createAdminClient();
  const year = normalizeYear(input.year);

  const { data: classes, error: classesError } = await admin
    .from('classes')
    .select('id')
    .eq('department', input.department)
    .eq('section', year);

  if (classesError) throw new Error(classesError.message);
  const classIds = (classes || []).map((row) => row.id);
  if (classIds.length === 0) return [];

  const { data: enrollments, error: enrollmentsError } = await admin
    .from('enrollments')
    .select('student_id, class_id, profiles!enrollments_student_id_fkey(full_name, roll_number)')
    .in('class_id', classIds);

  if (enrollmentsError) throw new Error(enrollmentsError.message);

  const studentMap = new Map<
    string,
    {
      student_id: string;
      full_name: string;
      roll_number: string;
      total_attendance: number;
      total_sessions: number;
    }
  >();
  const classToStudentIds = new Map<string, Set<string>>();

  for (const row of enrollments || []) {
    const studentId = row.student_id;
    if (!studentId) continue;
    if (studentMap.has(studentId)) continue;
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    studentMap.set(studentId, {
      student_id: studentId,
      full_name: profile?.full_name || 'Unnamed Student',
      roll_number: profile?.roll_number || '-',
      total_attendance: 0,
      total_sessions: 0,
    });
  }

  for (const row of enrollments || []) {
    if (!row.class_id || !row.student_id) continue;
    if (!classToStudentIds.has(row.class_id)) {
      classToStudentIds.set(row.class_id, new Set<string>());
    }
    classToStudentIds.get(row.class_id)?.add(row.student_id);
  }

  const { startDate, endDate } = getMonthRange(input.month);
  const { data: sessions, error: sessionsError } = await admin
    .from('attendance_sessions')
    .select('id, class_id')
    .in('class_id', classIds)
    .gte('session_date', startDate)
    .lt('session_date', endDate);

  if (sessionsError) throw new Error(sessionsError.message);

  const sessionIds = (sessions || []).map((row) => row.id);

  for (const session of sessions || []) {
    const enrolledStudentIds = classToStudentIds.get(session.class_id) || new Set<string>();
    for (const studentId of Array.from(enrolledStudentIds)) {
      const current = studentMap.get(studentId);
      if (!current) continue;
      current.total_sessions += 1;
    }
  }

  if (sessionIds.length > 0) {
    const { data: presentRecords, error: recordsError } = await admin
      .from('attendance_records')
      .select('student_id')
      .in('session_id', sessionIds)
      .eq('status', 'present');

    if (recordsError) throw new Error(recordsError.message);

    for (const record of presentRecords || []) {
      const studentId = record.student_id;
      const current = studentMap.get(studentId);
      if (!current) continue;
      current.total_attendance += 1;
    }
  }

  return Array.from(studentMap.values())
    .sort((left, right) =>
      left.roll_number.localeCompare(right.roll_number, undefined, { numeric: true })
    )
    .map((student, index) => ({
      slno: index + 1,
      student_id: student.student_id,
      roll_number: student.roll_number,
      full_name: student.full_name,
      total_attendance: student.total_attendance,
      total_sessions: student.total_sessions,
      attendance_percentage:
        student.total_sessions > 0
          ? Math.round((student.total_attendance / student.total_sessions) * 10000) / 100
          : 0,
    }));
}

export async function addStudentToDepartment(input: AddStudentInput): Promise<{
  student_id: string;
  roll_number: string;
  full_name: string;
  year: string;
  email: string;
}> {
  const admin = createAdminClient();
  const rollNumber = normalizeRollNumber(input.rollNumber);
  const year = normalizeYear(input.year);
  const fullName = input.fullName.trim();
  const email = (input.email?.trim().toLowerCase() ||
    `${rollNumber.toLowerCase()}@student.classnova.local`);

  const { data: existingRoll, error: existingRollError } = await admin
    .from('profiles')
    .select('id')
    .eq('roll_number', rollNumber)
    .maybeSingle();
  if (existingRollError) throw new Error(existingRollError.message);
  if (existingRoll) throw new Error('Roll number already exists');

  const createUserResult = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { role: 'student', full_name: fullName },
  });

  if (createUserResult.error) {
    throw new Error(createUserResult.error.message);
  }

  const userId = createUserResult.data.user?.id;
  if (!userId) throw new Error('Failed to create student account');

  const { error: profileError } = await admin
    .from('profiles')
    .upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        role: 'student',
        department: input.department,
        section: year,
        roll_number: rollNumber,
      },
      { onConflict: 'id' }
    );

  if (profileError) throw new Error(profileError.message);

  const { data: classes, error: classesError } = await admin
    .from('classes')
    .select('id')
    .eq('department', input.department)
    .eq('section', year);

  if (classesError) throw new Error(classesError.message);

  const classIds = (classes || []).map((row) => row.id);
  if (classIds.length > 0) {
    const rows = classIds.map((classId) => ({ student_id: userId, class_id: classId }));
    const { error: enrollError } = await admin
      .from('enrollments')
      .upsert(rows, { onConflict: 'student_id,class_id' });
    if (enrollError) throw new Error(enrollError.message);
  }

  return {
    student_id: userId,
    roll_number: rollNumber,
    full_name: fullName,
    year,
    email,
  };
}
