import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { database } from "./db";
import { fail } from "./http";

const row = z.record(z.string(), z.unknown());
const pageSchema = z.object({
  items: z.array(row).default([]),
  pageInfo: z.object({ hasMore: z.boolean(), nextCursor: z.string() }),
  dataStatus: z
    .object({ state: z.string(), retryAfterSeconds: z.number().optional() })
    .optional(),
});

// Read-only export authorization deliberately permits closed calls until their
// original expiry. It never grants verification or appointment access.
function exportRoom(headers: Headers) {
  const proof = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";

  if (!proof || proof.length > 256) {
    fail(401, "Call authorization required.");
  }

  const call = database()
    .prepare(
      "SELECT room_name FROM calls WHERE proof_hash = ? AND expires_at > ?",
    )
    .get(createHash("sha256").update(proof).digest("hex"), Date.now());

  if (!call) {
    fail(401, "Call export authorization has expired. Start a new call.");
  }

  return String(call.room_name);
}

// Extra defence for numeric identifiers and familiar credential formats; Cloud
// PII redaction remains required. Never export tool/config items or log fields.
function scrub(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  let text = value.slice(0, 32_000);

  for (const [key, secret] of Object.entries(process.env)) {
    if (
      /(SECRET|TOKEN|KEY|PASSWORD)$/.test(key) &&
      secret &&
      secret.length >= 8
    ) {
      text = text.split(secret).join("[credential removed]");
    }
  }

  return text
    .replace(/\b(?:\d[ -]?){11}\b/g, "[identifier removed]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[token removed]",
    )
    .replace(/\b(?:sk|pk|lk)[-_][A-Za-z0-9_-]{16,}\b/g, "[credential removed]")
    .replace(/Bearer\s+\S+/gi, "Bearer [removed]");
}

export async function exportSession(
  headers: Headers,
  kind: "transcript" | "logs",
) {
  const roomName = exportRoom(headers);
  const project = process.env.LIVEKIT_CLOUD_PROJECT_ID;
  const token = process.env.LIVEKIT_CLOUD_SESSION_TOKEN;

  if (!project || !/^p_[a-zA-Z0-9]+$/.test(project) || !token) {
    fail(
      503,
      "Cloud exports need LIVEKIT_CLOUD_PROJECT_ID and LIVEKIT_CLOUD_SESSION_TOKEN in webapp/.env.local (Admin user authentication).",
    );
  }

  const base = `https://beta-api.livekit.cloud/v0/projects/${project}`;
  const signal = AbortSignal.timeout(25_000);
  const read = async (path: string, query = new URLSearchParams()) => {
    const response = await fetch(`${base}${path}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal,
      redirect: "error",
    }).catch(() =>
      fail(503, "LiveKit Cloud could not be reached. Wait and retry."),
    );

    if (!response.ok) {
      if (response.status === 401) {
        fail(
          503,
          "LiveKit Cloud user session expired or invalid. Sign in again and update the server token.",
        );
      }

      if (response.status === 403) {
        fail(
          503,
          "LiveKit Cloud exports require the Admin role on this project.",
        );
      }

      if (response.status === 429) {
        fail(429, "LiveKit Cloud rate limit reached. Wait before retrying.");
      }

      if (response.status === 404) {
        fail(404, "Cloud session data is not available yet or has expired.");
      }

      fail(
        503,
        "Cloud data unavailable. Check project observability settings and retry after the call ends.",
      );
    }

    // Bound provider responses as well as the final download.
    const reader = response.body?.getReader();

    if (!reader) {
      fail(502, "Cloud returned an empty response.");
    }

    let size = 0;
    const chunks: Uint8Array[] = [];

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > 8_000_000) {
        await reader.cancel();

        fail(
          413,
          "Cloud export exceeds the download limit. Use LiveKit Cloud for the full session.",
        );
      }

      chunks.push(value);
    }

    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };

  const settings = z
    .object({ project: z.object({ enablePiiRedaction: z.boolean() }) })
    .parse(await read(""));

  if (!settings.project.enablePiiRedaction) {
    fail(
      409,
      "Enable PII redaction in LiveKit Cloud before downloading transcripts or logs here. Existing unredacted sessions must not be used.",
    );
  }

  const sessions = pageSchema.parse(
    await read(
      "/sessions",
      new URLSearchParams({
        "filter.roomName": roomName,
        "page.pageSize": "100",
      }),
    ),
  );
  // The API filter is a prefix, so enforce exact equality locally.
  const matches = sessions.items.filter((item) => item.roomName === roomName);

  if (matches.length !== 1 || sessions.pageInfo.hasMore) {
    fail(
      409,
      "The Cloud session cannot be identified unambiguously yet. Retry after the call ends.",
    );
  }

  const session = matches[0]!;
  const sessionId = z
    .string()
    .regex(/^RM_[A-Za-z0-9]+$/)
    .parse(session.sessionId);

  // Transcripts are finalized/redacted after session end; do not present a
  // potentially partial conversation as a complete transcript.
  if (kind === "transcript" && session.status !== "SESSION_STATUS_CLOSED") {
    fail(
      409,
      "End the call first. Cloud transcripts appear after session processing and PII redaction finish.",
    );
  }

  const items: Record<string, unknown>[] = [];
  const cursors = new Set<string>();
  let cursor = "";
  let dataStatus: z.infer<typeof pageSchema>["dataStatus"];
  let skipped = 0;

  for (let index = 0; index < 20; index++) {
    const page = pageSchema.parse(
      await read(
        `/sessions/${sessionId}/${kind}`,
        new URLSearchParams({
          "page.pageSize": "1000",
          "page.cursor": cursor,
        }),
      ),
    );

    dataStatus = page.dataStatus;

    for (const item of page.items) {
      if (kind === "transcript") {
        const message = row.safeParse(item.message);

        if (
          !message.success ||
          !["ROLE_USER", "ROLE_AGENT"].includes(String(message.data.role))
        ) {
          skipped++;

          continue;
        }

        items.push({
          timestamp: item.timestamp,
          role: message.data.role,
          text: scrub(message.data.text),
          redacted: message.data.redacted === true,
          interrupted: message.data.interrupted === true,
        });
      } else {
        // No bodyFields, attributes, trace payloads, tool arguments or results.
        // Free-form messages are omitted: they can embed arbitrary tool payloads.
        items.push({
          timestamp: item.timestamp,
          level: item.level,
          message: "[free-form log message omitted]",
        });
      }
    }

    if (JSON.stringify(items).length > 8_000_000) {
      fail(413, "Cloud export exceeds the download limit.");
    }

    if (!page.pageInfo.hasMore) {
      break;
    }

    cursor = page.pageInfo.nextCursor;

    if (!cursor || cursors.has(cursor) || index === 19) {
      fail(
        413,
        "Cloud export exceeds the pagination limit. Use LiveKit Cloud for the full session.",
      );
    }

    cursors.add(cursor);
  }

  if (!items.length) {
    fail(
      409,
      "No export data is available yet. Wait for Cloud processing and PII redaction, then retry. Check observability if this persists.",
    );
  }

  const result = {
    version: 1,
    kind,
    source: "LiveKit Cloud session observability API",
    exportedAt: new Date().toISOString(),
    dataStatus,
    scope:
      kind === "transcript"
        ? "User/agent messages only; tool results and instructions excluded."
        : "Log timestamps and severity only; free-form text and structured payloads excluded.",
    skippedNonMessageItems: skipped,
    items,
  };

  if (JSON.stringify(result).length > 8_000_000) {
    fail(413, "Cloud export exceeds the download limit.");
  }

  return result;
}
