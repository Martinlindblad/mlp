import type { Kysely, Transaction } from 'kysely';
import {
  canonicalDestinationRow,
  canonicalHash,
  canonicalSourceRow,
  type CanonicalRow,
  type DestinationRow,
} from './canonical';
import { MigrationValidationError, type MigrationIssue } from './errors';
import { type SourceSnapshot, type SnapshotDocument } from './inventory';
import { mapSourceDocument, type DestinationInsert } from './mappers';
import {
  SOURCE_COLLECTIONS,
  type SourceCollection,
} from './source-collections';
import { parseSourceDocument, type SourceDocument } from './source-schemas';
import type { Database } from '../server/db/database.types';

export interface CollectionResult {
  count: number;
  ids: string[];
  canonicalHash: string;
}

export interface MigrationReport {
  generatedAt: string;
  collections: Partial<Record<SourceCollection, CollectionResult>>;
}

export interface PreparedDocument<K extends SourceCollection> {
  collection: K;
  id: string;
  sourceOrder: number;
  source: SourceDocument<K>;
  canonical: CanonicalRow<K>;
  destination: DestinationInsert<K>;
}

export type PreparedSnapshot = Partial<{
  [K in SourceCollection]: PreparedDocument<K>[];
}>;

const sourceCollections = Object.keys(SOURCE_COLLECTIONS) as SourceCollection[];

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function invalidIssue(
  collection: SourceCollection,
  path: string,
  id = 'unknown',
): MigrationIssue {
  return { collection, id, code: 'invalid_value', path };
}

function detachMutableSourceValues<K extends SourceCollection>(
  collection: K,
  source: SourceDocument<K>,
): SourceDocument<K> {
  if (collection !== 'contact') return source;
  const contact = source as SourceDocument<'contact'>;
  return {
    ...contact,
    date: new Date(contact.date.getTime()),
  } as SourceDocument<K>;
}

function prepareDocument<K extends SourceCollection>(
  collection: K,
  snapshot: SnapshotDocument,
): PreparedDocument<K> {
  if (!Number.isSafeInteger(snapshot.sourceOrder) || snapshot.sourceOrder < 0) {
    throw new MigrationValidationError([
      invalidIssue(collection, 'sourceOrder'),
    ]);
  }
  const source = detachMutableSourceValues(
    collection,
    parseSourceDocument(collection, snapshot.value),
  );
  const canonical = canonicalSourceRow(collection, source);
  return {
    collection,
    id: String((canonical as { _id: string })._id),
    sourceOrder: snapshot.sourceOrder,
    source,
    canonical,
    destination: mapSourceDocument(collection, source, snapshot.sourceOrder),
  };
}

export function prepareSnapshot(
  snapshot: Partial<SourceSnapshot>,
): PreparedSnapshot {
  const requestedKeys = Object.keys(snapshot);
  if (requestedKeys.some((key) => !(key in SOURCE_COLLECTIONS))) {
    throw new Error('migration snapshot invalid');
  }

  const result: Partial<
    Record<SourceCollection, PreparedDocument<SourceCollection>[]>
  > = {};
  const issues: MigrationIssue[] = [];
  for (const collection of sourceCollections) {
    const documents = snapshot[collection];
    if (documents === undefined) continue;
    if (!Array.isArray(documents)) {
      issues.push(invalidIssue(collection, '$'));
      continue;
    }

    const prepared: PreparedDocument<typeof collection>[] = [];
    const ids = new Set<string>();
    for (const document of documents) {
      try {
        const value = prepareDocument(collection, document);
        if (ids.has(value.id)) {
          issues.push({
            collection,
            id: value.id,
            code: 'duplicate_id',
            path: '_id',
          });
        } else {
          ids.add(value.id);
          prepared.push(value);
        }
      } catch (error) {
        if (error instanceof MigrationValidationError) {
          issues.push(...error.issues);
        } else {
          issues.push(invalidIssue(collection, '$'));
        }
      }
    }
    result[collection] = prepared;
  }

  if (issues.length > 0) throw new MigrationValidationError(issues);
  return result as PreparedSnapshot;
}

function assertExistingRows<K extends SourceCollection>(
  collection: K,
  documents: readonly PreparedDocument<K>[],
  rows: readonly DestinationRow<K>[],
): PreparedDocument<K>[] {
  const existing = new Map(
    rows.map((row) => [(row as { id: string }).id, row] as const),
  );
  const issues: MigrationIssue[] = [];
  const pending: PreparedDocument<K>[] = [];

  for (const document of documents) {
    const row = existing.get(document.id);
    if (!row) {
      pending.push(document);
      continue;
    }
    const destination = canonicalDestinationRow(collection, row);
    const shapeMatches =
      canonicalHash([document.canonical as object]) ===
      canonicalHash([destination as object]);
    const orderMatches =
      collection === 'contact' ||
      (
        row as DestinationRow<Exclude<K, 'contact'>> & {
          source_order: number;
        }
      ).source_order === document.sourceOrder;
    if (!shapeMatches || !orderMatches) {
      issues.push({
        collection,
        id: document.id,
        code: 'hash_mismatch',
        path: '$',
      });
    }
  }

  if (issues.length > 0) throw new MigrationValidationError(issues);
  return pending;
}

async function importCollection(
  trx: Transaction<Database>,
  collection: SourceCollection,
  prepared: PreparedSnapshot,
): Promise<void> {
  switch (collection) {
    case 'about': {
      const documents = prepared.about ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('profile_sections')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('about', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('profile_sections')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'current_occupation': {
      const documents = prepared.current_occupation ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('current_occupations')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('current_occupation', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('current_occupations')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'hobbys': {
      const documents = prepared.hobbys ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('hobbies')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('hobbys', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('hobbies')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'languages': {
      const documents = prepared.languages ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('languages')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('languages', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('languages')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'page_cards': {
      const documents = prepared.page_cards ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('page_cards')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('page_cards', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('page_cards')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'proffessional_timeline': {
      const documents = prepared.proffessional_timeline ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('professional_timeline')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows(
        'proffessional_timeline',
        documents,
        rows,
      );
      if (pending.length > 0) {
        await trx
          .insertInto('professional_timeline')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'projects_and_cases': {
      const documents = prepared.projects_and_cases ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('projects')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('projects_and_cases', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('projects')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'pursuit': {
      const documents = prepared.pursuit ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('pursuits')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('pursuit', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('pursuits')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'social_media': {
      const documents = prepared.social_media ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('social_links')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('social_media', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('social_links')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
    case 'contact': {
      const documents = prepared.contact ?? [];
      const rows = documents.length
        ? await trx
            .selectFrom('contact_messages')
            .selectAll()
            .where(
              'id',
              'in',
              documents.map(({ id }) => id),
            )
            .execute()
        : [];
      const pending = assertExistingRows('contact', documents, rows);
      if (pending.length > 0) {
        await trx
          .insertInto('contact_messages')
          .values(pending.map(({ destination }) => destination))
          .execute();
      }
      return;
    }
  }
}

function migrationCollections(
  prepared: PreparedSnapshot,
): MigrationReport['collections'] {
  return Object.fromEntries(
    sourceCollections.flatMap((collection) => {
      const documents = prepared[collection];
      if (documents === undefined) return [];
      return [
        [
          collection,
          {
            count: documents.length,
            ids: documents.map(({ id }) => id).sort(compareCodePoints),
            canonicalHash: canonicalHash(
              documents.map(({ canonical }) => canonical as object),
            ),
          },
        ],
      ];
    }),
  );
}

export async function importSnapshot(
  db: Kysely<Database>,
  snapshot: Partial<SourceSnapshot>,
): Promise<MigrationReport> {
  const prepared = prepareSnapshot(snapshot);
  try {
    return await db
      .transaction()
      .execute(async (trx) => importPreparedSnapshot(trx, prepared));
  } catch (error) {
    if (error instanceof MigrationValidationError) throw error;
    const requested = sourceCollections.filter(
      (collection) => prepared[collection] !== undefined,
    );
    throw new MigrationValidationError([
      invalidIssue(requested[0] ?? 'contact', 'database'),
    ]);
  }
}

export async function importPreparedSnapshot(
  trx: Transaction<Database>,
  prepared: PreparedSnapshot,
): Promise<MigrationReport> {
  const requested = sourceCollections.filter(
    (collection) => prepared[collection] !== undefined,
  );

  try {
    for (const collection of requested) {
      await importCollection(trx, collection, prepared);
    }
  } catch (error) {
    if (error instanceof MigrationValidationError) throw error;
    throw new MigrationValidationError([
      invalidIssue(requested[0] ?? 'contact', 'database'),
    ]);
  }

  return {
    generatedAt: new Date().toISOString(),
    collections: migrationCollections(prepared),
  };
}
