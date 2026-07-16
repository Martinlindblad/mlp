import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  acceptanceMarkerJson,
  canonicalContactJson,
  intentEnvelopeJson,
  type ContactAcceptanceMarker,
  type ContactIntentEnvelope,
} from '../../../server/journal/contracts';
import {
  createAcceptanceMarker,
  createIntentEnvelope,
  plaintextMac,
  verifyAcceptanceMarker,
  verifyIntentEnvelope,
} from '../../../server/journal/authentication';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();

  return {
    ...actual,
    timingSafeEqual: vi.fn(actual.timingSafeEqual),
  };
});

const contact = {
  schema: 'mlp.contact.v1' as const,
  id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
  fullName: 'Martin Lindblad',
  email: 'martin@example.com',
  subject: 'Hello',
  message: 'Line one\n"Line two"',
  createdAt: '2026-07-16T12:00:00.123Z',
};

const key = Buffer.alloc(32, 0x11);
const ciphertext = Buffer.from('age-encryption-fixture-v1');
const keyring = new Map([['journal-2026-01', key]]);

function mutateFirstByte(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  bytes[0] = bytes[0] === 0x7a ? 0x79 : 0x7a;
  return bytes.toString('utf8');
}

function mutateJsonField<T extends object>(
  value: T,
  field: keyof T,
  replacement: unknown,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      ...(value as Record<string, unknown>),
      [field as string]: replacement,
    }),
  );
}

describe('journal authentication protocol', () => {
  it('creates deterministic domain-separated intent envelopes and receipts', () => {
    const canonicalBytes = Buffer.from(canonicalContactJson(contact));
    const intent = createIntentEnvelope(
      contact,
      'journal-2026-01',
      key,
      ciphertext,
    );
    const verifiedIntent = verifyIntentEnvelope(
      Buffer.from(intentEnvelopeJson(intent)),
      keyring,
    ).envelope;
    const marker = createAcceptanceMarker(
      verifiedIntent,
      '2026-07-16T12:00:01.456Z',
      key,
    );

    expect(
      verifyAcceptanceMarker(
        Buffer.from(acceptanceMarkerJson(marker)),
        verifiedIntent,
        keyring,
      ),
    ).toEqual(marker);

    expect(plaintextMac(canonicalBytes, key)).toBe(
      'zF_HCPIsHWQmrSTWU8j-T0Pytr7nH2Q2x_Fqr-JAD14',
    );
    expect(intent.ciphertextSha256).toBe(
      '1388b9eb0517dff373af1676d0611d37e99dead6c9051a6fffc04387874aba8a',
    );
    expect(intent.ciphertext).toBe('YWdlLWVuY3J5cHRpb24tZml4dHVyZS12MQ==');
    expect(intent.envelopeMac).toBe(
      'l_L3-aIoOFRbgF3pqPihsDX0ho9PtN107rplNqKN-yQ',
    );
    expect(marker.receiptMac).toBe(
      'riEvRLlxUUj6_uDp55b61Refnsus6unTR4CJK5YpCwc',
    );
  });

  it('rejects every mutated authenticated intent field with one generic failure', () => {
    const intent = createIntentEnvelope(
      contact,
      'journal-2026-01',
      key,
      ciphertext,
    );
    const alternateKeyring = new Map([
      ['journal-2026-01', key],
      ['journal-2026-02', key],
    ]);
    const mutations: Array<[keyof ContactIntentEnvelope, unknown]> = [
      ['schema', 'mlp.contact-intent.v2'],
      ['id', '81eb8a54-d43b-45d5-9ea7-77b5834eeed3'],
      ['createdAt', '2026-07-16T12:00:00.124Z'],
      ['keyId', 'journal-2026-02'],
      ['mac', mutateFirstByte(intent.mac)],
      ['ciphertextSha256', `2${intent.ciphertextSha256.slice(1)}`],
      [
        'ciphertext',
        Buffer.from('age-encryption-fixture-v2').toString('base64'),
      ],
      ['envelopeMac', mutateFirstByte(intent.envelopeMac)],
    ];

    for (const [field, replacement] of mutations) {
      expect(() =>
        verifyIntentEnvelope(
          mutateJsonField(intent, field, replacement),
          alternateKeyring,
        ),
      ).toThrow('journal authentication failed');
    }
  });

  it('rejects every mutated authenticated acceptance field with one generic failure', () => {
    const intent = createIntentEnvelope(
      contact,
      'journal-2026-01',
      key,
      ciphertext,
    );
    const marker = createAcceptanceMarker(
      intent,
      '2026-07-16T12:00:01.456Z',
      key,
    );
    const alternateKeyring = new Map([
      ['journal-2026-01', key],
      ['journal-2026-02', key],
    ]);
    const mutations: Array<[keyof ContactAcceptanceMarker, unknown]> = [
      ['schema', 'mlp.contact-accepted.v2'],
      ['id', '81eb8a54-d43b-45d5-9ea7-77b5834eeed3'],
      ['intentSchema', 'mlp.contact-intent.v2'],
      ['keyId', 'journal-2026-02'],
      ['mac', mutateFirstByte(marker.mac)],
      ['ciphertextSha256', `2${marker.ciphertextSha256.slice(1)}`],
      ['envelopeMac', mutateFirstByte(marker.envelopeMac)],
      ['acceptedAt', '2026-07-16T12:00:01.457Z'],
      ['receiptMac', mutateFirstByte(marker.receiptMac)],
    ];

    for (const [field, replacement] of mutations) {
      expect(() =>
        verifyAcceptanceMarker(
          mutateJsonField(marker, field, replacement),
          intent,
          alternateKeyring,
        ),
      ).toThrow('journal authentication failed');
    }
  });

  it('does not mix plaintext, envelope, and receipt MAC domains', () => {
    const intent = createIntentEnvelope(
      contact,
      'journal-2026-01',
      key,
      ciphertext,
    );
    const marker = createAcceptanceMarker(
      intent,
      '2026-07-16T12:00:01.456Z',
      key,
    );

    expect(intent.envelopeMac).not.toBe(intent.mac);
    expect(marker.receiptMac).not.toBe(intent.envelopeMac);
    expect(() =>
      verifyIntentEnvelope(
        Buffer.from(intentEnvelopeJson({ ...intent, envelopeMac: intent.mac })),
        keyring,
      ),
    ).toThrow('journal authentication failed');
    expect(() =>
      verifyAcceptanceMarker(
        Buffer.from(
          acceptanceMarkerJson({ ...marker, receiptMac: intent.mac }),
        ),
        intent,
        keyring,
      ),
    ).toThrow('journal authentication failed');
  });

  it('fails unknown key IDs generically', () => {
    const intent = createIntentEnvelope(
      contact,
      'journal-2026-01',
      key,
      ciphertext,
    );
    const marker = createAcceptanceMarker(
      intent,
      '2026-07-16T12:00:01.456Z',
      key,
    );

    expect(() =>
      verifyIntentEnvelope(Buffer.from(intentEnvelopeJson(intent)), new Map()),
    ).toThrow('journal authentication failed');
    expect(() =>
      verifyAcceptanceMarker(
        Buffer.from(acceptanceMarkerJson(marker)),
        intent,
        new Map(),
      ),
    ).toThrow('journal authentication failed');
  });

  it('calls timingSafeEqual only for equal-length decoded MACs', () => {
    const timingSafeEqualMock = vi.mocked(crypto.timingSafeEqual);
    const intent = createIntentEnvelope(
      contact,
      'journal-2026-01',
      key,
      ciphertext,
    );

    timingSafeEqualMock.mockClear();
    verifyIntentEnvelope(Buffer.from(intentEnvelopeJson(intent)), keyring);
    expect(timingSafeEqualMock).toHaveBeenCalledTimes(1);

    timingSafeEqualMock.mockClear();
    expect(() =>
      verifyIntentEnvelope(
        Buffer.from(
          JSON.stringify({
            ...intent,
            envelopeMac: Buffer.alloc(31, 0x11).toString('base64url'),
          }),
        ),
        keyring,
      ),
    ).toThrow('journal authentication failed');
    expect(timingSafeEqualMock).not.toHaveBeenCalled();
  });
});
