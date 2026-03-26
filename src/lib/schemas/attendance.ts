import { z } from 'zod';

export const SubmitAttendanceSchema = z.object({
  token: z
    .string()
    .length(4, 'Token must be 4 characters')
    .toUpperCase(),
  assertion: z.unknown(),
});

export type SubmitAttendanceInput = z.infer<typeof SubmitAttendanceSchema>;
