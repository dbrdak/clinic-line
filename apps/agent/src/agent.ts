import { Agent } from '@livekit/agents';
import type { Clinic } from './clinic.ts';
import { createLLM } from './models.ts';
import { instructions } from './prompts.ts';
import { createClinicTools } from './tools.ts';

export function createAgent(language: 'pl' | 'en', clinic: Clinic) {
  return Agent.create({
    instructions: instructions(language),
    llm: createLLM(),
    tools: createClinicTools(clinic),
  });
}
