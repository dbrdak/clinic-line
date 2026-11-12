"use client";

import { useEffect } from "react";
import {
  BarVisualizer,
  RoomAudioRenderer,
  RoomContext,
  useVoiceAssistant,
} from "@livekit/components-react";
import {
  ArrowUpRight,
  AudioLines,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Volume2,
} from "lucide-react";
import type { useClinicCall } from "./use-clinic-call";

function LiveAgent({ onState }: { onState(state: string): void }) {
  const { state, audioTrack } = useVoiceAssistant();

  useEffect(() => {
    onState(state);
  }, [state, onState]);

  return (
    <>
      <RoomAudioRenderer />
      <BarVisualizer
        state={state}
        {...(audioTrack ? { trackRef: audioTrack } : {})}
        barCount={7}
        className="voice-bars"
      />
    </>
  );
}

export function CallCard({
  controller,
}: {
  controller: ReturnType<typeof useClinicCall>;
}) {
  const {
    call,
    muted,
    micBusy,
    message,
    form,
    agentState,
    transportState,
    audioReady,
    connected,
    ongoing,
    setAgentState,
    toggleCall,
    toggleMicrophone,
    enableAudio,
  } = controller;
  const { t } = controller;

  return (
    <section
      className="call-card"
      aria-label={t("Rozmowa z Klarą", "Call Klara")}
    >
      <div className="card-top">
        <span className="eyebrow">
          {t("WIRTUALNA RECEPCJA", "VIRTUAL RECEPTION")}
        </span>
        <span className={`status-pill ${connected ? "live" : ""}`}>
          <i />
          {connected
            ? transportState === "connected"
              ? t("Połączono", "Connected")
              : t("Ponowne łączenie…", "Reconnecting…")
            : call.phase === "connecting"
              ? t("Łączenie…", "Connecting…")
              : call.error
                ? t("Rozłączono", "Disconnected")
                : t("Gotowa do rozmowy", "Ready to talk")}
        </span>
      </div>
      <div className={`orb ${connected ? "active" : ""}`} aria-hidden="true">
        <div>
          <AudioLines size={60} strokeWidth={1.3} />
        </div>
      </div>
      <h2>Klara</h2>
      <p className="agent-caption">
        {t("Twoja wirtualna recepcjonistka", "Your virtual receptionist")}
      </p>
      <div className="agent-state" role="status">
        {connected
          ? ({
              listening: t("Słucham…", "Listening…"),
              thinking: t("Sprawdzam…", "Thinking…"),
              speaking: t("Mówię…", "Speaking…"),
            }[agentState] ?? t("Czekam na Klarę…", "Waiting for Klara…"))
          : t(
              "Jestem tutaj, żeby pomóc Ci z wizytą.",
              "I’m here to help with your appointment.",
            )}
      </div>
      {call.value && (
        <RoomContext.Provider value={call.value.room}>
          <LiveAgent onState={setAgentState} />
        </RoomContext.Provider>
      )}
      <div className="call-controls">
        <button
          className={`call-button ${ongoing ? "end" : ""}`}
          onClick={() => {
            void toggleCall();
          }}
        >
          {ongoing ? <PhoneOff size={20} /> : <Phone size={20} />}
          {ongoing
            ? t("Zakończ rozmowę", "End call")
            : t("Porozmawiaj z Klarą", "Talk to Klara")}
          {!ongoing && <ArrowUpRight size={18} />}
        </button>
        <button
          className="mic-button"
          aria-label={
            muted
              ? t("Włącz mikrofon", "Unmute microphone")
              : t("Wycisz mikrofon", "Mute microphone")
          }
          aria-pressed={!muted}
          disabled={!connected || micBusy || Boolean(form)}
          onClick={() => {
            void toggleMicrophone();
          }}
        >
          {muted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
      </div>
      <p className="fine centered">
        {t(
          "Rozmowy całą dobę · wizyty pn.–pt. 07:00–19:00",
          "Calls 24/7 · visits Mon–Fri, 07:00–19:00",
        )}
        <br />
        Europe/Warsaw
      </p>
      {!audioReady && connected && (
        <button
          className="text-button"
          onClick={() => {
            void enableAudio();
          }}
        >
          <Volume2 size={16} />
          {t("Włącz dźwięk", "Enable audio")}
        </button>
      )}
      {(call.error || message) && (
        <p className="feedback" role="alert">
          {message ||
            t(
              "Nie udało się utrzymać połączenia. Sprawdź dostęp do mikrofonu i konfigurację serwera, a następnie spróbuj ponownie.",
              "The call could not connect or was disconnected. Check microphone access and server configuration, then try again.",
            )}
        </p>
      )}
    </section>
  );
}
