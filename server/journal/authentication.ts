import * as crypto from 'node:crypto';
import {
  acceptanceAuthenticatedFieldsJson,
  acceptanceMarkerJson,
  canonicalContactJson,
  intentAuthenticatedFieldsJson,
  intentEnvelopeJson,
  parseAcceptanceMarker,
  parseIntentEnvelope,
  type CanonicalContact,
  type ContactAcceptanceMarker,
  type ContactIntentEnvelope,
} from './contracts';

export const PLAINTEXT_DOMAIN = Buffer.from('mlp.contact.plaintext.v1\0');
export const ENVELOPE_DOMAIN = Buffer.from('mlp.contact.intent-envelope.v1\0');
export const RECEIPT_DOMAIN = Buffer.from(
  'mlp.contact.acceptance-receipt.v1\0',
);

const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function authenticationFailed(): never {
  throw new Error('journal authentication failed');
}

function requireMacKey(key: Uint8Array): Buffer {
  const keyBytes = Buffer.from(key);
  if (keyBytes.byteLength !== 32) {
    return authenticationFailed();
  }

  return keyBytes;
}

function hmac(domain: Buffer, payload: Uint8Array, key: Uint8Array): string {
  return crypto
    .createHmac('sha256', requireMacKey(key))
    .update(domain)
    .update(payload)
    .digest('base64url');
}

function decodeMac(value: string): Buffer | null {
  if (!MAC_PATTERN.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength !== 32 || decoded.toString('base64url') !== value) {
    return null;
  }

  return decoded;
}

function assertMac(actual: string, expected: string): void {
  const actualBytes = decodeMac(actual);
  const expectedBytes = decodeMac(expected);

  if (
    !actualBytes ||
    !expectedBytes ||
    actualBytes.byteLength !== expectedBytes.byteLength
  ) {
    return authenticationFailed();
  }

  if (!crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    return authenticationFailed();
  }
}

function intentAuthBytes(
  value: Omit<ContactIntentEnvelope, 'envelopeMac'>,
): Buffer {
  return Buffer.from(intentAuthenticatedFieldsJson(value));
}

function acceptanceAuthBytes(
  value: Omit<ContactAcceptanceMarker, 'receiptMac'>,
): Buffer {
  return Buffer.from(acceptanceAuthenticatedFieldsJson(value));
}

export function plaintextMac(plaintext: Uint8Array, key: Uint8Array): string {
  return hmac(PLAINTEXT_DOMAIN, plaintext, key);
}

export function createIntentEnvelope(
  contact: CanonicalContact,
  keyId: string,
  key: Uint8Array,
  ciphertext: Uint8Array,
): ContactIntentEnvelope {
  const canonicalContactBytes = Buffer.from(canonicalContactJson(contact));
  const ciphertextBytes = Buffer.from(ciphertext);
  const authenticatedFields: Omit<ContactIntentEnvelope, 'envelopeMac'> = {
    schema: 'mlp.contact-intent.v1',
    id: contact.id,
    createdAt: contact.createdAt,
    keyId,
    mac: plaintextMac(canonicalContactBytes, key),
    ciphertextSha256: crypto
      .createHash('sha256')
      .update(ciphertextBytes)
      .digest('hex'),
    ciphertext: ciphertextBytes.toString('base64'),
  };
  const envelope: ContactIntentEnvelope = {
    ...authenticatedFields,
    envelopeMac: hmac(
      ENVELOPE_DOMAIN,
      intentAuthBytes(authenticatedFields),
      key,
    ),
  };

  intentEnvelopeJson(envelope);
  return envelope;
}

export function verifyIntentEnvelope(
  encoded: Uint8Array,
  keyring: ReadonlyMap<string, Buffer>,
): { envelope: ContactIntentEnvelope; canonicalContactMac: string } {
  try {
    const envelope = parseIntentEnvelope(encoded);
    const key = keyring.get(envelope.keyId);
    if (!key) {
      return authenticationFailed();
    }

    assertMac(
      envelope.envelopeMac,
      hmac(
        ENVELOPE_DOMAIN,
        intentAuthBytes({
          schema: envelope.schema,
          id: envelope.id,
          createdAt: envelope.createdAt,
          keyId: envelope.keyId,
          mac: envelope.mac,
          ciphertextSha256: envelope.ciphertextSha256,
          ciphertext: envelope.ciphertext,
        }),
        key,
      ),
    );

    return { envelope, canonicalContactMac: envelope.mac };
  } catch {
    return authenticationFailed();
  }
}

export function createAcceptanceMarker(
  intent: ContactIntentEnvelope,
  acceptedAt: string,
  key: Uint8Array,
): ContactAcceptanceMarker {
  const authenticatedFields: Omit<ContactAcceptanceMarker, 'receiptMac'> = {
    schema: 'mlp.contact-accepted.v1',
    id: intent.id,
    intentSchema: intent.schema,
    keyId: intent.keyId,
    mac: intent.mac,
    ciphertextSha256: intent.ciphertextSha256,
    envelopeMac: intent.envelopeMac,
    acceptedAt,
  };
  const marker: ContactAcceptanceMarker = {
    ...authenticatedFields,
    receiptMac: hmac(
      RECEIPT_DOMAIN,
      acceptanceAuthBytes(authenticatedFields),
      key,
    ),
  };

  acceptanceMarkerJson(marker);
  return marker;
}

export function verifyAcceptanceMarker(
  encoded: Uint8Array,
  intent: ContactIntentEnvelope,
  keyring: ReadonlyMap<string, Buffer>,
): ContactAcceptanceMarker {
  try {
    const marker = parseAcceptanceMarker(encoded);
    const key = keyring.get(marker.keyId);
    if (!key) {
      return authenticationFailed();
    }

    if (
      marker.id !== intent.id ||
      marker.intentSchema !== intent.schema ||
      marker.keyId !== intent.keyId ||
      marker.mac !== intent.mac ||
      marker.ciphertextSha256 !== intent.ciphertextSha256 ||
      marker.envelopeMac !== intent.envelopeMac
    ) {
      return authenticationFailed();
    }

    assertMac(
      marker.receiptMac,
      hmac(
        RECEIPT_DOMAIN,
        acceptanceAuthBytes({
          schema: marker.schema,
          id: marker.id,
          intentSchema: marker.intentSchema,
          keyId: marker.keyId,
          mac: marker.mac,
          ciphertextSha256: marker.ciphertextSha256,
          envelopeMac: marker.envelopeMac,
          acceptedAt: marker.acceptedAt,
        }),
        key,
      ),
    );

    return marker;
  } catch {
    return authenticationFailed();
  }
}
