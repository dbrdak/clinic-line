import { z } from "zod";
import { handle, input } from "@/server/http";
import { issueCall } from "@/server/livekit";
import { browserCall, closeCall } from "@/server/verification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(
    async () =>
      issueCall(
        z
          .object({ language: z.enum(["pl", "en"]) })
          .strict()
          .parse(await input(request)).language,
      ),
    201,
  );
}

export async function DELETE(request: Request) {
  return handle(() => closeCall(browserCall(request.headers).id));
}
