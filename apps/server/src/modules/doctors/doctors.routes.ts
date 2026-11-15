import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

import { doctorIdParamsSchema } from '@clinicline/contracts/doctors';
import * as service from './doctors.service.js';

export const doctorRoutes: FastifyPluginAsync = async (app) => {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get(
    '/:doctor_id',
    {
      schema: {
        params: doctorIdParamsSchema,
      },
    },
    async (request) => service.getDoctor(request.params.doctor_id),
  );

  router.get('/', async () => service.getDoctors());
};
