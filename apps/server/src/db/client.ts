import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';

import { databasePath, ensureDatabaseDirectory } from './config.js';

ensureDatabaseDirectory();

const sqlite = new DatabaseSync(databasePath);

sqlite.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
`);

export const db = drizzle({ client: sqlite });
