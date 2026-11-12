"use client";

import { useEffect, useState } from "react";
import { RoomEvent, type RemoteParticipant, type Room } from "livekit-client";
import type { CallSession } from "@/lib/protocol";
import {
  acceptDiagnostic,
  DIAGNOSTICS_TOPIC,
  type DiagnosticEvent,
} from "@/lib/diagnostics-protocol";
import {
  createTransportSampler,
  type AudioTransport,
} from "@/lib/audio-transport";

export function useCallDiagnostics(
  active: { room: Room; session: CallSession } | null,
) {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [audio, setAudio] = useState<AudioTransport[]>([]);
  const [duplicates, setDuplicates] = useState(0);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [exportSession, setExportSession] = useState<CallSession | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    let live = true;
    let pinned: { identity: string; stream: string } | undefined;
    let history: DiagnosticEvent[] = [];
    let maximum = 0;
    const sampler = createTransportSampler();

    let started = false;
    const begin = () => {
      if (started || !live) {
        return;
      }

      started = true;

      setExportSession(active.session);

      setEvents([]);

      setAudio([]);

      setDuplicates(0);

      setReceivedAt(null);
    };
    const receive = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (!live || topic !== DIAGNOSTICS_TOPIC || !participant?.isAgent) {
        return;
      }

      const event = acceptDiagnostic(payload, active.session.callId);

      if (!event) {
        return;
      }

      if (
        pinned &&
        (pinned.identity !== participant.identity ||
          pinned.stream !== event.streamId)
      ) {
        return;
      }

      begin();

      pinned ??= { identity: participant.identity, stream: event.streamId };

      if (event.seq < maximum - 399) {
        return;
      }

      if (history.some((item) => item.seq === event.seq)) {
        setDuplicates((n) => n + 1);

        return;
      }

      maximum = Math.max(maximum, event.seq);

      history = [...history, event]
        .filter((item) => item.seq >= maximum - 399)
        .sort((a, b) => a.seq - b.seq)
        .slice(-400);

      setEvents(history);

      setReceivedAt(Date.now());
    };
    let sampling = false;
    const sample = async () => {
      if (sampling || active.room.state !== "connected") {
        return;
      }

      sampling = true;

      try {
        const next = await sampler.sample(active.room);

        if (live) {
          begin();

          setAudio(next);
        }
      } catch {
        /* Diagnostics must not affect the call. */
      } finally {
        sampling = false;
      }
    };
    const reset = () => {
      sampler.reset();

      setAudio([]);
    };

    active.room.on(RoomEvent.ConnectionStateChanged, begin);

    active.room.on(RoomEvent.DataReceived, receive);

    active.room.on(RoomEvent.Reconnecting, reset);

    active.room.on(RoomEvent.Reconnected, reset);

    const timer = setInterval(() => {
      void sample();
    }, 2000);

    void sample();

    return () => {
      live = false;

      clearInterval(timer);

      sampler.reset();

      active.room.off(RoomEvent.ConnectionStateChanged, begin);

      active.room.off(RoomEvent.DataReceived, receive);

      active.room.off(RoomEvent.Reconnecting, reset);

      active.room.off(RoomEvent.Reconnected, reset);
    };
  }, [active]);

  if (active && exportSession?.callId !== active.session.callId) {
    return {
      events: [],
      audio: [],
      duplicates: 0,
      gaps: 0,
      receivedAt: null,
      exportSession: active.session,
    };
  }

  const gaps = events.length
    ? events[events.length - 1]!.seq - events[0]!.seq + 1 - events.length
    : 0;

  return { events, audio, duplicates, gaps, receivedAt, exportSession };
}
