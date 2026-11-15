import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { llm, voice } from "@livekit/agents";

export const DIAGNOSTICS_TOPIC = "clinic.diagnostics.v1";

export const TOOL_NAMES = [
  "getClinicInformation",
  "verifyPatient",
  "checkPatientVerification",
  "findAvailableSlots",
  "lookupAppointments",
  "prepareAppointmentChange",
  "confirmAppointmentChange",
  "discardAppointmentChange",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type Outcome = "success" | "error" | "cancelled";

export type Context = { toolId?: string; speechId?: string };

export const LATENCIES = [
  "transcriptionDelay",
  "endOfTurnDelay",
  "onUserTurnCompletedDelay",
  "llmNodeTtft",
  "ttsNodeTtfb",
  "e2eLatency",
] as const;

export type Latency = (typeof LATENCIES)[number];

export type DiagnosticData =
  | { kind: "ready" }
  | {
      kind: "turn";
      messageId: string;
      role: "user" | "assistant";
      turnId?: string;
      speechId?: string;
      correlation: "self" | "sdk-timing" | "unavailable";
      metricsMs: Partial<Record<Latency, number>>;
      startedAtMs?: number;
      stoppedAtMs?: number;
      interrupted: boolean;
      exclusion:
        "none" | "proactive" | "human-wait" | "interrupted" | "no-user-timing";
    }
  | {
      kind: "speech";
      speechId: string;
      messageIds: string[];
      interrupted: boolean;
    }
  | {
      kind: "overlap";
      speechId?: string;
      decision: "interruption" | "backchannel" | "inconclusive";
      detectionMs?: number;
      inferenceMs?: number;
      rttMs?: number;
      requests?: number;
    }
  | { kind: "recovery"; resumed: boolean }
  | {
      kind: "tool";
      toolId: string;
      speechId?: string;
      name: ToolName;
      phase: "start" | "end";
      outcome?: Outcome;
      durationMs?: number;
    }
  | ({
      kind: "http";
      requestId: string;
      operation:
        | "clinic"
        | "availability"
        | "lookup"
        | "appointment-write"
        | "verification"
        | "call"
        | "other";
      phase: "start" | "end";
      durationMs?: number;
      outcome?: Outcome;
    } & Context)
  | { kind: "wait"; reason: "form" | "confirmation"; active: boolean };

export type DiagnosticEvent = DiagnosticData & {
  v: 1;
  callId: string;
  streamId: string;
  seq: number;
  atMs: number;
};

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const duration = (n: unknown) => (finite(n) && n >= 0 ? n * 1000 : undefined);

// A diagnostic callback must never break the session event emitter.
function safeObserver<T>(observer: (event: T) => void) {
  return (event: T) => {
    try {
      observer(event);
    } catch {
      /* Discard telemetry failures. */
    }
  };
}

/** Projection, not serialization of SDK objects. No content, extra, provider IDs or errors. */
export function mapTurnMetrics(metrics: llm.MetricsReport) {
  const result: Partial<Record<Latency, number>> = {};

  for (const key of LATENCIES) {
    const value = duration(metrics[key]);

    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

export class CallDiagnostics {
  private readonly streamId = randomUUID();
  private readonly epoch = Date.now();
  private readonly started = performance.now();
  private readonly context = new AsyncLocalStorage<Context>();
  private readonly ids = new Map<string, string>();
  private readonly userEnds: { stopped: number; turnId: string }[] = [];
  private readonly queue: DiagnosticEvent[] = [];
  private seq = 0;
  private idSequence = 0;
  private draining = false;
  private closed = false;
  private proactiveDepth = 0;
  private waits = new Set<"form" | "confirmation">();
  private disposers: (() => void)[] = [];
  private speechCleanup = new Set<() => void>();

  constructor(
    privateCallId: string,
    send: (event: DiagnosticEvent) => Promise<void>,
  ) {
    this.callId = privateCallId;

    this.send = send;
  }
  private readonly callId: string;
  private readonly send: (event: DiagnosticEvent) => Promise<void>;

  private alias(raw: string) {
    const existing = this.ids.get(raw);

    if (existing) {
      return existing;
    }

    const id = `id-${++this.idSequence}`;

    this.ids.set(raw, id);

    if (this.ids.size > 512) {
      this.ids.delete(this.ids.keys().next().value!);
    }

    return id;
  }
  emit(data: DiagnosticData) {
    if (this.closed) {
      return;
    }

    this.queue.push({
      ...data,
      v: 1,
      callId: this.callId,
      streamId: this.streamId,
      seq: ++this.seq,
      atMs: performance.now() - this.started,
    });

    if (this.queue.length > 64) {
      this.queue.shift();
    }

    if (!this.draining) {
      this.draining = true;

      // Never await delivery from a session callback, HTTP request, or tool.
      void this.drain();
    }
  }
  private async drain() {
    while (!this.closed && this.queue.length) {
      const event = this.queue.shift()!;

      try {
        await this.send(event);
      } catch {
        /* Diagnostics cannot change business outcomes. */
      }
    }

    this.draining = false;
  }
  wait(reason: "form" | "confirmation", active: boolean) {
    if (this.waits.has(reason) === active) {
      return;
    }

    if (active) {
      this.waits.add(reason);
    } else {
      this.waits.delete(reason);
    }

    this.emit({ kind: "wait", reason, active });
  }
  proactive<T>(execute: () => T): T {
    this.proactiveDepth++;

    try {
      return execute();
    } finally {
      this.proactiveDepth--;
    }
  }
  private message(
    item: llm.ChatMessage,
    speechId?: string,
    proactive = false,
    waiting = false,
  ) {
    if (item.role !== "user" && item.role !== "assistant") {
      return;
    }

    const messageId = this.alias(item.id);
    const metrics = item.metrics ?? {};
    let turnId: string | undefined;
    let correlation: "self" | "sdk-timing" | "unavailable" = "unavailable";

    if (item.role === "user") {
      turnId = messageId;

      correlation = "self";

      if (finite(metrics.stoppedSpeakingAt)) {
        this.userEnds.push({ stopped: metrics.stoppedSpeakingAt, turnId });

        if (this.userEnds.length > 100) {
          this.userEnds.shift();
        }
      }

      this.wait("confirmation", false);
    } else if (
      finite(metrics.startedSpeakingAt) &&
      finite(metrics.e2eLatency)
    ) {
      // SDK E2E uses exactly this user-stop timestamp; don't guess using receipt order.
      const stop = metrics.startedSpeakingAt - metrics.e2eLatency;

      turnId = [...this.userEnds]
        .reverse()
        .find((entry) => Math.abs(entry.stopped - stop) < 0.001)?.turnId;

      if (turnId) {
        correlation = "sdk-timing";
      }
    }

    const exclusion =
      item.role === "user"
        ? this.waits.has("form")
          ? "human-wait"
          : "none"
        : item.interrupted
          ? "interrupted"
          : proactive
            ? "proactive"
            : waiting || this.waits.size
              ? "human-wait"
              : !turnId
                ? "no-user-timing"
                : "none";

    this.emit({
      kind: "turn",
      messageId,
      role: item.role,
      ...(turnId ? { turnId } : {}),
      ...(speechId ? { speechId } : {}),
      correlation,
      metricsMs: mapTurnMetrics(metrics),
      ...(finite(metrics.startedSpeakingAt)
        ? { startedAtMs: metrics.startedSpeakingAt * 1000 - this.epoch }
        : {}),
      ...(finite(metrics.stoppedSpeakingAt)
        ? { stoppedAtMs: metrics.stoppedSpeakingAt * 1000 - this.epoch }
        : {}),
      interrupted: item.interrupted,
      exclusion,
    });
  }
  attach(session: voice.AgentSession) {
    const events = voice.AgentSessionEventTypes;
    const item = (event: voice.ConversationItemAddedEvent) => {
      if (event.item.type === "message" && event.item.role === "user") {
        this.message(event.item);
      }
    };
    const speech = (event: voice.SpeechCreatedEvent) => {
      const handle = event.speechHandle;
      const speechId = this.alias(handle.id);
      const waiting = this.waits.size > 0;
      // The SDK userInitiated flag also covers normal automatic replies.
      const proactive = this.proactiveDepth > 0;
      const done = safeObserver(() => {
        dispose();

        if (this.closed) {
          return;
        }

        const messages = handle.chatItems.filter(
          (item): item is llm.ChatMessage =>
            item.type === "message" && item.role === "assistant",
        );

        for (const message of messages) {
          this.message(message, speechId, proactive, waiting);
        }

        this.emit({
          kind: "speech",
          speechId,
          messageIds: messages.map((m) => this.alias(m.id)).slice(-16),
          interrupted: handle.interrupted,
        });
      });
      const dispose = () => {
        handle.removeDoneCallback(done);

        this.speechCleanup.delete(dispose);
      };

      this.speechCleanup.add(dispose);

      if (this.speechCleanup.size > 64) {
        this.speechCleanup.values().next().value!();
      }

      handle.addDoneCallback(done);
    };
    const overlap = (
      event: Extract<voice.AgentEvent, { type: "overlapping_speech" }>,
    ) => {
      this.emit({
        kind: "overlap",
        decision: event.agentEnded
          ? "inconclusive"
          : event.isInterruption
            ? "interruption"
            : "backchannel",
        ...(duration(event.detectionDelayInS) !== undefined
          ? { detectionMs: duration(event.detectionDelayInS)! }
          : {}),
        ...(duration(event.predictionDurationInS) !== undefined
          ? { inferenceMs: duration(event.predictionDurationInS)! }
          : {}),
        ...(duration(event.totalDurationInS) !== undefined
          ? { rttMs: duration(event.totalDurationInS)! }
          : {}),
        ...(finite(event.numRequests) ? { requests: event.numRequests } : {}),
      });
    };
    const recovery = (event: voice.AgentFalseInterruptionEvent) =>
      this.emit({ kind: "recovery", resumed: event.resumed });

    const observers = {
      item: safeObserver(item),
      speech: safeObserver(speech),
      overlap: safeObserver(overlap),
      recovery: safeObserver(recovery),
    };

    session.on(events.ConversationItemAdded, observers.item);

    session.on(events.SpeechCreated, observers.speech);

    session.on(events.OverlappingSpeech, observers.overlap);

    session.on(events.AgentFalseInterruption, observers.recovery);

    this.disposers.push(() => {
      session.off(events.ConversationItemAdded, observers.item);

      session.off(events.SpeechCreated, observers.speech);

      session.off(events.OverlappingSpeech, observers.overlap);

      session.off(events.AgentFalseInterruption, observers.recovery);
    });

    this.emit({ kind: "ready" });
  }
  async tool<T>(
    name: ToolName,
    options: llm.ToolOptions,
    execute: () => Promise<T>,
  ): Promise<T> {
    const toolId = this.alias(options.toolCallId);
    const speechId = options.ctx.speechHandle?.id
      ? this.alias(options.ctx.speechHandle.id)
      : undefined;
    const context = { toolId, ...(speechId ? { speechId } : {}) };
    const started = performance.now();

    this.emit({ kind: "tool", ...context, name, phase: "start" });

    let outcome: Outcome = "success";

    try {
      return await this.context.run(context, execute);
    } catch (error) {
      outcome = options.abortSignal.aborted ? "cancelled" : "error";

      throw error;
    } finally {
      this.emit({
        kind: "tool",
        ...context,
        name,
        phase: "end",
        outcome,
        durationMs: performance.now() - started,
      });

      if (name === "prepareAppointmentChange" && outcome === "success") {
        this.wait("confirmation", true);
      }

      if (
        name === "confirmAppointmentChange" ||
        name === "discardAppointmentChange"
      ) {
        this.wait("confirmation", false);
      }
    }
  }
  async http<T>(
    operation: Extract<DiagnosticData, { kind: "http" }>["operation"],
    signal: AbortSignal | undefined,
    execute: () => Promise<T>,
  ): Promise<T> {
    const requestId = `http-${++this.idSequence}`;
    const context = this.context.getStore() ?? {};
    const started = performance.now();

    this.emit({
      kind: "http",
      ...context,
      requestId,
      operation,
      phase: "start",
    });

    let outcome: Outcome = "success";

    try {
      return await execute();
    } catch (error) {
      outcome = signal?.aborted ? "cancelled" : "error";

      throw error;
    } finally {
      this.emit({
        kind: "http",
        ...context,
        requestId,
        operation,
        phase: "end",
        outcome,
        durationMs: performance.now() - started,
      });
    }
  }
  close() {
    this.closed = true;

    this.queue.length = 0;

    for (const dispose of this.disposers) {
      dispose();
    }

    this.disposers = [];

    for (const dispose of this.speechCleanup) {
      dispose();
    }

    this.speechCleanup.clear();

    this.ids.clear();

    this.userEnds.length = 0;
  }
}
