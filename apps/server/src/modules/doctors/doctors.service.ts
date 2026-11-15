import type { Doctor } from '@clinicline/contracts/doctors';

import { AppError } from '../../shared/app-error.js';
import * as repository from './doctors.repository.js';
import { toDoctorResponse } from './doctors.mapper.js';

export async function getDoctor(id: string): Promise<Doctor> {
  const doctor = await repository.findById(id);

  if (!doctor) {
    throw new AppError(404, 'doctor_not_found', 'The requested doctor does not exist.');
  }

  return toDoctorResponse(doctor);
}

export async function getDoctors(): Promise<Doctor[]> {
  const doctors = await repository.findAll();

  return doctors.map(toDoctorResponse);
}
