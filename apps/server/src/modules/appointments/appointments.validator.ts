import { Temporal } from '@js-temporal/polyfill';
import { clinicPolicy } from '../clinic/clinic.policy.js';
import type { AppointmentRecord } from './appointments.table.js';
import { AppError } from '../../shared/app-error.js';

type AppointmentSchedule = Pick<AppointmentRecord, 'startsAt' | 'endsAt'>;

export function validateAppointmentSchedule(schedule: AppointmentSchedule): void {
  const { startsAt, endsAt } = schedule;
  const { timeZone, appointmentMinutes, operatingDays } = clinicPolicy;

  const start = Temporal.Instant.fromEpochMilliseconds(startsAt.getTime()).toZonedDateTimeISO(
    timeZone,
  );

  const end = Temporal.Instant.fromEpochMilliseconds(endsAt.getTime()).toZonedDateTimeISO(timeZone);

  const now = Temporal.Now.zonedDateTimeISO(timeZone);
  const today = now.toPlainDate();

  // 1. Future appointments only
  if (startsAt.getTime() <= Date.now()) {
    throw new AppError(400, 'appointment_in_past', 'Appointment must start in the future.');
  }

  // 2. Booking horizon: today + following 29 days
  if (
    Temporal.PlainDate.compare(
      start.toPlainDate(),
      today.add({ days: clinicPolicy.bookingHorizon }),
    ) >= 0
  ) {
    throw new AppError(
      400,
      'outside_booking_horizon',
      'Appointment is outside the booking horizon.',
    );
  }

  // 3. Exactly 30 minutes
  if (endsAt.getTime() - startsAt.getTime() !== appointmentMinutes * 60_000) {
    throw new AppError(
      400,
      'invalid_appointment_duration',
      `Appointment must last ${appointmentMinutes} minutes.`,
    );
  }

  // 4. Working days
  if (!operatingDays.some((day) => day === start.dayOfWeek)) {
    throw new AppError(400, 'clinic_closed', 'The clinic is closed on the selected day.');
  }

  // 5. Working hours
  const toMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);

    if (hours === undefined || minutes === undefined) {
      throw new Error('Failed to extract hours and minutes from time string');
    }

    return hours * 60 + minutes;
  };

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  if (
    !start.toPlainDate().equals(end.toPlainDate()) ||
    startMinutes < toMinutes(clinicPolicy.opensAt) ||
    endMinutes > toMinutes(clinicPolicy.closesAt)
  ) {
    throw new AppError(
      400,
      'outside_business_hours',
      `Appointment must be between ${clinicPolicy.opensAt} and ${clinicPolicy.closesAt}.`,
    );
  }

  // 6. Valid appointment slots
  if (
    (startMinutes - toMinutes(clinicPolicy.opensAt)) % appointmentMinutes !== 0 ||
    start.second !== 0 ||
    start.millisecond !== 0 ||
    start.microsecond !== 0 ||
    start.nanosecond !== 0
  ) {
    throw new AppError(
      400,
      'invalid_appointment_slot',
      'Appointment must start on a valid 30-minute slot.',
    );
  }
}
