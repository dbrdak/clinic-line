import { z } from 'zod';

export const appointmentStatusSchema = z.enum(['scheduled', 'cancelled']);

export const appointmentSchema = z.object({
  id: z.uuid(),
  doctor_id: z.uuid(),
  patient_id: z.uuid(),
  starts_at: z.iso.datetime({ offset: true }),
  duration_minutes: z.number().int().positive(),
  status: appointmentStatusSchema,
});

export const createAppointmentSchema = appointmentSchema.pick({
  doctor_id: true,
  patient_id: true,
  starts_at: true,
});

export const updateAppointmentSchema = z
  .object({
    starts_at: z.iso.datetime({ offset: true }).optional(),
    status: appointmentStatusSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export type Appointment = z.infer<typeof appointmentSchema>;
export type CreateAppointmentRequest = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentRequest = z.infer<typeof updateAppointmentSchema>;
