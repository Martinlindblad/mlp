import type { Kysely } from 'kysely';
import { createDatabase } from '../../server/db/client';
import { loadDatabaseConfig } from '../../server/db/config';
import type { Database } from '../../server/db/database.types';

// Task 8/14 must provide a trusted one-shot operator image/path. Migration
// modules are intentionally typechecked separately from the production app.
export async function withMigrationTarget<T>(
  run: (db: Kysely<Database>) => Promise<T>,
): Promise<T> {
  const config = loadDatabaseConfig(process.env);
  if (config.user !== 'portfolio_migrator') {
    throw new Error('migration target configuration invalid');
  }
  const db = createDatabase(config);
  try {
    return await run(db);
  } finally {
    await db.destroy();
  }
}

export function runOperator(
  run: () => Promise<void>,
  failureMessage: string,
): void {
  run().catch(() => {
    process.stderr.write(`${failureMessage}\n`);
    process.exitCode = 1;
  });
}

export function runId(now = new Date()): string {
  return now.toISOString().replace(/\D/g, '').slice(0, 14);
}
