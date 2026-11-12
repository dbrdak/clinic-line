import { handle, input } from "@/server/http";
import { agentCall } from "@/server/livekit";
import { lookup, patientRequest } from "@/server/clinic";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const value = patientRequest.parse(await input(request));
    const call = await agentCall(request.headers);

    return lookup(call.id, value.patient.verificationRef);
  });
}
