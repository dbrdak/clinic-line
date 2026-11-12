import assert from "node:assert/strict";
import { test } from "node:test";
import { llm, type RunContext } from "@livekit/agents";
import { ClinicClient } from "../src/clinic-client.ts";
import { ClinicApiError, type Clinic } from "../src/clinic.ts";
import { createDemoClinic } from "../src/demo-clinic.ts";
import { createClinicTools } from "../src/tools.ts";
import { addDays, atWarsawTime } from "../src/time.ts";

const details = {
  firstName: "Pacjent1",
  lastName: "Testowy",
  pesel: "identifier-must-not-leak",
};

function fixture(dropWriteResponse = false) {
  const demo = createDemoClinic();
  let reference: string | undefined;
  const client: Clinic = {
    ...demo.clinic,
    async change(...args) {
      const result = await demo.clinic.change(...args);

      if (dropWriteResponse) {
        throw new ClinicApiError(
          "OUTCOME_UNKNOWN",
          "Response lost after commit.",
          true,
        );
      }

      return result;
    },
  };
  const verification = {
    ...demo.verification,
    async status(id: string) {
      const result = await demo.verification.status(id);

      reference = result.verificationRef;

      return result;
    },
  };
  const tools = createClinicTools(client, verification);
  const history = new llm.ChatContext();
  let interrupted = false;
  let disallowed = false;
  const ctx = {
    session: {
      history,
      generateReply: () => ({
        get interrupted() {
          return interrupted;
        },
        waitForPlayout: async () => {
          history.addMessage({
            role: "assistant",
            content: "Review and confirmation question.",
          });
        },
      }),
    },
    disallowInterruptions: () => {
      disallowed = true;
    },
  } as unknown as RunContext;

  async function call(name: string, args: object = {}, otherTools = tools) {
    const tool = otherTools.find((item) => item.name === name);

    assert.ok(tool);

    return tool.execute(args as never, {
      ctx,
      toolCallId: "test-call",
      abortSignal: new AbortController().signal,
    });
  }

  const user = (content: string) =>
    history.addMessage({ role: "user", content });
  const date = "2030-05-07";
  const startsAt = atWarsawTime(date, 10).toISOString();
  const book = {
    action: "book",
    doctorId: "doctor-1",
    appointmentId: null,
    startsAt,
  };

  return {
    client,
    tools,
    call,
    user,
    date,
    startsAt,
    book,
    reference: () => reference,
    count: () => demo.snapshot().length,
    interrupt: () => {
      interrupted = true;
    },
    wasDisallowed: () => disallowed,
    close: async () => {},
  };
}

test("read tools expose backend doctors and real slots without patient identifiers", async () => {
  const f = fixture();

  try {
    const clinic = (await f.call("getClinicInformation")) as {
      doctors: { id: string }[];
    };

    assert.equal(clinic.doctors[0]?.id, "doctor-1");

    const availability = (await f.call("findAvailableSlots", {
      doctorId: "doctor-1",
      date: f.date,
    })) as { slots: unknown[] };

    assert.equal(availability.slots.length, 2);

    assert.equal(f.count(), 0);

    await assert.rejects(f.call("lookupAppointments"), /VERIFICATION_REQUIRED/);
  } finally {
    await f.close();
  }
});

test("booking requires delivered review and a later actual user message; duplicate commit writes once", async () => {
  const f = fixture();

  try {
    f.user("Book a visit.");

    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: details.lastName,
    });

    const proposal = (await f.call("prepareAppointmentChange", f.book)) as {
      proposalId: string;
    };

    assert.equal(f.count(), 0);

    await assert.rejects(
      f.call("confirmAppointmentChange", proposal),
      /FRESH_CONFIRMATION_REQUIRED/,
    );

    f.user("Yes, please book that visit.");

    const receipt = (await f.call("confirmAppointmentChange", proposal)) as {
      committed: boolean;
      appointment: { startsAt: string };
    };

    assert.equal(receipt.committed, true);

    assert.equal(receipt.appointment.startsAt, f.startsAt);

    assert.equal(f.wasDisallowed(), true);

    await f.call("confirmAppointmentChange", proposal);

    assert.equal(f.count(), 1);
  } finally {
    await f.close();
  }
});

test("interrupted review cannot authorize a write", async () => {
  const f = fixture();

  try {
    f.user("Book a visit.");

    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: details.lastName,
    });

    f.interrupt();

    await assert.rejects(
      f.call("prepareAppointmentChange", f.book),
      /REVIEW_INTERRUPTED/,
    );

    f.user("Yes.");

    await assert.rejects(
      f.call("confirmAppointmentChange", { proposalId: "unknown" }),
      /CONFIRMATION_REQUIRED/,
    );

    assert.equal(f.count(), 0);
  } finally {
    await f.close();
  }
});

test("correction/discard invalidates the old proposal", async () => {
  const f = fixture();

  try {
    f.user("Book a visit.");

    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: details.lastName,
    });

    const proposal = await f.call("prepareAppointmentChange", f.book);

    f.user("Actually, another day.");

    await f.call("discardAppointmentChange");

    f.user("Yes.");

    await assert.rejects(
      f.call("confirmAppointmentChange", proposal as object),
      /CONFIRMATION_REQUIRED/,
    );

    assert.equal(f.count(), 0);
  } finally {
    await f.close();
  }
});

test("failed verification clears previous identity; separate agent instances do not share patients", async () => {
  const f = fixture();

  try {
    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: details.lastName,
    });

    await assert.rejects(
      f.call("lookupAppointments", {}, createClinicTools(f.client)),
      /VERIFICATION_REQUIRED/,
    );

    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: "Wrong",
    });

    await assert.rejects(f.call("lookupAppointments"), /VERIFICATION_REQUIRED/);
  } finally {
    await f.close();
  }
});

test("agent only offers clinic-provided slots and rejects unreturned timestamps", async () => {
  const f = fixture();

  try {
    let weekend = f.date;

    while (new Date(`${weekend}T12:00:00Z`).getUTCDay() !== 6) {
      weekend = addDays(weekend, 1);
    }

    for (const date of [weekend, addDays(f.date, 31)]) {
      const result = (await f.call("findAvailableSlots", {
        doctorId: "doctor-1",
        date,
      })) as { slots: unknown[] };

      assert.deepEqual(result.slots, []);
    }

    f.user("Book a visit.");

    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: details.lastName,
    });

    await assert.rejects(
      f.call("prepareAppointmentChange", {
        ...f.book,
        startsAt: atWarsawTime(f.date, 10, 15).toISOString(),
      }),
      /SLOT_UNAVAILABLE/,
    );

    assert.equal(f.count(), 0);
  } finally {
    await f.close();
  }
});

test("reschedule and cancellation use owned appointment IDs and keep the existing record", async () => {
  const f = fixture();

  try {
    f.user("Book.");

    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: details.lastName,
    });

    const proposal = await f.call("prepareAppointmentChange", f.book);

    f.user("Yes.");

    const booked = (await f.call(
      "confirmAppointmentChange",
      proposal as object,
    )) as { appointment: { id: string } };

    f.user("Move my visit.");

    const movedProposal = await f.call("prepareAppointmentChange", {
      action: "reschedule",
      doctorId: null,
      appointmentId: booked.appointment.id,
      startsAt: atWarsawTime(f.date, 11).toISOString(),
    });

    f.user("Yes, move it.");

    const moved = (await f.call(
      "confirmAppointmentChange",
      movedProposal as object,
    )) as { appointment: { id: string; startsAt: string } };

    assert.equal(moved.appointment.id, booked.appointment.id);

    assert.equal(
      moved.appointment.startsAt,
      atWarsawTime(f.date, 11).toISOString(),
    );

    f.user("Cancel my visit.");

    await assert.rejects(
      f.call("prepareAppointmentChange", {
        action: "cancel",
        doctorId: null,
        appointmentId: "not-owned",
        startsAt: null,
      }),
      /APPOINTMENT_NOT_CHANGEABLE/,
    );

    const cancellation = await f.call("prepareAppointmentChange", {
      action: "cancel",
      doctorId: null,
      appointmentId: booked.appointment.id,
      startsAt: null,
    });

    f.user("Yes, cancel it.");

    const cancelled = (await f.call(
      "confirmAppointmentChange",
      cancellation as object,
    )) as { appointment: { status: string } };

    assert.equal(cancelled.appointment.status, "cancelled");

    assert.equal(f.count(), 1);
  } finally {
    await f.close();
  }
});

test("network errors and invalid responses never expose request bodies or become success", async () => {
  const broken = new ClinicClient("http://fixture/api/", async () => {
    throw new Error(details.pesel);
  });

  await assert.rejects(
    broken.lookup({ verificationRef: "opaque-reference" }),
    (error: Error) =>
      !error.message.includes(details.pesel) &&
      error.message.includes("SERVICE_UNAVAILABLE"),
  );

  await assert.rejects(
    broken.change(
      "book",
      { verificationRef: "opaque-reference" },
      "doctor-1",
      new Date().toISOString(),
      null,
    ),
    /OUTCOME_UNKNOWN/,
  );

  const invalid = new ClinicClient(
    "http://fixture/api/",
    async () => new Response("{}", { status: 200 }),
  );

  await assert.rejects(invalid.clinic(), /INVALID_RESPONSE/);
});

test("a committed write with a lost response is never blindly retried", async () => {
  const f = fixture(true);

  try {
    f.user("Book.");

    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: details.lastName,
    });

    const proposal = await f.call("prepareAppointmentChange", f.book);

    f.user("Yes.");

    await assert.rejects(
      f.call("confirmAppointmentChange", proposal as object),
      /OUTCOME_UNKNOWN/,
    );

    assert.equal(f.count(), 1);

    await assert.rejects(
      f.call("confirmAppointmentChange", proposal as object),
      /CONFIRMATION_REQUIRED/,
    );

    await assert.rejects(
      f.call("prepareAppointmentChange", f.book),
      /RECONCILIATION_REQUIRED/,
    );

    const lookup = (await f.call("lookupAppointments")) as {
      appointments: unknown[];
    };

    assert.equal(lookup.appointments.length, 1);

    assert.equal(f.count(), 1);
  } finally {
    await f.close();
  }
});

test("an appointment changed after review requires a fresh proposal", async () => {
  const f = fixture();

  try {
    f.user("Book.");

    await f.call("verifyPatient", {
      firstName: details.firstName,
      lastName: details.lastName,
    });

    const proposal = await f.call("prepareAppointmentChange", f.book);

    f.user("Yes.");

    const booked = (await f.call(
      "confirmAppointmentChange",
      proposal as object,
    )) as { appointment: { id: string } };

    f.user("Cancel that visit.");

    const cancellation = await f.call("prepareAppointmentChange", {
      action: "cancel",
      doctorId: null,
      appointmentId: booked.appointment.id,
      startsAt: null,
    });

    await f.client.change(
      "reschedule",
      { verificationRef: f.reference()! },
      "doctor-1",
      atWarsawTime(f.date, 11).toISOString(),
      booked.appointment.id,
    );

    f.user("Yes, cancel the reviewed visit.");

    await assert.rejects(
      f.call("confirmAppointmentChange", cancellation as object),
      /STALE_PROPOSAL/,
    );

    assert.equal(
      (
        await f.client.lookup({ verificationRef: f.reference()! })
      ).appointments.find((item) => item.id === booked.appointment.id)!.status,
      "scheduled",
    );
  } finally {
    await f.close();
  }
});
