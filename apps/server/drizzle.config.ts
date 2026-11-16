import 'dotenv/config';

import { defineConfig } from 'drizzle-kit';
import { databasePath } from './src/db/config.js';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: databasePath,
  },
});
