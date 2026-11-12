import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { schema } from "./schema.ts";
import { addDays, atWarsawTime, warsawTime } from "./dates.ts";

let connection: DatabaseSync | undefined;

export function database() {
  if (connection) {
    return connection;
  }

  const path = resolve(
    /* turbopackIgnore: true */ process.env.DATABASE_PATH ??
      "./data/clinic-line.sqlite",
  );

  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });

  db.exec(schema);

  transaction(db, () => {
    // Keep existing local databases usable after adding registration status.
    if (
      !db
        .prepare("PRAGMA table_info(verifications)")
        .all()
        .some((column) => column.name === "is_new_patient")
    ) {
      db.exec(
        "ALTER TABLE verifications ADD COLUMN is_new_patient INTEGER NOT NULL DEFAULT 0",
      );
    }

    seed(db);
  });

  connection = db;

  return db;
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = work();

    db.exec("COMMIT");

    return result;
  } catch (error) {
    db.exec("ROLLBACK");

    throw error;
  }
}

function seed(db: DatabaseSync) {
  const empty =
    Number(db.prepare("SELECT count(*) AS count FROM doctors").get()!.count) ===
    0;

  // Add another fictional doctor to older one-doctor databases without changing existing records.
  if (
    Number(db.prepare("SELECT count(*) AS count FROM doctors").get()!.count) < 2
  ) {
    db.prepare("INSERT OR IGNORE INTO doctors VALUES (?, ?, ?)").run(
      "doctor-learning-2",
      "Piotr",
      "Demonstracyjny",
    );
  }

  if (!empty) {
    return;
  }

  const doctor = randomUUID();

  db.prepare("INSERT INTO doctors VALUES (?, ?, ?)").run(
    doctor,
    "Maria",
    "Przykładowa",
  );

  const patients: string[] = [];

  for (let i = 1; i <= 10; i++) {
    const id = randomUUID();

    db.prepare("INSERT INTO patients VALUES (?, ?, ?, ?)").run(
      id,
      `Pacjent${i}`,
      "Testowy",
      String(i).padStart(11, "0"),
    );

    patients.push(id);
  }

  const today = warsawTime(new Date()).date;
  let count = 0;

  for (let day = 1; day <= 14 && count < 30; day++) {
    const date = addDays(today, day);

    if ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) {
      continue;
    }

    for (const hour of [9, 11, 14]) {
      const start = atWarsawTime(date, hour).getTime();

      db.prepare("INSERT INTO appointments VALUES (?, ?, ?, ?, ?, ?)").run(
        randomUUID(),
        count % 2 ? "doctor-learning-2" : doctor,
        patients[count % 10]!,
        start,
        start + 30 * 60_000,
        "scheduled",
      );

      count++;
    }
  }
}
