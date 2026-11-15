import { inference, voice } from "@livekit/agents";

// Change models here or through environment variables; no provider-specific keys needed.
export function createLLM() {
  return new inference.LLM({
    model: process.env.LLM_MODEL ?? "google/gemma-4-31b-it",
  });
}

export function createSession(language: "pl" | "en") {
  return new voice.AgentSession({
    stt: new inference.STT({
      model: process.env.STT_MODEL ?? "deepgram/nova-3",
      language,
    }),
    tts: new inference.TTS({
      model: process.env.TTS_MODEL ?? "xai/tts-1",
      voice: process.env.TTS_VOICE ?? "carina",
      language,
    }),
    turnHandling: {
      turnDetection: new inference.TurnDetector(),
      interruption: { mode: "adaptive" },
      preemptiveGeneration: { enabled: true },
    },
  });
}
