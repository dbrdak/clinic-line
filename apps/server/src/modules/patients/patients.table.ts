import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const patients = sqliteTable('patients', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  firstName: text('first_name').notNull(),

  lastName: text('last_name').notNull(),
});

export type PatientRecord = typeof patients.$inferSelect;
export type NewPatientRecord = typeof patients.$inferInsert;
