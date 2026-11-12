import { z } from "zod";
import { handle } from "@/server/http";
import { requireAgent } from "@/server/livekit";
import { closeCall } from "@/server/verification";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  return handle(() => {
    requireAgent(request.headers);

    return closeCall(z.uuid().parse(request.headers.get("x-clinic-call-id")));
  });
}
