import { z } from 'zod';

export const CreateSessionSchema = z.object({
  class_id: z.string().uuid('Invalid class ID'),
  period: z.number().int().min(1).max(6, 'Period must be 1-6'),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
