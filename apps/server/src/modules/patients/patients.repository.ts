import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { patients, type NewPatientRecord } from './patients.table.js';

export async function findById(id: string) {
  const [patient] = await db.select().from(patients).where(eq(patients.id, id)).limit(1);

  return patient ?? null;
}

export async function findAll() {
  return db.select().from(patients).orderBy(asc(patients.lastName));
}

export async function insert(input: NewPatientRecord) {
  const [patient] = await db.insert(patients).values(input).returning();

  if (!patient) {
    throw new Error('Failed to insert patient');
  }

  return patient;
}
