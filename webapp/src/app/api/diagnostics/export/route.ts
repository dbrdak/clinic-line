import { z } from "zod";
import { handle, fail } from "@/server/http";
import { exportSession } from "@/server/session-export";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const response = await handle(async () => {
    const origin = request.headers.get("origin");

    if (origin && origin !== new URL(request.url).origin) {
      fail(403, "Invalid request origin.");
    }

    const kind = z
      .enum(["transcript", "logs"])
      .parse(new URL(request.url).searchParams.get("kind"));

    return exportSession(request.headers, kind);
  });

  response.headers.set("X-Content-Type-Options", "nosniff");

  if (response.ok) {
    response.headers.set(
      "Content-Disposition",
      'attachment; filename="clinicline-cloud-export.json"',
    );
  }

  return response;
}
