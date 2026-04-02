export type UserRole = 'teacher' | 'student';
export type SessionStatus = 'active' | 'closed';
export type AttendanceStatus = 'present' | 'absent';
export type AttendanceMarkMode =
  | 'biometric'
  | 'manual_override'
  | 'auto_absent';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  department: string | null;
  section: string | null;
  roll_number: string | null;
  photo_path: string | null;
  webauthn_credential: Record<string, unknown> | null;
  webauthn_challenge: string | null;
  created_at: string;
}

export interface Class {
  id: string;
  department: string;
  section: string;
  subject: string;
  teacher_id: string;
  created_at: string;
}

export interface Enrollment {
  id: string;
  student_id: string;
  class_id: string;
  created_at: string;
}

export interface AttendanceSession {
  id: string;
  class_id: string;
  teacher_id: string;
  token: string;
  period: number;
  session_date: string;
  token_expires_at: string;
  status: SessionStatus;
  created_at: string;
  // Joined fields
  classes?: Class;
  attendance_summary?: {
    total: number;
    present: number;
    absent: number;
    biometric: number;
    manual_override: number;
    auto_absent: number;
  };
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  mark_mode?: AttendanceMarkMode;
  marked_by?: string | null;
  marked_at: string;
  // Joined fields
  profiles?: Profile;
  attendance_sessions?: AttendanceSession;
}
