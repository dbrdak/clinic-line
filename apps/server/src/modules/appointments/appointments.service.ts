import type {
  CreateAppointmentRequest,
  UpdateAppointmentRequest,
  Appointment,
  AppointmentQuerySchema,
} from '@clinicline/contracts/appointments';

import { AppError } from '../../shared/app-error.js';
import { parseAppointmentTime } from '../../shared/time.js';
import * as repository from './appointments.repository.js';
import {
  createAppointmentRecordSchema,
  toAppointmentResponse,
  updateAppointmentRecordSchema,
} from './appointments.mapper.js';

export async function getAppointment(id: string): Promise<Appointment> {
  const appointment = await repository.findById(id);

  if (!appointment) {
    throw new AppError(404, 'appointment_not_found', 'The requested appointment does not exist.');
  }

  return toAppointmentResponse(appointment);
}

export async function getAppointments(query: AppointmentQuerySchema): Promise<Appointment[]> {
  const filters = {
    ...query,
    ...(query.starts_from && {
      starts_from: parseAppointmentTime(query.starts_from).toISOString(),
    }),
    ...(query.starts_to && {
      starts_to: parseAppointmentTime(query.starts_to).toISOString(),
    }),
  };

  if (filters.starts_from && filters.starts_to && filters.starts_from >= filters.starts_to) {
    throw new AppError(400, 'invalid_time_range', 'starts_from must be before starts_to.');
  }

  const appointments = await repository.findAll(filters);

  return appointments.map(toAppointmentResponse);
}

export async function createAppointment(input: CreateAppointmentRequest): Promise<Appointment> {
  const record = createAppointmentRecordSchema.parse(input);

  return toAppointmentResponse(await repository.insert(record));
}

export async function updateAppointment(
  id: string,
  input: UpdateAppointmentRequest,
): Promise<Appointment> {
  const record = updateAppointmentRecordSchema.parse(input);

  const appointment = await repository.update(id, record);

  if (!appointment) {
    throw new AppError(404, 'appointment_not_found', 'The requested appointment does not exist.');
  }

  return toAppointmentResponse(appointment);
}
