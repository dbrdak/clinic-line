import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const databasePath = resolve(process.env.DB_PATH ?? './data/clinicline.db');

export function ensureDatabaseDirectory(): void {
  mkdirSync(dirname(databasePath), { recursive: true });
}
