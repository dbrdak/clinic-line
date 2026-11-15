import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

import {
  createPatientSchema,
  patientSchema,
  patientIdParamsSchema,
} from '@clinicline/contracts/patients';

import * as service from './patients.service.js';

export const patientRoutes: FastifyPluginAsync = async (app) => {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get(
    '/:patient_id',
    {
      schema: {
        params: patientIdParamsSchema,
      },
    },
    async (request) => service.getPatient(request.params.patient_id),
  );

  router.get('/', async () => service.getPatients());

  router.post(
    '/',
    {
      schema: {
        body: createPatientSchema,
        response: {
          201: patientSchema,
        },
      },
    },
    async (request, reply) => {
      const patient = await service.createPatient(request.body);

      return reply.code(201).send(patient);
    },
  );
};
