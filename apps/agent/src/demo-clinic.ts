import {
  ClinicApiError,
  type Clinic,
  type ClinicAppointment,
} from "./clinic.ts";
import type { VerificationBridge } from "./verification.ts";

/** Deterministic fixtures, not another scheduling policy engine. Never used by main.ts. */
export function createDemoClinic() {
  const doctors = [
    { id: "doctor-1", firstName: "Maria", lastName: "Przykładowa" },
    { id: "doctor-2", firstName: "Piotr", lastName: "Demonstracyjny" },
  ];
  const slots = [
    "2030-05-07T08:00:00.000Z",
    "2030-05-07T09:00:00.000Z",
    "2030-05-08T08:00:00.000Z",
  ];
  const appointments: ClinicAppointment[] = [];
  let sequence = 0;
  let verificationId: string | undefined;
  let reference: string | undefined;
  let newPatient = false;
  let registered = false;

  function reject(code: string, message: string): never {
    throw new ClinicApiError(code, message);
  }

  const authorize = (value: { verificationRef: string }) => {
    if (!reference || value.verificationRef !== reference) {
      reject("VERIFICATION_REQUIRED", "Demo patient verification required.");
    }
  };
  const verification: VerificationBridge = {
    async request(names) {
      verificationId = `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

      newPatient =
        names.firstName === "Alicja" &&
        names.lastName === "Nowa" &&
        !registered;

      reference =
        (names.firstName === "Pacjent1" && names.lastName === "Testowy") ||
        (names.firstName === "Alicja" && names.lastName === "Nowa")
          ? `demo-reference-${sequence}`
          : undefined;

      registered ||= newPatient;

      return {
        newPatient,
        requestId: verificationId,
        status: reference ? "verified" : "failed",
        expiresAt: "2030-05-06T08:02:00.000Z",
      };
    },
    async status(id) {
      if (id !== verificationId) {
        reject("VERIFICATION_REQUIRED", "Unknown demo verification.");
      }

      return {
        requestId: id,
        newPatient,
        status: reference ? "verified" : "failed",
        expiresAt: "2030-05-06T08:02:00.000Z",
        ...(reference ? { verificationRef: reference } : {}),
      };
    },
  };
  const clinic: Clinic = {
    async clinic() {
      return {
        now: "2030-05-06T08:00:00.000Z",
        timeZone: "Europe/Warsaw",
        opensAt: "07:00",
        closesAt: "19:00",
        appointmentMinutes: 30,
        doctors,
        operatingDays: "Monday–Friday",
        bookingHorizon:
          "Today and the following 29 Warsaw calendar dates; future starts only.",
        callsAvailable: "24/7",
      };
    },
    async availability(doctorId, date) {
      if (!doctors.some((doctor) => doctor.id === doctorId)) {
        reject("NOT_FOUND", "Unknown demo doctor.");
      }

      return {
        doctorId,
        date,
        timeZone: "Europe/Warsaw",
        slots: slots
          .filter(
            (start) =>
              start.slice(0, 10) === date &&
              !appointments.some(
                (a) =>
                  a.doctorId === doctorId &&
                  a.startsAt === start &&
                  a.status === "scheduled",
              ),
          )
          .map((startsAt) => ({
            startsAt,
            endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
          })),
      };
    },
    async lookup(patient) {
      authorize(patient);

      return { appointments: structuredClone(appointments) };
    },
    async change(action, patient, doctorId, startsAt, appointmentId, expected) {
      authorize(patient);

      const existing = appointments.find((a) => a.id === appointmentId);

      if (action !== "book" && (!existing || existing.status !== "scheduled")) {
        reject("NOT_FOUND", "Unknown or cancelled demo appointment.");
      }

      if (
        existing &&
        expected &&
        JSON.stringify(existing) !== JSON.stringify(expected)
      ) {
        reject("CONFLICT", "Demo appointment changed after review.");
      }

      const doctor = existing?.doctorId ?? doctorId;
      const start = action === "cancel" ? existing!.startsAt : startsAt;

      if (!doctor || !start || !doctors.some((d) => d.id === doctor)) {
        reject("INVALID_SLOT", "Select a demo doctor and fixture slot.");
      }

      if (
        action !== "cancel" &&
        (!slots.includes(start) ||
          appointments.some(
            (a) =>
              a.id !== appointmentId &&
              a.status === "scheduled" &&
              a.startsAt === start,
          ))
      ) {
        reject("SLOT_UNAVAILABLE", "Demo fixture slot unavailable.");
      }

      const appointment: ClinicAppointment = {
        id: existing?.id ?? `appointment-${++sequence}`,
        doctorId: doctor,
        patientId: "demo-patient",
        startsAt: start,
        endsAt: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
        status: action === "cancel" ? "cancelled" : "scheduled",
      };

      if (existing) {
        appointments[appointments.indexOf(existing)] = appointment;
      } else {
        appointments.push(appointment);
      }

      return { appointment: structuredClone(appointment) };
    },
  };

  return {
    clinic,
    verification,
    snapshot: () => structuredClone(appointments),
  };
}
