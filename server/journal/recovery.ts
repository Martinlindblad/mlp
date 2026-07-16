import { createHash } from 'node:crypto';
import type { AgeProcess } from './age-process';
import {
  plaintextMac,
  verifyAcceptanceMarker,
  verifyIntentEnvelope,
} from './authentication';
import {
  ACCEPTED_MAX_BYTES,
  canonicalContactJson,
  CONTACT_SCHEMA,
  INTENT_MAX_BYTES,
  parseCanonicalContact,
  type CanonicalContact,
  type ContactIntentEnvelope,
} from './contracts';
import type { JournalObjectReader } from './r2-store';

export interface AcceptedSetWatermark {
  count: number;
  sha256: string;
  schemas: string[];
  keyIds: string[];
}

export interface RecoveredAcceptedContact {
  contact: CanonicalContact;
  keyId: string;
  mac: string;
}

export interface AcceptedMarkerEvidence {
  id: string;
  keyId: string;
  mac: string;
  ciphertextSha256: string;
  envelopeMac: string;
  receiptMac: string;
}

export interface RecoveryStaging {
  stageFirst(
    evidence: AcceptedMarkerEvidence,
    recovered: RecoveredAcceptedContact,
  ): Promise<void>;
  stageSecond(evidence: AcceptedMarkerEvidence): Promise<void>;
  hasAcceptedId(id: string): Promise<boolean>;
  watermark(pass: 'first' | 'second'): Promise<AcceptedSetWatermark>;
}

const ACCEPTED_PREFIX = 'v1/accepted/' as const;
const INTENTS_PREFIX = 'v1/intents/' as const;
const OBJECT_KEY_PATTERN =
  /^v1\/(accepted|intents)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;

function recoveryFailed(): never {
  throw new Error('journal recovery failed');
}

function idFromKey(
  prefix: typeof ACCEPTED_PREFIX | typeof INTENTS_PREFIX,
  key: string,
): string {
  const match = key.match(OBJECT_KEY_PATTERN);
  if (!match || !key.startsWith(prefix)) {
    return recoveryFailed();
  }
  return match[2];
}

async function listAllKeys(
  store: JournalObjectReader,
  prefix: typeof ACCEPTED_PREFIX | typeof INTENTS_PREFIX,
  signal: AbortSignal,
): Promise<string[]> {
  const keys: string[] = [];
  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();
  let continuationToken: string | undefined;

  for (;;) {
    if (signal.aborted) recoveryFailed();
    if (continuationToken) {
      if (seenTokens.has(continuationToken)) recoveryFailed();
      seenTokens.add(continuationToken);
    }

    let page: { keys: string[]; nextToken?: string };
    try {
      page = await store.listPage(prefix, continuationToken, signal);
    } catch {
      return recoveryFailed();
    }

    for (const key of page.keys) {
      const id = idFromKey(prefix, key);
      if (seenIds.has(id)) recoveryFailed();
      seenIds.add(id);
      keys.push(key);
    }

    if (!page.nextToken) return keys;
    if (seenTokens.has(page.nextToken)) recoveryFailed();
    continuationToken = page.nextToken;
  }
}

function decodeCiphertext(envelope: ContactIntentEnvelope): Buffer {
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  if (
    ciphertext.byteLength === 0 ||
    ciphertext.toString('base64') !== envelope.ciphertext
  ) {
    recoveryFailed();
  }
  const digest = createHash('sha256').update(ciphertext).digest('hex');
  if (digest !== envelope.ciphertextSha256) recoveryFailed();
  return ciphertext;
}

function validatePlaintext(
  envelope: ContactIntentEnvelope,
  plaintext: Buffer,
  key: Buffer,
): CanonicalContact {
  const contact = parseCanonicalContact(plaintext);
  if (
    contact.schema !== CONTACT_SCHEMA ||
    contact.id !== envelope.id ||
    contact.createdAt !== envelope.createdAt
  ) {
    recoveryFailed();
  }

  const mac = plaintextMac(Buffer.from(canonicalContactJson(contact)), key);
  if (mac !== envelope.mac) recoveryFailed();
  return contact;
}

async function readIntent(
  store: JournalObjectReader,
  id: string,
  macKeys: ReadonlyMap<string, Buffer>,
  signal: AbortSignal,
): Promise<ContactIntentEnvelope> {
  const encoded = await store.get(`${INTENTS_PREFIX}${id}.json`, INTENT_MAX_BYTES, signal);
  if (!encoded) recoveryFailed();
  try {
    return verifyIntentEnvelope(encoded, macKeys).envelope;
  } catch {
    return recoveryFailed();
  }
}

async function authenticateAccepted(
  deps: {
    store: JournalObjectReader;
    age: AgeProcess;
    identityFile: string;
    macKeys: ReadonlyMap<string, Buffer>;
    signal: AbortSignal;
  },
  markerKey: string,
): Promise<{
  evidence: AcceptedMarkerEvidence;
  recovered: RecoveredAcceptedContact;
}> {
  const id = idFromKey(ACCEPTED_PREFIX, markerKey);
  const intent = await readIntent(deps.store, id, deps.macKeys, deps.signal);
  if (intent.id !== id) recoveryFailed();

  const markerBytes = await deps.store.get(
    markerKey,
    ACCEPTED_MAX_BYTES,
    deps.signal,
  );
  if (!markerBytes) recoveryFailed();

  let marker;
  try {
    marker = verifyAcceptanceMarker(markerBytes, intent, deps.macKeys);
  } catch {
    return recoveryFailed();
  }

  const key = deps.macKeys.get(intent.keyId);
  if (!key) recoveryFailed();
  const plaintext = await deps.age.decrypt(
    decodeCiphertext(intent),
    deps.identityFile,
    deps.signal,
  );
  const contact = validatePlaintext(intent, plaintext, key);
  const evidence: AcceptedMarkerEvidence = {
    id,
    keyId: marker.keyId,
    mac: marker.mac,
    ciphertextSha256: marker.ciphertextSha256,
    envelopeMac: marker.envelopeMac,
    receiptMac: marker.receiptMac,
  };

  return {
    evidence,
    recovered: {
      contact,
      keyId: intent.keyId,
      mac: intent.mac,
    },
  };
}

async function countPendingIntents(
  store: JournalObjectReader,
  staging: RecoveryStaging,
  signal: AbortSignal,
): Promise<number> {
  const intentKeys = await listAllKeys(store, INTENTS_PREFIX, signal);
  let pending = 0;
  for (const key of intentKeys) {
    if (!(await staging.hasAcceptedId(idFromKey(INTENTS_PREFIX, key)))) {
      pending += 1;
    }
  }
  return pending;
}

function sameWatermark(
  left: AcceptedSetWatermark,
  right: AcceptedSetWatermark,
): boolean {
  return (
    left.count === right.count &&
    left.sha256 === right.sha256 &&
    JSON.stringify(left.schemas) === JSON.stringify(right.schemas) &&
    JSON.stringify(left.keyIds) === JSON.stringify(right.keyIds)
  );
}

export async function readStableAcceptedSet(deps: {
  store: JournalObjectReader;
  age: AgeProcess;
  identityFile: string;
  macKeys: ReadonlyMap<string, Buffer>;
  staging: RecoveryStaging;
  signal: AbortSignal;
}): Promise<{
  watermark: AcceptedSetWatermark;
  pendingIntentCount: number;
}> {
  try {
    const firstKeys = await listAllKeys(deps.store, ACCEPTED_PREFIX, deps.signal);
    for (const markerKey of firstKeys) {
      const { evidence, recovered } = await authenticateAccepted(
        deps,
        markerKey,
      );
      await deps.staging.stageFirst(evidence, recovered);
    }

    const firstWatermark = await deps.staging.watermark('first');
    const pendingIntentCount = await countPendingIntents(
      deps.store,
      deps.staging,
      deps.signal,
    );

    const secondKeys = await listAllKeys(
      deps.store,
      ACCEPTED_PREFIX,
      deps.signal,
    );
    for (const markerKey of secondKeys) {
      const { evidence } = await authenticateAccepted(deps, markerKey);
      await deps.staging.stageSecond(evidence);
    }

    const secondWatermark = await deps.staging.watermark('second');
    if (!sameWatermark(firstWatermark, secondWatermark)) recoveryFailed();

    return { watermark: firstWatermark, pendingIntentCount };
  } catch {
    return recoveryFailed();
  }
}
