import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types';

const ensureJournalContactSignature =
  'public.ensure_journal_contact(uuid,text,text,text,text,timestamptz,text,text,text)';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .alterTable('contact_messages')
    .addColumn('journal_schema', 'text')
    .addColumn('journal_key_id', 'text')
    .addColumn('journal_mac', 'text')
    .execute();

  await sql`
    alter table public.contact_messages
      add constraint contact_messages_journal_all_or_none_chk
        check (
          (
            journal_schema is null
            and journal_key_id is null
            and journal_mac is null
          )
          or (
            journal_schema is not null
            and journal_key_id is not null
            and journal_mac is not null
          )
        ),
      add constraint contact_messages_journal_schema_chk
        check (
          journal_schema is null
          or journal_schema = 'mlp.contact.v1'
        ),
      add constraint contact_messages_journal_key_id_chk
        check (
          journal_key_id is null
          or journal_key_id ~ '^[a-z0-9][a-z0-9._-]{0,31}$'
        ),
      add constraint contact_messages_journal_mac_chk
        check (
          journal_mac is null
          or journal_mac ~ '^[A-Za-z0-9_-]{43}$'
        )
  `.execute(db);

  await sql`revoke insert on table public.contact_messages from portfolio_app`.execute(
    db,
  );

  await sql`
    create function public.ensure_journal_contact(
      p_id uuid,
      p_full_name text,
      p_email text,
      p_subject text,
      p_message text,
      p_created_at timestamptz,
      p_journal_schema text,
      p_journal_key_id text,
      p_journal_mac text
    ) returns text
    language plpgsql
    security definer
    set search_path = pg_catalog
    as $$
    declare
      existing public.contact_messages%rowtype;
      inserted_rows integer;
    begin
      if p_id is null
         or p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or p_journal_schema is distinct from 'mlp.contact.v1'
         or p_journal_key_id is null
         or p_journal_key_id !~ '^[a-z0-9][a-z0-9._-]{0,31}$'
         or p_journal_mac is null
         or p_journal_mac !~ '^[A-Za-z0-9_-]{43}$'
         or p_created_at is null
         or date_trunc('milliseconds', p_created_at) is distinct from p_created_at then
        raise exception using errcode = '22023', message = 'journal contact rejected';
      end if;

      insert into public.contact_messages (
        id, full_name, email, subject, message, created_at,
        journal_schema, journal_key_id, journal_mac
      ) values (
        p_id::text, p_full_name, p_email, p_subject, p_message, p_created_at,
        p_journal_schema, p_journal_key_id, p_journal_mac
      ) on conflict (id) do nothing;
      get diagnostics inserted_rows = row_count;

      if inserted_rows = 1 then
        return 'inserted';
      end if;

      select * into existing
      from public.contact_messages
      where id = p_id::text
      for update;

      if not found then
        raise exception using errcode = '40001', message = 'journal contact conflict';
      end if;

      if row(existing.full_name, existing.email, existing.subject,
             existing.message, existing.created_at, existing.journal_schema,
             existing.journal_key_id, existing.journal_mac)
         is not distinct from
         row(p_full_name, p_email, p_subject, p_message, p_created_at,
             p_journal_schema, p_journal_key_id, p_journal_mac) then
        return 'matched';
      end if;

      raise exception using errcode = '23505', message = 'journal contact conflict';
    end
    $$;
  `.execute(db);

  await sql.raw(`alter function ${ensureJournalContactSignature} owner to portfolio_migrator`).execute(
    db,
  );
  await sql.raw(`revoke all on function ${ensureJournalContactSignature} from public`).execute(
    db,
  );
  await sql.raw(`grant execute on function ${ensureJournalContactSignature} to portfolio_app, portfolio_migrator`).execute(
    db,
  );
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`revoke all on function ${ensureJournalContactSignature} from public`).execute(
    db,
  );
  await sql.raw(`revoke execute on function ${ensureJournalContactSignature} from portfolio_app, portfolio_migrator`).execute(
    db,
  );
  await sql`drop function if exists public.ensure_journal_contact(
    uuid, text, text, text, text, timestamptz, text, text, text
  )`.execute(db);

  await sql`grant insert on table public.contact_messages to portfolio_app`.execute(
    db,
  );

  await sql`
    alter table public.contact_messages
      drop constraint if exists contact_messages_journal_all_or_none_chk,
      drop constraint if exists contact_messages_journal_schema_chk,
      drop constraint if exists contact_messages_journal_key_id_chk,
      drop constraint if exists contact_messages_journal_mac_chk
  `.execute(db);

  await db.schema
    .alterTable('contact_messages')
    .dropColumn('journal_schema')
    .dropColumn('journal_key_id')
    .dropColumn('journal_mac')
    .execute();
}
