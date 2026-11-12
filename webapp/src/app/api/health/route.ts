import { handle } from "@/server/http";
import { database } from "@/server/db";

export const runtime = "nodejs";

export async function GET() {
  return handle(() => {
    database().prepare("SELECT 1").get();

    return { status: "ok" };
  });
}
