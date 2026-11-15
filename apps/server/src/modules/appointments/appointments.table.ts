import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { patients } from '../patients/patients.table.js';
import { doctors } from '../doctors/doctors.table.js';
import { appointmentStatuses, appointmentStatusSchema } from '@clinicline/contracts';

export const appointments = sqliteTable('appointments', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id, {
      onDelete: 'restrict',
    }),

  doctorId: text('doctor_id')
    .notNull()
    .references(() => doctors.id, {
      onDelete: 'restrict',
    }),

  startsAt: integer('starts_at', {
    mode: 'timestamp_ms',
  }).notNull(),

  endsAt: integer('ends_at', {
    mode: 'timestamp_ms',
  }).notNull(),

  status: text('status', {
    enum: appointmentStatuses,
  })
    .notNull()
    .default(appointmentStatusSchema.enum.scheduled),
});

export type AppointmentRecord = typeof appointments.$inferSelect;

export type NewAppointmentRecord = typeof appointments.$inferInsert;

export type UpdateAppointmentRecord = Partial<
  Pick<AppointmentRecord, 'startsAt' | 'endsAt' | 'status'>
>;
