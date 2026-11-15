import { Temporal } from '@js-temporal/polyfill';

import { AppError } from './app-error.js';

export const CLINIC_TIME_ZONE = 'Europe/Warsaw';
export const APPOINTMENT_MINUTES = 30;

export function clinicLocalToDate(date: string, time: string): Date {
  try {
    const instant = Temporal.PlainDate.from(date)
      .toPlainDateTime(Temporal.PlainTime.from(time))
      .toZonedDateTime(CLINIC_TIME_ZONE, { disambiguation: 'reject' })
      .toInstant();

    return new Date(instant.epochMilliseconds);
  } catch {
    throw new AppError(
      400,
      'invalid_clinic_time',
      'Invalid, nonexistent, or ambiguous Warsaw date and time.',
    );
  }
}

export function clinicTime(instant: Date) {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(
    CLINIC_TIME_ZONE,
  );
}

export function clinicDayBounds(date: string) {
  const day = Temporal.PlainDate.from(date);

  return {
    from: clinicLocalToDate(day.toString(), '00:00'),
    to: clinicLocalToDate(day.add({ days: 1 }).toString(), '00:00'),
  };
}

export function isBookingDate(date: string, now: Date): boolean {
  const day = Temporal.PlainDate.from(date);
  const today = clinicTime(now).toPlainDate();

  return (
    day.dayOfWeek <= 5 &&
    Temporal.PlainDate.compare(day, today) >= 0 &&
    Temporal.PlainDate.compare(day, today.add({ days: 29 })) <= 0
  );
}

export function validateAppointmentTime(start: Date, end: Date, now: Date): void {
  const local = clinicTime(start);
  const closing = clinicLocalToDate(local.toPlainDate().toString(), '19:00');

  if (
    start.getTime() <= now.getTime() ||
    !isBookingDate(local.toPlainDate().toString(), now) ||
    end.getTime() - start.getTime() !== APPOINTMENT_MINUTES * 60_000 ||
    local.hour < 7 ||
    end.getTime() > closing.getTime() ||
    local.minute % 30 !== 0 ||
    local.second !== 0 ||
    local.millisecond !== 0
  ) {
    throw new AppError(
      400,
      'invalid_appointment_time',
      'Choose a future thirty-minute slot on the half hour, Monday–Friday 07:00–19:00 Warsaw time, within the next thirty calendar dates.',
    );
  }
}
