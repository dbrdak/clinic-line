import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

import { db } from './client.js';

export function migrateDatabase(): void {
  migrate(db, {
    migrationsFolder: resolve(process.cwd(), 'drizzle'),
  });
}
