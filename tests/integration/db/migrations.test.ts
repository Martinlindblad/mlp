import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createIsolatedDatabase } from '../../helpers/postgres';
import { migrateToLatest } from '../../../server/db/migrator';

const expectedTables = [
  'contact_messages',
  'current_occupations',
  'hobbies',
  'languages',
  'page_cards',
  'professional_timeline',
  'profile_sections',
  'projects',
  'pursuits',
  'social_links',
];

describe('database migrations', () => {
  const isolated = createIsolatedDatabase();
  beforeAll(async () => isolated.start());
  afterAll(async () => isolated.stop());

  it('creates the exact schema and is idempotent', async () => {
    await migrateToLatest(isolated.db);
    await migrateToLatest(isolated.db);

    const tables = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      and table_name not like 'kysely_%'
      order by table_name
    `.execute(isolated.db);
    expect(tables.rows.map((row) => row.table_name)).toEqual(expectedTables);

    const contentColumns = await sql<{ table_name: string }>`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'source_order'
      order by table_name
    `.execute(isolated.db);
    expect(contentColumns.rows.map((row) => row.table_name)).toEqual(
      expectedTables.filter((name) => name !== 'contact_messages'),
    );

    const migrations = await sql<{ name: string }>`
      select name from kysely_migration order by timestamp desc limit 1
    `.execute(isolated.db);
    expect(migrations.rows[0]?.name).toBe('002_runtime_grants');
  });
});
