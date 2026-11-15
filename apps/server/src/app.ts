import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { registerErrorHandler } from './shared/error-handler.js';

import { appointmentRoutes } from './modules/appointments/appointments.routes.js';
import { doctorRoutes } from './modules/doctors/doctors.routes.js';
import { patientRoutes } from './modules/patients/patients.routes.js';
import { clinicRoutes } from './modules/clinic/clinic.routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    bodyLimit: 1024 * 1024,
    requestTimeout: 30_000,
    connectionTimeout: 10_000,
    trustProxy: false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  registerErrorHandler(app);

  app.get('/health', () => ({
    status: 'ok',
  }));

  await app.register(clinicRoutes, {
    prefix: '/api/clinic',
  });

  await app.register(appointmentRoutes, {
    prefix: '/api/appointments',
  });

  await app.register(doctorRoutes, {
    prefix: '/api/doctors',
  });

  await app.register(patientRoutes, {
    prefix: '/api/patients',
  });

  return app;
}
