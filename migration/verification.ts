import type { Kysely } from 'kysely';
import type { Database } from '../server/db/database.types';
import {
  canonicalDestinationRow,
  canonicalHash,
  type DestinationRow,
} from './canonical';
import { MigrationValidationError, type MigrationIssue } from './errors';
import { prepareSnapshot, type PreparedDocument } from './importer';
import type { SourceSnapshot } from './inventory';
import {
  SOURCE_COLLECTIONS,
  type SourceCollection,
} from './source-collections';

export interface ValidationCollectionResult {
  sourceCount: number;
  destinationCount: number;
  idsMatch: boolean;
  timestampsMatch: boolean;
  hashMatch: boolean;
}

export interface ValidationReport {
  valid: true;
  generatedAt: string;
  collections: Partial<Record<SourceCollection, ValidationCollectionResult>>;
}

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

function equalStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function destinationRows(
  db: Kysely<Database>,
  collection: SourceCollection,
): Promise<readonly DestinationRow<SourceCollection>[]> {
  switch (collection) {
    case 'about':
      return db.selectFrom('profile_sections').selectAll().execute();
    case 'current_occupation':
      return db.selectFrom('current_occupations').selectAll().execute();
    case 'hobbys':
      return db.selectFrom('hobbies').selectAll().execute();
    case 'languages':
      return db.selectFrom('languages').selectAll().execute();
    case 'page_cards':
      return db.selectFrom('page_cards').selectAll().execute();
    case 'proffessional_timeline':
      return db.selectFrom('professional_timeline').selectAll().execute();
    case 'projects_and_cases':
      return db.selectFrom('projects').selectAll().execute();
    case 'pursuit':
      return db.selectFrom('pursuits').selectAll().execute();
    case 'social_media':
      return db.selectFrom('social_links').selectAll().execute();
    case 'contact':
      return db.selectFrom('contact_messages').selectAll().execute();
  }
}

function validateCollection<K extends SourceCollection>(
  collection: K,
  source: readonly PreparedDocument<K>[],
  destination: readonly DestinationRow<K>[],
): ValidationCollectionResult {
  const sourceIds = source.map(({ id }) => id).sort(compareCodePoints);
  const destinationIds = destination
    .map((row) => (row as { id: string }).id)
    .sort(compareCodePoints);
  const idsMatch = equalStrings(sourceIds, destinationIds);
  const sourceHash = canonicalHash(
    source.map(({ canonical }) => canonical as object),
  );
  const destinationCanonical = destination.map(
    (row) => canonicalDestinationRow(collection, row) as object,
  );
  const canonicalShapesMatch =
    sourceHash === canonicalHash(destinationCanonical);

  let sourceOrderMatches = true;
  let timestampsMatch = true;
  if (collection === 'contact') {
    const sourceTimestamps = (source as readonly PreparedDocument<'contact'>[])
      .map(({ id, canonical }) => `${id}:${canonical.date}`)
      .sort(compareCodePoints);
    const destinationTimestamps = (
      destination as readonly DestinationRow<'contact'>[]
    )
      .map((row) => `${row.id}:${row.created_at.toISOString()}`)
      .sort(compareCodePoints);
    timestampsMatch = equalStrings(sourceTimestamps, destinationTimestamps);
  } else {
    const expectedOrders = new Map(
      source.map(({ id, sourceOrder }) => [id, sourceOrder]),
    );
    sourceOrderMatches = destination.every(
      (row) =>
        expectedOrders.get((row as { id: string }).id) ===
        (row as { source_order: number }).source_order,
    );
  }

  return {
    sourceCount: source.length,
    destinationCount: destination.length,
    idsMatch,
    timestampsMatch,
    hashMatch: canonicalShapesMatch && sourceOrderMatches,
  };
}

export async function verifySnapshot(
  db: Kysely<Database>,
  snapshot: Partial<SourceSnapshot>,
): Promise<ValidationReport> {
  const prepared = prepareSnapshot(snapshot);
  const collections: ValidationReport['collections'] = {};
  const issues: MigrationIssue[] = [];

  try {
    for (const collection of sourceCollections) {
      const source = prepared[collection];
      if (source === undefined) continue;
      const destination = await destinationRows(db, collection);
      const result = validateCollection(
        collection,
        source as PreparedDocument<typeof collection>[],
        destination as DestinationRow<typeof collection>[],
      );
      collections[collection] = result;
      if (
        result.sourceCount !== result.destinationCount ||
        !result.idsMatch ||
        !result.timestampsMatch ||
        !result.hashMatch
      ) {
        issues.push({
          collection,
          id: 'unknown',
          code: 'hash_mismatch',
          path: 'destination',
        });
      }
    }
  } catch (error) {
    if (error instanceof MigrationValidationError) throw error;
    throw new MigrationValidationError([
      {
        collection:
          sourceCollections.find(
            (collection) => prepared[collection] !== undefined,
          ) ?? 'contact',
        id: 'unknown',
        code: 'invalid_value',
        path: 'database',
      },
    ]);
  }

  if (issues.length > 0) throw new MigrationValidationError(issues);
  return { valid: true, generatedAt: new Date().toISOString(), collections };
}
