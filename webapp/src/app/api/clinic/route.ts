import { handle } from "@/server/http";
import { clinicInformation } from "@/server/clinic";

export const runtime = "nodejs";

export async function GET() {
  return handle(clinicInformation);
}
