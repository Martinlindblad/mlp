import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  AcceptedMarkerEvidence,
  AcceptedSetWatermark,
  RecoveredAcceptedContact,
  RecoveryStaging,
} from './recovery';

export type {
  AcceptedMarkerEvidence,
  AcceptedSetWatermark,
  RecoveredAcceptedContact,
} from './recovery';

export interface RecoverySession extends RecoveryStaging {
  reconcileAcceptedContacts(): Promise<{
    preExisting: number;
    inserted: number;
    final: number;
    mismatch: 0;
  }>;
  proveExactRowsAfterCommit(): Promise<void>;
}

const FIRST_TABLE = 'journal_recovery_first';
const SECOND_TABLE = 'journal_recovery_second';

function recoveryFailed(): never {
  throw new Error('journal recovery failed');
}

function evidenceLine(evidence: AcceptedMarkerEvidence): string {
  return `${evidence.keyId}\t${evidence.id}\t${evidence.mac}\t${evidence.ciphertextSha256}\t${evidence.envelopeMac}\t${evidence.receiptMac}\n`;
}

function rowCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) recoveryFailed();
  return count;
}

async function createTempTables(client: PoolClient): Promise<void> {
  await client.query(`
    create temporary table ${FIRST_TABLE} (
      id text primary key,
      full_name text not null,
      email text not null,
      subject text not null,
      message text not null,
      created_at timestamptz not null,
      journal_schema text not null,
      journal_key_id text not null,
      journal_mac text not null,
      ciphertext_sha256 text not null,
      envelope_mac text not null,
      receipt_mac text not null,
      line text not null unique
    ) on commit preserve rows
  `);
  await client.query(`
    create temporary table ${SECOND_TABLE} (
      id text primary key,
      journal_schema text not null,
      journal_key_id text not null,
      journal_mac text not null,
      ciphertext_sha256 text not null,
      envelope_mac text not null,
      receipt_mac text not null,
      line text not null unique
    ) on commit preserve rows
  `);
}

async function dropTempTables(client: PoolClient): Promise<void> {
  await client.query(`drop table if exists ${SECOND_TABLE}`);
  await client.query(`drop table if exists ${FIRST_TABLE}`);
}

class PgRecoverySession implements RecoverySession {
  private reconciled = false;

  constructor(private readonly client: PoolClient) {}

  async stageFirst(
    evidence: AcceptedMarkerEvidence,
    recovered: RecoveredAcceptedContact,
  ): Promise<void> {
    if (
      recovered.contact.id !== evidence.id ||
      recovered.keyId !== evidence.keyId ||
      recovered.mac !== evidence.mac
    ) {
      recoveryFailed();
    }
    try {
      await this.client.query(
        `
          insert into ${FIRST_TABLE} (
            id, full_name, email, subject, message, created_at,
            journal_schema, journal_key_id, journal_mac,
            ciphertext_sha256, envelope_mac, receipt_mac, line
          )
          values (
            $1::text, $2::text, $3::text, $4::text, $5::text, $6::timestamptz,
            $7::text, $8::text, $9::text, $10::text, $11::text, $12::text,
            $13::text
          )
        `,
        [
          evidence.id,
          recovered.contact.fullName,
          recovered.contact.email,
          recovered.contact.subject,
          recovered.contact.message,
          recovered.contact.createdAt,
          recovered.contact.schema,
          evidence.keyId,
          evidence.mac,
          evidence.ciphertextSha256,
          evidence.envelopeMac,
          evidence.receiptMac,
          evidenceLine(evidence),
        ],
      );
    } catch {
      recoveryFailed();
    }
  }

  async stageSecond(evidence: AcceptedMarkerEvidence): Promise<void> {
    try {
      const result = await this.client.query(
        `
          insert into ${SECOND_TABLE} (
            id, journal_schema, journal_key_id, journal_mac, ciphertext_sha256,
            envelope_mac, receipt_mac, line
          )
          select
            $1::text, first_pass.journal_schema, $2::text, $3::text, $4::text,
            $5::text, $6::text, $7::text
          from ${FIRST_TABLE} first_pass
          where first_pass.id = $1::text
        `,
        [
          evidence.id,
          evidence.keyId,
          evidence.mac,
          evidence.ciphertextSha256,
          evidence.envelopeMac,
          evidence.receiptMac,
          evidenceLine(evidence),
        ],
      );
      if (result.rowCount !== 1) recoveryFailed();
    } catch {
      recoveryFailed();
    }
  }

  async hasAcceptedId(id: string): Promise<boolean> {
    const result = await this.client.query<{ exists: boolean }>(
      `select exists(select 1 from ${FIRST_TABLE} where id = $1::text)`,
      [id],
    );
    return result.rows[0]?.exists === true;
  }

  async watermark(pass: 'first' | 'second'): Promise<AcceptedSetWatermark> {
    const table = pass === 'first' ? FIRST_TABLE : SECOND_TABLE;
    const result = await this.client.query<{
      line: string;
      journal_key_id: string;
      journal_schema: string;
    }>(
      `
        select line, journal_key_id, journal_schema
        from ${table}
        order by convert_to(line, 'UTF8')
      `,
    );
    const hash = createHash('sha256');
    const schemas = new Set<string>();
    const keyIds = new Set<string>();
    for (const row of result.rows) {
      hash.update(row.line, 'utf8');
      if (row.journal_schema) schemas.add(row.journal_schema);
      keyIds.add(row.journal_key_id);
    }
    return {
      count: result.rows.length,
      sha256: hash.digest('hex'),
      schemas: Array.from(schemas).sort(),
      keyIds: Array.from(keyIds).sort(),
    };
  }

  async reconcileAcceptedContacts(): Promise<{
    preExisting: number;
    inserted: number;
    final: number;
    mismatch: 0;
  }> {
    try {
      await this.client.query('begin isolation level serializable');
      await this.client.query(
        'lock table public.contact_messages in share row exclusive mode',
      );

      const mismatch = await this.client.query(
        `
          select 1
          from ${FIRST_TABLE} staged
          join public.contact_messages existing on existing.id = staged.id
          where not (
            existing.full_name = staged.full_name and
            existing.email = staged.email and
            existing.subject = staged.subject and
            existing.message = staged.message and
            existing.created_at = staged.created_at and
            existing.journal_schema = staged.journal_schema and
            existing.journal_key_id = staged.journal_key_id and
            existing.journal_mac = staged.journal_mac
          )
          limit 1
        `,
      );
      if (mismatch.rowCount !== 0) recoveryFailed();

      const preExisting = await this.client.query<{ count: string }>(`
        select count(*) as count
        from ${FIRST_TABLE} staged
        join public.contact_messages existing on existing.id = staged.id
      `);
      const insert = await this.client.query(
        `
          insert into public.contact_messages (
            id, full_name, email, subject, message, created_at,
            journal_schema, journal_key_id, journal_mac
          )
          select
            staged.id, staged.full_name, staged.email, staged.subject,
            staged.message, staged.created_at, staged.journal_schema,
            staged.journal_key_id, staged.journal_mac
          from ${FIRST_TABLE} staged
          where not exists (
            select 1 from public.contact_messages existing
            where existing.id = staged.id
          )
        `,
      );
      const final = await this.client.query<{ count: string }>(`
        select count(*) as count
        from ${FIRST_TABLE} staged
        join public.contact_messages existing on existing.id = staged.id
        where existing.full_name = staged.full_name
          and existing.email = staged.email
          and existing.subject = staged.subject
          and existing.message = staged.message
          and existing.created_at = staged.created_at
          and existing.journal_schema = staged.journal_schema
          and existing.journal_key_id = staged.journal_key_id
          and existing.journal_mac = staged.journal_mac
      `);
      const staged = await this.client.query<{ count: string }>(
        `select count(*) as count from ${FIRST_TABLE}`,
      );
      const finalCount = rowCount(final.rows[0]?.count);
      if (finalCount !== rowCount(staged.rows[0]?.count)) recoveryFailed();

      await this.client.query('commit');
      this.reconciled = true;
      return {
        preExisting: rowCount(preExisting.rows[0]?.count),
        inserted: insert.rowCount ?? 0,
        final: finalCount,
        mismatch: 0,
      };
    } catch {
      try {
        await this.client.query('rollback');
      } catch {
        // The public error is intentionally fixed.
      }
      recoveryFailed();
    }
  }

  async proveExactRowsAfterCommit(): Promise<void> {
    if (!this.reconciled) recoveryFailed();
    const result = await this.client.query(
      `
        select 1
        from ${FIRST_TABLE} staged
        left join public.contact_messages existing on existing.id = staged.id
        where existing.id is null
           or not (
             existing.full_name = staged.full_name and
             existing.email = staged.email and
             existing.subject = staged.subject and
             existing.message = staged.message and
             existing.created_at = staged.created_at and
             existing.journal_schema = staged.journal_schema and
             existing.journal_key_id = staged.journal_key_id and
             existing.journal_mac = staged.journal_mac
           )
        limit 1
      `,
    );
    if (result.rowCount !== 0) recoveryFailed();
  }
}

export async function withRecoverySession<T>(
  pool: Pool,
  operation: (session: RecoverySession) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await createTempTables(client);
    const session = new PgRecoverySession(client);
    return await operation(session);
  } catch {
    return recoveryFailed();
  } finally {
    try {
      await dropTempTables(client);
    } finally {
      client.release();
    }
  }
}

export async function reconcileAcceptedContacts(
  session: RecoverySession,
): Promise<{
  preExisting: number;
  inserted: number;
  final: number;
  mismatch: 0;
}> {
  return session.reconcileAcceptedContacts();
}
