import { ObjectId, type Db } from 'mongodb';
import { canonicalHash } from './canonical';
import { MigrationValidationError, type MigrationIssue } from './errors';
import {
  SOURCE_COLLECTIONS,
  type SourceCollection,
} from './source-collections';
import { allowedSourceKeys } from './source-schemas';

export const SOURCE_READ_CONSISTENCY_NOTICE =
  'Inventory and snapshot reads are separate and are not a point-in-time transaction; final contact capture requires drained traffic.';

export interface InventoryIndex {
  name: string;
  keys: Record<string, 1 | -1 | 'text' | 'hashed'>;
  unique: boolean;
}

export interface CollectionInventory {
  count: number;
  ids: string[];
  keys: string[];
  bsonTypes: Record<string, string[]>;
  indexes: InventoryIndex[];
  validatorHash: string;
}

export interface SourceInventory {
  generatedAt: string;
  collections: Record<SourceCollection, CollectionInventory>;
}

export interface SnapshotDocument {
  sourceOrder: number;
  value: unknown;
}

export type SourceSnapshot = Record<SourceCollection, SnapshotDocument[]>;

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

function bsonType(value: unknown): string {
  if (value instanceof ObjectId) return 'objectId';
  if (value instanceof Date) return 'date';
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return 'binData';
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'double';
  }
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function addType(
  types: Map<string, Set<string>>,
  path: string,
  value: unknown,
): void {
  const values = types.get(path) ?? new Set<string>();
  values.add(bsonType(value));
  types.set(path, values);
}

function inspectValue(
  value: unknown,
  path: string,
  keys: Set<string>,
  types: Map<string, Set<string>>,
): void {
  addType(types, path, value);
  if (Array.isArray(value)) {
    for (const item of value) {
      keys.add(`${path}[]`);
      inspectValue(item, `${path}[]`, keys, types);
    }
    return;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    value instanceof Date ||
    value instanceof ObjectId ||
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array
  ) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    keys.add(childPath);
    inspectValue(child, childPath, keys, types);
  }
}

function safeSourceId(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unknown';
  const id = (value as { _id?: unknown })._id;
  return id instanceof ObjectId && ObjectId.isValid(id)
    ? id.toHexString()
    : 'unknown';
}

function invalidIndexIssue(
  collection: SourceCollection,
  index: number,
): MigrationIssue {
  return {
    collection,
    id: 'unknown',
    code: 'invalid_value',
    path: `<index:${index + 1}>`,
  };
}

function normalizedIndexes(
  collection: SourceCollection,
  indexes: readonly unknown[],
): InventoryIndex[] {
  const issues: MigrationIssue[] = [];
  const normalized = indexes
    .map((value, index): InventoryIndex | undefined => {
      if (!value || typeof value !== 'object') {
        issues.push(invalidIndexIssue(collection, index));
        return undefined;
      }
      const record = value as {
        name?: unknown;
        key?: unknown;
        unique?: unknown;
      };
      if (
        typeof record.name !== 'string' ||
        !/^[A-Za-z0-9_.-]+$/.test(record.name) ||
        !record.key ||
        typeof record.key !== 'object' ||
        Array.isArray(record.key)
      ) {
        issues.push(invalidIndexIssue(collection, index));
        return undefined;
      }
      const keys: InventoryIndex['keys'] = {};
      for (const [key, direction] of Object.entries(record.key)) {
        if (
          direction !== 1 &&
          direction !== -1 &&
          direction !== 'text' &&
          direction !== 'hashed'
        ) {
          issues.push(invalidIndexIssue(collection, index));
          return undefined;
        }
        keys[key] = direction;
      }
      return { name: record.name, keys, unique: record.unique === true };
    })
    .filter((value): value is InventoryIndex => value !== undefined)
    .sort((left, right) => compareCodePoints(left.name, right.name));
  if (issues.length > 0) throw new MigrationValidationError(issues);
  return normalized;
}

export async function inventorySource(
  db: Db,
  generatedAt = new Date(),
): Promise<SourceInventory> {
  const entries: [SourceCollection, CollectionInventory][] = [];
  const structuralIssues: MigrationIssue[] = [];

  for (const collection of sourceCollections) {
    const sourceCollection = db.collection(collection);
    const rows = await sourceCollection.find({}).toArray();
    const keys = new Set<string>();
    const types = new Map<string, Set<string>>();
    const ids: string[] = [];
    let unknownOrdinal = 0;

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        structuralIssues.push({
          collection,
          id: 'unknown',
          code: 'invalid_value',
          path: '$',
        });
        continue;
      }
      const id = safeSourceId(row);
      if (id === 'unknown') {
        structuralIssues.push({
          collection,
          id,
          code: 'invalid_value',
          path: '_id',
        });
      } else {
        ids.push(id);
      }
      const record = row as Record<string, unknown>;
      const allowed = allowedSourceKeys(collection);
      for (const key of Object.keys(record).sort(compareCodePoints)) {
        if (!allowed.has(key)) {
          unknownOrdinal += 1;
          structuralIssues.push({
            collection,
            id,
            code: 'unknown_field',
            path: `<unknown:${unknownOrdinal}>`,
          });
        }
        keys.add(key);
        inspectValue(record[key], key, keys, types);
      }
    }

    const collectionInfo = await db
      .listCollections({ name: collection })
      .next();
    const validator =
      collectionInfo && 'options' in collectionInfo
        ? collectionInfo.options?.validator ?? {}
        : {};
    const indexes = normalizedIndexes(
      collection,
      await sourceCollection.indexes(),
    );
    const bsonTypes = Object.fromEntries(
      Array.from(types.entries())
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, values]) => [
          key,
          Array.from(values).sort(compareCodePoints),
        ]),
    );

    entries.push([
      collection,
      {
        count: rows.length,
        ids: ids.sort(compareCodePoints),
        keys: Array.from(keys).sort(compareCodePoints),
        bsonTypes,
        indexes,
        validatorHash: canonicalHash([{ _id: 'validator', validator }]),
      },
    ]);
  }

  if (structuralIssues.length > 0) {
    throw new MigrationValidationError(structuralIssues);
  }

  return {
    generatedAt: generatedAt.toISOString(),
    collections: Object.fromEntries(entries) as SourceInventory['collections'],
  };
}

export async function captureSnapshot(
  db: Db,
  collections: readonly SourceCollection[],
): Promise<Partial<SourceSnapshot>> {
  const entries = await Promise.all(
    collections.map(async (collection) => {
      const rows = await db.collection(collection).find({}).toArray();
      return [
        collection,
        rows.map((value, sourceOrder) => ({ sourceOrder, value })),
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
