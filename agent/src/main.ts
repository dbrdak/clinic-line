import { ServerOptions, cli, defineAgent } from "@livekit/agents";
import { EnhancerModel, audioEnhancement } from "@livekit/plugins-ai-coustics";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RoomEvent } from "@livekit/rtc-node";
import { ClinicClient } from "./clinic-client.ts";
import { createVerificationBridge } from "./verification.ts";
import { createSession } from "./models.ts";
import { createAgent } from "./agent.ts";

dotenv.config({ path: ".env.local", quiet: true });

export default defineAgent({
  entry: async (ctx) => {
    const call = z
      .object({
        callId: z.uuid(),
        roomName: z.string(),
        participantIdentity: z.string(),
        language: z.enum(["pl", "en"]),
      })
      .parse(JSON.parse(ctx.job.metadata || "{}"));

    if (ctx.room.name && ctx.room.name !== call.roomName) {
      throw new Error("Call room mismatch.");
    }

    const secret = process.env.CLINIC_AGENT_SECRET;

    if (!secret || secret.length < 32) {
      throw new Error("CLINIC_AGENT_SECRET is required.");
    }

    const client = new ClinicClient(undefined, fetch, {
      id: call.callId,
      secret,
    });

    await ctx.connect();

    await ctx.waitForParticipant(call.participantIdentity);

    const bridge = createVerificationBridge(client, call, async (payload) => {
      if (!ctx.room.localParticipant) {
        throw new Error("Agent is disconnected.");
      }

      const ack = await ctx.room.localParticipant.performRpc({
        destinationIdentity: call.participantIdentity,
        method: "clinic.openVerification",
        payload: JSON.stringify(payload),
        responseTimeout: 5000,
      });

      if (ack !== "accepted") {
        throw new Error("Verification form is unavailable.");
      }
    });

    const cleanup = async () => {
      await client
        .request("voice/call", z.object({ ended: z.boolean() }), {
          method: "DELETE",
        })
        .catch(() => { });
    };

    ctx.addShutdownCallback(cleanup);

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === call.participantIdentity) {
        void cleanup();
      }
    });

    const session = createSession(call.language);

    await session.start({
      agent: createAgent(call.language, client, bridge),
      room: ctx.room,
      outputOptions: { transcriptionEnabled: false },
      inputOptions: {
        participantIdentity: call.participantIdentity,
        textEnabled: false,
        noiseCancellation: audioEnhancement({ model: EnhancerModel.QuailVfS }),
      },
    });

    ctx.room.localParticipant?.registerRpcMethod(
      "clinic.verificationUpdated",
      async (data) => {
        if (data.callerIdentity !== call.participantIdentity) {
          throw new Error("Unexpected participant.");
        }

        const { requestId } = z
          .object({ requestId: z.uuid() })
          .strict()
          .parse(JSON.parse(data.payload));
        const result = await bridge.status(requestId);

        session.generateReply({
          instructions: `The backend verification status is ${result.status}. Call checkPatientVerification to synchronize it. Continue in ${call.language === "pl" ? "Polish" : "English"}. This event is not caller consent to any appointment change.`,
        });

        return "accepted";
      },
    );

    session.generateReply({
      instructions: `
        Speak ${call.language === "pl" ? "Polish" : "English"}. Greet the caller briefly and calmly. Introduce yourself as Klara, the clinic's virtual receptionist,
        and ask how you can help with appointments. Follow your existing identity, capability, privacy,
        and scope instructions.`,
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "klara",
  }),
);
