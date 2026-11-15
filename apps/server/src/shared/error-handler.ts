import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from './app-error.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    if (error.validation) {
      return reply.code(400).send({
        error: 'validation_error',
        message: error.message,
      });
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: error.code.toLowerCase().trim().replace(' ', '_'),
        message: error.message,
      });
    }
    request.log.error({ err: error }, 'Unexpected request error');

    return reply.code(500).send({
      error: 'internal_server_error',
      message: 'An unexpected error occurred.',
    });
  });
}
