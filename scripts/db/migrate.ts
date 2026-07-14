import { getDatabase } from '../../server/db/client';
import { migrateToLatest } from '../../server/db/migrator';

async function main(): Promise<void> {
  const db = getDatabase();
  try {
    await migrateToLatest(db);
    process.stdout.write('database migrations applied\n');
  } finally {
    await db.destroy();
  }
}

main().catch(() => {
  process.stderr.write('database migration failed\n');
  process.exitCode = 1;
});
