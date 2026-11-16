import { z } from 'zod';

export const appointmentStatuses = ['scheduled', 'cancelled'] as const;

export const appointmentStatusSchema = z.enum(appointmentStatuses);

export const appointmentSchema = z.object({
  id: z.uuid(),
  doctor_id: z.uuid(),
  patient_id: z.uuid(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  status: appointmentStatusSchema,
});

// Requests may use Warsaw local time; responses remain offset-bearing instants.
const appointmentInputTimeSchema = z.iso.datetime({ offset: true, local: true });

export const createAppointmentSchema = appointmentSchema
  .pick({
    doctor_id: true,
    patient_id: true,
    starts_at: true,
    ends_at: true,
  })
  .extend({
    starts_at: appointmentInputTimeSchema,
    ends_at: appointmentInputTimeSchema,
  });

export const updateAppointmentSchema = z
  .object({
    starts_at: appointmentInputTimeSchema.optional(),
    ends_at: appointmentInputTimeSchema.optional(),
    status: appointmentStatusSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const appointmentQuerySchema = z.object({
  doctor_id: z.uuid().optional(),
  patient_id: z.uuid().optional(),
  status: appointmentStatusSchema.optional(),
  starts_from: appointmentInputTimeSchema.optional(),
  starts_to: appointmentInputTimeSchema.optional(),
});

export const appointmentIdParamsSchema = z.object({
  appointment_id: z.uuid(),
});

export type Appointment = z.infer<typeof appointmentSchema>;

export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export type CreateAppointmentRequest = z.infer<typeof createAppointmentSchema>;

export type UpdateAppointmentRequest = z.infer<typeof updateAppointmentSchema>;

export type AppointmentQuerySchema = z.infer<typeof appointmentQuerySchema>;

export type AppointmentIdParamsSchema = z.infer<typeof appointmentIdParamsSchema>;
