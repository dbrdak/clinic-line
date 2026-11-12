import { handle, input } from "@/server/http";
import { agentCall } from "@/server/livekit";
import { changeAppointment, id } from "@/server/clinic";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const body = await input(request);
    const call = await agentCall(request.headers);

    return changeAppointment(
      call.id,
      "cancel",
      body,
      id.parse((await context.params).id),
    );
  });
}
