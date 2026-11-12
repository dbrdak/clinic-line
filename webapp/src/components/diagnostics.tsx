"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  distribution,
  latencyKeys,
  type TurnEvent,
} from "@/lib/diagnostics-protocol";
import type { useClinicCall } from "./use-clinic-call";
import {
  LatencyView,
  InterruptionView,
  TransportView,
  ToolsView,
} from "./diagnostic-views";

export function Diagnostics({
  controller,
}: {
  controller: ReturnType<typeof useClinicCall>;
}) {
  const {
    diagnostics: { events, audio, duplicates, gaps, receivedAt, exportSession },
  } = controller;
  const [downloading, setDownloading] = useState<"transcript" | "logs" | null>(
    null,
  );
  const [downloadMessage, setDownloadMessage] = useState("");
  const latestCall = useRef(exportSession?.callId);

  useEffect(() => {
    latestCall.current = exportSession?.callId;
  }, [exportSession?.callId]);

  const save = (kind: string, value: unknown) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;

    anchor.download = `clinicline-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    document.body.appendChild(anchor);

    anchor.click();

    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadMetrics = () => {
    const messages = new Map<string, TurnEvent>();

    for (const event of events) {
      if (event.kind === "turn") {
        messages.set(event.messageId, event);
      }
    }

    const turns = [...messages.values()].sort((a, b) => a.atMs - b.atMs);
    const latency = Object.fromEntries(
      latencyKeys.map((key) => {
        const samples = turns
          .filter((turn) => turn.exclusion === "none")
          .flatMap((turn) =>
            turn.metricsMs[key] === undefined ? [] : [turn.metricsMs[key]!],
          );
        const stats = distribution(samples);

        return [
          key,
          {
            medianMs: stats.median ?? null,
            p95Ms: stats.p95 ?? null,
            n: stats.n,
          },
        ];
      }),
    );

    save("metrics", {
      version: 1,
      exportedAt: new Date().toISOString(),
      source: "Agent diagnostic events and browser-local LiveKit audio stats",
      scope:
        "Current/last call; up to 400 retained events and latest audio snapshot. Missing fields are unavailable, not zero. No transcript or tool payloads.",
      units: {
        eventTimes: "ms relative to agent origin",
        latency: "ms",
        audioSampledAt: "Unix epoch ms",
        bitrate: "kbps",
        loss: "%",
        callDuration: "s",
      },
      overview: {
        connection: controller.transportState,
        agentState: controller.agentState,
        muted: controller.muted,
        quality: controller.quality,
        durationSeconds: controller.elapsed,
        reconnects: controller.reconnects,
        audioTracks: controller.tracks,
        formRpcRequests: controller.rpcCount,
      },
      history: { limit: 400, duplicates, gaps, receivedAt },
      latency,
      events,
      audio,
    });

    setDownloadMessage("Metrics downloaded.");
  };
  const downloadCloud = async (kind: "transcript" | "logs") => {
    if (!exportSession || downloading) {
      return;
    }

    const call = exportSession;

    setDownloading(kind);

    setDownloadMessage("");

    try {
      const response = await fetch(`/api/diagnostics/export?kind=${kind}`, {
        headers: { Authorization: `Bearer ${call.callProof}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const data: unknown = await response.json();

      if (latestCall.current !== call.callId) {
        return;
      }

      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Cloud export failed. Try again later.";

        setDownloadMessage(message);

        return;
      }

      save(kind, data);

      setDownloadMessage(
        `${kind === "transcript" ? "Transcript" : "Agent log metadata"} downloaded. Cloud data may still be settling; see dataStatus in the file.`,
      );
    } catch {
      if (latestCall.current === call.callId) {
        setDownloadMessage(
          "Cloud export could not complete. Wait and try again.",
        );
      }
    } finally {
      setDownloading(null);
    }
  };
  const views = [
    ["latency", "Turn latency"],
    ["interruptions", "Interruptions"],
    ["transport", "Audio transport"],
    ["tools", "Tools & HTTP"],
  ] as const;

  return (
    <section className="diagnostics" aria-labelledby="diagnostics-title">
      <div className="diagnostics-toolbar">
        <div className="diagnostics-heading">
          <p className="eyebrow">LIVEKIT · SESSION OBSERVABILITY</p>
          <h1 id="diagnostics-title">Diagnostics lab</h1>
          <p className="fine">
            Real call measurements, from the voice pipeline to audio transport
          </p>
        </div>
        <div
          className="diagnostic-downloads"
          role="group"
          aria-label="Download call data"
        >
          <button
            type="button"
            onClick={downloadMetrics}
            title="Download retained metrics as JSON"
          >
            <Download size={14} aria-hidden="true" /> Metrics JSON
          </button>
          <button
            type="button"
            disabled={!exportSession || Boolean(downloading)}
            onClick={() => void downloadCloud("transcript")}
            title="Cloud transcript; available after the call and PII processing"
          >
            <Download size={14} aria-hidden="true" />
            {downloading === "transcript" ? "Downloading…" : "Transcript"}
          </button>
          <button
            type="button"
            disabled={!exportSession || Boolean(downloading)}
            onClick={() => void downloadCloud("logs")}
            title="Cloud agent log timestamps and severity; free-form messages and payloads excluded"
          >
            <Download size={14} aria-hidden="true" />
            {downloading === "logs" ? "Downloading…" : "Agent logs"}
          </button>
        </div>
      </div>
      <p className="fine">
        Cloud downloads need server-side Admin authentication. Transcript: after
        call processing. Logs: timestamps and severity only; free-form messages
        and payloads excluded.
      </p>
      <p className="fine" role="status" aria-live="polite">
        {downloadMessage}
      </p>
      <h2>Call overview</h2>
      <p className="fine">
        Source: browser SDK events and the local call timer. Counters describe
        the current call; quality is unavailable before connection.
      </p>
      <dl className="diagnostic-overview">
        {[
          ["Connection", controller.transportState],
          ["Agent state", controller.agentState],
          ["Microphone", controller.muted ? "muted" : "on"],
          [
            "Quality",
            controller.quality === "unknown"
              ? "Unavailable"
              : controller.quality,
          ],
          ["Call duration", `${controller.elapsed} s`],
          ["Reconnects (count)", `${controller.reconnects}`],
          ["Audio tracks (count)", `${controller.tracks}`],
          ["Form RPC requests (count)", `${controller.rpcCount}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="fine">
        Agent events: {events.length}/400 · duplicates: {duplicates} · sequence
        gaps in retained history: {gaps}.{" "}
        {receivedAt
          ? "Last packet received" +
            ` ${new Date(receivedAt).toLocaleTimeString("en-GB")} (browser clock).`
          : "Agent diagnostics unavailable — awaiting first packet."}
      </p>
      <nav className="diagnostic-tabs" aria-label="Diagnostic views">
        {views.map(([key, label]) => (
          <a key={key} href={`#diagnostic-${key}`}>
            {label}
          </a>
        ))}
      </nav>
      {views.map(([key, label]) => (
        <section
          className="diagnostic-view"
          id={`diagnostic-${key}`}
          key={key}
          aria-labelledby={`heading-${key}`}
        >
          <h2 id={`heading-${key}`}>{label}</h2>
          {key === "latency" ? (
            <LatencyView events={events} />
          ) : key === "interruptions" ? (
            <InterruptionView events={events} />
          ) : key === "transport" ? (
            <TransportView
              audio={audio}
              connected={controller.transportState === "connected"}
            />
          ) : (
            <ToolsView events={events} />
          )}
        </section>
      ))}
      <p className="fine">
        Current / last call only. Bounded in-memory history clears on a new call
        or refresh. These are not measurements of sound heard by the user.
      </p>
    </section>
  );
}
