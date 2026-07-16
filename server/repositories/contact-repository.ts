import type { Pool, PoolClient } from 'pg';

export interface NewContactMessage {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  createdAt: Date;
}

export interface JournalContactInput extends NewContactMessage {
  journalSchema: 'mlp.contact.v1';
  journalKeyId: string;
  journalMac: string;
}

export interface ContactRepository {
  ensureJournalContact(
    message: JournalContactInput,
    signal: AbortSignal,
  ): Promise<'inserted' | 'matched'>;
  insertContact(message: NewContactMessage): Promise<void>;
}

const repositoryErrorMessage = 'contact persistence unavailable';

interface DestroyablePoolClient extends PoolClient {
  connection?: {
    stream?: {
      destroy(): void;
    };
  };
  processID?: number;
}

function repositoryError(): Error {
  return new Error(repositoryErrorMessage);
}

function destroyConnection(client: PoolClient): void {
  (client as DestroyablePoolClient).connection?.stream?.destroy();
}

function cancelBackend(pool: Pool, client: PoolClient): void {
  const processID = (client as DestroyablePoolClient).processID;
  if (!processID) return;
  void pool
    .query('select pg_cancel_backend($1)', [processID])
    .catch(() => undefined);
}

function releaseClient(
  client: PoolClient,
  state: { released: boolean },
  destroy = false,
): void {
  if (state.released) return;
  state.released = true;
  if (destroy) destroyConnection(client);
  client.release(destroy);
}

async function acquireClient(
  pool: Pool,
  signal: AbortSignal,
): Promise<PoolClient> {
  if (signal.aborted) throw repositoryError();

  return await new Promise<PoolClient>((resolve, reject) => {
    let settled = false;
    let abortedWhileQueued = false;

    const rejectOnce = (): void => {
      if (settled) return;
      settled = true;
      reject(repositoryError());
    };
    const onAbort = (): void => {
      abortedWhileQueued = true;
      rejectOnce();
    };

    signal.addEventListener('abort', onAbort, { once: true });

    pool.connect((error, client) => {
      signal.removeEventListener('abort', onAbort);

      if (error || !client) {
        rejectOnce();
        return;
      }

      if (settled || abortedWhileQueued || signal.aborted) {
        client.release(true);
        rejectOnce();
        return;
      }

      settled = true;
      resolve(client);
    });
  });
}

export function createContactRepository(pool: Pool): ContactRepository {
  return {
    async ensureJournalContact(message, signal) {
      const client = await acquireClient(pool, signal);
      const releaseState = { released: false };
      const onAbort = (): void => {
        cancelBackend(pool, client);
        releaseClient(client, releaseState, true);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      try {
        if (signal.aborted) throw repositoryError();
        const result = await client.query<{ outcome: string }>({
          text: `
            select public.ensure_journal_contact(
              $1::uuid,
              $2::text,
              $3::text,
              $4::text,
              $5::text,
              $6::timestamptz,
              $7::text,
              $8::text,
              $9::text
            ) as outcome
          `,
          values: [
            message.id,
            message.fullName,
            message.email,
            message.subject,
            message.message,
            message.createdAt,
            message.journalSchema,
            message.journalKeyId,
            message.journalMac,
          ],
        });
        const outcome = result.rows[0]?.outcome;
        if (outcome === 'inserted' || outcome === 'matched') {
          return outcome;
        }
        throw repositoryError();
      } catch {
        throw repositoryError();
      } finally {
        signal.removeEventListener('abort', onAbort);
        releaseClient(client, releaseState);
      }
    },

    async insertContact() {
      throw repositoryError();
    },
  };
}
