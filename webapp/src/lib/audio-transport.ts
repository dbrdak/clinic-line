import { LocalAudioTrack, RemoteAudioTrack, type Room } from "livekit-client";

type Row = Record<string, unknown>;

type Counters = {
  id: string;
  timestamp: number;
  bytes?: number;
  sent?: number;
  packets?: number;
  lost?: number;
  delay?: number;
  emitted?: number;
  samples?: number;
  concealments?: number;
};

export type AudioTransport = {
  direction: "uplink" | "downlink";
  track: string;
  sampledAt: number;
  intervalMs?: number;
  bitrateKbps?: number;
  lossPercent?: number;
  lossIntervalMs?: number;
  lossEstimate?: boolean;
  jitterMs?: number;
  rttMs?: number;
  rttSource?: "RTCP RR estimate" | "local ICE";
  jitterBufferMs?: number;
  concealedSamples?: number;
  concealmentEvents?: number;
  concealedSamplesPerSecond?: number;
  protocol?: string;
  localCandidate?: string;
  remoteCandidate?: string;
};

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const delta = (a: number | undefined, b: number | undefined) =>
  a !== undefined && b !== undefined && a >= b ? a - b : undefined;
const secondsToMs = (v: unknown) =>
  num(v) === undefined ? undefined : num(v)! * 1000;
const candidate = (v: unknown) =>
  typeof v === "string" && ["host", "srflx", "prflx", "relay"].includes(v)
    ? v
    : undefined;
const setNumber = (
  target: AudioTransport,
  key: keyof AudioTransport,
  value: number | undefined,
) => {
  if (value !== undefined && Number.isFinite(value) && value >= 0) {
    Object.assign(target, { [key]: value });
  }
};

/** Track-local counters; no peer-connection internals, addresses, SDP, or raw stats escape. */
export function createTransportSampler() {
  const previous = new Map<string, Counters>();
  const remoteLoss = new Map<string, Counters>();
  let epoch = 0;

  return {
    reset() {
      previous.clear();

      remoteLoss.clear();

      epoch++;
    },
    async sample(room: Room): Promise<AudioTransport[]> {
      const generation = epoch;
      const tracks: (LocalAudioTrack | RemoteAudioTrack)[] = [];

      for (const publication of room.localParticipant.audioTrackPublications.values()) {
        if (publication.track instanceof LocalAudioTrack) {
          tracks.push(publication.track);
        }
      }

      for (const participant of room.remoteParticipants.values()) {
        if (!participant.isAgent) {
          continue;
        }

        for (const publication of participant.audioTrackPublications.values()) {
          if (publication.track instanceof RemoteAudioTrack) {
            tracks.push(publication.track);
          }
        }
      }

      const seen = new Set<string>();
      const results = await Promise.all(
        tracks.map(async (track, index) => {
          const uplink = track instanceof LocalAudioTrack;

          try {
            const [summary, report] = await Promise.all([
              uplink ? track.getSenderStats() : track.getReceiverStats(),
              track.getRTCStatsReport(),
            ]);

            if (!report || generation !== epoch) {
              return undefined;
            }

            const rows: Row[] = [];

            report.forEach((entry) => rows.push(entry as Row));

            const rtp = rows.find(
              (r) =>
                r.type === (uplink ? "outbound-rtp" : "inbound-rtp") &&
                (r.kind === "audio" || r.mediaType === "audio") &&
                (!summary?.streamId || r.id === summary.streamId),
            );

            if (
              !rtp ||
              typeof rtp.id !== "string" ||
              num(rtp.timestamp) === undefined
            ) {
              return undefined;
            }

            const key = `${uplink ? "up" : "down"}:${rtp.id}`;

            seen.add(key);

            const current: Counters = {
              id: rtp.id,
              timestamp: num(rtp.timestamp)!,
              ...(num(uplink ? rtp.bytesSent : rtp.bytesReceived) !== undefined
                ? { bytes: num(uplink ? rtp.bytesSent : rtp.bytesReceived)! }
                : {}),
              ...(num(uplink ? rtp.packetsSent : rtp.packetsReceived) !==
              undefined
                ? {
                    packets: num(
                      uplink ? rtp.packetsSent : rtp.packetsReceived,
                    )!,
                  }
                : {}),
              ...(num(rtp.packetsLost) !== undefined
                ? { lost: num(rtp.packetsLost)! }
                : {}),
              ...(num(rtp.jitterBufferDelay) !== undefined
                ? { delay: num(rtp.jitterBufferDelay)! }
                : {}),
              ...(num(rtp.jitterBufferEmittedCount) !== undefined
                ? { emitted: num(rtp.jitterBufferEmittedCount)! }
                : {}),
              ...(num(rtp.concealedSamples) !== undefined
                ? { samples: num(rtp.concealedSamples)! }
                : {}),
              ...(num(rtp.concealmentEvents) !== undefined
                ? { concealments: num(rtp.concealmentEvents)! }
                : {}),
            };
            const last = previous.get(key);

            previous.set(key, current);

            const elapsed = last ? current.timestamp - last.timestamp : 0;
            const valid = last && elapsed > 0 && elapsed <= 15000;
            const result: AudioTransport = {
              direction: uplink ? "uplink" : "downlink",
              track: `${uplink ? "mic" : "agent"}-${index + 1}`,
              sampledAt: Date.now(),
            };

            if (valid) {
              result.intervalMs = elapsed;

              const bytes = delta(current.bytes, last.bytes);

              if (bytes !== undefined) {
                setNumber(result, "bitrateKbps", (bytes * 8) / elapsed);
              }

              if (!uplink) {
                const received = delta(current.packets, last.packets);
                const lost = delta(current.lost, last.lost);

                if (
                  received !== undefined &&
                  lost !== undefined &&
                  received + lost > 0
                ) {
                  setNumber(
                    result,
                    "lossPercent",
                    (100 * lost) / (received + lost),
                  );
                }

                const delay = delta(current.delay, last.delay),
                  emitted = delta(current.emitted, last.emitted);

                if (
                  delay !== undefined &&
                  emitted !== undefined &&
                  emitted > 0
                ) {
                  setNumber(result, "jitterBufferMs", (delay * 1000) / emitted);
                }

                const samples = delta(current.samples, last.samples);

                setNumber(result, "concealedSamples", samples);

                if (samples !== undefined) {
                  setNumber(
                    result,
                    "concealedSamplesPerSecond",
                    (samples * 1000) / elapsed,
                  );
                }

                setNumber(
                  result,
                  "concealmentEvents",
                  delta(current.concealments, last.concealments),
                );
              }
            }

            const transport = report.get(String(rtp.transportId)) as
              Row | undefined;
            const pair = transport?.selectedCandidatePairId
              ? (report.get(String(transport.selectedCandidatePairId)) as
                  Row | undefined)
              : undefined;

            if (pair) {
              const local = report.get(String(pair.localCandidateId)) as
                Row | undefined;
              const remote = report.get(String(pair.remoteCandidateId)) as
                Row | undefined;
              const localType = candidate(local?.candidateType),
                remoteType = candidate(remote?.candidateType);

              if (localType) {
                result.localCandidate = localType;
              }

              if (remoteType) {
                result.remoteCandidate = remoteType;
              }

              if (local?.protocol === "udp" || local?.protocol === "tcp") {
                result.protocol = local.protocol;
              }

              const rtt = secondsToMs(pair.currentRoundTripTime);

              if (rtt !== undefined) {
                result.rttMs = rtt;

                result.rttSource = "local ICE";
              }
            }

            setNumber(result, "jitterMs", secondsToMs(summary?.jitter));

            if (uplink) {
              const remote = report.get(String(rtp.remoteId)) as
                Row | undefined;

              if (
                remote &&
                typeof remote.id === "string" &&
                num(remote.timestamp) !== undefined
              ) {
                const rtt = secondsToMs(
                  summary?.type === "audio" && "roundTripTime" in summary
                    ? summary.roundTripTime
                    : undefined,
                );

                if (rtt !== undefined) {
                  result.rttMs = rtt;

                  result.rttSource = "RTCP RR estimate";
                }

                const before = remoteLoss.get(key);

                if (!before || before.timestamp !== remote.timestamp) {
                  const remoteCurrent: Counters = {
                    id: remote.id,
                    timestamp: num(remote.timestamp)!,
                    ...(num(remote.packetsLost) !== undefined
                      ? { lost: num(remote.packetsLost)! }
                      : {}),
                    ...(num(remote.packetsReceived) !== undefined
                      ? { packets: num(remote.packetsReceived)! }
                      : {}),
                    ...(current.packets !== undefined
                      ? { sent: current.packets }
                      : {}),
                  };

                  remoteLoss.set(key, remoteCurrent);

                  if (
                    before &&
                    before.id === remoteCurrent.id &&
                    remoteCurrent.timestamp > before.timestamp &&
                    remoteCurrent.timestamp - before.timestamp <= 15000
                  ) {
                    const lost = delta(remoteCurrent.lost, before.lost);
                    const received = delta(
                      remoteCurrent.packets,
                      before.packets,
                    );
                    const sent = delta(remoteCurrent.sent, before.sent);

                    if (lost !== undefined) {
                      if (received !== undefined && received + lost > 0) {
                        setNumber(
                          result,
                          "lossPercent",
                          (100 * lost) / (received + lost),
                        );
                      } else if (
                        sent !== undefined &&
                        sent > 0 &&
                        lost <= sent
                      ) {
                        setNumber(result, "lossPercent", (100 * lost) / sent);

                        result.lossEstimate = true;
                      }

                      if (result.lossPercent !== undefined) {
                        result.lossIntervalMs =
                          remoteCurrent.timestamp - before.timestamp;
                      }
                    }
                  }
                }
              }
            }

            if (result.lossPercent !== undefined && !uplink) {
              result.lossIntervalMs = elapsed;
            }

            return result;
          } catch {
            return undefined;
          }
        }),
      );

      if (generation !== epoch) {
        return [];
      }

      for (const key of previous.keys()) {
        if (!seen.has(key)) {
          previous.delete(key);

          remoteLoss.delete(key);
        }
      }

      return results.filter(
        (result): result is AudioTransport => result !== undefined,
      );
    },
  };
}
