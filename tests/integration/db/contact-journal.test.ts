import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { migrateToLatest } from '../../../server/db/migrator';
import type { Database } from '../../../server/db/database.types';
import { createIsolatedDatabase } from '../../helpers/postgres';

interface JournalInput {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
  journalSchema: string;
  journalKeyId: string;
  journalMac: string;
}

function input(id: string): JournalInput {
  return {
    id,
    fullName: 'Martin Lindblad',
    email: 'martin@example.com',
    subject: 'Hello',
    message: 'Message',
    createdAt: '2026-07-16T12:00:00.123Z',
    journalSchema: 'mlp.contact.v1',
    journalKeyId: 'journal-2026-01',
    journalMac: 'ERERERERERERERERERERERERERERERERERERERERERE',
  };
}

const firstInput = input('71eb8a54-d43b-45d5-9ea7-77b5834eeed3');
const mismatchInput = input('72eb8a54-d43b-45d5-9ea7-77b5834eeed3');
const invalidInput = input('73eb8a54-d43b-45d5-9ea7-77b5834eeed3');
const accessInput = input('74eb8a54-d43b-45d5-9ea7-77b5834eeed3');

async function ensureJournalContact(
  db: Kysely<Database>,
  value: JournalInput,
): Promise<string> {
  const result = await sql<{ outcome: string }>`
    select public.ensure_journal_contact(
      ${value.id}::uuid,
      ${value.fullName},
      ${value.email},
      ${value.subject},
      ${value.message},
      ${value.createdAt}::timestamptz,
      ${value.journalSchema},
      ${value.journalKeyId},
      ${value.journalMac}
    ) as outcome
  `.execute(db);
  return result.rows[0]?.outcome ?? '';
}

const isolated = createIsolatedDatabase();

describe('journal contact PostgreSQL boundary', () => {
  beforeAll(async () => {
    await isolated.start();
    await migrateToLatest(isolated.db);
  });

  afterAll(async () => isolated.stop(), 20_000);

  it('inserts first contact and matches exact retries without mutation', async () => {
    await expect(ensureJournalContact(isolated.db, firstInput)).resolves.toBe(
      'inserted',
    );
    await expect(ensureJournalContact(isolated.db, firstInput)).resolves.toBe(
      'matched',
    );

    const rows = await isolated.db
      .selectFrom('contact_messages')
      .selectAll()
      .where('id', '=', firstInput.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: firstInput.id,
      full_name: firstInput.fullName,
      email: firstInput.email,
      subject: firstInput.subject,
      message: firstInput.message,
      journal_schema: firstInput.journalSchema,
      journal_key_id: firstInput.journalKeyId,
      journal_mac: firstInput.journalMac,
    });
  });

  it('rejects field mismatches generically and keeps the original row', async () => {
    await ensureJournalContact(isolated.db, mismatchInput);

    for (const patch of [
      { fullName: 'Other Name' },
      { email: 'other@example.com' },
      { subject: 'Other subject' },
      { message: 'Other message' },
      { createdAt: '2026-07-16T12:00:00.124Z' },
      { journalSchema: 'mlp.contact.v2' },
      { journalKeyId: 'journal-2026-02' },
      { journalMac: 'IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI' },
    ]) {
      await expect(
        ensureJournalContact(isolated.db, { ...mismatchInput, ...patch }),
      ).rejects.toThrow('journal contact');
    }

    const count = await isolated.db
      .selectFrom('contact_messages')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('id', '=', mismatchInput.id)
      .executeTakeFirstOrThrow();
    expect(count.count).toBe('1');
  });

  it('rejects invalid protocol values before writes without leaking sentinels', async () => {
    const invalidCases = [
      { id: 'not-a-uuid' },
      { journalSchema: 'mlp.contact.v2' },
      { journalKeyId: 'BadKey' },
      { journalMac: 'not-a-mac' },
    ];
    for (let index = 0; index < invalidCases.length; index += 1) {
      const patch = invalidCases[index];
      const candidate = {
        ...invalidInput,
        id: `75eb8a54-d43b-45d5-9ea7-77b5834eeed${index}`,
        ...patch,
        message: 'sentinel-message-secret',
      };
      await expect(
        ensureJournalContact(isolated.db, candidate),
      ).rejects.not.toThrow('sentinel-message-secret');
      if (candidate.id !== 'not-a-uuid') {
        const row = await isolated.db
          .selectFrom('contact_messages')
          .select('id')
          .where('id', '=', candidate.id)
          .executeTakeFirst();
        expect(row).toBeUndefined();
      }
    }
  });

  it('denies app table access and allows backup reads for legacy and journal rows', async () => {
    await isolated.db
      .insertInto('contact_messages')
      .values({
        id: '64b000000000000000000001',
        full_name: 'Legacy Sender',
        email: 'legacy@example.com',
        subject: 'Legacy',
        message: 'Legacy message',
        created_at: '2024-02-03T04:05:06.789Z',
      })
      .execute();
    await ensureJournalContact(isolated.db, accessInput);

    await isolated.db.connection().execute(async (connection) => {
      await sql`set role portfolio_app`.execute(connection);
      try {
        await expect(
          sql`select * from public.contact_messages`.execute(connection),
        ).rejects.toThrow();
        await expect(
          sql`insert into public.contact_messages (id, full_name, email, subject, message, created_at)
              values ('76eb8a54-d43b-45d5-9ea7-77b5834eeed3', 'A', 'a@example.com', 'S', 'M', now())`.execute(
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
      } finally {
        await sql`reset role`.execute(connection);
      }
    });

    await isolated.db.connection().execute(async (connection) => {
      await sql`set role portfolio_backup`.execute(connection);
      try {
        const result = await sql<{
          id: string;
          journal_schema: string | null;
          journal_key_id: string | null;
          journal_mac: string | null;
        }>`
          select id, journal_schema, journal_key_id, journal_mac
          from public.contact_messages
          where id in ('64b000000000000000000001', ${accessInput.id})
          order by id
        `.execute(connection);
        expect(result.rows).toEqual([
          {
            id: '64b000000000000000000001',
            journal_schema: null,
            journal_key_id: null,
            journal_mac: null,
          },
          {
            id: accessInput.id,
            journal_schema: accessInput.journalSchema,
            journal_key_id: accessInput.journalKeyId,
            journal_mac: accessInput.journalMac,
          },
        ]);
      } finally {
        await sql`reset role`.execute(connection);
      }
    });
  });

  it('resolves concurrent identical calls as inserted and matched', async () => {
    const concurrent = input('81eb8a54-d43b-45d5-9ea7-77b5834eeed3');

    const outcomes = await Promise.all([
      ensureJournalContact(isolated.db, concurrent),
      ensureJournalContact(isolated.db, concurrent),
    ]);
    expect(outcomes.sort()).toEqual(['inserted', 'matched']);
  });

  it('accepts one concurrent conflicting payload and keeps one row only', async () => {
    const base = input('82eb8a54-d43b-45d5-9ea7-77b5834eeed3');
    const conflict = { ...base, message: 'Different message' };

    const results = await Promise.allSettled([
      ensureJournalContact(isolated.db, base),
      ensureJournalContact(isolated.db, conflict),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({
      status: 'fulfilled',
      value: 'inserted',
    });
    expect(String(rejected[0]?.reason)).toContain('journal contact conflict');

    const rows = await isolated.db
      .selectFrom('contact_messages')
      .select(['id', 'message'])
      .where('id', '=', base.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect([base.message, conflict.message]).toContain(rows[0]?.message);
  });
});
