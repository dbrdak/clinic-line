import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';

import { doctors } from './doctors.table.js';

export async function findById(id: string) {
  const [doctor] = await db.select().from(doctors).where(eq(doctors.id, id)).limit(1);

  return doctor ?? null;
}

export async function findAll() {
  return db.select().from(doctors).orderBy(asc(doctors.lastName));
}
