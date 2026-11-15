import type { CreatePatientRequest, Patient } from '@clinicline/contracts/patients';

import { AppError } from '../../shared/app-error.js';
import * as repository from './patients.repository.js';
import { createPatientRecordSchema, toPatientResponse } from './patients.mapper.js';

export async function getPatient(id: string): Promise<Patient> {
  const patient = await repository.findById(id);

  if (!patient) {
    throw new AppError(404, 'patient_not_found', 'The requested patient does not exist.');
  }

  return toPatientResponse(patient);
}

export async function getPatients(): Promise<Patient[]> {
  const patients = await repository.findAll();

  return patients.map(toPatientResponse);
}

export async function createPatient(input: CreatePatientRequest) {
  const record = createPatientRecordSchema.parse(input);

  return toPatientResponse(await repository.insert(record));
}
