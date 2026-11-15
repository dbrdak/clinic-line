import { and, asc, eq, gte, lt } from 'drizzle-orm';

import type { AppointmentQuerySchema } from '@clinicline/contracts/appointments';

import { db } from '../../db/client.js';
import {
  appointments,
  type NewAppointmentRecord,
  type UpdateAppointmentRecord,
} from './appointments.table.js';

export async function findById(id: string) {
  const [appointment] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, id))
    .limit(1);

  return appointment ?? null;
}

export async function findAll(filters: AppointmentQuerySchema) {
  return db
    .select()
    .from(appointments)
    .where(
      and(
        filters.starts_from ? gte(appointments.startsAt, new Date(filters.starts_from)) : undefined,

        filters.starts_to ? lt(appointments.startsAt, new Date(filters.starts_to)) : undefined,

        filters.doctor_id ? eq(appointments.doctorId, filters.doctor_id) : undefined,

        filters.patient_id ? eq(appointments.patientId, filters.patient_id) : undefined,

        filters.status ? eq(appointments.status, filters.status) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

export async function insert(input: NewAppointmentRecord) {
  const [appointment] = await db.insert(appointments).values(input).returning();

  if (!appointment) {
    throw new Error('Failed to insert appointment');
  }

  return appointment;
}

export async function update(id: string, input: UpdateAppointmentRecord) {
  const [appointment] = await db
    .update(appointments)
    .set(input)
    .where(eq(appointments.id, id))
    .returning();

  return appointment ?? null;
}
