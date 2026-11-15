import {
  createAppointmentSchema,
  updateAppointmentSchema,
  type Appointment,
} from '@clinicline/contracts/appointments';

import type {
  AppointmentRecord,
  NewAppointmentRecord,
  UpdateAppointmentRecord,
} from './appointments.table.js';

export const createAppointmentRecordSchema = createAppointmentSchema.transform(
  (input): NewAppointmentRecord => ({
    startsAt: new Date(input.starts_at),
    endsAt: new Date(input.ends_at),
    doctorId: input.doctor_id,
    patientId: input.patient_id,
  }),
);

export const updateAppointmentRecordSchema = updateAppointmentSchema.transform(
  (input): UpdateAppointmentRecord => ({
    ...(input.starts_at !== undefined && {
      startsAt: new Date(input.starts_at),
    }),

    ...(input.ends_at !== undefined && {
      endsAt: new Date(input.ends_at),
    }),

    ...(input.status !== undefined && {
      status: input.status,
    }),
  }),
);

export function toAppointmentResponse(appointment: AppointmentRecord): Appointment {
  return {
    id: appointment.id,
    starts_at: appointment.startsAt.toISOString(),
    ends_at: appointment.endsAt.toISOString(),
    doctor_id: appointment.doctorId,
    patient_id: appointment.patientId,
    status: appointment.status,
  };
}
