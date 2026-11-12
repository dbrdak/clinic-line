import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SQLOutputValue } from "node:sqlite";
import { database, transaction } from "./db.ts";
import { addDays, atWarsawTime, warsawTime } from "./dates.ts";
import { fail } from "./http.ts";
import { verifiedPatient } from "./verification.ts";

export const id = z.string().min(1).max(128);

const dateTime = z.iso.datetime({ offset: true });

export const appointmentSchema = z.object({
  id,
  doctorId: id,
  patientId: id,
  startsAt: dateTime,
  endsAt: dateTime,
  status: z.enum(["scheduled", "cancelled"]),
});

export const patientRequest = z
  .object({
    patient: z
      .object({ verificationRef: z.string().min(32).max(128) })
      .strict(),
  })
  .strict();

export const bookingRequest = patientRequest.extend({
  confirmed: z.literal(true),
  doctorId: id,
  startsAt: dateTime,
});

export const changeRequest = patientRequest.extend({
  confirmed: z.literal(true),
  expected: appointmentSchema,
  startsAt: dateTime.optional(),
});

type Row = Record<string, SQLOutputValue>;

function appointment(row: Row) {
  return {
    id: String(row.id),
    doctorId: String(row.doctor_id),
    patientId: String(row.patient_id),
    startsAt: new Date(Number(row.starts_at_ms)).toISOString(),
    endsAt: new Date(Number(row.ends_at_ms)).toISOString(),
    status: row.status as "scheduled" | "cancelled",
  };
}

export function doctors() {
  return database()
    .prepare(
      "SELECT id, first_name AS firstName, last_name AS lastName FROM doctors ORDER BY last_name, id",
    )
    .all();
}

export function clinicInformation() {
  return {
    now: new Date().toISOString(),
    timeZone: "Europe/Warsaw",
    opensAt: "07:00",
    closesAt: "19:00",
    appointmentMinutes: 30,
    doctors: doctors(),
    operatingDays: "Monday–Friday",
    bookingHorizon:
      "Today and the following 29 Warsaw calendar dates; future half-hour starts only. No holiday exceptions.",
    callsAvailable: "24/7",
  };
}

function allowedDate(date: string, now: Date) {
  const today = warsawTime(now).date;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();

  return (
    date >= today && date < addDays(today, 30) && weekday !== 0 && weekday !== 6
  );
}

function slotEnd(startsAt: Date, now: Date) {
  if (!Number.isFinite(startsAt.getTime())) {
    fail(400, "Invalid appointment time.");
  }

  const local = warsawTime(startsAt);
  const end = new Date(startsAt.getTime() + 30 * 60_000);

  if (
    !allowedDate(local.date, now) ||
    startsAt <= now ||
    startsAt.getUTCSeconds() !== 0 ||
    startsAt.getUTCMilliseconds() !== 0 ||
    local.minute % 30 !== 0 ||
    startsAt < atWarsawTime(local.date, 7) ||
    end > atWarsawTime(local.date, 19)
  ) {
    fail(
      400,
      "Choose a future weekday half-hour appointment, 07:00–19:00 Europe/Warsaw, within today plus 29 calendar days.",
    );
  }

  return end;
}

export function availability(doctorId: string, date: string) {
  const db = database();

  if (!db.prepare("SELECT id FROM doctors WHERE id = ?").get(doctorId)) {
    fail(404, "Doctor not found.");
  }

  const now = new Date();
  const slots: { startsAt: string; endsAt: string }[] = [];

  if (allowedDate(date, now)) {
    for (let minute = 7 * 60; minute < 19 * 60; minute += 30) {
      const start = atWarsawTime(date, Math.floor(minute / 60), minute % 60);
      const end = new Date(start.getTime() + 30 * 60_000);

      if (start <= now) {
        continue;
      }

      const conflict = db
        .prepare(
          "SELECT id FROM appointments WHERE doctor_id = ? AND status = 'scheduled' AND starts_at_ms < ? AND ends_at_ms > ? LIMIT 1",
        )
        .get(doctorId, end.getTime(), start.getTime());

      if (!conflict) {
        slots.push({
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        });
      }
    }
  }

  return { doctorId, date, timeZone: "Europe/Warsaw", slots };
}

export function lookup(callId: string, reference: string) {
  const patient = verifiedPatient(callId, reference);

  return {
    appointments: database()
      .prepare(
        "SELECT * FROM appointments WHERE patient_id = ? ORDER BY starts_at_ms,id",
      )
      .all(patient)
      .map(appointment),
  };
}

export function changeAppointment(
  callId: string,
  action: "book" | "cancel" | "reschedule",
  raw: unknown,
  appointmentId?: string,
) {
  const value =
    action === "book" ? bookingRequest.parse(raw) : changeRequest.parse(raw);
  const db = database();

  return transaction(db, () => {
    // Recheck persisted call/reference inside the same write transaction.
    const patient = verifiedPatient(callId, value.patient.verificationRef);
    const now = new Date();
    let existing: ReturnType<typeof appointment> | undefined;

    if (action !== "book") {
      const row = db
        .prepare("SELECT * FROM appointments WHERE id = ? AND patient_id = ?")
        .get(appointmentId!, patient);

      if (!row) {
        fail(404, "Appointment not found.");
      }

      existing = appointment(row);

      if (
        existing.status !== "scheduled" ||
        new Date(existing.startsAt) <= now
      ) {
        fail(409, "Appointment cannot be changed.");
      }

      const expected = changeRequest.parse(value).expected;

      if (
        Object.keys(existing).some(
          (key) =>
            existing![key as keyof typeof existing] !==
            expected[key as keyof typeof expected],
        )
      ) {
        fail(
          409,
          "Appointment changed after review; obtain fresh confirmation.",
        );
      }
    }

    const doctorId = existing?.doctorId ?? bookingRequest.parse(value).doctorId;

    if (!db.prepare("SELECT id FROM doctors WHERE id = ?").get(doctorId)) {
      fail(404, "Doctor not found.");
    }

    const startsAt =
      action === "cancel"
        ? new Date(existing!.startsAt)
        : new Date(value.startsAt ?? fail(400, "Appointment time required."));
    const endsAt =
      action === "cancel" ? new Date(existing!.endsAt) : slotEnd(startsAt, now);
    const status = action === "cancel" ? "cancelled" : "scheduled";
    const appointmentIdValue = existing?.id ?? randomUUID();

    if (
      status === "scheduled" &&
      db
        .prepare(
          "SELECT id FROM appointments WHERE id != ? AND status = 'scheduled' AND (doctor_id = ? OR patient_id = ?) AND starts_at_ms < ? AND ends_at_ms > ? LIMIT 1",
        )
        .get(
          appointmentIdValue,
          doctorId,
          patient,
          endsAt.getTime(),
          startsAt.getTime(),
        )
    ) {
      fail(
        409,
        "The doctor or patient already has an overlapping appointment.",
      );
    }

    if (existing) {
      db.prepare(
        "UPDATE appointments SET starts_at_ms = ?, ends_at_ms = ?, status = ? WHERE id = ?",
      ).run(startsAt.getTime(), endsAt.getTime(), status, appointmentIdValue);
    } else {
      db.prepare("INSERT INTO appointments VALUES (?, ?, ?, ?, ?, ?)").run(
        appointmentIdValue,
        doctorId,
        patient,
        startsAt.getTime(),
        endsAt.getTime(),
        status,
      );
    }

    return {
      appointment: {
        id: appointmentIdValue,
        doctorId,
        patientId: patient,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status,
      },
    };
  });
}
