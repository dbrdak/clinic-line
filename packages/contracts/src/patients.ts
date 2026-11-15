import { z } from 'zod';

export const patientSchema = z.object({
  id: z.uuid(),
  first_name: z.string(),
  last_name: z.string()
});

export const createPatientSchema = patientSchema
  .omit({ id: true })
  .extend({
    first_name: z.string().trim().min(1).max(255),
    last_name: z.string().trim().min(1).max(255)
  });
