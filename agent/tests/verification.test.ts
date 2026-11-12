import assert from "node:assert/strict";
import { test } from "node:test";
import { llm, type RunContext } from "@livekit/agents";
import { ClinicClient } from "../src/clinic-client.ts";
import { createDemoClinic } from "../src/demo-clinic.ts";
import { createVerificationBridge } from "../src/verification.ts";
import { createClinicTools } from "../src/tools.ts";

test("browser verification never falls back to simulated verification", async () => {
  const { clinic } = createDemoClinic();
  const tool = createClinicTools(clinic).find(
    (tool) => tool.name === "verifyPatient",
  )!;

  await assert.rejects(
    tool.execute({ firstName: "Pacjent1", lastName: "Testowy" } as never, {
      ctx: {} as RunContext,
      toolCallId: "test",
      abortSignal: new AbortController().signal,
    }),
    /FORM_UNAVAILABLE/,
  );
});

test("HTTP verification only sends names and call binding and returns pending after RPC acknowledgment", async () => {
  const requests: { path: string; body: unknown }[] = [];
  const result = {
    requestId: "00000000-0000-4000-8000-000000000001",
    status: "pending",
    expiresAt: "2030-05-06T08:02:00.000Z",
  };
  const client = new ClinicClient(
    "http://fixture/api/",
    async (url, init) => {
      requests.push({
        path: new URL(String(url)).pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });

      assert.equal(
        new Headers(init?.headers).get("x-clinic-call-id"),
        "call-1",
      );

      return new Response(JSON.stringify(result));
    },
    { id: "call-1", secret: "not-exposed-to-model" },
  );
  let opened: unknown;
  const bridge = createVerificationBridge(
    client,
    {
      callId: "call-1",
      roomName: "room-1",
      participantIdentity: "caller-1",
      language: "pl",
    },
    async (payload) => {
      opened = payload;
    },
  );

  assert.equal(
    (await bridge.request({ firstName: "Pacjent1", lastName: "Testowy" }))
      .status,
    "pending",
  );

  assert.deepEqual(opened, {
    requestId: result.requestId,
    expiresAt: result.expiresAt,
  });

  assert.deepEqual(requests[0]?.body, {
    firstName: "Pacjent1",
    lastName: "Testowy",
    callId: "call-1",
    roomName: "room-1",
    participantIdentity: "caller-1",
  });

  assert.ok(!JSON.stringify(requests).includes("pesel"));
});

test("a failed RPC cancels the pending request and cannot grant access", async () => {
  const methods: string[] = [];
  const client = new ClinicClient("http://fixture/api/", async (_url, init) => {
    methods.push(init?.method ?? "GET");

    return new Response(
      JSON.stringify({
        requestId: "00000000-0000-4000-8000-000000000001",
        status: init?.method === "DELETE" ? "dismissed" : "pending",
        expiresAt: "2030-05-06T08:02:00.000Z",
      }),
    );
  });
  const bridge = createVerificationBridge(
    client,
    {
      callId: "call-1",
      roomName: "room-1",
      participantIdentity: "caller-1",
      language: "en",
    },
    async () => {
      throw new Error("disconnected");
    },
  );

  await assert.rejects(
    bridge.request({ firstName: "Pacjent1", lastName: "Testowy" }),
    /unavailable/,
  );

  assert.deepEqual(methods, ["POST", "DELETE"]);
});

test("parallel confirmations save once and corrected proposals require their own later approval", async () => {
  const { clinic, verification, snapshot } = createDemoClinic();
  const history = new llm.ChatContext();
  const ctx = {
    session: {
      history,
      generateReply: () => ({
        interrupted: false,
        waitForPlayout: async () => {
          history.addMessage({ role: "assistant", content: "Review." });
        },
      }),
    },
    disallowInterruptions: () => {},
  } as unknown as RunContext;
  const tools = createClinicTools(clinic, verification);
  const call = (name: string, args: object = {}) =>
    tools
      .find((tool) => tool.name === name)!
      .execute(args as never, {
        ctx,
        toolCallId: "test",
        abortSignal: new AbortController().signal,
      });

  history.addMessage({ role: "user", content: "Book ten o'clock." });

  await call("verifyPatient", { firstName: "Pacjent1", lastName: "Testowy" });

  const first = await call("prepareAppointmentChange", {
    action: "book",
    doctorId: "doctor-1",
    appointmentId: null,
    startsAt: "2030-05-07T08:00:00.000Z",
  });

  history.addMessage({ role: "user", content: "Actually eleven o'clock." });

  await call("discardAppointmentChange");

  await assert.rejects(
    call("confirmAppointmentChange", first as object),
    /CONFIRMATION_REQUIRED/,
  );

  const revised = await call("prepareAppointmentChange", {
    action: "book",
    doctorId: "doctor-1",
    appointmentId: null,
    startsAt: "2030-05-07T09:00:00.000Z",
  });

  history.addMessage({ role: "user", content: "Yes, eleven o'clock." });

  await Promise.all([
    call("confirmAppointmentChange", revised as object),
    call("confirmAppointmentChange", revised as object),
  ]);

  assert.equal(snapshot().length, 1);

  assert.equal(snapshot()[0]?.startsAt, "2030-05-07T09:00:00.000Z");
});

test("registration is acknowledged only after verified status and is reported once", async () => {
  const { clinic, verification } = createDemoClinic();
  const tools = createClinicTools(clinic, verification);
  const call = (name: string, args: object = {}) =>
    tools
      .find((tool) => tool.name === name)!
      .execute(args as never, {
        ctx: {} as RunContext,
        toolCallId: "registration",
        abortSignal: new AbortController().signal,
      });

  assert.deepEqual(await call("checkPatientVerification"), {
    status: "not_requested",
    verified: false,
  });

  await call("verifyPatient", { firstName: "Alicja", lastName: "Nowa" });

  assert.deepEqual(await call("checkPatientVerification"), {
    status: "verified",
    verified: true,
    newPatient: true,
  });

  await call("verifyPatient", { firstName: "Alicja", lastName: "Nowa" });

  assert.deepEqual(await call("checkPatientVerification"), {
    status: "verified",
    verified: true,
    newPatient: false,
  });

  await call("verifyPatient", { firstName: "Invalid", lastName: "Fixture" });

  assert.deepEqual(await call("checkPatientVerification"), {
    status: "failed",
    verified: false,
  });
});
