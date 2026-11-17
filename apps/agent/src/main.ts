import { ServerOptions, cli, defineAgent } from '@livekit/agents';
import { EnhancerModel, audioEnhancement } from '@livekit/plugins-ai-coustics';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createSession } from './models.ts';
import { createAgent } from './agent.ts';

dotenv.config({ path: '.env.local', quiet: true });

export default defineAgent({
  entry: async (ctx) => {
    const session = createSession();

    await session.start({
      agent: createAgent(),
      room: ctx.room,
      outputOptions: { transcriptionEnabled: false },
      inputOptions: {
        textEnabled: false,
        noiseCancellation: audioEnhancement({ model: EnhancerModel.QuailVfS }),
      },
    });

    await ctx.connect();

    session.generateReply({
      instructions: `Greet briefly as Klara in Polish and ask how you can help with appointments.`,
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'klara',
  }),
);
