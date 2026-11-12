import { z } from "zod";
import { handle } from "@/server/http";
import { agentCall } from "@/server/livekit";
import { verificationStatus, dismissVerification } from "@/server/verification";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const call = await agentCall(request.headers);

    return verificationStatus(
      call.id,
      z.uuid().parse((await context.params).id),
    );
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const call = await agentCall(request.headers);

    dismissVerification(call.id, z.uuid().parse((await context.params).id));

    return verificationStatus(call.id, (await context.params).id);
  });
}
