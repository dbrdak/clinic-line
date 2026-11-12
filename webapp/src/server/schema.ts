export const schema = `PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  pesel TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY NOT NULL,
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  patient_id TEXT NOT NULL REFERENCES patients(id),
  starts_at_ms INTEGER NOT NULL, ends_at_ms INTEGER NOT NULL, status TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS appointments_doctor_time ON appointments(doctor_id, starts_at_ms);
CREATE INDEX IF NOT EXISTS appointments_patient_time ON appointments(patient_id, starts_at_ms);

CREATE TABLE IF NOT EXISTS calls (
 id TEXT PRIMARY KEY, room_name TEXT NOT NULL UNIQUE, participant_identity TEXT NOT NULL UNIQUE,
 language TEXT NOT NULL CHECK(language IN ('pl','en')), proof_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE IF NOT EXISTS verifications (
 id TEXT PRIMARY KEY, call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
 first_name TEXT NOT NULL, last_name TEXT NOT NULL, expires_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','processing','verified','failed','dismissed','expired','disconnected')),
 patient_id TEXT REFERENCES patients(id), reference TEXT UNIQUE,
 is_new_patient INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS verifications_call ON verifications(call_id);
`;
