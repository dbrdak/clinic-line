import { Temporal } from '@js-temporal/polyfill';

import { AppError } from './app-error.js';

export const CLINIC_TIME_ZONE = 'Europe/Warsaw';

/** Offset-free ISO inputs are clinic-local; explicit offsets already identify an instant. */
export function parseAppointmentTime(value: string): Date {
  try {
    const instant = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      ? Temporal.Instant.from(value)
      : Temporal.PlainDateTime.from(value)
          .toZonedDateTime(CLINIC_TIME_ZONE, { disambiguation: 'reject' })
          .toInstant();

    return new Date(instant.epochMilliseconds);
  } catch {
    throw new AppError(
      400,
      'invalid_appointment_time',
      'Invalid appointment timestamp. Local times use Europe/Warsaw; nonexistent or repeated DST times require a different time or an explicit UTC offset.',
    );
  }
}
