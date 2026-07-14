import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/database.types';

export async function checkReadiness(
  db: Kysely<Database>,
  requiredMigration: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  const check = async () => {
    await sql`select 1`.execute(db);
    const migration = await db
      .selectFrom('kysely_migration')
      .select('name')
      .where('name', '=', requiredMigration)
      .executeTakeFirst();
    return migration?.name === requiredMigration;
  };

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([check(), timedOut]);
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
