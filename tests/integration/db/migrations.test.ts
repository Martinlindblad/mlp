import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createIsolatedDatabase } from '../../helpers/postgres';
import { migrateToLatest } from '../../../server/db/migrator';

const contentTables = [
  'current_occupations',
  'hobbies',
  'languages',
  'page_cards',
  'professional_timeline',
  'profile_sections',
  'projects',
  'pursuits',
  'social_links',
] as const;
const expectedTables = ['contact_messages', ...contentTables];
const backupTables = [
  ...contentTables,
  'contact_messages',
  'kysely_migration',
  'kysely_migration_lock',
] as const;
const contentTableSet = new Set<string>(contentTables);

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
    expect(migrations.rows[0]?.name).toBe('003_contact_journal');

    const journalColumns = await sql<{
      column_name: string;
      data_type: string;
      is_nullable: 'YES' | 'NO';
    }>`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
      and table_name = 'contact_messages'
      and column_name in ('journal_schema', 'journal_key_id', 'journal_mac')
      order by column_name
    `.execute(isolated.db);
    expect(journalColumns.rows).toEqual([
      { column_name: 'journal_key_id', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'journal_mac', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'journal_schema', data_type: 'text', is_nullable: 'YES' },
    ]);
  });

  it('enforces complete runtime and backup privilege matrices', async () => {
    await migrateToLatest(isolated.db);

    const privileges = await sql<{
      app_connect: boolean;
      app_temporary: boolean;
      backup_connect: boolean;
      backup_temporary: boolean;
      public_connect: boolean;
      public_temporary: boolean;
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
        ) as public_temporary
    `.execute(isolated.db);

    expect(privileges.rows[0]).toEqual({
      app_connect: true,
      app_temporary: false,
      backup_connect: true,
      backup_temporary: false,
      public_connect: false,
      public_temporary: false,
    });

    const tablePrivileges = await sql<{
      role_name: 'portfolio_app' | 'portfolio_backup';
      table_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>`
      select
        roles.role_name,
        tables.table_name,
        has_table_privilege(
          roles.role_name, 'public.' || tables.table_name, 'select'
        ) as can_select,
        has_table_privilege(
          roles.role_name, 'public.' || tables.table_name, 'insert'
        ) as can_insert,
        has_table_privilege(
          roles.role_name, 'public.' || tables.table_name, 'update'
        ) as can_update,
        has_table_privilege(
          roles.role_name, 'public.' || tables.table_name, 'delete'
        ) as can_delete
      from (
        values ('portfolio_app'), ('portfolio_backup')
      ) as roles(role_name)
      cross join (
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
      ) as tables(table_name)
    `.execute(isolated.db);

    expect(tablePrivileges.rows).toHaveLength(backupTables.length * 2);
    for (const roleName of ['portfolio_app', 'portfolio_backup'] as const) {
      for (const tableName of backupTables) {
        const actual = tablePrivileges.rows.find(
          (row) => row.role_name === roleName && row.table_name === tableName,
        );
        const isApplication = roleName === 'portfolio_app';
        expect(actual).toEqual({
          role_name: roleName,
          table_name: tableName,
          can_select: isApplication
            ? contentTableSet.has(tableName) || tableName === 'kysely_migration'
            : true,
          can_insert: false,
          can_update: false,
          can_delete: false,
        });
      }
    }
  });

  it('hardens the journal contact function and contact table privileges', async () => {
    await migrateToLatest(isolated.db);

    const constraints = await sql<{ conname: string; definition: string }>`
      select conname, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.contact_messages'::regclass
      and conname in (
        'contact_messages_journal_all_or_none_chk',
        'contact_messages_journal_schema_chk',
        'contact_messages_journal_key_id_chk',
        'contact_messages_journal_mac_chk'
      )
      order by conname
    `.execute(isolated.db);
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      'contact_messages_journal_all_or_none_chk',
      'contact_messages_journal_key_id_chk',
      'contact_messages_journal_mac_chk',
      'contact_messages_journal_schema_chk',
    ]);
    expect(constraints.rows.map((row) => row.definition).join('\n')).toContain(
      'mlp.contact.v1',
    );
    expect(constraints.rows.map((row) => row.definition).join('\n')).toContain(
      '^[a-z0-9][a-z0-9._-]{0,31}$',
    );
    expect(constraints.rows.map((row) => row.definition).join('\n')).toContain(
      '^[A-Za-z0-9_-]{43}$',
    );

    const functionAcl = await sql<{
      security_definer: boolean;
      owner: string;
      search_path: string[];
      public_execute: boolean;
      app_execute: boolean;
      owner_execute: boolean;
    }>`
      select
        p.prosecdef as security_definer,
        r.rolname as owner,
        p.proconfig as search_path,
        has_function_privilege('public', p.oid, 'execute') as public_execute,
        has_function_privilege('portfolio_app', p.oid, 'execute') as app_execute,
        has_function_privilege('portfolio_migrator', p.oid, 'execute') as owner_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname = 'public'
      and p.proname = 'ensure_journal_contact'
    `.execute(isolated.db);
    expect(functionAcl.rows[0]).toEqual({
      security_definer: true,
      owner: 'portfolio_migrator',
      search_path: ['search_path=pg_catalog'],
      public_execute: false,
      app_execute: true,
      owner_execute: true,
    });

    await isolated.db.connection().execute(async (connection) => {
      await sql`set role portfolio_app`.execute(connection);
      await expect(
        sql`select * from public.contact_messages`.execute(connection),
      ).rejects.toThrow();
      await expect(
        sql`insert into public.contact_messages (id, full_name, email, subject, message, created_at)
            values ('71eb8a54-d43b-45d5-9ea7-77b5834eeed3', 'Martin', 'martin@example.com', 'Hello', 'Message', now())`.execute(
          connection,
        ),
      ).rejects.toThrow();
      await expect(
        sql`update public.contact_messages set subject = 'Nope'`.execute(
          connection,
        ),
      ).rejects.toThrow();
      await expect(
        sql`delete from public.contact_messages`.execute(connection),
      ).rejects.toThrow();
      await expect(
        sql`select public.ensure_journal_contact(
          '71eb8a54-d43b-45d5-9ea7-77b5834eeed3'::uuid,
          'Martin', 'martin@example.com', 'Hello', 'Message',
          '2026-07-16T12:00:00.123Z'::timestamptz,
          'mlp.contact.v1', 'journal-2026-01',
          'ERERERERERERERERERERERERERERERERERERERERERE'
        ) as outcome`.execute(connection),
      ).resolves.toMatchObject({ rows: [{ outcome: 'inserted' }] });
      await sql`reset role`.execute(connection);
    });

    await isolated.db.connection().execute(async (connection) => {
      await sql`set role portfolio_backup`.execute(connection);
      await expect(
        sql`select id, journal_schema, journal_key_id, journal_mac
            from public.contact_messages`.execute(connection),
      ).resolves.toMatchObject({
        rows: [
          {
            id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
            journal_schema: 'mlp.contact.v1',
            journal_key_id: 'journal-2026-01',
            journal_mac: 'ERERERERERERERERERERERERERERERERERERERERERE',
          },
        ],
      });
      await sql`reset role`.execute(connection);
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
