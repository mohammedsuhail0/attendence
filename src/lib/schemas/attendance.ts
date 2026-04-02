import { z } from 'zod';

export const SubmitAttendanceSchema = z.object({
  token: z
    .string()
    .length(4, 'Token must be 4 characters')
    .toUpperCase(),
  assertion: z.unknown(),
});

export const ManualOverrideAttendanceSchema = z.object({
  student_id: z.string().uuid('Invalid student ID'),
});

export type SubmitAttendanceInput = z.infer<typeof SubmitAttendanceSchema>;
export type ManualOverrideAttendanceInput = z.infer<
  typeof ManualOverrideAttendanceSchema
>;
