import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/database.types';

const inFlightChecks = new WeakMap<
  Kysely<Database>,
  Map<string, Promise<boolean>>
>();

async function runReadinessCheck(
  db: Kysely<Database>,
  requiredMigration: string,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('Readiness deadline exceeded'));
  }, timeoutMs);
  const queryOptions = {
    signal: controller.signal,
    inflightQueryAbortStrategy: 'cancel query' as const,
  };

  try {
    await sql`select 1`.execute(db, queryOptions);
    const migration = await db
      .selectFrom('kysely_migration')
      .select('name')
      .where('name', '=', requiredMigration)
      .executeTakeFirst(queryOptions);
    return migration?.name === requiredMigration;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function checkReadiness(
  db: Kysely<Database>,
  requiredMigration: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  const contract = JSON.stringify([requiredMigration, timeoutMs]);
  let databaseChecks = inFlightChecks.get(db);
  if (!databaseChecks) {
    databaseChecks = new Map();
    inFlightChecks.set(db, databaseChecks);
  }

  const existing = databaseChecks.get(contract);
  if (existing) return existing;

  const check = runReadinessCheck(db, requiredMigration, timeoutMs).finally(
    () => {
      if (databaseChecks?.get(contract) === check) {
        databaseChecks.delete(contract);
        if (databaseChecks.size === 0) inFlightChecks.delete(db);
      }
    },
  );
  databaseChecks.set(contract, check);
  return check;
}
