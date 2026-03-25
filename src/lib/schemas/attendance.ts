import { z } from 'zod';

export const SubmitAttendanceSchema = z.object({
  token: z
    .string()
    .length(6, 'Token must be 6 characters')
    .toUpperCase(),
  assertion: z.unknown(),
});

export type SubmitAttendanceInput = z.infer<typeof SubmitAttendanceSchema>;
