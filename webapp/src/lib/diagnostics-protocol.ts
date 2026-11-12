import { z } from "zod";

// Deliberately independent of agent/ runtime imports. Keep v1 fields in sync.
export const DIAGNOSTICS_TOPIC = "clinic.diagnostics.v1";

export const latencyKeys = [
  "transcriptionDelay",
  "endOfTurnDelay",
  "onUserTurnCompletedDelay",
  "llmNodeTtft",
  "ttsNodeTtfb",
  "e2eLatency",
] as const;

export type LatencyKey = (typeof latencyKeys)[number];

const id = z
  .string()
  .regex(/^(id|http)-[0-9]+$/)
  .max(32);
const ms = z.number().finite().nonnegative();
const outcome = z.enum(["success", "error", "cancelled"]);
const base = z.object({
  v: z.literal(1),
  callId: z.uuid(),
  streamId: z.uuid(),
  seq: z.number().int().positive(),
  atMs: ms,
});
const context = { toolId: id.optional(), speechId: id.optional() };

export const diagnosticSchema = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("ready") }).strict(),
  base
    .extend({
      kind: z.literal("turn"),
      messageId: id,
      role: z.enum(["user", "assistant"]),
      turnId: id.optional(),
      speechId: id.optional(),
      correlation: z.enum(["self", "sdk-timing", "unavailable"]),
      metricsMs: z
        .object({
          transcriptionDelay: ms.optional(),
          endOfTurnDelay: ms.optional(),
          onUserTurnCompletedDelay: ms.optional(),
          llmNodeTtft: ms.optional(),
          ttsNodeTtfb: ms.optional(),
          e2eLatency: ms.optional(),
        })
        .strict(),
      startedAtMs: z.number().finite().optional(),
      stoppedAtMs: z.number().finite().optional(),
      interrupted: z.boolean(),
      exclusion: z.enum([
        "none",
        "proactive",
        "human-wait",
        "interrupted",
        "no-user-timing",
      ]),
    })
    .strict(),
  base
    .extend({
      kind: z.literal("speech"),
      speechId: id,
      messageIds: z.array(id).max(16),
      interrupted: z.boolean(),
    })
    .strict(),
  base
    .extend({
      kind: z.literal("overlap"),
      speechId: id.optional(),
      decision: z.enum(["interruption", "backchannel", "inconclusive"]),
      detectionMs: ms.optional(),
      inferenceMs: ms.optional(),
      rttMs: ms.optional(),
      requests: z.number().int().nonnegative().optional(),
    })
    .strict(),
  base.extend({ kind: z.literal("recovery"), resumed: z.boolean() }).strict(),
  base
    .extend({
      kind: z.literal("tool"),
      ...context,
      toolId: id,
      name: z.enum([
        "getClinicInformation",
        "verifyPatient",
        "checkPatientVerification",
        "findAvailableSlots",
        "lookupAppointments",
        "prepareAppointmentChange",
        "confirmAppointmentChange",
        "discardAppointmentChange",
      ]),
      phase: z.enum(["start", "end"]),
      outcome: outcome.optional(),
      durationMs: ms.optional(),
    })
    .strict(),
  base
    .extend({
      kind: z.literal("http"),
      ...context,
      requestId: id,
      operation: z.enum([
        "clinic",
        "availability",
        "lookup",
        "appointment-write",
        "verification",
        "call",
        "other",
      ]),
      phase: z.enum(["start", "end"]),
      outcome: outcome.optional(),
      durationMs: ms.optional(),
    })
    .strict(),
  base
    .extend({
      kind: z.literal("wait"),
      reason: z.enum(["form", "confirmation"]),
      active: z.boolean(),
    })
    .strict(),
]);

export type DiagnosticEvent = z.infer<typeof diagnosticSchema>;

export type TurnEvent = Extract<DiagnosticEvent, { kind: "turn" }>;

export function acceptDiagnostic(
  payload: Uint8Array,
  callId: string,
): DiagnosticEvent | undefined {
  if (payload.byteLength > 4096) {
    return;
  }

  try {
    const parsed = diagnosticSchema.safeParse(
      JSON.parse(new TextDecoder().decode(payload)),
    );

    if (parsed.success && parsed.data.callId === callId) {
      return parsed.data;
    }
  } catch {
    /* Other LiveKit data is not diagnostic data. Never log it. */
  }

  return;
}

export function distribution(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;

  return {
    n,
    median: n
      ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2
      : undefined,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : undefined,
  };
}
