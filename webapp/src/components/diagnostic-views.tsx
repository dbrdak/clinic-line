import type { ReactNode } from "react";
import {
  distribution,
  latencyKeys,
  type DiagnosticEvent,
  type LatencyKey,
  type TurnEvent,
} from "@/lib/diagnostics-protocol";
import type { AudioTransport } from "@/lib/audio-transport";

const number = (value: number | undefined, unit = "ms") =>
  value === undefined
    ? "Unavailable"
    : `${value.toLocaleString("en", { maximumFractionDigits: 1 })} ${unit}`;
const at = (value: number) =>
  `${value < 0 ? "" : "+"}${(value / 1000).toFixed(2)} s`;

function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      className="diagnostic-table"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  );
}

const definitions: Record<LatencyKey, string> = {
  transcriptionDelay: "User speech ended → final transcript available.",
  endOfTurnDelay:
    "User speech ended → turn-completion decision. Can overlap transcription delay.",
  onUserTurnCompletedDelay:
    "Time spent in the agent’s onUserTurnCompleted callback.",
  llmNodeTtft:
    "LLM pipeline node → first token; not entire LLM generation time.",
  ttsNodeTtfb: "First text token → first TTS audio chunk.",
  e2eLatency:
    "User speech ended → agent response began, measured by the agent SDK. Not measured browser audibility.",
};

export function LatencyView({ events }: { events: DiagnosticEvent[] }) {
  const byMessage = new Map<string, TurnEvent>();

  for (const event of events) {
    if (event.kind === "turn") {
      byMessage.set(event.messageId, event);
    }
  }

  const turns = [...byMessage.values()].sort((a, b) => a.atMs - b.atMs);

  return (
    <>
      <Table label="Voice latency distributions">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Latest observed</th>
            <th>Eligible median</th>
            <th>Eligible p95</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {latencyKeys.map((key) => {
            const samples = turns
              .filter((t) => t.exclusion === "none")
              .flatMap((t) =>
                t.metricsMs[key] === undefined ? [] : [t.metricsMs[key]!],
              );
            const stats = distribution(samples);
            const latest = [...turns]
              .reverse()
              .find((t) => t.metricsMs[key] !== undefined);

            return (
              <tr key={key}>
                <th scope="row">
                  <abbr title={definitions[key]}>{key}</abbr>
                </th>
                <td>
                  {number(latest?.metricsMs[key])}
                  {latest && latest.exclusion !== "none" && (
                    <small>excluded: {latest.exclusion}</small>
                  )}
                </td>
                <td>{number(stats.median)}</td>
                <td>{number(stats.p95)}</td>
                <td>{stats.n}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <details className="metric-definitions">
        <summary>Definitions & exclusions</summary>
        <dl>
          {latencyKeys.map((key) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{definitions[key]}</dd>
            </div>
          ))}
        </dl>
        <p>
          These durations overlap: never add them to manufacture E2E. Proactive
          responses, human/form/confirmation waiting, interrupted replies and
          responses without matching user timing are excluded from aggregates.
          Missing/negative/nonfinite latency fields are unavailable. Greetings
          can have node timings without E2E. The SDK reports finalized assistant
          metrics when speech finishes.
        </p>
      </details>
      <h3>Chronological message timeline</h3>
      {!turns.length ? (
        <p>No per-message metrics received yet.</p>
      ) : (
        <Table label="Chronological voice turn measurements">
          <thead>
            <tr>
              <th>Observed / message</th>
              <th>Role / correlation</th>
              <th>Actual speech start–end</th>
              {latencyKeys.map((key) => (
                <th key={key}>{key} (ms)</th>
              ))}
              <th>Aggregation</th>
            </tr>
          </thead>
          <tbody>
            {turns.map((turn) => (
              <tr key={turn.messageId}>
                <th scope="row">
                  {at(turn.atMs)}
                  <small>
                    {turn.messageId} / {turn.speechId ?? "speech unavailable"}
                  </small>
                </th>
                <td>
                  {turn.role}
                  <small>
                    {turn.turnId ?? "turn unavailable"} · {turn.correlation}
                  </small>
                </td>
                <td>
                  {turn.startedAtMs === undefined
                    ? "Unavailable"
                    : at(turn.startedAtMs)}{" "}
                  –{" "}
                  {turn.stoppedAtMs === undefined
                    ? "Unavailable"
                    : at(turn.stoppedAtMs)}
                </td>
                {latencyKeys.map((key) => (
                  <td key={key}>{number(turn.metricsMs[key], "")}</td>
                ))}
                <td>
                  {turn.exclusion === "none" ? "eligible" : turn.exclusion}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

export function InterruptionView({ events }: { events: DiagnosticEvent[] }) {
  const overlaps = events.filter((e) => e.kind === "overlap");
  const recoveries = events.filter((e) => e.kind === "recovery");
  const speeches = events.filter((e) => e.kind === "speech" && e.interrupted);

  return (
    <>
      <div className="diagnostic-counts">
        <span>
          Interruptions:{" "}
          {overlaps.filter((e) => e.decision === "interruption").length}
        </span>
        <span>
          Backchannels:{" "}
          {overlaps.filter((e) => e.decision === "backchannel").length}
        </span>
        <span>
          Inconclusive:{" "}
          {overlaps.filter((e) => e.decision === "inconclusive").length}
        </span>
        <span>Interrupted speeches: {speeches.length}</span>
        <span>Recoveries: {recoveries.filter((e) => e.resumed).length}</span>
      </div>
      <p className="fine">
        Inconclusive means agentEnded=true: the agent finished before an
        interruption verdict. It is not a confirmed backchannel. Detection
        delay, model inference and request RTT are separate overlapping
        measurements; do not add them. Exact overlap/recovery speech IDs are
        unavailable in these public events.
      </p>
      {!overlaps.length ? (
        <p>
          Unavailable — no overlap decision reported yet. Try “mhm” during
          speech, then a longer correction.
        </p>
      ) : (
        <Table label="Adaptive interruption decisions">
          <thead>
            <tr>
              <th>Observed</th>
              <th>Decision</th>
              <th>Detection delay</th>
              <th>Inference duration</th>
              <th>Request RTT</th>
              <th>Requests</th>
            </tr>
          </thead>
          <tbody>
            {overlaps.map((e) => (
              <tr key={e.seq}>
                <th scope="row">{at(e.atMs)}</th>
                <td>{e.decision}</td>
                <td>{number(e.detectionMs)}</td>
                <td>{number(e.inferenceMs)}</td>
                <td>{number(e.rttMs)}</td>
                <td>{e.requests ?? "Unavailable"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <h3>Interrupted speech & false-interruption recovery</h3>
      {!speeches.length && !recoveries.length ? (
        <p>No interrupted speech or recovery event reported yet.</p>
      ) : (
        <ul className="diagnostic-events">
          {events.flatMap((e) =>
            e.kind === "speech" && e.interrupted
              ? [
                  <li key={e.seq}>
                    {at(e.atMs)} · {e.speechId} interrupted; messages{" "}
                    {e.messageIds.join(", ") || "unavailable"}. Text
                    intentionally omitted.
                  </li>,
                ]
              : e.kind === "recovery"
                ? [
                    <li key={e.seq}>
                      {at(e.atMs)} · False interruption · automatic resume:{" "}
                      {e.resumed ? "yes" : "no"}. Exact speech correlation
                      unavailable.
                    </li>,
                  ]
                : [],
          )}
        </ul>
      )}
    </>
  );
}

export function TransportView({
  audio,
  connected,
}: {
  audio: AudioTransport[];
  connected: boolean;
}) {
  return (
    <>
      <p className="fine">
        {connected
          ? "Live sampling."
          : "Call ended or not started; any values below are the last snapshot."}
      </p>
      {!audio.length ? (
        <p>
          Unavailable — waiting for published/subscribed audio tracks and
          browser stats.
        </p>
      ) : (
        audio.map((row) => (
          <section className="transport-card" key={row.track}>
            <h3>
              {row.direction === "uplink"
                ? "↑ Browser microphone → LiveKit"
                : "↓ LiveKit agent audio → browser"}{" "}
              <small>{row.track}</small>
            </h3>
            <dl>
              {[
                [
                  "RTT",
                  `${number(row.rttMs)}${row.rttSource ? ` · ${row.rttSource}` : ""}`,
                ],
                [
                  "Jitter",
                  `${number(row.jitterMs)} · ${row.direction === "uplink" ? "reported by SFU receiver" : "browser receiver"}`,
                ],
                [
                  "Interval packet loss",
                  `${number(row.lossPercent, "%")} / report interval ${number(row.lossIntervalMs)}${row.lossEstimate ? " · estimate (asynchronous RTCP / sent packets)" : ""}`,
                ],
                [
                  "Interval bitrate",
                  `${number(row.bitrateKbps, "kbit/s")} · derived from byte deltas`,
                ],
                [
                  "Average jitter-buffer delay",
                  row.direction === "uplink"
                    ? "Unavailable — remote receiver buffer not exposed"
                    : `${number(row.jitterBufferMs)} · Δdelay / Δemitted`,
                ],
                [
                  "Concealed audio samples",
                  row.direction === "uplink"
                    ? "Unavailable — remote receiver samples not exposed"
                    : `${number(row.concealedSamples, "samples / interval")} (${number(row.concealedSamplesPerSecond, "samples/s")})`,
                ],
                [
                  "Concealment events",
                  row.direction === "uplink"
                    ? "Unavailable — remote receiver events not exposed"
                    : number(row.concealmentEvents, "events / interval"),
                ],
                ["Sampling interval", number(row.intervalMs)],
                [
                  "Selected ICE candidates",
                  `${row.localCandidate ?? "Unavailable"} (local) ↔ ${row.remoteCandidate ?? "Unavailable"} (remote)`,
                ],
                ["ICE transport protocol", row.protocol ?? "Unavailable"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
    </>
  );
}

export function ToolsView({ events }: { events: DiagnosticEvent[] }) {
  const toolEvents = events.filter((e) => e.kind === "tool");
  const starts = toolEvents.filter((e) => e.phase === "start");
  const http = events.filter((e) => e.kind === "http");
  const ends = toolEvents.filter((e) => e.phase === "end");
  const tools = [
    ...starts,
    ...ends.filter(
      (end) => !starts.some((start) => start.toolId === end.toolId),
    ),
  ].sort((a, b) => a.atMs - b.atMs);
  const waits: { reason: string; start: number; end?: number }[] = [];

  for (const event of events) {
    if (event.kind === "wait") {
      if (event.active) {
        waits.push({ reason: event.reason, start: event.atMs });
      } else {
        const wait = [...waits]
          .reverse()
          .find((w) => w.reason === event.reason && w.end === undefined);

        if (wait) {
          wait.end = event.atMs;
        }
      }
    }
  }

  return (
    <>
      {!tools.length ? (
        <p>No tool execution reported yet.</p>
      ) : (
        <Table label="Tool execution timeline">
          <thead>
            <tr>
              <th>Start / tool</th>
              <th>IDs</th>
              <th>End / outcome</th>
              <th>Total tool duration</th>
              <th>Individual HTTP durations</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((start) => {
              const end = ends.find((e) => e.toolId === start.toolId);
              const requests = http.filter(
                (e) => e.phase === "end" && e.toolId === start.toolId,
              );

              return (
                <tr key={start.toolId}>
                  <th scope="row">
                    {start.phase === "start"
                      ? at(start.atMs)
                      : "Start unavailable"}
                    <small>{start.name}</small>
                  </th>
                  <td>
                    {start.toolId}
                    <small>{start.speechId ?? "speech unavailable"}</small>
                  </td>
                  <td>
                    {end
                      ? `${at(end.atMs)} · ${end.outcome ?? "unavailable"}`
                      : "Running / end unavailable"}
                  </td>
                  <td>{number(end?.durationMs)}</td>
                  <td>
                    {requests.length
                      ? requests.map((e) => (
                          <small key={e.requestId}>
                            {e.operation}: {number(e.durationMs)} · {e.outcome}
                          </small>
                        ))
                      : "No completed HTTP request reported"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <details className="metric-definitions" open>
        <summary>
          All clinic HTTP requests (including status RPC / cleanup)
        </summary>
        <ul className="diagnostic-events">
          {http.map((e) => (
            <li key={e.seq}>
              {at(e.atMs)} · {e.requestId} · {e.operation} ·{" "}
              {e.toolId ?? "no tool context"} · {e.phase}
              {e.phase === "end"
                ? ` · ${number(e.durationMs)} · ${e.outcome}`
                : ""}
            </li>
          ))}
        </ul>
      </details>

      <h3>Human waiting — excluded from response performance</h3>
      {!waits.length ? (
        <p>No form/confirmation wait interval recorded.</p>
      ) : (
        <ul className="diagnostic-events">
          {waits.map((wait) => (
            <li key={wait.start}>
              {wait.reason} · {at(wait.start)} →{" "}
              {wait.end === undefined
                ? "waiting / end unavailable"
                : `${at(wait.end)} · ${number(wait.end - wait.start)}`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
