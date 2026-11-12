import { z } from "zod";
import { handle, input, fail } from "@/server/http";
import { agentCall } from "@/server/livekit";
import { beginVerification } from "@/server/verification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const body = z
      .object({
        callId: z.uuid(),
        roomName: z.string(),
        participantIdentity: z.string(),
        firstName: z.string().trim().min(1).max(64),
        lastName: z.string().trim().min(1).max(64),
      })
      .strict()
      .parse(await input(request));
    const call = await agentCall(request.headers);

    if (
      body.callId !== call.id ||
      body.roomName !== call.roomName ||
      body.participantIdentity !== call.participantIdentity
    ) {
      fail(403, "Call binding does not match.");
    }

    return beginVerification(call.id, body.firstName, body.lastName);
  }, 201);
}
