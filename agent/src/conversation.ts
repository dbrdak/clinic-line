import type { VerificationBridge } from "./verification.ts";
import { llm, type RunContext } from "@livekit/agents";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { proposalInput } from "./tool-schemas.ts";
import { warsawTime, addDays } from "./time.ts";
import {
  ClinicApiError,
  type Clinic,
  type ClinicAppointment,
  type PatientDetails,
} from "./clinic.ts";

type ToolOptions = { ctx: RunContext; abortSignal: AbortSignal };

type Proposal = z.infer<typeof proposalInput> & {
  id: string;
  patient: PatientDetails;
  preparedByUserId: string;
  reviewed: boolean;
  original: ClinicAppointment | null;
};

function fail(code: string, message: string): never {
  throw new llm.ToolError(`${code}: ${message}`);
}

function latestUser(ctx: RunContext) {
  return ctx.session.history.items
    .filter((item) => item.type === "message" && item.role === "user")
    .at(-1);
}

/** Called once per createAgent(): patient details, proposals and receipts never cross calls. */
export function createConversation(
  client: Clinic,
  verification?: VerificationBridge,
) {
  let verificationRequestId: string | undefined;
  let patient: PatientDetails | undefined;
  let pending: Proposal | undefined;
  let queue: Promise<void> = Promise.resolve();
  let outcomeUnknown = false;
  const receipts = new Map<string, { appointment: ClinicAppointment }>();

  // Serialize parallel model calls so verification, proposals and writes cannot race.
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = queue;
    let release!: () => void;

    queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await work();
    } finally {
      release();
    }
  }

  async function verifiedPatient(): Promise<PatientDetails> {
    if (!verification || !verificationRequestId) {
      fail(
        "VERIFICATION_REQUIRED",
        "Ask for fictional first and last name, then use verifyPatient to open the secure PESEL form. Never ask the caller to speak PESEL.",
      );
    }

    const result = await verification.status(verificationRequestId);

    if (result.status !== "verified" || !result.verificationRef) {
      patient = undefined;

      fail(
        "VERIFICATION_REQUIRED",
        `The secure form status is ${result.status}. Do not disclose appointments. Use checkPatientVerification or request a new form if it expired or was dismissed.`,
      );
    }

    patient = { verificationRef: result.verificationRef };

    return patient;
  }

  return {
    getClinicInformation: async (_: unknown, { abortSignal }: ToolOptions) =>
      exclusive(async () => {
        const clinic = await client.clinic(abortSignal);
        const today = warsawTime(new Date(clinic.now)).date;

        return {
          ...clinic,
          todayWarsaw: today,
          tomorrowWarsaw: addDays(today, 1),
        };
      }),
    verifyPatient: async (
      details: { firstName: string; lastName: string },
      { abortSignal }: ToolOptions,
    ) =>
      exclusive(async () => {
        pending = undefined;

        receipts.clear();

        patient = undefined;

        verificationRequestId = undefined;

        if (!verification) {
          fail(
            "FORM_UNAVAILABLE",
            "Secure verification requires the ClinicLine browser. Do not request PESEL by voice or chat.",
          );
        }

        const result = await verification.request(details, abortSignal);

        verificationRequestId = result.requestId;

        return {
          status: result.status,
          requestId: result.requestId,
          expiresAt: result.expiresAt,
          nextAction:
            result.status === "verified"
              ? "Verification completed by the configured service. Call checkPatientVerification for the saved registration status before acknowledging a new patient; then continue."
              : "Wait for browser form submission. Never ask for PESEL aloud.",
        };
      }),
    checkPatientVerification: async () =>
      exclusive(async () => {
        if (!verification || !verificationRequestId) {
          return { status: "not_requested", verified: false };
        }

        const result = await verification.status(verificationRequestId);

        return {
          status: result.status,
          verified: result.status === "verified",
          ...(result.status === "verified"
            ? { newPatient: result.newPatient ?? false }
            : {}),
        };
      }),
    findAvailableSlots: async (
      { doctorId, date }: { doctorId: string; date: string },
      { abortSignal }: ToolOptions,
    ) =>
      exclusive(async () => {
        const clinic = await client.clinic(abortSignal);

        if (!clinic.doctors.some((doctor) => doctor.id === doctorId)) {
          fail(
            "DOCTOR_NOT_FOUND",
            "Choose a doctor returned by getClinicInformation.",
          );
        }

        const result = await client.availability(doctorId, date, abortSignal);

        return {
          ...result,
          slots: result.slots.map((slot) => ({
            ...slot,
            warsawDate: warsawTime(new Date(slot.startsAt)).date,
            warsawTime: new Intl.DateTimeFormat("en-GB", {
              timeZone: "Europe/Warsaw",
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).format(new Date(slot.startsAt)),
          })),
        };
      }),
    lookupAppointments: async (_: unknown, { abortSignal }: ToolOptions) =>
      exclusive(async () => {
        const result = await client.lookup(
          await verifiedPatient(),
          abortSignal,
        );

        return {
          ...result,
          uncertainChangeNeedsReconciliation: outcomeUnknown,
        };
      }),
    prepareAppointmentChange: async (
      input: z.infer<typeof proposalInput>,
      { ctx, abortSignal }: ToolOptions,
    ) =>
      exclusive(async () => {
        pending = undefined;

        if (outcomeUnknown) {
          fail(
            "RECONCILIATION_REQUIRED",
            "A previous write has an unknown outcome. Look up appointments and stop further writes in this call; do not blindly retry.",
          );
        }

        const details = await verifiedPatient();
        const user = latestUser(ctx);

        if (!user) {
          fail("USER_REQUEST_REQUIRED", "Wait for an actual caller request.");
        }

        const clinic = await client.clinic(abortSignal);
        let existing: ClinicAppointment | undefined;

        if (input.action === "book") {
          if (
            !input.doctorId ||
            input.appointmentId !== null ||
            !input.startsAt
          ) {
            fail(
              "INVALID_PROPOSAL",
              "Booking requires doctorId and startsAt, with appointmentId null.",
            );
          }
        } else {
          if (
            !input.appointmentId ||
            input.doctorId !== null ||
            (input.action === "cancel"
              ? input.startsAt !== null
              : !input.startsAt)
          ) {
            fail(
              "INVALID_PROPOSAL",
              "Changes require appointmentId, doctorId null, and startsAt only for rescheduling.",
            );
          }

          const result = await client.lookup(details, abortSignal);

          existing = result.appointments.find(
            (item) => item.id === input.appointmentId,
          );

          if (!existing || existing.status !== "scheduled") {
            fail(
              "APPOINTMENT_NOT_CHANGEABLE",
              "Select a scheduled, future appointment from this patient's lookup results.",
            );
          }
        }

        const doctorId = existing?.doctorId ?? input.doctorId!;
        const doctor = clinic.doctors.find((item) => item.id === doctorId);

        if (!doctor) {
          fail(
            "DOCTOR_NOT_FOUND",
            "Refresh clinic information and choose an existing doctor.",
          );
        }

        if (input.action !== "cancel") {
          const result = await client.availability(
            doctorId,
            warsawTime(new Date(input.startsAt!)).date,
            abortSignal,
          );

          if (
            !result.slots.some(
              (slot) =>
                Date.parse(slot.startsAt) === Date.parse(input.startsAt!),
            )
          ) {
            fail(
              "SLOT_UNAVAILABLE",
              "Refresh slots and ask the caller to select another. No appointment changed.",
            );
          }
        }

        const proposal: Proposal = {
          ...input,
          doctorId,
          id: randomUUID(),
          patient: { ...details },
          preparedByUserId: user.id,
          reviewed: false,
          original: existing ?? null,
        };

        pending = proposal;

        abortSignal.throwIfAborted();

        // Explicit child reply: never wait for the parent speech that owns this tool.
        const review = ctx.session.generateReply({
          instructions: `Speak a short, natural confirmation question following your normal voice rules. Never output JSON, code, field names, or identifiers. Nothing has been saved. Ask the caller to confirm this exact action and then stop. Action: ${proposal.action}. Doctor: ${doctor.firstName} ${doctor.lastName}. Appointment date and local time in Warsaw: ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", dateStyle: "full", timeStyle: "short" }).format(new Date(input.startsAt ?? existing!.startsAt))}. ${existing && input.action === "reschedule" ? `Original appointment in Warsaw: ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", dateStyle: "full", timeStyle: "short" }).format(new Date(existing.startsAt))}.` : ""} Duration: thirty minutes. Do not say it is booked, cancelled, or rescheduled yet.`,
          toolChoice: "none",
        });

        await review.waitForPlayout();

        if (
          review.interrupted ||
          abortSignal.aborted ||
          latestUser(ctx)?.id !== user.id
        ) {
          pending = undefined;

          fail(
            "REVIEW_INTERRUPTED",
            "No change was made. Resolve the interruption and prepare a new proposal before confirmation.",
          );
        }

        proposal.reviewed = true;

        return {
          proposalId: proposal.id,
          status: "awaiting_confirmation",
          reviewAlreadySpoken: true,
          nextAction:
            "Wait silently for the caller. Do not confirm or repeat the review in this turn.",
        };
      }),
    confirmAppointmentChange: async (
      { proposalId }: { proposalId: string },
      { ctx }: ToolOptions,
    ) =>
      exclusive(async () => {
        const receipt = receipts.get(proposalId);

        if (receipt) {
          return { ...receipt, committed: true, duplicate: true };
        }

        const proposal = pending;

        if (
          outcomeUnknown ||
          !proposal ||
          proposal.id !== proposalId ||
          !proposal.reviewed
        ) {
          fail(
            "CONFIRMATION_REQUIRED",
            "No reviewed current proposal matches. Prepare the exact change and wait for a later approval.",
          );
        }

        const users = ctx.session.history.items.filter(
          (item) => item.type === "message" && item.role === "user",
        );
        const original = users.findIndex(
          (item) => item.id === proposal.preparedByUserId,
        );

        if (original < 0 || users.length !== original + 2) {
          fail(
            "FRESH_CONFIRMATION_REQUIRED",
            "Approval must be the next caller turn after the completed review. Resolve questions/corrections and prepare again if needed.",
          );
        }

        ctx.disallowInterruptions();

        // Consume before awaiting I/O: failures cannot replay this approval.
        pending = undefined;

        if (proposal.original) {
          const result = await client.lookup(proposal.patient);
          const current = result.appointments.find(
            (item) => item.id === proposal.original!.id,
          );

          if (
            !current ||
            current.status !== "scheduled" ||
            current.startsAt !== proposal.original.startsAt ||
            current.endsAt !== proposal.original.endsAt ||
            current.doctorId !== proposal.original.doctorId
          ) {
            fail(
              "STALE_PROPOSAL",
              "The appointment changed since review. Look it up, prepare a new proposal, and obtain fresh confirmation.",
            );
          }
        }

        try {
          const result = await client.change(
            proposal.action,
            proposal.patient,
            proposal.doctorId,
            proposal.startsAt,
            proposal.appointmentId,
            proposal.original,
          );

          receipts.set(proposal.id, result);

          return { ...result, committed: true };
        } catch (error) {
          if (error instanceof ClinicApiError && error.outcomeUnknown) {
            outcomeUnknown = true;
          }

          throw error;
        }
      }),
    discardAppointmentChange: async () =>
      exclusive(async () => {
        pending = undefined;

        return { discarded: true, clinicRecordsChanged: false };
      }),
  };
}
