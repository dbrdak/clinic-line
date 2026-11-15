import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const doctors = sqliteTable('doctors', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  firstName: text('first_name').notNull(),

  lastName: text('last_name').notNull(),
});

export type DoctorRecord = typeof doctors.$inferSelect;
export type NewDoctorRecord = typeof doctors.$inferInsert;
