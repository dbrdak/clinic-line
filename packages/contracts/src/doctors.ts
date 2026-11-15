import { z } from 'zod';

export const doctorSchema = z.object({
  id: z.uuid(),
  first_name: z.string(),
  last_name: z.string(),
});

export const doctorIdParamsSchema = z.object({
  doctor_id: z.uuid(),
});

export type Doctor = z.infer<typeof doctorSchema>;

export type DoctorIdParamsSchema = z.infer<typeof doctorIdParamsSchema>;
