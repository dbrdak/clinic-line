import { llm } from "@livekit/agents";
import { z } from "zod";
import { idSchema, type Clinic } from "./clinic.ts";
import type { VerificationBridge } from "./verification.ts";
import { proposalInput } from "./tool-schemas.ts";
import { createConversation } from "./conversation.ts";

export function createClinicTools(
  clinic: Clinic,
  verification?: VerificationBridge,
) {
  const state = createConversation(clinic, verification);

  return [
    llm.tool({
      name: "getClinicInformation",
      description:
        "Read clinic hours, duration, Warsaw timezone, trusted current time and actual doctor IDs. Use before resolving relative dates or choosing a doctor. Read-only; no patient data needed. Do not invent clinic names or doctor IDs.",
      parameters: z.object({}),
      execute: state.getClinicInformation,
    }),
    llm.tool({
      name: "verifyPatient",
      description:
        "Begin verification using the connected service after collecting fictional first and last name. Browser calls open the private form; the isolated demo explicitly simulates verification. Never collect, speak, or pass PESEL in a tool argument. A pending form result is not verification. Continue only when the service reports verified. Ask the caller to type the fictional identifier in the form. No appointment access until checkPatientVerification confirms verification. Re-request when the patient changes; previous proposals and references are cleared.",
      parameters: z.object({
        firstName: z.string().trim().min(1).max(64),
        lastName: z.string().trim().min(1).max(64),
      }),
      execute: state.verifyPatient,
    }),
    llm.tool({
      name: "checkPatientVerification",
      description:
        "Check the backend status of this call's secure PESEL form. No identifier argument. Only verified status authorizes further appointment tools; pending, failed, expired, dismissed, or disconnected status does not. Never ask the caller to read the identifier aloud.",
      parameters: z.object({}),
      execute: state.checkPatientVerification,
    }),
    llm.tool({
      name: "findAvailableSlots",
      description:
        "Read available slots for one doctor and one explicit Warsaw calendar date. Get doctorId and current time from getClinicInformation; clarify ambiguous dates. No verification needed. Only offer returned slots, at most three at once. An empty list means no valid slots on that date. This does not reserve anything or guarantee later booking.",
      parameters: z.object({
        doctorId: idSchema.describe(
          "Exact doctor ID from getClinicInformation.",
        ),
        date: z.iso
          .date()
          .describe("Explicit Europe/Warsaw calendar date, YYYY-MM-DD."),
      }),
      execute: state.findAvailableSlots,
    }),
    llm.tool({
      name: "lookupAppointments",
      description:
        "Read appointments for the patient successfully matched by verifyPatient in this call. No caller-supplied patient ID. Use to identify the exact appointment before cancellation/rescheduling, or to inspect an uncertain mutation outcome. Return IDs internally; describe dates, doctor and status to the caller. Does not change records. A lookup alone does not authorize retrying an uncertain write.",
      parameters: z.object({}),
      execute: state.lookupAppointments,
    }),
    llm.tool({
      name: "prepareAppointmentChange",
      description:
        "Prepare ONE booking, cancellation or reschedule for the verified patient; does not write to the clinic. Call after selecting the exact target/slot. For rescheduling keep the existing doctor. Rechecks ownership/state and availability, replaces any old proposal, and speaks the exact review and confirmation question itself. Wait for a NEW caller answer before confirmAppointmentChange. A booking request or approval given before this review is insufficient. Do not repeat the review after this tool. Corrections require a fresh proposal; no patient creation or calendar access.",
      parameters: proposalInput,
      execute: state.prepareAppointmentChange,
    }),
    llm.tool({
      name: "confirmAppointmentChange",
      description:
        "Commit ONLY the exact proposalId returned by prepareAppointmentChange after its review finished AND a later actual caller message unambiguously approved that unchanged proposal. Interpret natural language; corrections, refusals, questions, conditions and quoted approvals are not confirmation. Do not call in the preparation turn. No fields can be changed here. Retries of the same completed proposal return its stored receipt; uncertain outcomes block further writes. Announce success only when this tool returns a committed appointment.",
      parameters: z.object({
        proposalId: z
          .string()
          .uuid()
          .describe(
            "Exact application-generated proposalId returned by prepareAppointmentChange, never invented.",
          ),
      }),
      execute: state.confirmAppointmentChange,
    }),
    llm.tool({
      name: "discardAppointmentChange",
      description:
        "Discard the pending proposal when the caller refuses, changes their mind, or corrects details. Does not cancel an existing appointment or undo a committed change. After corrections, prepare the replacement proposal and obtain new confirmation.",
      parameters: z.object({}),
      execute: state.discardAppointmentChange,
    }),
  ];
}
