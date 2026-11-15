import { z } from 'zod';

export const patientSchema = z.object({
  id: z.uuid(),
  first_name: z.string(),
  last_name: z.string(),
});

export const createPatientSchema = patientSchema.omit({ id: true }).extend({
  first_name: z.string().trim().min(1).max(255),
  last_name: z.string().trim().min(1).max(255),
});

export const updatePatientSchema = createPatientSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const patientIdParamsSchema = z.object({
  patient_id: z.uuid(),
});

export type Patient = z.infer<typeof patientSchema>;

export type CreatePatientRequest = z.infer<typeof createPatientSchema>;

export type UpdatePatientRequest = z.infer<typeof updatePatientSchema>;

export type PatientIdParamsSchema = z.infer<typeof patientIdParamsSchema>;
