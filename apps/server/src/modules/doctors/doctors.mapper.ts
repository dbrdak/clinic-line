import { type Doctor } from '@clinicline/contracts/doctors';
import type { DoctorRecord } from './doctors.table.js';

export function toDoctorResponse(doctor: DoctorRecord): Doctor {
  return {
    id: doctor.id,
    first_name: doctor.firstName,
    last_name: doctor.lastName,
  };
}
