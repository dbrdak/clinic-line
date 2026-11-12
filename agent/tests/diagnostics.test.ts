import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { llm, voice } from "@livekit/agents";
import { z } from "zod";
import {
  CallDiagnostics,
  mapTurnMetrics,
  type DiagnosticEvent,
} from "../src/diagnostics.ts";
import { ClinicClient } from "../src/clinic-client.ts";

const callA = "00000000-0000-4000-8000-000000000001";
const callB = "00000000-0000-4000-8000-000000000002";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(callId = callA) {
  const events: DiagnosticEvent[] = [];
  const diagnostics = new CallDiagnostics(callId, async (event) => {
    events.push(event);
  });
  const session = new EventEmitter() as unknown as voice.AgentSession;

  diagnostics.attach(session);

  return { diagnostics, events, session };
}

function speech(
  session: voice.AgentSession,
  message: llm.ChatMessage,
  userInitiated = true,
) {
  const callbacks = new Set<() => void>();
  const handle = {
    id: "raw-speech-id",
    interrupted: message.interrupted,
    chatItems: [message],
    addDoneCallback: (fn: () => void) => callbacks.add(fn),
    removeDoneCallback: (fn: () => void) => callbacks.delete(fn),
  } as unknown as voice.SpeechHandle;

  session.emit(voice.AgentSessionEventTypes.SpeechCreated, {
    type: "speech_created",
    speechHandle: handle,
    source: "generate_reply",
    userInitiated,
    createdAt: Date.now(),
  });

  for (const callback of callbacks) {
    callback();
  }
}

const options = (id: string, signal = new AbortController().signal) => ({
  ctx: { speechHandle: { id: "sdk-speech" } } as unknown as voice.RunContext,
  toolCallId: id,
  abortSignal: signal,
});

test("turn metrics allowlist converts seconds without summing overlapping stages", () => {
  assert.deepEqual(
    mapTurnMetrics({
      transcriptionDelay: 0.2,
      endOfTurnDelay: 0.3,
      onUserTurnCompletedDelay: 0,
      llmNodeTtft: 0.1,
      ttsNodeTtfb: 0.15,
      e2eLatency: 0.5,
      playbackLatency: 900,
      providerRequestIds: ["do-not-send"],
    }),
    {
      transcriptionDelay: 200,
      endOfTurnDelay: 300,
      onUserTurnCompletedDelay: 0,
      llmNodeTtft: 100,
      ttsNodeTtfb: 150,
      e2eLatency: 500,
    },
  );

  assert.deepEqual(
    mapTurnMetrics({ e2eLatency: -1, llmNodeTtft: NaN, ttsNodeTtfb: Infinity }),
    {},
  );
});

test("message timing correlation is exact; proactive and human waiting do not enter aggregates", async () => {
  const { diagnostics, events, session } = setup();
  const user = llm.ChatMessage.create({
    role: "user",
    id: "sensitive-raw-id",
    content: "Name and identifier never sent",
    metrics: { stoppedSpeakingAt: 100, transcriptionDelay: 0.2 },
  });

  session.emit(voice.AgentSessionEventTypes.ConversationItemAdded, {
    type: "conversation_item_added",
    item: user,
    createdAt: Date.now(),
  });

  speech(
    session,
    llm.ChatMessage.create({
      role: "assistant",
      content: "private answer",
      metrics: { startedSpeakingAt: 101, e2eLatency: 1 },
    }),
  );

  diagnostics.proactive(() => {
    speech(
      session,
      llm.ChatMessage.create({
        role: "assistant",
        content: "proactive",
        metrics: { startedSpeakingAt: 101, e2eLatency: 1 },
      }),
      true,
    );
  });

  diagnostics.wait("form", true);

  speech(
    session,
    llm.ChatMessage.create({
      role: "assistant",
      content: "form wait",
      metrics: { startedSpeakingAt: 101, e2eLatency: 1 },
    }),
  );

  diagnostics.wait("form", false);

  speech(
    session,
    llm.ChatMessage.create({
      role: "assistant",
      content: "unrelated",
      metrics: { startedSpeakingAt: 110, e2eLatency: 1 },
    }),
  );

  await flush();

  const turns = events.filter((e) => e.kind === "turn");

  assert.equal(turns[1]?.correlation, "sdk-timing");

  assert.equal(turns[1]?.turnId, turns[0]?.messageId);

  assert.equal(turns[1]?.exclusion, "none");

  assert.equal(turns[2]?.exclusion, "proactive");

  assert.equal(turns[3]?.exclusion, "human-wait");

  assert.equal(turns[4]?.correlation, "unavailable");

  assert.equal(turns[4]?.exclusion, "no-user-timing");

  assert.ok(!JSON.stringify(events).includes("sensitive-raw-id"));

  assert.ok(!JSON.stringify(events).includes("private answer"));

  diagnostics.close();
});

test("adaptive overlap projection preserves inconclusive decisions and excludes audio, probabilities and text", async () => {
  const { diagnostics, events, session } = setup();

  for (const event of [
    { isInterruption: true },
    { isInterruption: false },
    { isInterruption: false, agentEnded: true },
  ]) {
    session.emit(voice.AgentSessionEventTypes.OverlappingSpeech, {
      type: "overlapping_speech",
      detectedAt: Date.now(),
      probability: 0.9,
      probabilities: [0.9],
      speechInput: new Int16Array([123]),
      numRequests: 2,
      totalDurationInS: 0.04,
      predictionDurationInS: 0.02,
      detectionDelayInS: 0.3,
      ...event,
    });
  }

  session.emit(voice.AgentSessionEventTypes.AgentFalseInterruption, {
    type: "agent_false_interruption",
    resumed: true,
    createdAt: Date.now(),
  });

  await flush();

  const overlaps = events.filter((e) => e.kind === "overlap");

  assert.deepEqual(
    overlaps.map((e) => e.decision),
    ["interruption", "backchannel", "inconclusive"],
  );

  assert.equal(overlaps[0]?.detectionMs, 300);

  assert.equal(overlaps[0]?.inferenceMs, 20);

  assert.equal(overlaps[0]?.rttMs, 40);

  assert.ok(!JSON.stringify(events).includes("speechInput"));

  assert.ok(!JSON.stringify(events).includes("probability"));

  assert.ok(events.some((e) => e.kind === "recovery" && e.resumed));

  diagnostics.close();
});

test("parallel tool HTTP events keep exact async tool/speech correlation and sanitize paths, results and errors", async () => {
  const { diagnostics, events } = setup();
  const client = new ClinicClient(
    "http://fixture/api/",
    async () =>
      new Response(JSON.stringify({ ok: true, private: "must-not-send" })),
    undefined,
    diagnostics,
  );

  await Promise.all(
    ["tool-one", "tool-two"].map((id) =>
      diagnostics.tool("lookupAppointments", options(id), async () => {
        await flush();

        return client.request(
          "appointments/lookup",
          z.object({ ok: z.boolean() }),
          {
            method: "POST",
            body: {
              verificationRef: "private-reference",
              firstName: "PrivateName",
            },
          },
        );
      }),
    ),
  );

  await flush();

  const tools = events
    .filter((e) => e.kind === "tool")
    .filter((e) => e.phase === "start");
  const http = events.filter((e) => e.kind === "http");

  assert.equal(tools.length, 2);

  assert.notEqual(tools[0]?.toolId, tools[1]?.toolId);

  assert.equal(http.length, 4);

  for (const request of http) {
    assert.ok(
      tools.some(
        (tool) =>
          tool.toolId === request.toolId && tool.speechId === request.speechId,
      ),
    );
  }

  const encoded = JSON.stringify(events);

  for (const secret of [
    "private-reference",
    "PrivateName",
    "must-not-send",
    "tool-one",
    "tool-two",
    "sdk-speech",
  ]) {
    assert.ok(!encoded.includes(secret));
  }

  diagnostics.close();
});

test("transport failure and cancellation never replace tool values or exception identity", async () => {
  const diagnostics = new CallDiagnostics(callA, async () => {
    throw new Error("publisher offline");
  });
  const expected = { committed: true };

  assert.equal(
    await diagnostics.tool(
      "confirmAppointmentChange",
      options("commit"),
      async () => expected,
    ),
    expected,
  );

  const error = new Error("raw sensitive error");

  await assert.rejects(
    diagnostics.tool("lookupAppointments", options("failure"), async () => {
      throw error;
    }),
    (caught) => caught === error,
  );

  const collected: DiagnosticEvent[] = [];
  const cancelled = new CallDiagnostics(callB, async (e) => {
    collected.push(e);
  });
  const controller = new AbortController();

  await assert.rejects(
    cancelled.tool(
      "lookupAppointments",
      options("cancel", controller.signal),
      async () => {
        controller.abort();

        throw error;
      },
    ),
    (caught) => caught === error,
  );

  await flush();

  assert.ok(
    collected.some((e) => e.kind === "tool" && e.outcome === "cancelled"),
  );

  assert.ok(!JSON.stringify(collected).includes(error.message));

  diagnostics.close();

  cancelled.close();
});

test("stalled publication stays bounded and close detaches listeners; calls and stream IDs remain isolated", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: DiagnosticEvent[] = [];
  const a = new CallDiagnostics(callA, async (e) => {
    sent.push(e);

    await blocked;
  });

  for (let i = 0; i < 500; i++) {
    a.emit({ kind: "ready" });
  }

  assert.equal(sent.length, 1);

  release();

  await flush();

  assert.equal(sent.length, 65);

  assert.equal(sent[1]?.seq, 437);

  assert.equal(sent[64]?.seq, 500);

  const b = setup(callB);

  await flush();

  assert.notEqual(sent[0]?.streamId, b.events[0]?.streamId);

  assert.ok(sent.every((e) => e.callId === callA));

  assert.ok(b.events.every((e) => e.callId === callB));

  b.diagnostics.close();

  assert.equal(
    b.session.listenerCount(voice.AgentSessionEventTypes.ConversationItemAdded),
    0,
  );

  const count = b.events.length;

  b.diagnostics.emit({ kind: "ready" });

  await flush();

  assert.equal(b.events.length, count);

  a.close();
});

test("malformed telemetry cannot throw into the session and unfinished speech callbacks detach on close", async () => {
  const { diagnostics, events, session } = setup();
  const message = llm.ChatMessage.create({
    role: "user",
    content: "not serialized",
  });

  Object.defineProperty(message, "metrics", {
    get: () => {
      throw new Error("private telemetry failure");
    },
  });

  assert.doesNotThrow(() =>
    session.emit(voice.AgentSessionEventTypes.ConversationItemAdded, {
      type: "conversation_item_added",
      item: message,
      createdAt: Date.now(),
    }),
  );

  const callbacks = new Set<(speech: voice.SpeechHandle) => void>();
  const handle = {
    id: "pending-speech",
    chatItems: [],
    interrupted: false,
    addDoneCallback: (callback: (speech: voice.SpeechHandle) => void) =>
      callbacks.add(callback),
    removeDoneCallback: (callback: (speech: voice.SpeechHandle) => void) =>
      callbacks.delete(callback),
  } as unknown as voice.SpeechHandle;

  session.emit(voice.AgentSessionEventTypes.SpeechCreated, {
    type: "speech_created",
    speechHandle: handle,
    userInitiated: false,
    source: "generate_reply",
    createdAt: Date.now(),
  });

  assert.equal(callbacks.size, 1);

  diagnostics.close();

  assert.equal(callbacks.size, 0);

  await flush();

  assert.ok(!JSON.stringify(events).includes("private telemetry failure"));
});
