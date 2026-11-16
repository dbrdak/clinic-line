import 'dotenv/config';

import { buildApp } from './app.js';
import { migrateDatabase } from './db/migrate.js';

async function main(): Promise<void> {
  migrateDatabase();

  const app = await buildApp();

  try {
    await app.listen({
      port: Number.parseInt(process.env.PORT ?? '3000'),
      host: '127.0.0.1',
    });
  } catch (error) {
    app.log.fatal({ err: error });
    await app.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error('Server startup failed:', error);
  process.exitCode = 1;
});
