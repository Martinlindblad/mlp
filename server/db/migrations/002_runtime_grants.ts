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
] as const;

export async function up(db: Kysely<Database>): Promise<void> {
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
}
