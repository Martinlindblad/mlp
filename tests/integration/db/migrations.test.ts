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

  it('enforces runtime database and backup privileges', async () => {
    await migrateToLatest(isolated.db);

    const privileges = await sql<{
      app_connect: boolean;
      app_temporary: boolean;
      backup_connect: boolean;
      backup_temporary: boolean;
      public_connect: boolean;
      public_temporary: boolean;
      app_lock_select: boolean;
      backup_all_select: boolean;
    }>`
      select
        has_database_privilege(
          'portfolio_app', current_database(), 'connect'
        ) as app_connect,
        has_database_privilege(
          'portfolio_app', current_database(), 'temporary'
        ) as app_temporary,
        has_database_privilege(
          'portfolio_backup', current_database(), 'connect'
        ) as backup_connect,
        has_database_privilege(
          'portfolio_backup', current_database(), 'temporary'
        ) as backup_temporary,
        has_database_privilege(
          0::oid, current_database(), 'connect'
        ) as public_connect,
        has_database_privilege(
          0::oid, current_database(), 'temporary'
        ) as public_temporary,
        has_table_privilege(
          'portfolio_app', 'public.kysely_migration_lock', 'select'
        ) as app_lock_select,
        (
          select bool_and(
            has_table_privilege(
              'portfolio_backup', 'public.' || table_name, 'select'
            )
          )
          from (
            values
              ('profile_sections'),
              ('current_occupations'),
              ('hobbies'),
              ('languages'),
              ('page_cards'),
              ('professional_timeline'),
              ('projects'),
              ('pursuits'),
              ('social_links'),
              ('contact_messages'),
              ('kysely_migration'),
              ('kysely_migration_lock')
          ) as backup_tables(table_name)
        ) as backup_all_select
    `.execute(isolated.db);

    expect(privileges.rows[0]).toEqual({
      app_connect: true,
      app_temporary: false,
      backup_connect: true,
      backup_temporary: false,
      public_connect: false,
      public_temporary: false,
      app_lock_select: false,
      backup_all_select: true,
    });
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
