import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

import { clinicInformationSchema } from '@clinicline/contracts';

export const clinicRoutes: FastifyPluginAsync = async (app) => {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get(
    '/',
    {
      schema: {
        response: {
          200: clinicInformationSchema,
        },
      },
    },
    async () => ({
      now: new Date().toISOString(),
      timeZone: 'Europe/Warsaw',
      opensAt: '07:00',
      closesAt: '19:00',
      appointmentMinutes: Number.parseInt(process.env.APPOINTMENT_DURATION_MINUTES ?? '30'),
      operatingDays: 'Monday–Friday',
      bookingHorizon: 'Today and the following 29 Warsaw calendar dates; future starts only.',
    }),
  );
};
