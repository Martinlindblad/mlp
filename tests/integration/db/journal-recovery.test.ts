import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { migrateToLatest } from '../../../server/db/migrator';
import {
  withRecoverySession,
  type AcceptedMarkerEvidence,
  type RecoveredAcceptedContact,
  type RecoverySession,
} from '../../../server/journal/recovery-staging';
import { createIsolatedDatabase } from '../../helpers/postgres';

const isolated = createIsolatedDatabase();

const baseContact = {
  schema: 'mlp.contact.v1' as const,
  id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
  fullName: 'Martin Lindblad',
  email: 'martin@example.com',
  subject: 'Hello',
  message: 'Recovered message',
  createdAt: '2026-07-16T12:00:00.123Z',
};

const baseEvidence = {
  id: baseContact.id,
  keyId: 'journal-2026-01',
  mac: 'ERERERERERERERERERERERERERERERERERERERERERE',
  ciphertextSha256:
    '1388b9eb0517dff373af1676d0611d37e99dead6c9051a6fffc04387874aba8a',
  envelopeMac: 'IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI',
  receiptMac: 'MzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM',
} satisfies AcceptedMarkerEvidence;

function recovered(
  patch: Partial<typeof baseContact> = {},
  evidence: AcceptedMarkerEvidence = baseEvidence,
): RecoveredAcceptedContact {
  return {
    contact: { ...baseContact, ...patch },
    keyId: evidence.keyId,
    mac: evidence.mac,
  };
}

async function stage(
  session: RecoverySession,
  evidence: AcceptedMarkerEvidence,
  contact: RecoveredAcceptedContact,
): Promise<void> {
  await session.stageFirst(evidence, contact);
  await session.stageSecond(evidence);
}

async function row(id: string) {
  return await isolated.db
    .selectFrom('contact_messages')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

describe('journal recovery PostgreSQL reconciliation', () => {
  beforeAll(async () => {
    await isolated.start();
    await migrateToLatest(isolated.db);
  });

  afterAll(async () => isolated.stop(), 20_000);

  it('uses identical accepted-set watermarks for both authenticated passes', async () => {
    await withRecoverySession(isolated.pool, async (session) => {
      await session.stageFirst(baseEvidence, recovered());
      await session.stageSecond(baseEvidence);

      const first = await session.watermark('first');
      const second = await session.watermark('second');

      expect(second).toEqual(first);
    });
  });

  it('inserts missing accepted contacts and reruns as an exact no-op', async () => {
    const first = await withRecoverySession(isolated.pool, async (session) => {
      await stage(session, baseEvidence, recovered());
      const result = await session.reconcileAcceptedContacts();
      await session.proveExactRowsAfterCommit();
      return result;
    });

    expect(first).toEqual({
      preExisting: 0,
      inserted: 1,
      final: 1,
      mismatch: 0,
    });
    await expect(row(baseContact.id)).resolves.toMatchObject({
      id: baseContact.id,
      full_name: baseContact.fullName,
      email: baseContact.email,
      subject: baseContact.subject,
      message: baseContact.message,
      journal_schema: baseContact.schema,
      journal_key_id: baseEvidence.keyId,
      journal_mac: baseEvidence.mac,
    });

    const second = await withRecoverySession(isolated.pool, async (session) => {
      await stage(session, baseEvidence, recovered());
      const result = await session.reconcileAcceptedContacts();
      await session.proveExactRowsAfterCommit();
      return result;
    });
    expect(second).toEqual({
      preExisting: 1,
      inserted: 0,
      final: 1,
      mismatch: 0,
    });
  });

  it('rolls back every insertion when one accepted row differs', async () => {
    const mismatchId = '27fb12f3-71de-49c4-9fae-d7d82ad5c645';
    const missingId = '3c7e8d23-bc95-46e5-9d69-f21fb221cd0f';
    await isolated.db
      .insertInto('contact_messages')
      .values({
        id: mismatchId,
        full_name: 'Existing Sender',
        email: 'existing@example.com',
        subject: 'Existing',
        message: 'Existing message',
        created_at: '2026-07-16T12:01:00.123Z',
        journal_schema: 'mlp.contact.v1',
        journal_key_id: baseEvidence.keyId,
        journal_mac: baseEvidence.mac,
      })
      .execute();

    const mismatchEvidence = { ...baseEvidence, id: mismatchId };
    const missingEvidence = {
      ...baseEvidence,
      id: missingId,
      mac: 'RERERERERERERERERERERERERERERERERERERERERERE',
    };

    await expect(
      withRecoverySession(isolated.pool, async (session) => {
        await stage(
          session,
          mismatchEvidence,
          recovered({ id: mismatchId, message: 'Recovered mismatch' }, mismatchEvidence),
        );
        await stage(
          session,
          missingEvidence,
          recovered({ id: missingId }, missingEvidence),
        );
        await session.reconcileAcceptedContacts();
      }),
    ).rejects.toThrow('journal recovery failed');

    await expect(row(missingId)).resolves.toBeUndefined();
    await expect(row(mismatchId)).resolves.toMatchObject({
      message: 'Existing message',
    });
  });

  it('requires a separate post-commit exact subset proof before reporting success', async () => {
    const id = '52c1387c-5ff2-42fc-a4f7-c2a12f58c7bd';
    const evidence = { ...baseEvidence, id };

    await expect(
      withRecoverySession(isolated.pool, async (session) => {
        await stage(session, evidence, recovered({ id }, evidence));
        await session.reconcileAcceptedContacts();
        await sql`
          update public.contact_messages
          set message = 'tampered after commit'
          where id = ${id}
        `.execute(isolated.db);
        await session.proveExactRowsAfterCommit();
      }),
    ).rejects.toThrow('journal recovery failed');
  });
});
