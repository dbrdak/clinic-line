import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import {
  RoomAgentDispatch,
  RoomConfiguration,
  TrackSource,
} from "@livekit/protocol";
import { z } from "zod";
import {
  activeCall,
  closeCall,
  createCall,
  type Call,
} from "./verification.ts";
import { fail } from "./http.ts";

function config() {
  const {
    LIVEKIT_URL: url,
    LIVEKIT_API_KEY: key,
    LIVEKIT_API_SECRET: secret,
  } = process.env;

  if (!url?.startsWith("wss://") || !key || !secret) {
    fail(503, "Configure LiveKit Cloud credentials in webapp/.env.local.");
  }

  return { url, key, secret };
}

export function requireAgent(headers: Headers) {
  const secret = process.env.CLINIC_AGENT_SECRET;
  const supplied = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";

  if (!secret || secret.length < 32) {
    fail(503, "Configure CLINIC_AGENT_SECRET in both applications.");
  }

  const digest = (value: string) => createHash("sha256").update(value).digest();

  if (!timingSafeEqual(digest(secret), digest(supplied))) {
    fail(401, "Agent authorization required.");
  }
}

export async function requirePresent(call: Call) {
  const { url, key, secret } = config();
  let present = false;

  try {
    const participant = await new RoomServiceClient(
      url.replace(/^wss:/, "https:"),
      key,
      secret,
    ).getParticipant(call.roomName, call.participantIdentity);

    present = participant.identity === call.participantIdentity;
  } catch {
    /* No raw provider errors are exposed or logged. */
  }

  if (!present) {
    closeCall(call.id);

    fail(410, "The caller is no longer connected.");
  }
}

export async function agentCall(headers: Headers) {
  requireAgent(headers);

  const call = activeCall(z.uuid().parse(headers.get("x-clinic-call-id")));

  await requirePresent(call);

  return call;
}

export async function issueCall(language: "pl" | "en") {
  const { url, key, secret } = config();

  if (
    !process.env.CLINIC_AGENT_SECRET ||
    process.env.CLINIC_AGENT_SECRET.length < 32
  ) {
    fail(503, "Configure CLINIC_AGENT_SECRET in both applications.");
  }

  const { call, proof } = createCall(language);

  try {
    const token = new AccessToken(key, secret, {
      identity: call.participantIdentity,
      ttl: "5m",
      attributes: { "clinic.language": language },
    });

    token.addGrant({
      roomJoin: true,
      room: call.roomName,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    });

    token.roomConfig = new RoomConfiguration({
      agents: [
        new RoomAgentDispatch({
          agentName: "klara",
          metadata: JSON.stringify({
            callId: call.id,
            roomName: call.roomName,
            participantIdentity: call.participantIdentity,
            language,
          }),
        }),
      ],
    });

    return {
      token: await token.toJwt(),
      serverUrl: url,
      callId: call.id,
      roomName: call.roomName,
      participantIdentity: call.participantIdentity,
      callProof: proof,
      expiresAt: new Date(call.expiresAt).toISOString(),
    };
  } catch {
    closeCall(call.id);

    fail(503, "LiveKit token creation failed. Check the server credentials.");
  }
}
