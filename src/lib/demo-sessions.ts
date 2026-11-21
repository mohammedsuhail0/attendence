import type { AttendanceSession } from '@/types/database';

export const inMemorySessions: Map<string, AttendanceSession> = new Map();
export const inMemoryRecords: Map<string, Array<{ session_id: string; student_id: string; status: 'present' | 'absent'; mark_mode: string; marked_at: string }>> = new Map();
