import { describe, expect, it, vi } from 'vitest';
import type { AgeProcess } from '../../../server/journal/age-process';
import {
  createAcceptanceMarker,
  createIntentEnvelope,
  verifyAcceptanceMarker,
  verifyIntentEnvelope,
} from '../../../server/journal/authentication';
import {
  ACCEPTED_MAX_BYTES,
  acceptanceMarkerJson,
  canonicalContactJson,
  INTENT_MAX_BYTES,
  intentEnvelopeJson,
  type CanonicalContact,
  type ContactIntentEnvelope,
} from '../../../server/journal/contracts';
import {
  ContactConflictError,
  ContactUnavailableError,
  createContactJournal,
} from '../../../server/journal/contact-journal';
import type { ConditionalPutResult, JournalObjectStore } from '../../../server/journal/r2-store';
import type {
  ContactRepository,
  JournalContactInput,
} from '../../../server/repositories/contact-repository';

const activeKeyId = 'journal-2026-01';
const oldKeyId = 'journal-2025-12';
const activeKey = Buffer.alloc(32, 0x33);
const oldKey = Buffer.alloc(32, 0x44);
const ageRecipient = 'age1recipient';

const input = {
  id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
  fullName: 'Martin Lindblad',
  email: 'martin@example.com',
  subject: 'Hello',
  message: 'Message',
};

interface PutScript {
  result?: ConditionalPutResult;
  write?: boolean;
  error?: Error;
}

class MemoryStore implements JournalObjectStore {
  readonly objects = new Map<string, Buffer>();
  readonly getCounts = new Map<string, number>();
  putScripts: PutScript[] = [];

  async putIfAbsent(
    key: string,
    body: Uint8Array,
    _maximumBytes: number,
    _signal: AbortSignal,
  ): Promise<ConditionalPutResult> {
    if (this.objects.has(key)) return 'exists';

    const script = this.putScripts.shift();
    if (script?.write !== false) {
      this.objects.set(key, Buffer.from(body));
    }
    if (script?.error) throw script.error;
    return script?.result ?? 'created';
  }

  async get(
    key: string,
    _maximumBytes: number,
    _signal: AbortSignal,
  ): Promise<Buffer | null> {
    this.getCounts.set(key, (this.getCounts.get(key) ?? 0) + 1);
    const stored = this.objects.get(key);
    return stored ? Buffer.from(stored) : null;
  }

  async listPage(): Promise<{ keys: string[]; nextToken?: string }> {
    return { keys: [] };
  }
}

class MemoryContacts implements ContactRepository {
  readonly rows = new Map<string, JournalContactInput>();
  readonly calls: JournalContactInput[] = [];
  failNext: Error | undefined;

  async ensureJournalContact(
    message: JournalContactInput,
    _signal: AbortSignal,
  ): Promise<'inserted' | 'matched'> {
    this.calls.push(message);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }

    const existing = this.rows.get(message.id);
    if (!existing) {
      this.rows.set(message.id, message);
      return 'inserted';
    }
    if (JSON.stringify(existing) !== JSON.stringify(message)) {
      throw new Error('repository disagreement sentinel');
    }
    return 'matched';
  }

  async insertContact(): Promise<void> {
    throw new Error('legacy insert must not be called');
  }
}

function intentKey(id = input.id): string {
  return `v1/intents/${id}.json`;
}

function markerKey(id = input.id): string {
  return `v1/accepted/${id}.json`;
}

function canonical(
  value: typeof input,
  createdAt: string,
): CanonicalContact {
  return {
    schema: 'mlp.contact.v1',
    ...value,
    createdAt,
  };
}

function encodedIntent(
  value: typeof input,
  createdAt: string,
  keyId = activeKeyId,
  key = activeKey,
): Buffer {
  const contact = canonical(value, createdAt);
  return Buffer.from(
    intentEnvelopeJson(
      createIntentEnvelope(
        contact,
        keyId,
        key,
        Buffer.from(`age:${canonicalContactJson(contact)}`),
      ),
    ),
  );
}

function markerFor(
  intent: ContactIntentEnvelope,
  acceptedAt: string,
  key = activeKey,
): Buffer {
  return Buffer.from(
    acceptanceMarkerJson(createAcceptanceMarker(intent, acceptedAt, key)),
  );
}

function makeAge(): AgeProcess {
  return {
    encrypt: vi.fn(async (plaintext: Uint8Array) =>
      Buffer.from(`age:${Buffer.from(plaintext).toString('base64')}`),
    ),
    decrypt: vi.fn(),
  };
}

function harness(options: {
  store?: MemoryStore;
  contacts?: MemoryContacts;
  keyId?: string;
  keyring?: ReadonlyMap<string, Buffer>;
  now?: string[];
} = {}) {
  const store = options.store ?? new MemoryStore();
  const contacts = options.contacts ?? new MemoryContacts();
  const metricLines: string[] = [];
  const nowValues = [
    ...(options.now ?? [
      '2026-07-16T12:00:00.123Z',
      '2026-07-16T12:00:01.456Z',
      '2026-07-16T12:00:02.789Z',
    ]),
  ];
  const journal = createContactJournal({
    store,
    age: makeAge(),
    contacts,
    activeKeyId: options.keyId ?? activeKeyId,
    ageRecipient,
    macKeys:
      options.keyring ??
      new Map([
        [activeKeyId, activeKey],
        [oldKeyId, oldKey],
      ]),
    now: () => new Date(nowValues.shift() ?? '2026-07-16T12:00:09.999Z'),
    emitMetricLine: (line) => metricLines.push(line),
  });

  return { journal, store, contacts, metricLines };
}

describe('contact journal state machine', () => {
  it('moves ABSENT to PREPARED to PROJECTED to ACCEPTED before returning', async () => {
    const { journal, store, contacts, metricLines } = harness();

    await expect(
      journal.accept(input, new AbortController().signal),
    ).resolves.toEqual({ id: input.id });

    const intent = verifyIntentEnvelope(
      store.objects.get(intentKey()) ?? Buffer.alloc(0),
      new Map([[activeKeyId, activeKey]]),
    ).envelope;
    const marker = verifyAcceptanceMarker(
      store.objects.get(markerKey()) ?? Buffer.alloc(0),
      intent,
      new Map([[activeKeyId, activeKey]]),
    );

    expect(contacts.calls).toHaveLength(1);
    expect(contacts.calls[0]).toMatchObject({
      id: input.id,
      fullName: input.fullName,
      email: input.email,
      subject: input.subject,
      message: input.message,
      createdAt: new Date('2026-07-16T12:00:00.123Z'),
      journalSchema: 'mlp.contact.v1',
      journalKeyId: activeKeyId,
      journalMac: intent.mac,
    });
    expect(marker.acceptedAt).toBe('2026-07-16T12:00:01.456Z');
    expect(metricLines).toEqual([
      '{"event":"contact_journal","outcome":"success"}\n',
    ]);
  });

  it('recovers PREPARED and PROJECTED states and reuses stored createdAt', async () => {
    const prepared = harness();
    prepared.contacts.failNext = new Error('postgres host secret');
    await expect(
      prepared.journal.accept(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(ContactUnavailableError);
    expect(prepared.store.objects.has(intentKey())).toBe(true);
    expect(prepared.store.objects.has(markerKey())).toBe(false);

    const retryPrepared = harness({
      store: prepared.store,
      contacts: new MemoryContacts(),
      now: ['2026-07-16T12:10:00.000Z', '2026-07-16T12:10:01.000Z'],
    });
    await expect(
      retryPrepared.journal.accept(input, new AbortController().signal),
    ).resolves.toEqual({ id: input.id });
    expect(retryPrepared.contacts.calls[0]?.createdAt).toEqual(
      new Date('2026-07-16T12:00:00.123Z'),
    );

    const projected = harness();
    projected.store.putScripts = [
      {},
      { result: 'ambiguous', write: false },
    ];
    await expect(
      projected.journal.accept(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(ContactUnavailableError);
    expect(projected.contacts.rows.has(input.id)).toBe(true);
    expect(projected.store.objects.has(markerKey())).toBe(false);

    const retryProjected = harness({
      store: projected.store,
      contacts: projected.contacts,
      now: ['2026-07-16T12:20:00.000Z'],
    });
    await expect(
      retryProjected.journal.accept(input, new AbortController().signal),
    ).resolves.toEqual({ id: input.id });
  });

  it('keeps ACCEPTED idempotent and rejects same-key different payloads only after authenticated intent comparison', async () => {
    const { journal, contacts } = harness();

    await journal.accept(input, new AbortController().signal);
    await expect(
      journal.accept(input, new AbortController().signal),
    ).resolves.toEqual({ id: input.id });
    await expect(
      journal.accept(
        { ...input, message: 'Different message' },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ContactConflictError);
    expect(contacts.calls).toHaveLength(2);
  });

  it('performs exactly one verification GET after ambiguous intent and marker writes', async () => {
    const { journal, store } = harness();
    store.putScripts = [
      { result: 'ambiguous', write: true },
      { result: 'ambiguous', write: true },
    ];

    await expect(
      journal.accept(input, new AbortController().signal),
    ).resolves.toEqual({ id: input.id });

    expect(store.getCounts.get(intentKey())).toBe(1);
    expect(store.getCounts.get(markerKey())).toBe(1);
  });

  it('does not overwrite mismatched envelope or marker bytes and classifies them unavailable', async () => {
    const store = new MemoryStore();
    store.objects.set(intentKey(), Buffer.from('not-json'));
    const invalidIntentBytes = Buffer.from(store.objects.get(intentKey()) ?? []);
    const invalidIntent = harness({ store });

    await expect(
      invalidIntent.journal.accept(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(ContactUnavailableError);
    expect(store.objects.get(intentKey())).toEqual(invalidIntentBytes);

    const valid = harness();
    await valid.journal.accept(input, new AbortController().signal);
    const invalidMarkerBytes = Buffer.from('not-json-marker');
    valid.store.objects.set(markerKey(), invalidMarkerBytes);

    await expect(
      valid.journal.accept(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(ContactUnavailableError);
    expect(valid.store.objects.get(markerKey())).toEqual(invalidMarkerBytes);
  });

  it('converges concurrent identical requests and allows only one concurrent different payload winner', async () => {
    const identical = harness();
    await expect(
      Promise.all([
        identical.journal.accept(input, new AbortController().signal),
        identical.journal.accept(input, new AbortController().signal),
      ]),
    ).resolves.toEqual([{ id: input.id }, { id: input.id }]);
    expect(identical.contacts.rows).toHaveLength(1);

    const different = harness();
    const results = await Promise.allSettled([
      different.journal.accept(input, new AbortController().signal),
      different.journal.accept(
        { ...input, message: 'Different message' },
        new AbortController().signal,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(different.contacts.rows).toHaveLength(1);
  });

  it('uses retained intent key material for marker rotation and fails closed when it is absent', async () => {
    const store = new MemoryStore();
    store.objects.set(
      intentKey(),
      encodedIntent(input, '2026-07-16T12:00:00.123Z', oldKeyId, oldKey),
    );

    const rotated = harness({
      store,
      keyId: activeKeyId,
      keyring: new Map([
        [activeKeyId, activeKey],
        [oldKeyId, oldKey],
      ]),
    });
    await expect(
      rotated.journal.accept(input, new AbortController().signal),
    ).resolves.toEqual({ id: input.id });

    const intent = verifyIntentEnvelope(
      store.objects.get(intentKey()) ?? Buffer.alloc(0),
      new Map([[oldKeyId, oldKey]]),
    ).envelope;
    const marker = verifyAcceptanceMarker(
      store.objects.get(markerKey()) ?? Buffer.alloc(0),
      intent,
      new Map([[oldKeyId, oldKey]]),
    );
    expect(marker.keyId).toBe(oldKeyId);

    const missingOldKeyStore = new MemoryStore();
    missingOldKeyStore.objects.set(
      intentKey(),
      encodedIntent(input, '2026-07-16T12:00:00.123Z', oldKeyId, oldKey),
    );
    const missingOldKey = harness({
      store: missingOldKeyStore,
      keyring: new Map([[activeKeyId, activeKey]]),
    });
    await expect(
      missingOldKey.journal.accept(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(ContactUnavailableError);
    expect(missingOldKeyStore.objects.has(markerKey())).toBe(false);
  });

  it('maps terminal failures to the fixed outcome metric and never leaks sentinels', async () => {
    const intentFailure = harness();
    intentFailure.store.putScripts = [
      { error: new Error('r2 endpoint secret') },
    ];
    await expect(
      intentFailure.journal.accept(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(ContactUnavailableError);
    expect(intentFailure.metricLines).toEqual([
      '{"event":"contact_journal","outcome":"intent_failure"}\n',
    ]);

    const projectionFailure = harness();
    projectionFailure.contacts.failNext = new Error('postgres secret');
    await expect(
      projectionFailure.journal.accept(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(ContactUnavailableError);
    expect(projectionFailure.metricLines).toEqual([
      '{"event":"contact_journal","outcome":"projection_failure"}\n',
    ]);

    const markerFailure = harness();
    markerFailure.store.putScripts = [
      {},
      { result: 'ambiguous', write: false },
    ];
    await expect(
      markerFailure.journal.accept(input, new AbortController().signal),
    ).rejects.toBeInstanceOf(ContactUnavailableError);
    expect(markerFailure.metricLines).toEqual([
      '{"event":"contact_journal","outcome":"marker_failure"}\n',
    ]);

    const conflict = harness();
    await conflict.journal.accept(input, new AbortController().signal);
    await expect(
      conflict.journal.accept(
        { ...input, message: 'sentinel-message-secret' },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ContactConflictError);
    expect(conflict.metricLines.at(-1)).toBe(
      '{"event":"contact_journal","outcome":"conflict"}\n',
    );

    for (const lines of [
      intentFailure.metricLines,
      projectionFailure.metricLines,
      markerFailure.metricLines,
      conflict.metricLines,
    ]) {
      expect(lines.join('')).not.toContain('secret');
      expect(lines.join('')).not.toContain(input.id);
    }
  });
});
