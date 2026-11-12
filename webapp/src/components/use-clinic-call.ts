"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  Room,
  RoomEvent,
  type RemoteParticipant,
} from "livekit-client";
import { createCallLifecycle, type CallSnapshot } from "@/lib/call-lifecycle";
import {
  callSessionSchema,
  OPEN_FORM_RPC,
  VERIFICATION_UPDATED_RPC,
  type CallSession,
  type FormRequest,
  type Language,
} from "@/lib/protocol";
import { acceptVerificationRpc } from "@/lib/verification-rpc";

type Active = { room: Room; session: CallSession; agentIdentity?: string };

const initial: CallSnapshot<Active> = {
  phase: "idle",
  value: null,
  error: false,
};

class CallApiError extends Error {
  constructor(readonly status: number) {
    super("Request failed");
  }
}

async function callApi(
  path: string,
  method: string,
  session?: CallSession,
  body?: unknown,
) {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.callProof}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new CallApiError(response.status);
  }

  return response.json() as Promise<unknown>;
}

export function useClinicCall(language: Language) {
  const [call, setCall] = useState(initial);
  const [muted, setMuted] = useState(true);
  const [micBusy, setMicBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<FormRequest | null>(null);
  const [agentState, setAgentState] = useState("disconnected");
  const [transportState, setTransportState] = useState<string>("disconnected");
  const [quality, setQuality] = useState("unknown");
  const [reconnects, setReconnects] = useState(0);
  const [rpcCount, setRpcCount] = useState(0);
  const [tracks, setTracks] = useState(0);
  const [audioReady, setAudioReady] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const formRef = useRef<FormRequest | null>(null);
  const pl = language === "pl";
  const t = (polish: string, english: string) => (pl ? polish : english);
  const manager = useRef<ReturnType<typeof createCallLifecycle<Active>> | null>(
    null,
  );

  useEffect(() => {
    manager.current = createCallLifecycle<Active>({
      issue: async (selected) =>
        callSessionSchema.parse(
          await callApi("/api/call", "POST", undefined, { language: selected }),
        ),
      release: async (session) => {
        await callApi("/api/call", "DELETE", session);
      },
      change: (snapshot) => {
        setCall(snapshot);

        if (!snapshot.value) {
          formRef.current = null;

          setForm(null);

          setMuted(true);

          setAgentState("disconnected");

          setTransportState("disconnected");

          setTracks(0);

          setQuality("unknown");
        }
      },
      create: (session) => {
        const room = new Room({ adaptiveStream: true, dynacast: true });
        const active: Active = { room, session };
        let closed = false;

        room.registerRpcMethod(OPEN_FORM_RPC, async (data) =>
          acceptVerificationRpc(data, {
            isAgent: (identity) =>
              room.remoteParticipants.get(identity)?.isAgent === true,
            received: (request) => {
              active.agentIdentity = data.callerIdentity;

              formRef.current = request;

              setRpcCount((count) => count + 1);
            },
            mute: () => room.localParticipant.setMicrophoneEnabled(false),
            open: (request) => {
              if (
                !closed &&
                formRef.current?.requestId === request.requestId &&
                room.state === ConnectionState.Connected
              ) {
                setMuted(true);

                setForm(request);
              }
            },
            failed: () => {
              if (manager.current?.current()?.connection.value === active) {
                void manager.current.end(true);
              }
            },
          }),
        );

        room.on(RoomEvent.Disconnected, () => {
          if (manager.current?.current()?.connection.value === active) {
            void manager.current.end(true);
          }
        });

        room.on(RoomEvent.ConnectionStateChanged, setTransportState);

        room.on(RoomEvent.Reconnecting, () =>
          setReconnects((count) => count + 1),
        );

        room.on(RoomEvent.ConnectionQualityChanged, (value, participant) => {
          if (participant.isLocal) {
            setQuality(value);
          }
        });

        room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
          setAudioReady(room.canPlaybackAudio),
        );

        const countTracks = () =>
          setTracks(
            [...room.remoteParticipants.values()].reduce(
              (count, participant) =>
                count +
                [...participant.audioTrackPublications.values()].filter(
                  (track) => track.isSubscribed,
                ).length,
              0,
            ),
          );

        room.on(RoomEvent.TrackSubscribed, countTracks);

        room.on(RoomEvent.TrackUnsubscribed, countTracks);

        room.on(
          RoomEvent.ParticipantDisconnected,
          (participant: RemoteParticipant) => {
            if (
              participant.isAgent &&
              manager.current?.current()?.connection.value === active
            ) {
              void manager.current?.end(true);
            }
          },
        );

        return {
          value: active,
          connect: async () => {
            await room.connect(session.serverUrl, session.token);

            if (closed) {
              await room.disconnect(true);

              throw new Error("Call ended");
            }

            await room.startAudio().catch(() => setAudioReady(false));

            if (closed) {
              throw new Error("Call ended");
            }

            await room.localParticipant.setMicrophoneEnabled(true);

            if (closed) {
              await room.disconnect(true);

              throw new Error("Call ended");
            }

            setMuted(false);
          },
          close: async () => {
            closed = true;

            room.unregisterRpcMethod(OPEN_FORM_RPC);

            await room.disconnect(true);
          },
        };
      },
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;

    document.title =
      language === "pl"
        ? "ClinicLine · Porozmawiaj z Klarą"
        : "ClinicLine · Talk to Klara";
  }, [language]);

  useEffect(
    () => () => {
      void manager.current?.end();
    },
    [],
  );

  useEffect(() => {
    if (call.phase !== "connected") {
      return;
    }

    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );

    return () => clearInterval(timer);
  }, [call.phase]);

  useEffect(() => {
    if (!call.value) {
      return;
    }

    const timeout = setTimeout(
      () => {
        void manager.current?.end();
      },
      Math.max(0, Date.parse(call.value.session.expiresAt) - Date.now()),
    );

    return () => clearTimeout(timeout);
  }, [call.value]);

  const notify = async (request: FormRequest, active: Active) => {
    if (active.agentIdentity) {
      await active.room.localParticipant
        .performRpc({
          destinationIdentity: active.agentIdentity,
          method: VERIFICATION_UPDATED_RPC,
          payload: JSON.stringify({ requestId: request.requestId }),
          responseTimeout: 5000,
        })
        .catch(() => {
          setMessage(
            t(
              "Nie udało się powiadomić Klary. Poproś o sprawdzenie statusu.",
              "Could not notify Klara. Ask her to check verification status.",
            ),
          );
        });
    }
  };
  const dismiss = () => {
    const request = formRef.current;
    const active = manager.current?.current()?.connection.value;

    formRef.current = null;

    setForm(null);

    if (request && active) {
      void callApi("/api/verification", "PATCH", active.session, {
        requestId: request.requestId,
      })
        .catch(() => {})
        .finally(() => notify(request, active));
    }
  };
  const connected = call.phase === "connected";
  const ongoing = connected || call.phase === "connecting";

  const toggleCall = () => {
    setMessage("");

    if (ongoing) {
      void manager.current?.end();
    } else {
      setElapsed(0);

      setReconnects(0);

      setRpcCount(0);

      setQuality("unknown");

      void manager.current?.start(language);
    }
  };

  const toggleMicrophone = async () => {
    const active = call.value;

    if (!active) {
      return;
    }

    setMicBusy(true);

    try {
      await active.room.localParticipant.setMicrophoneEnabled(muted);

      setMuted(!active.room.localParticipant.isMicrophoneEnabled);
    } catch {
      setMessage(
        t(
          "Nie udało się zmienić mikrofonu. Sprawdź uprawnienia przeglądarki.",
          "Microphone change failed. Check browser permissions.",
        ),
      );
    } finally {
      setMicBusy(false);
    }
  };

  const enableAudio = () => {
    void call.value?.room
      .startAudio()
      .catch(() =>
        setMessage(t("Przeglądarka blokuje dźwięk.", "Browser blocked audio.")),
      );
  };
  const submit = async (pesel: string) => {
    const active = manager.current?.current()?.connection.value;
    const request = formRef.current;
    const failure = (message: string, retryable: boolean) => ({
      message,
      retryable,
    });

    if (!active || !request) {
      return failure(
        t("Rozmowa została zakończona.", "The call has ended."),
        false,
      );
    }

    const current = () =>
      manager.current?.current()?.connection.value === active &&
      formRef.current?.requestId === request.requestId;
    const verified = async () => {
      if (current()) {
        formRef.current = null;

        setForm(null);

        setMessage(
          t(
            "Dane potwierdzone. Włącz mikrofon, aby kontynuować.",
            "Details verified. Unmute to continue.",
          ),
        );

        await notify(request, active);
      }
    };

    try {
      const result = (await callApi(
        "/api/verification",
        "POST",
        active.session,
        {
          requestId: request.requestId,
          pesel,
        },
      )) as { status: string };

      if (result.status === "verified") {
        await verified();

        return;
      }
    } catch (error) {
      if (error instanceof CallApiError && [400, 422].includes(error.status)) {
        return failure(
          t(
            "Dane nie pasują. Sprawdź fikcyjny PESEL i spróbuj ponownie. Imię i nazwisko muszą odpowiadać danym podanym Klarze. Jeśli zostały źle rozpoznane, zamknij formularz i popraw je w rozmowie.",
            "Details did not match. Check the fictional PESEL and try again. Your name must match what you told Klara. If it was misheard, dismiss the form and correct it in the call.",
          ),
          true,
        );
      }
    }

    // A lost response may hide success. Read status before offering any retry;
    // the backend's atomic consumption also protects overlapping submissions.
    try {
      const response = await fetch("/api/verification", {
        headers: {
          Authorization: `Bearer ${active.session.callProof}`,
          "X-Verification-Request": request.requestId,
        },
        cache: "no-store",
      });

      if (response.ok) {
        const result = (await response.json()) as { status: string };

        if (result.status === "verified") {
          await verified();

          return;
        }

        if (result.status === "pending") {
          return failure(
            t(
              "Nie udało się potwierdzić wysłania. Formularz jest nadal aktywny. Spróbuj ponownie.",
              "Submission could not be confirmed. The form is still active. Try again.",
            ),
            true,
          );
        }
      }
    } catch {
      // Keep the form visible, but do not blindly resubmit an unknown outcome.
    }

    if (current()) {
      await notify(request, active);
    }

    return failure(
      t(
        "Formularz jest nieaktywny lub wynik jest niepotwierdzony. Zamknij go, włącz mikrofon i poproś Klarę o sprawdzenie statusu lub nowy formularz.",
        "This form is inactive or the result is unconfirmed. Dismiss it, unmute, and ask Klara to check status or open a new form.",
      ),
      false,
    );
  };

  return {
    t,
    call,
    muted,
    micBusy,
    message,
    form,
    agentState,
    transportState,
    quality,
    reconnects,
    rpcCount,
    tracks,
    audioReady,
    elapsed,
    connected,
    ongoing,
    setAgentState,
    toggleCall,
    toggleMicrophone,
    enableAudio,
    submit,
    dismiss,
  };
}
