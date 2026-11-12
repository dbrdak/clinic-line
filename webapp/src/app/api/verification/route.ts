import { z } from "zod";
import { handle, input } from "@/server/http";
import { requirePresent } from "@/server/livekit";
import {
  browserCall,
  finishVerification,
  dismissVerification,
  verificationStatus,
} from "@/server/verification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => {
    const body = z
      .object({ requestId: z.uuid(), pesel: z.string().regex(/^[0-9]{11}$/) })
      .strict()
      .parse(await input(request));

    try {
      const call = browserCall(request.headers);

      await requirePresent(call);

      return finishVerification(call.id, body.requestId, body.pesel);
    } finally {
      body.pesel = "";
    }
  });
}

export async function GET(request: Request) {
  return handle(() => {
    const requestId = z
      .uuid()
      .parse(request.headers.get("x-verification-request"));
    const { status } = verificationStatus(
      browserCall(request.headers).id,
      requestId,
    );

    return { status };
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const body = z
      .object({ requestId: z.uuid() })
      .strict()
      .parse(await input(request));

    return dismissVerification(browserCall(request.headers).id, body.requestId);
  });
}
