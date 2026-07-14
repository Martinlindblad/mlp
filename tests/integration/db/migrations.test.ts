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

  it('grants backup access to migration lock state', async () => {
    await migrateToLatest(isolated.db);

    const privilege = await sql<{ can_select: boolean }>`
      select has_table_privilege(
        'portfolio_backup',
        'public.kysely_migration_lock',
        'select'
      ) as can_select
    `.execute(isolated.db);

    expect(privilege.rows[0]?.can_select).toBe(true);
  });

  it('matches nullable legacy read fields and the required occupation title', async () => {
    await migrateToLatest(isolated.db);

    const columns = await sql<{
      table_name: string;
      column_name: string;
      is_nullable: 'YES' | 'NO';
    }>`
      select table_name, column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
      and (
        (table_name = 'current_occupations' and column_name = 'title')
        or (table_name = 'page_cards' and column_name = 'content')
        or (table_name = 'projects' and column_name in ('from_label', 'to_label'))
      )
      order by table_name, column_name
    `.execute(isolated.db);

    expect(columns.rows).toEqual([
      {
        table_name: 'current_occupations',
        column_name: 'title',
        is_nullable: 'NO',
      },
      {
        table_name: 'page_cards',
        column_name: 'content',
        is_nullable: 'YES',
      },
      {
        table_name: 'projects',
        column_name: 'from_label',
        is_nullable: 'YES',
      },
      {
        table_name: 'projects',
        column_name: 'to_label',
        is_nullable: 'YES',
      },
    ]);
  });
});
