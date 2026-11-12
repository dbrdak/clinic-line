import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";
import { database, transaction } from "./db.ts";
import { fail } from "./http.ts";

export type Call = {
  id: string;
  roomName: string;
  participantIdentity: string;
  language: "pl" | "en";
  expiresAt: number;
};

type Row = Record<string, SQLOutputValue>;

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const namesEqual = (a: string, b: string) =>
  a.trim().normalize("NFC").toLocaleLowerCase("pl-PL") ===
  b.trim().normalize("NFC").toLocaleLowerCase("pl-PL");

function callValue(row: Row): Call {
  return {
    id: String(row.id),
    roomName: String(row.room_name),
    participantIdentity: String(row.participant_identity),
    language: row.language as "pl" | "en",
    expiresAt: Number(row.expires_at),
  };
}

export function activeCall(id: string): Call {
  const row = database()
    .prepare(
      "SELECT * FROM calls WHERE id = ? AND closed = 0 AND expires_at > ?",
    )
    .get(id, Date.now());

  if (!row) {
    fail(410, "Call has ended or expired.");
  }

  return callValue(row);
}

export function createCall(language: "pl" | "en") {
  const db = database();

  return transaction(db, () => {
    db.prepare("DELETE FROM calls WHERE expires_at <= ?").run(Date.now());

    if (
      Number(
        db
          .prepare("SELECT count(*) AS count FROM calls WHERE closed = 0")
          .get()!.count,
      ) >= 200
    ) {
      fail(503, "Demo call capacity reached.");
    }

    const call: Call = {
      id: randomUUID(),
      roomName: `clinic-${randomUUID()}`,
      participantIdentity: `caller-${randomUUID()}`,
      language,
      expiresAt: Date.now() + 30 * 60_000,
    };
    const proof = opaque();

    db.prepare("INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?, 0)").run(
      call.id,
      call.roomName,
      call.participantIdentity,
      language,
      hash(proof),
      call.expiresAt,
    );

    return { call, proof };
  });
}

export function browserCall(headers: Headers) {
  const proof = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const row = database()
    .prepare("SELECT id FROM calls WHERE proof_hash = ?")
    .get(hash(proof));

  if (!row) {
    fail(401, "Call authorization required.");
  }

  return activeCall(String(row.id));
}

export function closeCall(id: string) {
  const db = database();

  transaction(db, () => {
    db.prepare("UPDATE calls SET closed = 1 WHERE id = ?").run(id);

    db.prepare(
      "UPDATE verifications SET status = 'disconnected', reference = NULL, patient_id = NULL WHERE call_id = ?",
    ).run(id);
  });

  return { ended: true };
}

export function beginVerification(
  callId: string,
  firstName: string,
  lastName: string,
) {
  const db = database();

  return transaction(db, () => {
    activeCall(callId);

    if (
      Number(
        db
          .prepare(
            "SELECT count(*) AS count FROM verifications WHERE call_id = ?",
          )
          .get(callId)!.count,
      ) >= 50
    ) {
      fail(429, "Too many verification requests in this call.");
    }

    db.prepare(
      "UPDATE verifications SET status = 'dismissed', reference = NULL, patient_id = NULL WHERE call_id = ?",
    ).run(callId);

    const id = randomUUID();
    const expiresAt = Date.now() + 2 * 60_000;

    db.prepare(
      "INSERT INTO verifications VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL)",
    ).run(id, callId, firstName, lastName, expiresAt);

    return {
      requestId: id,
      status: "pending",
      expiresAt: new Date(expiresAt).toISOString(),
    };
  });
}

function request(callId: string, id: string) {
  activeCall(callId);

  const db = database();

  db.prepare(
    "UPDATE verifications SET status = 'expired' WHERE id = ? AND call_id = ? AND status IN ('pending','processing') AND expires_at <= ?",
  ).run(id, callId, Date.now());

  const row = db
    .prepare("SELECT * FROM verifications WHERE id = ? AND call_id = ?")
    .get(id, callId);

  if (!row) {
    fail(404, "Verification request not found.");
  }

  return row;
}

export function verificationStatus(callId: string, id: string) {
  const row = request(callId, id);

  return {
    requestId: id,
    status: String(row.status),
    expiresAt: new Date(Number(row.expires_at)).toISOString(),
    ...(row.status === "verified" && row.reference
      ? { verificationRef: String(row.reference) }
      : {}),
  };
}

export function consumeVerification(callId: string, id: string) {
  const db = database();

  // One SQL compare-and-set wins even when Next.js uses different processes/connections.
  activeCall(callId);

  const changed = db
    .prepare(
      "UPDATE verifications SET status = 'processing' WHERE id = ? AND call_id = ? AND status = 'pending' AND expires_at > ?",
    )
    .run(id, callId, Date.now());

  if (!changed.changes) {
    const row = request(callId, id);

    if (row.status === "expired") {
      fail(410, "Verification request expired.");
    }

    fail(409, "Verification request already used.");
  }
}

export function finishVerification(callId: string, id: string, pesel: string) {
  const db = database();

  return transaction(db, () => {
    consumeVerification(callId, id);

    const row = request(callId, id);

    if (row.status !== "processing") {
      fail(410, "Verification request is no longer active.");
    }

    const patient = db
      .prepare("SELECT id, first_name, last_name FROM patients WHERE pesel = ?")
      .get(pesel);
    const matched =
      patient &&
      namesEqual(String(patient.first_name), String(row.first_name)) &&
      namesEqual(String(patient.last_name), String(row.last_name));

    if (!matched) {
      // Roll back consumption too: invalid details can be corrected until expiry.
      fail(422, "Details did not match.");
    }

    const status = "verified";

    db.prepare(
      "UPDATE verifications SET status = ?, patient_id = ?, reference = ? WHERE id = ?",
    ).run(
      status,
      matched ? String(patient.id) : null,
      matched ? opaque() : null,
      id,
    );

    return { status };
  });
}

export function dismissVerification(callId: string, id: string) {
  activeCall(callId);

  const changed = database()
    .prepare(
      "UPDATE verifications SET status = 'dismissed' WHERE id = ? AND call_id = ? AND status = 'pending' AND expires_at > ?",
    )
    .run(id, callId, Date.now());

  if (!changed.changes) {
    request(callId, id);

    fail(409, "Verification request is no longer pending.");
  }

  return { status: "dismissed" };
}

export function verifiedPatient(callId: string, reference: string): string {
  activeCall(callId);

  const row = database()
    .prepare(
      "SELECT patient_id FROM verifications WHERE call_id = ? AND reference = ? AND status = 'verified'",
    )
    .get(callId, reference);

  if (!row?.patient_id) {
    fail(401, "Patient verification required.");
  }

  return String(row.patient_id);
}
