import { handle, input } from "@/server/http";
import { agentCall } from "@/server/livekit";
import { changeAppointment } from "@/server/clinic";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const body = await input(request);
    const call = await agentCall(request.headers);

    return changeAppointment(call.id, "book", body);
  }, 201);
}
