import { z } from "zod";

export const languageSchema = z.enum(["pl", "en"]);

export type Language = z.infer<typeof languageSchema>;

export const callSessionSchema = z.object({
  token: z.string(),
  serverUrl: z.string().startsWith("wss://"),
  callId: z.uuid(),
  roomName: z.string(),
  participantIdentity: z.string(),
  callProof: z.string(),
  expiresAt: z.iso.datetime(),
});

export type CallSession = z.infer<typeof callSessionSchema>;

export const formRequestSchema = z.object({
  requestId: z.uuid(),
  expiresAt: z.iso.datetime(),
});

export type FormRequest = z.infer<typeof formRequestSchema>;

export const OPEN_FORM_RPC = "clinic.openVerification";

export const VERIFICATION_UPDATED_RPC = "clinic.verificationUpdated";
