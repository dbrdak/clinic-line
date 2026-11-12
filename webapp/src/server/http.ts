import "server-only";
import { z } from "zod";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);

    this.status = status;
  }
}

export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handle(
  work: () => unknown | Promise<unknown>,
  status = 200,
) {
  try {
    return json(await work(), status);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ error: "Invalid request." }, 400);
    }

    // Exception messages, request bodies, credentials and identifiers are never logged or returned.
    return json(
      { error: "The request could not be completed; outcome unconfirmed." },
      500,
    );
  }
}

export async function input(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");

  if (origin && origin !== new URL(request.url).origin) {
    fail(403, "Invalid request origin.");
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    fail(415, "JSON required.");
  }

  const reader = request.body?.getReader();

  if (!reader) {
    fail(400, "Body required.");
  }

  let size = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > 4096) {
      await reader.cancel();

      fail(413, "Body too large.");
    }

    chunks.push(value);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
