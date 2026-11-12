import { handle } from "@/server/http";
import { doctors } from "@/server/clinic";

export const runtime = "nodejs";

export async function GET() {
  return handle(() => ({ doctors: doctors() }));
}
