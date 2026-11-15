import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

import {
  appointmentIdParamsSchema,
  appointmentQuerySchema,
  appointmentSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
} from '@clinicline/contracts/appointments';

import * as service from './appointments.service.js';

export const appointmentRoutes: FastifyPluginAsync = async (app) => {
  const router = app.withTypeProvider<ZodTypeProvider>();

  router.get(
    '/:appointment_id',
    {
      schema: {
        params: appointmentIdParamsSchema,
      },
    },
    async (request) => service.getAppointment(request.params.appointment_id),
  );

  router.get(
    '/',
    {
      schema: {
        querystring: appointmentQuerySchema,
      },
    },
    async (request) => service.getAppointments(request.query),
  );

  router.post(
    '/',
    {
      schema: {
        body: createAppointmentSchema,
        response: {
          201: appointmentSchema,
        },
      },
    },
    async (request, reply) => {
      const appointment = await service.createAppointment(request.body);

      return reply.code(201).send(appointment);
    },
  );

  router.patch(
    '/appointment:_id',
    {
      schema: {
        params: appointmentIdParamsSchema,
        body: updateAppointmentSchema,
      },
    },

    (request) => service.updateAppointment(request.params.appointment_id, request.body),
  );
};
