import { createHash } from 'node:crypto';
import type { Selectable } from 'kysely';
import {
  serializeCurrentOccupation,
  serializeHobby,
  serializeLanguage,
  serializePageCard,
  serializeProfileSection,
  serializeProject,
  serializePursuit,
  serializeSocialLink,
  serializeTimeline,
} from '../server/api/serializers';
import type { Database } from '../server/db/database.types';
import type {
  CareerSummary,
  CaseData,
  InformationCard,
  Interest,
  Language,
  PersonalInfo,
  ProfessionalTimeline,
  Pursuit,
  SocailMediaLink,
} from '../types/DBTypes';
import type { SourceCollection } from './source-collections';
import type { SourceDocument } from './source-schemas';

export interface CanonicalContact {
  _id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  date: string;
}

interface CanonicalMap {
  about: PersonalInfo;
  current_occupation: CareerSummary;
  hobbys: Interest;
  languages: Language;
  page_cards: InformationCard;
  proffessional_timeline: ProfessionalTimeline;
  projects_and_cases: CaseData;
  pursuit: Pursuit;
  social_media: SocailMediaLink;
  contact: CanonicalContact;
}

interface DestinationRowMap {
  about: Selectable<Database['profile_sections']>;
  current_occupation: Selectable<Database['current_occupations']>;
  hobbys: Selectable<Database['hobbies']>;
  languages: Selectable<Database['languages']>;
  page_cards: Selectable<Database['page_cards']>;
  proffessional_timeline: Selectable<Database['professional_timeline']>;
  projects_and_cases: Selectable<Database['projects']>;
  pursuit: Selectable<Database['pursuits']>;
  social_media: Selectable<Database['social_links']>;
  contact: Selectable<Database['contact_messages']>;
}

export type CanonicalRow<K extends SourceCollection> = CanonicalMap[K];
export type DestinationRow<K extends SourceCollection> = DestinationRowMap[K];

type SourceAdapter<K extends SourceCollection> = (
  document: SourceDocument<K>,
) => CanonicalRow<K>;
type DestinationAdapter<K extends SourceCollection> = (
  row: DestinationRow<K>,
) => CanonicalRow<K>;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== null && item !== undefined,
    ),
  ) as T;
}

type MongoSourceDocument = { _id: { toHexString(): string } };
type PublicSourceDocument<T extends MongoSourceDocument> = Omit<T, '_id'> & {
  _id: string;
};

function sourcePublicShape<T extends MongoSourceDocument>(
  document: T,
): PublicSourceDocument<T> {
  const { _id: sourceId, ...fields } = document;
  return compact({
    _id: sourceId.toHexString(),
    ...fields,
  }) as PublicSourceDocument<T>;
}

const sourceAdapters = {
  about: (document) => sourcePublicShape(document),
  current_occupation: (document) => sourcePublicShape(document),
  hobbys: (document) => sourcePublicShape(document),
  languages: (document) => sourcePublicShape(document),
  page_cards: (document) => sourcePublicShape(document),
  proffessional_timeline: (document) => sourcePublicShape(document),
  projects_and_cases: (document) => sourcePublicShape(document),
  pursuit: (document) => sourcePublicShape(document),
  social_media: (document) => sourcePublicShape(document),
  contact: (document) => ({
    _id: document._id.toHexString(),
    fullName: 'fullName' in document ? document.fullName : document.fullname,
    email: document.email,
    subject: document.subject,
    message: document.message,
    date: document.date.toISOString(),
  }),
} satisfies { [K in SourceCollection]: SourceAdapter<K> };

const destinationAdapters = {
  about: serializeProfileSection,
  current_occupation: serializeCurrentOccupation,
  hobbys: serializeHobby,
  languages: serializeLanguage,
  page_cards: serializePageCard,
  proffessional_timeline: serializeTimeline,
  projects_and_cases: serializeProject,
  pursuit: serializePursuit,
  social_media: serializeSocialLink,
  contact: (row) => ({
    _id: row.id,
    fullName: row.full_name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    date: row.created_at.toISOString(),
  }),
} satisfies { [K in SourceCollection]: DestinationAdapter<K> };

export function canonicalSourceRow<K extends SourceCollection>(
  collection: K,
  document: SourceDocument<K>,
): CanonicalRow<K> {
  const adapter = sourceAdapters[collection] as unknown as SourceAdapter<K>;
  return adapter(document);
}

export function canonicalDestinationRow<K extends SourceCollection>(
  collection: K,
  row: DestinationRow<K>,
): CanonicalRow<K> {
  const adapter = destinationAdapters[
    collection
  ] as unknown as DestinationAdapter<K>;
  return adapter(row);
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) =>
    character.codePointAt(0),
  );
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

export function canonicalHash<T extends object>(rows: readonly T[]): string {
  const ordered = rows
    .map((row) => {
      const normalized = normalize(row) as Record<string, unknown>;
      return {
        id: String(normalized._id),
        normalized,
        serialized: JSON.stringify(normalized),
      };
    })
    .sort((left, right) => {
      const idOrder = compareCodePoints(left.id, right.id);
      return idOrder === 0
        ? compareCodePoints(left.serialized, right.serialized)
        : idOrder;
    })
    .map(({ normalized }) => normalized);

  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}
