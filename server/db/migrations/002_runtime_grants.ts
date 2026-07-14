import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types';

const contentTables = [
  'profile_sections',
  'current_occupations',
  'hobbies',
  'languages',
  'page_cards',
  'professional_timeline',
  'projects',
  'pursuits',
  'social_links',
] as const;
const backupTables = [
  ...contentTables,
  'contact_messages',
  'kysely_migration',
  'kysely_migration_lock',
] as const;

async function currentDatabaseName(db: Kysely<Database>): Promise<string> {
  const result = await sql<{ name: string }>`
    select current_database() as name
  `.execute(db);
  const name = result.rows[0]?.name;
  if (!name) throw new Error('Unable to determine the current database');
  return name;
}

export async function up(db: Kysely<Database>): Promise<void> {
  const databaseName = await currentDatabaseName(db);
  await sql`revoke connect, temporary on database ${sql.id(
    databaseName,
  )} from public`.execute(db);
  await sql`grant connect on database ${sql.id(
    databaseName,
  )} to portfolio_app, portfolio_backup`.execute(db);
  await sql`grant usage on schema public to portfolio_app, portfolio_backup`.execute(
    db,
  );
  for (const table of contentTables) {
    await sql
      .raw(`grant select on table "${table}" to portfolio_app`)
      .execute(db);
  }
  await sql`grant insert on table contact_messages to portfolio_app`.execute(
    db,
  );
  await sql`grant select on table kysely_migration to portfolio_app`.execute(
    db,
  );
  for (const table of backupTables) {
    await sql
      .raw(`grant select on table "${table}" to portfolio_backup`)
      .execute(db);
  }
}

export async function down(db: Kysely<Database>): Promise<void> {
  const databaseName = await currentDatabaseName(db);
  for (const table of backupTables) {
    await sql
      .raw(`revoke select on table "${table}" from portfolio_backup`)
      .execute(db);
  }
  await sql`revoke select on table kysely_migration from portfolio_app`.execute(
    db,
  );
  await sql`revoke insert on table contact_messages from portfolio_app`.execute(
    db,
  );
  for (const table of contentTables) {
    await sql
      .raw(`revoke select on table "${table}" from portfolio_app`)
      .execute(db);
  }
  await sql`revoke usage on schema public from portfolio_app, portfolio_backup`.execute(
    db,
  );
  await sql`revoke connect on database ${sql.id(
    databaseName,
  )} from portfolio_app, portfolio_backup`.execute(db);
  await sql`grant connect, temporary on database ${sql.id(
    databaseName,
  )} to public`.execute(db);
}
