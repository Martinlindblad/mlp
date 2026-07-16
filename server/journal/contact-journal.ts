import * as crypto from 'node:crypto';
import type { AgeProcess } from './age-process';
import {
  createAcceptanceMarker,
  createIntentEnvelope,
  plaintextMac,
  verifyAcceptanceMarker,
  verifyIntentEnvelope,
} from './authentication';
import {
  ACCEPTED_MAX_BYTES,
  acceptanceMarkerJson,
  canonicalContactJson,
  CONTACT_SCHEMA,
  INTENT_MAX_BYTES,
  intentEnvelopeJson,
  type CanonicalContact,
  type ContactIntentEnvelope,
} from './contracts';
import {
  serializeJournalOutcome,
  type JournalOutcome,
} from './metrics';
import type { JournalObjectStore } from './r2-store';
import type { ContactRepository } from '../repositories/contact-repository';

export interface ContactSubmission {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
}

export interface ContactJournal {
  accept(input: ContactSubmission, signal: AbortSignal): Promise<{ id: string }>;
}

export class ContactConflictError extends Error {
  constructor() {
    super('contact conflict');
    this.name = 'ContactConflictError';
  }
}

export class ContactUnavailableError extends Error {
  constructor(
    public readonly outcome: Exclude<
      JournalOutcome,
      'conflict' | 'success'
    >,
  ) {
    super('contact unavailable');
    this.name = 'ContactUnavailableError';
  }
}

interface PreparedIntent {
  envelope: ContactIntentEnvelope;
  contact: CanonicalContact;
}

function objectKey(kind: 'accepted' | 'intents', id: string): string {
  return `v1/${kind}/${id}.json`;
}

function unavailable(
  outcome: ContactUnavailableError['outcome'],
): ContactUnavailableError {
  return new ContactUnavailableError(outcome);
}

function canonicalContact(
  input: ContactSubmission,
  createdAt: string,
): CanonicalContact {
  return {
    schema: CONTACT_SCHEMA,
    id: input.id,
    fullName: input.fullName,
    email: input.email,
    subject: input.subject,
    message: input.message,
    createdAt,
  };
}

function decodeMac(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.byteLength !== 32 || decoded.toString('base64url') !== value) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function macsEqual(left: string, right: string): boolean {
  const leftBytes = decodeMac(left);
  const rightBytes = decodeMac(right);
  if (
    !leftBytes ||
    !rightBytes ||
    leftBytes.byteLength !== rightBytes.byteLength
  ) {
    return false;
  }
  return crypto.timingSafeEqual(leftBytes, rightBytes);
}

function verifyPlaintextMatch(
  input: ContactSubmission,
  envelope: ContactIntentEnvelope,
  key: Buffer,
): CanonicalContact {
  const requestedContact = canonicalContact(input, envelope.createdAt);
  const requestedMac = plaintextMac(
    Buffer.from(canonicalContactJson(requestedContact)),
    key,
  );

  if (!macsEqual(requestedMac, envelope.mac)) {
    throw new ContactConflictError();
  }

  return requestedContact;
}

export function createContactJournal(deps: {
  store: JournalObjectStore;
  age: AgeProcess;
  contacts: ContactRepository;
  activeKeyId: string;
  ageRecipient: string;
  macKeys: ReadonlyMap<string, Buffer>;
  now(): Date;
  emitMetricLine(line: string): void;
}): ContactJournal {
  async function readVerifiedIntent(
    key: string,
    signal: AbortSignal,
  ): Promise<ContactIntentEnvelope> {
    const encoded = await deps.store.get(key, INTENT_MAX_BYTES, signal);
    if (!encoded) throw unavailable('intent_failure');
    return verifyIntentEnvelope(encoded, deps.macKeys).envelope;
  }

  async function prepareIntent(
    input: ContactSubmission,
    signal: AbortSignal,
  ): Promise<PreparedIntent> {
    const key = deps.macKeys.get(deps.activeKeyId);
    if (!key) throw unavailable('intent_failure');

    const createdAt = deps.now().toISOString();
    const contact = canonicalContact(input, createdAt);
    const plaintext = Buffer.from(canonicalContactJson(contact));
    const ciphertext = await deps.age.encrypt(
      plaintext,
      deps.ageRecipient,
      signal,
    );
    const newEnvelope = createIntentEnvelope(
      contact,
      deps.activeKeyId,
      key,
      ciphertext,
    );
    const keyName = objectKey('intents', input.id);
    const result = await deps.store.putIfAbsent(
      keyName,
      Buffer.from(intentEnvelopeJson(newEnvelope)),
      INTENT_MAX_BYTES,
      signal,
    );

    if (result === 'created') {
      return { envelope: newEnvelope, contact };
    }

    const envelope = await readVerifiedIntent(keyName, signal);
    const storedKey = deps.macKeys.get(envelope.keyId);
    if (!storedKey) throw unavailable('intent_failure');
    return {
      envelope,
      contact: verifyPlaintextMatch(input, envelope, storedKey),
    };
  }

  async function projectIntent(
    prepared: PreparedIntent,
    signal: AbortSignal,
  ): Promise<void> {
    const outcome = await deps.contacts.ensureJournalContact(
      {
        id: prepared.contact.id,
        fullName: prepared.contact.fullName,
        email: prepared.contact.email,
        subject: prepared.contact.subject,
        message: prepared.contact.message,
        createdAt: new Date(prepared.contact.createdAt),
        journalSchema: CONTACT_SCHEMA,
        journalKeyId: prepared.envelope.keyId,
        journalMac: prepared.envelope.mac,
      },
      signal,
    );

    if (outcome !== 'inserted' && outcome !== 'matched') {
      throw unavailable('projection_failure');
    }
  }

  async function proveAccepted(
    prepared: PreparedIntent,
    signal: AbortSignal,
  ): Promise<void> {
    const key = deps.macKeys.get(prepared.envelope.keyId);
    if (!key) throw unavailable('marker_failure');

    const acceptedAt = deps.now().toISOString();
    const marker = createAcceptanceMarker(prepared.envelope, acceptedAt, key);
    const markerBytes = Buffer.from(acceptanceMarkerJson(marker));
    const keyName = objectKey('accepted', prepared.envelope.id);
    const result = await deps.store.putIfAbsent(
      keyName,
      markerBytes,
      ACCEPTED_MAX_BYTES,
      signal,
    );

    if (result === 'created') {
      verifyAcceptanceMarker(markerBytes, prepared.envelope, deps.macKeys);
      return;
    }

    const storedMarker = await deps.store.get(
      keyName,
      ACCEPTED_MAX_BYTES,
      signal,
    );
    if (!storedMarker) throw unavailable('marker_failure');
    verifyAcceptanceMarker(storedMarker, prepared.envelope, deps.macKeys);
  }

  async function acceptOnce(
    input: ContactSubmission,
    signal: AbortSignal,
  ): Promise<{ id: string }> {
    let prepared: PreparedIntent;
    try {
      prepared = await prepareIntent(input, signal);
    } catch (error) {
      if (error instanceof ContactConflictError) throw error;
      if (error instanceof ContactUnavailableError) throw error;
      throw unavailable('intent_failure');
    }

    try {
      await projectIntent(prepared, signal);
    } catch (error) {
      if (error instanceof ContactUnavailableError) throw error;
      throw unavailable('projection_failure');
    }

    try {
      await proveAccepted(prepared, signal);
    } catch (error) {
      if (error instanceof ContactUnavailableError) throw error;
      throw unavailable('marker_failure');
    }

    return { id: prepared.contact.id };
  }

  return {
    async accept(input, signal) {
      try {
        const result = await acceptOnce(input, signal);
        deps.emitMetricLine(serializeJournalOutcome('success'));
        return result;
      } catch (error) {
        if (error instanceof ContactConflictError) {
          deps.emitMetricLine(serializeJournalOutcome('conflict'));
          throw error;
        }

        if (error instanceof ContactUnavailableError) {
          deps.emitMetricLine(serializeJournalOutcome(error.outcome));
          throw error;
        }

        deps.emitMetricLine(serializeJournalOutcome('marker_failure'));
        throw unavailable('marker_failure');
      }
    },
  };
}
