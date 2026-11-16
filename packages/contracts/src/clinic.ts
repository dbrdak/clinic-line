import { z } from 'zod';

export const clinicInformationSchema = z.object({
  now: z.iso.datetime({ offset: true }),
  timeZone: z.string(),
  opensAt: z.string(),
  closesAt: z.string(),
  appointmentMinutes: z.int32(),
  operatingDays: z.array(z.int().min(1).max(7)),
  bookingHorizon: z.number(),
});

export type ClinicInformation = z.infer<typeof clinicInformationSchema>;
