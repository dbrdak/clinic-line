import { defineRelations } from 'drizzle-orm';

import * as schema from './schema.js';

export const relations = defineRelations(schema, (r) => ({
  appointments: {
    doctor: r.one.doctors({
      from: r.appointments.doctorId,
      to: r.doctors.id,
    }),
    patient: r.one.patients({
      from: r.appointments.patientId,
      to: r.patients.id,
    }),
  },
  doctors: {
    appointments: r.many.appointments(),
  },
  patients: {
    appointments: r.many.appointments(),
  },
}));
