import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Kysely } from 'kysely';
import type { Database } from './database.types';

interface Migrator {
  migrateToLatest(): Promise<{ error?: unknown }>;
}

interface MigrationModule {
  FileMigrationProvider: new (options: {
    fs: typeof fs;
    path: typeof path;
    migrationFolder: string;
  }) => unknown;
  Migrator: new (options: {
    db: Kysely<Database>;
    provider: unknown;
  }) => Migrator;
}

const { FileMigrationProvider, Migrator: KyselyMigrator } = createRequire(
  __filename,
)('kysely/migration') as MigrationModule;

export function createMigrator(db: Kysely<Database>): Migrator {
  return new KyselyMigrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });
}

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const result = await createMigrator(db).migrateToLatest();
  if (result.error instanceof Error) throw result.error;
  if (result.error) {
    throw new Error('Database migration failed', { cause: result.error });
  }
}
