import 'dotenv/config';

import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';

import { db } from './client.js';
import { migrateDatabase } from './migrate.js';

import {
  appointments,
  type NewAppointmentRecord,
} from '../modules/appointments/appointments.table.js';
import { doctors, type NewDoctorRecord } from '../modules/doctors/doctors.table.js';
import { patients, type NewPatientRecord } from '../modules/patients/patients.table.js';

import { CLINIC_TIME_ZONE } from '../shared/time.js';

const APPOINTMENT_MINUTES = 30;
const DAYS_TO_SEED = 7;

// Fixed UUIDs for predictable demo records.
const seedDoctors = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    firstName: 'Anna',
    lastName: 'Kowalska',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    firstName: 'Piotr',
    lastName: 'Nowak',
  },
] satisfies NewDoctorRecord[];

const seedPatients = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    firstName: 'Jan',
    lastName: 'Wiśniewski',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    firstName: 'Maria',
    lastName: 'Zielińska',
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    firstName: 'Tomasz',
    lastName: 'Lewandowski',
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    firstName: 'Katarzyna',
    lastName: 'Wójcik',
  },
  {
    id: '20000000-0000-4000-8000-000000000005',
    firstName: 'Michał',
    lastName: 'Kamiński',
  },
  {
    id: '20000000-0000-4000-8000-000000000006',
    firstName: 'Aleksandra',
    lastName: 'Dąbrowska',
  },
] satisfies NewPatientRecord[];

// Generate the same valid UUID for the same appointment.
// This makes rerunning the seed safe from duplicate IDs.
function seedUuid(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex');

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

function toUtcDate(date: Temporal.PlainDate, minutesSinceMidnight: number): Date {
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;

  const localDateTime = Temporal.PlainDateTime.from({
    year: date.year,
    month: date.month,
    day: date.day,
    hour,
    minute,
  });

  const zoned = localDateTime.toZonedDateTime(CLINIC_TIME_ZONE, {
    disambiguation: 'reject',
  });

  return new Date(zoned.epochMilliseconds);
}

function generateAppointments(): NewAppointmentRecord[] {
  const today = Temporal.Now.zonedDateTimeISO(CLINIC_TIME_ZONE).toPlainDate();

  const now = Date.now();
  const records: NewAppointmentRecord[] = [];

  for (let dayOffset = 0; dayOffset < DAYS_TO_SEED; dayOffset++) {
    const date = today.add({ days: dayOffset });

    // Temporal dayOfWeek: Monday = 1, Sunday = 7.
    if (date.dayOfWeek > 5) continue;

    for (const [doctorIndex, doctor] of seedDoctors.entries()) {
      // Four appointments per doctor, with plenty of free slots.
      // Slightly vary the booked times between weekdays.
      const baseSlots =
        doctorIndex === 0
          ? [8 * 60, 10 * 60, 13 * 60, 16 * 60]
          : [9 * 60, 11 * 60, 14 * 60, 17 * 60];

      const shift = dayOffset % 2 === 0 ? 0 : 30;

      for (const [slotIndex, baseSlot] of baseSlots.entries()) {
        const startMinute = baseSlot + shift;
        const startsAt = toUtcDate(date, startMinute);

        // Never create appointments in the past.
        if (startsAt.getTime() <= now) continue;

        const endsAt = new Date(startsAt.getTime() + APPOINTMENT_MINUTES * 60_000);

        const patientIndex = (dayOffset * 3 + doctorIndex * 2 + slotIndex) % seedPatients.length;

        const patient = seedPatients[patientIndex];

        if (!patient) {
          throw new Error('No seed patient found');
        }

        records.push({
          id: seedUuid(`${date.toString()}:${doctor.id}:${startMinute.toString()}`),
          doctorId: doctor.id,
          patientId: patient.id,
          startsAt,
          endsAt,
          status: 'scheduled',
        });
      }
    }
  }

  return records;
}

async function seed(): Promise<void> {
  // Ensure schema exists before inserting anything.
  migrateDatabase();

  await db.insert(doctors).values(seedDoctors).onConflictDoNothing();

  await db.insert(patients).values(seedPatients).onConflictDoNothing();

  const appointmentRecords = generateAppointments();

  if (appointmentRecords.length > 0) {
    await db.insert(appointments).values(appointmentRecords).onConflictDoNothing();
  }

  console.log(
    `Seed completed: ${seedDoctors.length} doctors, ` +
      `${seedPatients.length} patients, ` +
      `${appointmentRecords.length} generated appointment records.`,
  );
}

seed().catch((error: unknown) => {
  console.error('Database seeding failed:', error);
  process.exitCode = 1;
});
