import { Agent } from '@livekit/agents';
import { createLLM } from './models.ts';
import { instructions } from './prompts.ts';
import { registerTools } from './tools.ts';

export function createAgent() {
	return Agent.create({
		instructions: instructions(),
		llm: createLLM(),
		tools: registerTools(),
	});
}
