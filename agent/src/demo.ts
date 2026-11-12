import {
  cli,
  defineAgent,
  ServerOptions,
  type JobContext,
} from "@livekit/agents";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { createAgent } from "./agent.ts";
import { createDemoClinic } from "./demo-clinic.ts";
import { createSession } from "./models.ts";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const states = new WeakMap<JobContext, ReturnType<typeof createDemoClinic>>();

// Explicitly isolated entrypoint: no HTTP client, call metadata, forms, or database.
export default defineAgent({
  entry: async (ctx) => {
    const language =
      (ctx.simulationContext()?.userdata().language ??
        process.env.DEMO_LANGUAGE) === "pl"
        ? "pl"
        : "en";
    const demo = createDemoClinic();

    states.set(ctx, demo);

    const { clinic, verification } = demo;
    const session = createSession(language);

    await session.start({
      agent: createAgent(language, clinic, verification, true),
      room: ctx.room,
    });

    await ctx.connect();

    session.generateReply({
      instructions: `Greet briefly in ${language === "pl" ? "Polish" : "English"}, explain this is an isolated simulation, and ask how to help with appointments.`,
    });
  },
  onSimulationEnd: (sim) => {
    const records = states.get(sim.jobContext)?.snapshot();
    const expected = sim.userdata().expectedStart;

    if (
      typeof expected === "string" &&
      (!records ||
        records.length !== 1 ||
        records[0]?.status !== "scheduled" ||
        records[0]?.startsAt !== expected ||
        records[0]?.doctorId !== "doctor-1")
    ) {
      sim.fail("The demo did not save exactly the requested appointment.");
    }

    if (sim.userdata().expectedCount === 0 && records?.length !== 0) {
      sim.fail("Unexpected demo mutation.");
    }

    states.delete(sim.jobContext);
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
