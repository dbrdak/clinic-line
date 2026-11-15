import { z } from 'zod';

export const doctorSchema = z.object({
  id: z.uuid(),
  first_name: z.string(),
  last_name: z.string(),
  specialization: z.string(),
});

export type Doctor = z.infer<typeof doctorSchema>;
