import { ServerOptions, cli, defineAgent } from '@livekit/agents';
import { EnhancerModel, audioEnhancement } from '@livekit/plugins-ai-coustics';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { RoomEvent } from '@livekit/rtc-node';
import { ClinicClient } from './clinic-client.ts';
import { createSession } from './models.ts';
import { createAgent } from './agent.ts';

dotenv.config({ path: '.env.local', quiet: true });

export default defineAgent({
  entry: async (ctx) => {
    const call = z
      .object({
        callId: z.uuid(),
        roomName: z.string(),
        participantIdentity: z.string(),
        language: z.enum(['pl', 'en']),
      })
      .parse(JSON.parse(ctx.job.metadata || '{}'));

    if (ctx.room.name && ctx.room.name !== call.roomName) {
      throw new Error('Call room mismatch.');
    }

    const secret = process.env.CLINIC_AGENT_SECRET;

    if (!secret || secret.length < 32) {
      throw new Error('CLINIC_AGENT_SECRET is required.');
    }

    const client = new ClinicClient(undefined, fetch, {
      id: call.callId,
      secret,
    });

    await ctx.connect();

    await ctx.waitForParticipant(call.participantIdentity);

    const cleanup = async () => {
      await client
        .request('voice/call', z.object({ ended: z.boolean() }), {
          method: 'DELETE',
        })
        .catch();
    };

    ctx.addShutdownCallback(cleanup);

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === call.participantIdentity) {
        void cleanup();
      }
    });

    const session = createSession(call.language);

    await session.start({
      agent: createAgent(call.language, client),
      room: ctx.room,
      outputOptions: { transcriptionEnabled: false },
      inputOptions: {
        participantIdentity: call.participantIdentity,
        textEnabled: false,
        noiseCancellation: audioEnhancement({ model: EnhancerModel.QuailVfS }),
      },
    });

    ctx.room.localParticipant?.registerRpcMethod('clinic.verificationUpdated', async (data) => {
      if (data.callerIdentity !== call.participantIdentity) {
        throw new Error('Unexpected participant.');
      }

      return 'accepted';
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'klara',
  }),
);
