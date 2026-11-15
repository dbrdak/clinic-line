import { createPatientSchema, type Patient } from '@clinicline/contracts/patients';
import type { NewPatientRecord, PatientRecord } from './patients.table.js';

export const createPatientRecordSchema = createPatientSchema.transform(
  (input): NewPatientRecord => ({
    firstName: input.first_name,
    lastName: input.last_name,
  }),
);

export function toPatientResponse(patient: PatientRecord): Patient {
  return {
    id: patient.id,
    first_name: patient.firstName,
    last_name: patient.lastName,
  };
}
