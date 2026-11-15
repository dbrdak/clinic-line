import type { CallDiagnostics } from "./diagnostics.ts";
import { z } from "zod";
import { ClinicClient } from "./clinic-client.ts";

const statusSchema = z.object({
  requestId: z.uuid(),
  expiresAt: z.iso.datetime(),
  status: z.enum([
    "pending",
    "processing",
    "verified",
    "failed",
    "dismissed",
    "expired",
    "disconnected",
  ]),
  verificationRef: z.string().optional(),
  newPatient: z.boolean().optional(),
});

export type VerificationResult = z.infer<typeof statusSchema>;

export interface VerificationBridge {
  request(
    names: { firstName: string; lastName: string },
    signal?: AbortSignal,
  ): Promise<VerificationResult>;

  status(requestId: string): Promise<VerificationResult>;
}

export type CallBinding = {
  callId: string;
  roomName: string;
  participantIdentity: string;
  language: "pl" | "en";
};

export function createVerificationBridge(
  client: ClinicClient,
  call: CallBinding,
  openForm: (payload: {
    requestId: string;
    expiresAt: string;
  }) => Promise<void>,
  diagnostics?: CallDiagnostics,
): VerificationBridge {
  return {
    async request(names, signal) {
      const result = await client.request(
        "voice/verification-requests",
        statusSchema,
        {
          method: "POST",
          body: {
            ...names,
            callId: call.callId,
            roomName: call.roomName,
            participantIdentity: call.participantIdentity,
          },
          ...(signal ? { signal } : {}),
        },
      );

      try {
        await openForm({
          requestId: result.requestId,
          expiresAt: result.expiresAt,
        });
      } catch {
        await client
          .request(
            `voice/verification-requests/${encodeURIComponent(result.requestId)}`,
            statusSchema,
            { method: "DELETE" },
          )
          .catch(() => {});

        throw new Error("Browser verification form unavailable.");
      }

      diagnostics?.wait("form", true);

      return result;
    },
    async status(requestId) {
      const result = await client.request(
        `voice/verification-requests/${encodeURIComponent(requestId)}`,
        statusSchema,
      );

      if (result.status !== "pending" && result.status !== "processing") {
        diagnostics?.wait("form", false);
      }

      return result;
    },
  };
}
