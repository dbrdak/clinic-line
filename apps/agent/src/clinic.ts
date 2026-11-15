import { llm } from "@livekit/agents";
import { z } from "zod";

// Wire contract only. This application never imports backend implementations.
export const idSchema = z.string().min(1).max(128);

export const dateTimeSchema = z.iso.datetime({ offset: true });

export const doctorSchema = z.object({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string(),
});

export const appointmentSchema = z.object({
  id: idSchema,
  doctorId: idSchema,
  patientId: idSchema,
  startsAt: dateTimeSchema,
  endsAt: dateTimeSchema,
  status: z.enum(["scheduled", "cancelled"]),
});

export const clinicSchema = z.object({
  now: dateTimeSchema,
  timeZone: z.literal("Europe/Warsaw"),
  opensAt: z.literal("07:00"),
  closesAt: z.literal("19:00"),
  appointmentMinutes: z.literal(30),
  doctors: z.array(doctorSchema),
  operatingDays: z.string(),
  bookingHorizon: z.string(),
  callsAvailable: z.string(),
});

export const availabilitySchema = z.object({
  doctorId: idSchema,
  date: z.iso.date(),
  timeZone: z.literal("Europe/Warsaw"),
  slots: z.array(
    z.object({ startsAt: dateTimeSchema, endsAt: dateTimeSchema }),
  ),
});

export type PatientDetails = { verificationRef: string };

export type ClinicAppointment = z.infer<typeof appointmentSchema>;

export interface Clinic {
  clinic(signal?: AbortSignal): Promise<z.infer<typeof clinicSchema>>;

  availability(
    doctorId: string,
    date: string,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof availabilitySchema>>;

  lookup(
    patient: PatientDetails,
    signal?: AbortSignal,
  ): Promise<{ appointments: ClinicAppointment[] }>;

  change(
    action: "book" | "cancel" | "reschedule",
    patient: PatientDetails,
    doctorId: string | null,
    startsAt: string | null,
    appointmentId: string | null,
    expected?: ClinicAppointment | null,
  ): Promise<{ appointment: ClinicAppointment }>;
}

export class ClinicApiError extends llm.ToolError {
  readonly outcomeUnknown: boolean;
  constructor(code: string, message: string, outcomeUnknown = false) {
    super(`${code}: ${message}`);

    this.outcomeUnknown = outcomeUnknown;
  }
}
