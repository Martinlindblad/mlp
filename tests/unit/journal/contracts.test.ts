import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_MAX_BYTES,
  INTENT_MAX_BYTES,
  acceptanceMarkerJson,
  canonicalContactJson,
  intentEnvelopeJson,
  parseAcceptanceMarker,
  parseCanonicalContact,
  parseIntentEnvelope,
  parseMacKeyring,
  type CanonicalContact,
  type ContactAcceptanceMarker,
  type ContactIntentEnvelope,
} from '../../../server/journal/contracts';

const contact = {
  schema: 'mlp.contact.v1' as const,
  id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
  fullName: 'Martin Lindblad',
  email: 'martin@example.com',
  subject: 'Hello',
  message: 'Line one\n"Line two"',
  createdAt: '2026-07-16T12:00:00.123Z',
};

const canonicalContactText =
  '{"schema":"mlp.contact.v1","id":"71eb8a54-d43b-45d5-9ea7-77b5834eeed3","fullName":"Martin Lindblad","email":"martin@example.com","subject":"Hello","message":"Line one\\n\\"Line two\\"","createdAt":"2026-07-16T12:00:00.123Z"}';

const mac = Buffer.alloc(32, 0x11).toString('base64url');
const otherMac = Buffer.alloc(32, 0x22).toString('base64url');
const ciphertext = Buffer.from('age-encryption-fixture-v1').toString('base64');
const ciphertextSha256 =
  '1388b9eb0517dff373af1676d0611d37e99dead6c9051a6fffc04387874aba8a';
const keyMaterial = Buffer.alloc(32, 0x33).toString('base64');

const intent = {
  schema: 'mlp.contact-intent.v1' as const,
  id: contact.id,
  createdAt: contact.createdAt,
  keyId: 'journal-2026-01',
  mac,
  ciphertextSha256,
  ciphertext,
  envelopeMac: otherMac,
};

const marker = {
  schema: 'mlp.contact-accepted.v1' as const,
  id: contact.id,
  intentSchema: 'mlp.contact-intent.v1' as const,
  keyId: 'journal-2026-01',
  mac,
  ciphertextSha256,
  envelopeMac: otherMac,
  acceptedAt: '2026-07-16T12:00:01.456Z',
  receiptMac: Buffer.alloc(32, 0x44).toString('base64url'),
};

function encoded(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

function canonicalIntentText(value: ContactIntentEnvelope): string {
  return JSON.stringify({
    schema: value.schema,
    id: value.id,
    createdAt: value.createdAt,
    keyId: value.keyId,
    mac: value.mac,
    ciphertextSha256: value.ciphertextSha256,
    ciphertext: value.ciphertext,
    envelopeMac: value.envelopeMac,
  });
}

function canonicalMarkerText(value: ContactAcceptanceMarker): string {
  return JSON.stringify({
    schema: value.schema,
    id: value.id,
    intentSchema: value.intentSchema,
    keyId: value.keyId,
    mac: value.mac,
    ciphertextSha256: value.ciphertextSha256,
    envelopeMac: value.envelopeMac,
    acceptedAt: value.acceptedAt,
    receiptMac: value.receiptMac,
  });
}

function base64Ciphertext(byteLength: number): string {
  return Buffer.alloc(byteLength, 0x61).toString('base64');
}

describe('canonical contact contracts', () => {
  it('serializes and parses canonical contact bytes in fixed field order', () => {
    expect(canonicalContactJson(contact)).toBe(canonicalContactText);
    expect(
      parseCanonicalContact(Buffer.from(canonicalContactJson(contact))),
    ).toEqual(contact);
  });

  it('rejects reordered, missing, and unknown contact fields', () => {
    const reordered =
      '{"id":"71eb8a54-d43b-45d5-9ea7-77b5834eeed3","schema":"mlp.contact.v1","fullName":"Martin Lindblad","email":"martin@example.com","subject":"Hello","message":"Line one\\n\\"Line two\\"","createdAt":"2026-07-16T12:00:00.123Z"}';
    const missing = { ...contact, message: undefined };
    const unknown = { ...contact, extra: 'field' };

    expect(() => parseCanonicalContact(encoded(reordered))).toThrow(
      'invalid canonical contact',
    );
    expect(() =>
      parseCanonicalContact(encoded(JSON.stringify(missing))),
    ).toThrow('invalid canonical contact');
    expect(() =>
      parseCanonicalContact(encoded(JSON.stringify(unknown))),
    ).toThrow('invalid canonical contact');
  });

  it.each([
    ['uppercase', '71EB8A54-D43B-45D5-9EA7-77B5834EEED3'],
    ['non-v4', '71eb8a54-d43b-15d5-9ea7-77b5834eeed3'],
    ['non-canonical', '71eb8a54d43b45d59ea777b5834eeed3'],
  ])('rejects %s UUIDs', (_label, id) => {
    expect(() => canonicalContactJson({ ...contact, id })).toThrow(
      'invalid canonical contact',
    );
  });

  it.each([
    ['invalid calendar date', '2026-02-30T12:00:00.123Z'],
    ['too few fractional digits', '2026-07-16T12:00:00.12Z'],
    ['too many fractional digits', '2026-07-16T12:00:00.1234Z'],
    ['no fractional digits', '2026-07-16T12:00:00Z'],
  ])('rejects %s timestamps', (_label, createdAt) => {
    expect(() => canonicalContactJson({ ...contact, createdAt })).toThrow(
      'invalid canonical contact',
    );
  });

  it('rejects wrong schema and untrimmed strings', () => {
    expect(() =>
      canonicalContactJson({
        ...contact,
        schema: 'mlp.contact.v2' as CanonicalContact['schema'],
      }),
    ).toThrow('invalid canonical contact');
    expect(() =>
      canonicalContactJson({ ...contact, fullName: ' Martin Lindblad' }),
    ).toThrow('invalid canonical contact');
  });

  it('preserves case and leaves composed and decomposed Unicode byte-distinct', () => {
    const casePreserving = {
      ...contact,
      fullName: 'MaRtIn Élodie',
      email: 'Martin.Lindblad@Example.COM',
    };
    const composed = { ...contact, fullName: 'Élodie' };
    const decomposed = { ...composed, fullName: 'E\u0301lodie' };

    expect(
      parseCanonicalContact(encoded(canonicalContactJson(casePreserving))),
    ).toEqual(casePreserving);
    expect(canonicalContactJson(composed)).not.toBe(
      canonicalContactJson(decomposed),
    );
    expect(Buffer.from(canonicalContactJson(composed))).not.toEqual(
      Buffer.from(canonicalContactJson(decomposed)),
    );
  });
});

describe('authenticated protocol document contracts', () => {
  it('serializes canonical intent envelopes and acceptance markers', () => {
    expect(intentEnvelopeJson(intent)).toBe(canonicalIntentText(intent));
    expect(parseIntentEnvelope(encoded(intentEnvelopeJson(intent)))).toEqual(
      intent,
    );
    expect(acceptanceMarkerJson(marker)).toBe(canonicalMarkerText(marker));
    expect(
      parseAcceptanceMarker(encoded(acceptanceMarkerJson(marker))),
    ).toEqual(marker);
  });

  it('rejects invalid key IDs including values over 32 characters', () => {
    for (const keyId of [
      'Journal-2026-01',
      '-journal',
      'journal/2026',
      'a'.repeat(33),
    ]) {
      expect(() => intentEnvelopeJson({ ...intent, keyId })).toThrow(
        'invalid contact intent envelope',
      );
      expect(() => acceptanceMarkerJson({ ...marker, keyId })).toThrow(
        'invalid contact acceptance marker',
      );
    }
  });

  it('rejects padded and non-base64url MACs', () => {
    expect(() => intentEnvelopeJson({ ...intent, mac: `${mac}=` })).toThrow(
      'invalid contact intent envelope',
    );
    expect(() =>
      intentEnvelopeJson({ ...intent, envelopeMac: `${mac.slice(0, 41)}+/` }),
    ).toThrow('invalid contact intent envelope');
    expect(() =>
      acceptanceMarkerJson({ ...marker, receiptMac: `${mac}=` }),
    ).toThrow('invalid contact acceptance marker');
  });

  it('rejects non-canonical standard-base64 ciphertext', () => {
    expect(() =>
      intentEnvelopeJson({
        ...intent,
        ciphertext: ciphertext.replace(/=+$/, ''),
      }),
    ).toThrow('invalid contact intent envelope');
  });

  it('rejects non-canonical intent and marker JSON inputs', () => {
    expect(() =>
      parseIntentEnvelope(
        encoded(
          '{"id":"71eb8a54-d43b-45d5-9ea7-77b5834eeed3","schema":"mlp.contact-intent.v1","createdAt":"2026-07-16T12:00:00.123Z","keyId":"journal-2026-01","mac":"ERERERERERERERERERERERERERERERERERERERERERE","ciphertextSha256":"1388b9eb0517dff373af1676d0611d37e99dead6c9051a6fffc04387874aba8a","ciphertext":"YWdlLWVuY3J5cHRpb24tZml4dHVyZS12MQ==","envelopeMac":"IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI"}',
        ),
      ),
    ).toThrow('invalid contact intent envelope');
    expect(() =>
      parseAcceptanceMarker(
        encoded(JSON.stringify({ ...marker, extra: true })),
      ),
    ).toThrow('invalid contact acceptance marker');
  });

  it('checks raw byte caps before UTF-8 decode and lets boundary-sized inputs reach validation', () => {
    expect(() =>
      parseIntentEnvelope(Buffer.alloc(INTENT_MAX_BYTES, 0x20)),
    ).toThrow('invalid contact intent envelope');
    expect(() =>
      parseIntentEnvelope(Buffer.alloc(INTENT_MAX_BYTES + 1, 0xff)),
    ).toThrow('journal document exceeds maximum size');
    expect(() =>
      parseAcceptanceMarker(Buffer.alloc(ACCEPTED_MAX_BYTES, 0x20)),
    ).toThrow('invalid contact acceptance marker');
    expect(() =>
      parseAcceptanceMarker(Buffer.alloc(ACCEPTED_MAX_BYTES + 1, 0xff)),
    ).toThrow('journal document exceeds maximum size');
  });

  it('rejects the first valid outbound intent envelope above the byte cap', () => {
    let lowerBound = 1;
    let upperBound = INTENT_MAX_BYTES;

    while (lowerBound < upperBound) {
      const candidateBytes = Math.floor((lowerBound + upperBound) / 2);
      const candidate = {
        ...intent,
        ciphertext: base64Ciphertext(candidateBytes),
      };
      const size = Buffer.byteLength(canonicalIntentText(candidate), 'utf8');

      if (size <= INTENT_MAX_BYTES) {
        lowerBound = candidateBytes + 1;
      } else {
        upperBound = candidateBytes;
      }
    }

    const firstOverCap = {
      ...intent,
      ciphertext: base64Ciphertext(lowerBound),
    };
    const lastUnderCap = {
      ...intent,
      ciphertext: base64Ciphertext(lowerBound - 1),
    };

    expect(
      Buffer.byteLength(canonicalIntentText(lastUnderCap), 'utf8'),
    ).toBeLessThanOrEqual(INTENT_MAX_BYTES);
    expect(intentEnvelopeJson(lastUnderCap)).toBe(
      canonicalIntentText(lastUnderCap),
    );
    expect(
      Buffer.byteLength(canonicalIntentText(firstOverCap), 'utf8'),
    ).toBeGreaterThan(INTENT_MAX_BYTES);
    expect(() => intentEnvelopeJson(firstOverCap)).toThrow(
      'journal document exceeds maximum size',
    );
  });

  it('serializes canonical markers within the fixed marker byte cap', () => {
    const text = acceptanceMarkerJson(marker);

    expect(text).toBe(canonicalMarkerText(marker));
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      ACCEPTED_MAX_BYTES,
    );
  });
});

describe('MAC keyring parsing', () => {
  it('parses a compact single-line keyring object with padded 32-byte base64 keys', () => {
    const keyring = parseMacKeyring(
      encoded(JSON.stringify({ 'journal-2026-01': keyMaterial })),
    );

    expect(Array.from(keyring.keys())).toEqual(['journal-2026-01']);
    expect(keyring.get('journal-2026-01')).toEqual(Buffer.alloc(32, 0x33));
  });

  it('rejects duplicate, unknown, and empty keyring fields', () => {
    expect(() =>
      parseMacKeyring(
        encoded(
          `{"journal-2026-01":"${keyMaterial}","journal-2026-01":"${keyMaterial}"}`,
        ),
      ),
    ).toThrow('invalid MAC keyring');
    expect(() =>
      parseMacKeyring(encoded(JSON.stringify({ InvalidKey: keyMaterial }))),
    ).toThrow('invalid MAC keyring');
    expect(() =>
      parseMacKeyring(encoded(JSON.stringify({ '': keyMaterial }))),
    ).toThrow('invalid MAC keyring');
  });

  it('rejects empty keyrings and key material that is not exactly 32 bytes', () => {
    expect(() => parseMacKeyring(encoded('{}'))).toThrow('invalid MAC keyring');
    expect(() =>
      parseMacKeyring(
        encoded(
          JSON.stringify({
            'journal-2026-01': Buffer.alloc(31).toString('base64'),
          }),
        ),
      ),
    ).toThrow('invalid MAC keyring');
  });
});
