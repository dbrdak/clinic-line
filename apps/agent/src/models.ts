import { inference, voice } from '@livekit/agents';

// Change models here or through environment variables; no provider-specific keys needed.
export function createLLM() {
  return new inference.LLM({
    model: process.env.LLM_MODEL ?? 'google/gemma-4-31b-it',
  });
}

export function createSession() {
  return new voice.AgentSession({
    stt: new inference.STT({
      model: process.env.STT_MODEL ?? 'google/gemini-3.5-transcribe-live',
      modelOptions: {
        language_codes: ['pl-PL', 'en-US'],
      },
    }),
    tts: new inference.TTS({
      model: process.env.TTS_MODEL ?? 'google/gemini-3.8-flash-tts',
      voice: process.env.TTS_VOICE ?? 'Zephyr',
      modelOptions: {
        language_codes: ['pl-PL', 'en-US'],
      },
    }),
    turnHandling: {
      turnDetection: new inference.TurnDetector(),
      interruption: { mode: 'adaptive' },
      preemptiveGeneration: { enabled: true },
    },
  });
}
