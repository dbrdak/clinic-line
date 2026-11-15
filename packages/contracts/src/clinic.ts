import { z } from 'zod';

export const clinicInformationSchema = z.object({
  now: z.iso.datetime({ offset: true }),
  timeZone: z.string(),
  opensAt: z.string(),
  closesAt: z.string(),
  appointmentMinutes: z.int32(),
  operatingDays: z.string(),
  bookingHorizon: z.string(),
});

export type ClinicInformation = z.infer<typeof clinicInformationSchema>;
