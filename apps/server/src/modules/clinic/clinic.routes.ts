import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

import { clinicInformationSchema } from '@clinicline/contracts';
import { clinicPolicy } from './clinic.policy.js';

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
		() => {
			return { ...clinicPolicy, now: new Date().toISOString() };
		},
	);
};
