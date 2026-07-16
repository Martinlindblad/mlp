import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AgeProcess } from '../../../server/journal/age-process';
import {
  createAcceptanceMarker,
  createIntentEnvelope,
} from '../../../server/journal/authentication';
import {
  acceptanceMarkerJson,
  canonicalContactJson,
  CONTACT_SCHEMA,
  INTENT_MAX_BYTES,
  intentEnvelopeJson,
  type CanonicalContact,
  type ContactIntentEnvelope,
} from '../../../server/journal/contracts';
import {
  readStableAcceptedSet,
  type AcceptedMarkerEvidence,
  type AcceptedSetWatermark,
  type RecoveredAcceptedContact,
  type RecoveryStaging,
} from '../../../server/journal/recovery';
import type { JournalObjectReader } from '../../../server/journal/r2-store';

const keyId = 'journal-2026-01';
const key = Buffer.alloc(32, 0x33);
const identityFile = '/run/recovery-secrets/age-identities';

const contacts = [
  {
    schema: CONTACT_SCHEMA,
    id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
    fullName: 'Martin Lindblad',
    email: 'martin@example.com',
    subject: 'Hello',
    message: 'First message',
    createdAt: '2026-07-16T12:00:00.123Z',
  },
  {
    schema: CONTACT_SCHEMA,
    id: '27fb12f3-71de-49c4-9fae-d7d82ad5c645',
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    subject: 'Math',
    message: 'Second message',
    createdAt: '2026-07-16T12:00:01.123Z',
  },
] satisfies CanonicalContact[];

function intentKey(id: string): string {
  return `v1/intents/${id}.json`;
}

function acceptedKey(id: string): string {
  return `v1/accepted/${id}.json`;
}

function evidenceLine(evidence: AcceptedMarkerEvidence): string {
  return `${evidence.keyId}\t${evidence.id}\t${evidence.mac}\t${evidence.ciphertextSha256}\t${evidence.envelopeMac}\t${evidence.receiptMac}\n`;
}

function watermarkFor(
  lines: string[],
  schemas: string[],
  keyIds: string[],
): AcceptedSetWatermark {
  const hash = createHash('sha256');
  for (const line of lines.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
    hash.update(line);
  }
  return {
    count: lines.length,
    sha256: hash.digest('hex'),
    schemas: Array.from(new Set(schemas)).sort(),
    keyIds: Array.from(new Set(keyIds)).sort(),
  };
}

function fixture(contact: CanonicalContact): {
  ciphertext: Buffer;
  intent: ContactIntentEnvelope;
  intentBytes: Buffer;
  markerBytes: Buffer;
  plaintext: Buffer;
} {
  const plaintext = Buffer.from(canonicalContactJson(contact));
  const ciphertext = Buffer.from(`age:${contact.id}`);
  const intent = createIntentEnvelope(contact, keyId, key, ciphertext);
  return {
    ciphertext,
    intent,
    intentBytes: Buffer.from(intentEnvelopeJson(intent)),
    markerBytes: Buffer.from(
      acceptanceMarkerJson(
        createAcceptanceMarker(
          intent,
          '2026-07-16T12:05:00.123Z',
          key,
        ),
      ),
    ),
    plaintext,
  };
}

class MemoryStore implements JournalObjectReader {
  readonly objects = new Map<string, Buffer>();
  readonly getCalls: string[] = [];
  acceptedPages: Array<{ keys: string[]; nextToken?: string }> | undefined;
  acceptedPageScript:
    | Array<{ keys: string[]; nextToken?: string }>
    | undefined;

  constructor(fixtures: ReturnType<typeof fixture>[]) {
    for (const item of fixtures) {
      this.objects.set(intentKey(item.intent.id), item.intentBytes);
      this.objects.set(acceptedKey(item.intent.id), item.markerBytes);
    }
  }

  async get(
    keyName: string,
    _maximumBytes: number,
    _signal: AbortSignal,
  ): Promise<Buffer | null> {
    this.getCalls.push(keyName);
    const value = this.objects.get(keyName);
    return value ? Buffer.from(value) : null;
  }

  async listPage(
    prefix: 'v1/accepted/' | 'v1/intents/',
    continuationToken: string | undefined,
    _signal: AbortSignal,
  ): Promise<{ keys: string[]; nextToken?: string }> {
    if (prefix === 'v1/accepted/' && this.acceptedPageScript) {
      return this.acceptedPageScript.shift() ?? { keys: [] };
    }
    if (prefix === 'v1/accepted/' && this.acceptedPages) {
      const index = continuationToken ? Number(continuationToken) : 0;
      return this.acceptedPages[index] ?? { keys: [] };
    }

    const keys = Array.from(this.objects.keys())
      .filter((keyName) => keyName.startsWith(prefix))
      .sort();
    return { keys };
  }
}

class MemoryStaging implements RecoveryStaging {
  readonly first: Array<{
    evidence: AcceptedMarkerEvidence;
    recovered: RecoveredAcceptedContact;
  }> = [];
  readonly second: AcceptedMarkerEvidence[] = [];

  async stageFirst(
    evidence: AcceptedMarkerEvidence,
    recovered: RecoveredAcceptedContact,
  ): Promise<void> {
    this.first.push({ evidence, recovered });
  }

  async stageSecond(evidence: AcceptedMarkerEvidence): Promise<void> {
    this.second.push(evidence);
  }

  async hasAcceptedId(id: string): Promise<boolean> {
    return this.first.some(({ evidence }) => evidence.id === id);
  }

  async watermark(pass: 'first' | 'second'): Promise<AcceptedSetWatermark> {
    const evidences =
      pass === 'first'
        ? this.first.map(({ evidence }) => evidence)
        : this.second;
    const schemas =
      pass === 'first'
        ? this.first.map(({ recovered }) => recovered.contact.schema)
        : [CONTACT_SCHEMA];
    return watermarkFor(
      evidences.map(evidenceLine),
      schemas,
      evidences.map((evidence) => evidence.keyId),
    );
  }
}

function harness() {
  const built = contacts.map(fixture);
  const store = new MemoryStore(built);
  const plaintextByCiphertext = new Map(
    built.map((item) => [item.ciphertext.toString('base64'), item.plaintext]),
  );
  const age: AgeProcess = {
    encrypt: vi.fn(),
    decrypt: vi.fn(async (ciphertext: Uint8Array) => {
      const plaintext = plaintextByCiphertext.get(
        Buffer.from(ciphertext).toString('base64'),
      );
      if (!plaintext) throw new Error('age failed');
      return Buffer.from(plaintext);
    }),
  };
  const staging = new MemoryStaging();
  return { age, built, staging, store };
}

describe('journal accepted-set recovery inventory', () => {
  it('authenticates two complete passes and returns a stable redacted watermark', async () => {
    const { age, built, staging, store } = harness();
    const pending = fixture({
      ...contacts[0],
      id: '3c7e8d23-bc95-46e5-9d69-f21fb221cd0f',
      createdAt: '2026-07-16T12:10:00.123Z',
    });
    store.objects.set(intentKey(pending.intent.id), pending.intentBytes);

    const result = await readStableAcceptedSet({
        store,
        age,
        identityFile,
        macKeys: new Map([[keyId, key]]),
        staging,
        signal: new AbortController().signal,
      });

    expect(result).toEqual({
      watermark: watermarkFor(
        staging.first.map(({ evidence }) => evidenceLine(evidence)),
        [CONTACT_SCHEMA],
        [keyId],
      ),
      pendingIntentCount: 1,
    });

    expect(staging.first).toHaveLength(2);
    expect(staging.second).toHaveLength(2);
    expect(staging.first.map(({ recovered }) => recovered.contact)).toEqual(
      contacts
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(age.decrypt).toHaveBeenCalledTimes(4);
    for (const item of built) {
      expect(store.getCalls.filter((keyName) => keyName === acceptedKey(item.intent.id))).toHaveLength(2);
      expect(store.getCalls.filter((keyName) => keyName === intentKey(item.intent.id))).toHaveLength(2);
    }
  });

  it('fails closed on unstable listings, token loops, missing pairs, and corrupt authenticated bytes', async () => {
    const cases: Array<[string, (store: MemoryStore) => void]> = [
      [
        'unstable accepted inventory',
        (store) => {
          store.acceptedPageScript = [
            { keys: [acceptedKey(contacts[0].id), acceptedKey(contacts[1].id)] },
            { keys: [acceptedKey(contacts[0].id)] },
          ];
        },
      ],
      [
        'LIST token loop',
        (store) => {
          store.acceptedPageScript = [
            { keys: [acceptedKey(contacts[0].id)], nextToken: '1' },
            { keys: [acceptedKey(contacts[1].id)], nextToken: '1' },
          ];
        },
      ],
      [
        'missing intent',
        (store) => {
          store.objects.delete(intentKey(contacts[0].id));
        },
      ],
      [
        'corrupt marker',
        (store) => {
          store.objects.set(acceptedKey(contacts[0].id), Buffer.from('{}'));
        },
      ],
      [
        'corrupt intent',
        (store) => {
          store.objects.set(intentKey(contacts[0].id), Buffer.from('{}'));
        },
      ],
    ];

    for (const [, mutate] of cases) {
      const { age, staging, store } = harness();
      mutate(store);

      await expect(
        readStableAcceptedSet({
          store,
          age,
          identityFile,
          macKeys: new Map([[keyId, key]]),
          staging,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('journal recovery failed');
    }
  });
});
