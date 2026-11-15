import type {
  CreateAppointmentRequest,
  UpdateAppointmentRequest,
  Appointment,
  AppointmentQuerySchema,
} from '@clinicline/contracts/appointments';

import { AppError } from '../../shared/app-error.js';
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
  const patients = await repository.findAll(query);

  return patients.map(toAppointmentResponse);
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
