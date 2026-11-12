import { Agent } from "@livekit/agents";
import type { VerificationBridge } from "./verification.ts";
import type { Clinic } from "./clinic.ts";
import { createLLM } from "./models.ts";
import { instructions } from "./prompts.ts";
import { createClinicTools } from "./tools.ts";

export function createAgent(
  language: "pl" | "en",
  clinic: Clinic,
  verification: VerificationBridge,
  demo = false,
) {
  return Agent.create({
    instructions: instructions(language, demo),
    llm: createLLM(),
    tools: createClinicTools(clinic, verification),
  });
}
