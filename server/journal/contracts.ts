import { z } from 'zod';

export const CONTACT_SCHEMA = 'mlp.contact.v1' as const;
export const INTENT_SCHEMA = 'mlp.contact-intent.v1' as const;
export const ACCEPTED_SCHEMA = 'mlp.contact-accepted.v1' as const;
export const INTENT_MAX_BYTES = 65_536;
export const ACCEPTED_MAX_BYTES = 4_096;

export interface CanonicalContact {
  schema: typeof CONTACT_SCHEMA;
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
}

export interface ContactIntentEnvelope {
  schema: typeof INTENT_SCHEMA;
  id: string;
  createdAt: string;
  keyId: string;
  mac: string;
  ciphertextSha256: string;
  ciphertext: string;
  envelopeMac: string;
}

export interface ContactAcceptanceMarker {
  schema: typeof ACCEPTED_SCHEMA;
  id: string;
  intentSchema: typeof INTENT_SCHEMA;
  keyId: string;
  mac: string;
  ciphertextSha256: string;
  envelopeMac: string;
  acceptedAt: string;
  receiptMac: string;
}

export type JournalMacKeyring = ReadonlyMap<string, Buffer>;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fail(message: string): never {
  throw new Error(message);
}

function isCanonicalTimestamp(value: string): boolean {
  if (!TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isTrimmed(value: string): boolean {
  return value === value.trim();
}

function isCanonicalStandardBase64(value: string): boolean {
  if (value.length === 0 || /[^A-Za-z0-9+/=]/.test(value)) {
    return false;
  }

  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0 && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function decodeCanonicalBase64(value: string): Buffer | null {
  if (!isCanonicalStandardBase64(value)) {
    return null;
  }

  return Buffer.from(value, 'base64');
}

const timestampSchema = z.string().refine(isCanonicalTimestamp);
const trimmedStringSchema = z.string().refine(isTrimmed);
const uuidSchema = z.string().regex(UUID_V4_PATTERN);
const keyIdSchema = z.string().regex(KEY_ID_PATTERN);
const macSchema = z
  .string()
  .regex(MAC_PATTERN)
  .refine((value) => Buffer.from(value, 'base64url').length === 32)
  .refine(
    (value) => Buffer.from(value, 'base64url').toString('base64url') === value,
  );
const ciphertextSchema = z.string().refine(isCanonicalStandardBase64);
const sha256HexSchema = z.string().regex(SHA256_HEX_PATTERN);

const canonicalContactSchema = z
  .object({
    schema: z.literal(CONTACT_SCHEMA),
    id: uuidSchema,
    fullName: trimmedStringSchema,
    email: trimmedStringSchema,
    subject: trimmedStringSchema,
    message: trimmedStringSchema,
    createdAt: timestampSchema,
  })
  .strict();

const intentAuthenticatedFieldsSchema = z
  .object({
    schema: z.literal(INTENT_SCHEMA),
    id: uuidSchema,
    createdAt: timestampSchema,
    keyId: keyIdSchema,
    mac: macSchema,
    ciphertextSha256: sha256HexSchema,
    ciphertext: ciphertextSchema,
  })
  .strict();

const intentEnvelopeSchema = intentAuthenticatedFieldsSchema
  .extend({
    envelopeMac: macSchema,
  })
  .strict();

const acceptanceAuthenticatedFieldsSchema = z
  .object({
    schema: z.literal(ACCEPTED_SCHEMA),
    id: uuidSchema,
    intentSchema: z.literal(INTENT_SCHEMA),
    keyId: keyIdSchema,
    mac: macSchema,
    ciphertextSha256: sha256HexSchema,
    envelopeMac: macSchema,
    acceptedAt: timestampSchema,
  })
  .strict();

const acceptanceMarkerSchema = acceptanceAuthenticatedFieldsSchema
  .extend({
    receiptMac: macSchema,
  })
  .strict();

function parseJson(text: string, message: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail(message);
  }
}

function parseUtf8(
  encoded: Uint8Array,
  maxBytes: number | null,
  message: string,
): string {
  if (maxBytes !== null && encoded.byteLength > maxBytes) {
    return fail('journal document exceeds maximum size');
  }

  return Buffer.from(encoded).toString('utf8');
}

function requireCanonical<T>(
  result: { success: true; data: T } | { success: false },
  message: string,
): T {
  if (!result.success) {
    return fail(message);
  }

  return result.data;
}

function validateContact(value: unknown): CanonicalContact {
  return requireCanonical(
    canonicalContactSchema.safeParse(value),
    'invalid canonical contact',
  ) as CanonicalContact;
}

function validateIntentAuthenticatedFields(
  value: unknown,
): Omit<ContactIntentEnvelope, 'envelopeMac'> {
  return requireCanonical(
    intentAuthenticatedFieldsSchema.safeParse(value),
    'invalid contact intent envelope',
  ) as Omit<ContactIntentEnvelope, 'envelopeMac'>;
}

function validateIntentEnvelope(value: unknown): ContactIntentEnvelope {
  return requireCanonical(
    intentEnvelopeSchema.safeParse(value),
    'invalid contact intent envelope',
  ) as ContactIntentEnvelope;
}

function validateAcceptanceAuthenticatedFields(
  value: unknown,
): Omit<ContactAcceptanceMarker, 'receiptMac'> {
  return requireCanonical(
    acceptanceAuthenticatedFieldsSchema.safeParse(value),
    'invalid contact acceptance marker',
  ) as Omit<ContactAcceptanceMarker, 'receiptMac'>;
}

function validateAcceptanceMarker(value: unknown): ContactAcceptanceMarker {
  return requireCanonical(
    acceptanceMarkerSchema.safeParse(value),
    'invalid contact acceptance marker',
  ) as ContactAcceptanceMarker;
}

function canonicalContactObject(value: CanonicalContact): CanonicalContact {
  return {
    schema: value.schema,
    id: value.id,
    fullName: value.fullName,
    email: value.email,
    subject: value.subject,
    message: value.message,
    createdAt: value.createdAt,
  };
}

function intentAuthenticatedFieldsObject(
  value: Omit<ContactIntentEnvelope, 'envelopeMac'>,
): Omit<ContactIntentEnvelope, 'envelopeMac'> {
  return {
    schema: value.schema,
    id: value.id,
    createdAt: value.createdAt,
    keyId: value.keyId,
    mac: value.mac,
    ciphertextSha256: value.ciphertextSha256,
    ciphertext: value.ciphertext,
  };
}

function intentEnvelopeObject(
  value: ContactIntentEnvelope,
): ContactIntentEnvelope {
  return {
    ...intentAuthenticatedFieldsObject(value),
    envelopeMac: value.envelopeMac,
  };
}

function acceptanceAuthenticatedFieldsObject(
  value: Omit<ContactAcceptanceMarker, 'receiptMac'>,
): Omit<ContactAcceptanceMarker, 'receiptMac'> {
  return {
    schema: value.schema,
    id: value.id,
    intentSchema: value.intentSchema,
    keyId: value.keyId,
    mac: value.mac,
    ciphertextSha256: value.ciphertextSha256,
    envelopeMac: value.envelopeMac,
    acceptedAt: value.acceptedAt,
  };
}

function acceptanceMarkerObject(
  value: ContactAcceptanceMarker,
): ContactAcceptanceMarker {
  return {
    ...acceptanceAuthenticatedFieldsObject(value),
    receiptMac: value.receiptMac,
  };
}

function enforceSerializedSize(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return fail('journal document exceeds maximum size');
  }

  return text;
}

export function canonicalContactJson(value: CanonicalContact): string {
  return JSON.stringify(canonicalContactObject(validateContact(value)));
}

export function intentAuthenticatedFieldsJson(
  value: Omit<ContactIntentEnvelope, 'envelopeMac'>,
): string {
  return JSON.stringify(
    intentAuthenticatedFieldsObject(validateIntentAuthenticatedFields(value)),
  );
}

export function intentEnvelopeJson(value: ContactIntentEnvelope): string {
  return enforceSerializedSize(
    JSON.stringify(intentEnvelopeObject(validateIntentEnvelope(value))),
    INTENT_MAX_BYTES,
  );
}

export function acceptanceAuthenticatedFieldsJson(
  value: Omit<ContactAcceptanceMarker, 'receiptMac'>,
): string {
  return JSON.stringify(
    acceptanceAuthenticatedFieldsObject(
      validateAcceptanceAuthenticatedFields(value),
    ),
  );
}

export function acceptanceMarkerJson(value: ContactAcceptanceMarker): string {
  return enforceSerializedSize(
    JSON.stringify(acceptanceMarkerObject(validateAcceptanceMarker(value))),
    ACCEPTED_MAX_BYTES,
  );
}

export function parseCanonicalContact(encoded: Uint8Array): CanonicalContact {
  const text = parseUtf8(encoded, null, 'invalid canonical contact');
  const parsed = validateContact(parseJson(text, 'invalid canonical contact'));

  if (canonicalContactJson(parsed) !== text) {
    return fail('invalid canonical contact');
  }

  return parsed;
}

export function parseIntentEnvelope(
  encoded: Uint8Array,
): ContactIntentEnvelope {
  const text = parseUtf8(
    encoded,
    INTENT_MAX_BYTES,
    'invalid contact intent envelope',
  );
  const parsed = validateIntentEnvelope(
    parseJson(text, 'invalid contact intent envelope'),
  );

  if (intentEnvelopeJson(parsed) !== text) {
    return fail('invalid contact intent envelope');
  }

  return parsed;
}

export function parseAcceptanceMarker(
  encoded: Uint8Array,
): ContactAcceptanceMarker {
  const text = parseUtf8(
    encoded,
    ACCEPTED_MAX_BYTES,
    'invalid contact acceptance marker',
  );
  const parsed = validateAcceptanceMarker(
    parseJson(text, 'invalid contact acceptance marker'),
  );

  if (acceptanceMarkerJson(parsed) !== text) {
    return fail('invalid contact acceptance marker');
  }

  return parsed;
}

export function parseMacKeyring(encoded: Uint8Array): JournalMacKeyring {
  const text = Buffer.from(encoded).toString('utf8');

  if (!text.startsWith('{') || !text.endsWith('}') || /[\r\n]/.test(text)) {
    return fail('invalid MAC keyring');
  }

  const body = text.slice(1, -1);
  if (body.length === 0) {
    return fail('invalid MAC keyring');
  }

  const keys = new Set<string>();
  const keyring = new Map<string, Buffer>();
  let cursor = 0;

  while (cursor < body.length) {
    const match = /^"([^"\\]*)":"([^"\\]*)"/.exec(body.slice(cursor));
    if (!match) {
      return fail('invalid MAC keyring');
    }

    const [, keyId, encodedKey] = match;
    if (!KEY_ID_PATTERN.test(keyId) || keys.has(keyId)) {
      return fail('invalid MAC keyring');
    }

    const key = decodeCanonicalBase64(encodedKey);
    if (!key || key.byteLength !== 32) {
      return fail('invalid MAC keyring');
    }

    keys.add(keyId);
    keyring.set(keyId, key);
    cursor += match[0].length;

    if (cursor === body.length) {
      break;
    }

    if (body[cursor] !== ',') {
      return fail('invalid MAC keyring');
    }
    cursor += 1;
  }

  return keyring;
}
