import {
  Binary,
  BSONRegExp,
  Code,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
} from 'mongodb';
import { describe, expect, it } from 'vitest';
import { captureSnapshot, inventorySource } from '../../../migration/inventory';
import { MigrationValidationError } from '../../../migration/errors';
import { SOURCE_COLLECTIONS } from '../../../migration/source-collections';

interface FakeCollectionData {
  documents: unknown[];
  indexes?: unknown[];
  validator?: unknown;
}

function fakeDatabase(
  data: Partial<Record<keyof typeof SOURCE_COLLECTIONS, FakeCollectionData>>,
) {
  const calls: string[] = [];
  return {
    databaseName: 'must-not-enter-reports',
    calls,
    collection(name: keyof typeof SOURCE_COLLECTIONS) {
      calls.push(name);
      const collection = data[name] ?? { documents: [] };
      return {
        find() {
          return {
            async toArray() {
              return collection.documents;
            },
          };
        },
        async indexes() {
          return (
            collection.indexes ?? [
              { name: '_id_', key: { _id: 1 }, unique: true },
            ]
          );
        },
      };
    },
    listCollections(filter: { name: keyof typeof SOURCE_COLLECTIONS }) {
      return {
        async next() {
          return {
            name: filter.name,
            options: { validator: data[filter.name]?.validator ?? {} },
          };
        },
      };
    },
  };
}

describe('source inventory', () => {
  it('inspects exactly ten collections and emits structural metadata only', async () => {
    const contactId = new ObjectId('64b000000000000000000001');
    const db = fakeDatabase({
      about: {
        documents: [
          {
            _id: new ObjectId('64b000000000000000000003'),
            title: 'About',
            info: 'Info',
            name: 'Name',
            surname: 'Surname',
            key: 'about',
            description: ['PII_ARRAY_ELEMENT_NOT_A_REPORT_VALUE'],
          },
        ],
      },
      contact: {
        documents: [
          {
            _id: contactId,
            date: new Date('2026-07-14T11:00:00.000Z'),
            email: 'martin@example.com',
            fullName: 'PII_FULL_NAME_INVENTORY',
            message: 'PII_MESSAGE_INVENTORY',
            subject: 'PII_SUBJECT_INVENTORY',
          },
        ],
        validator: { $jsonSchema: { bsonType: 'object' } },
      },
      projects_and_cases: {
        documents: [
          {
            _id: new ObjectId('64b000000000000000000002'),
            title: 'PII_TITLE_NOT_A_REPORT_VALUE',
            description: 'PII_DESCRIPTION_NOT_A_REPORT_VALUE',
            imageSource: '/image.png',
            projectDetails: {
              headline: 'PII_HEADLINE_NOT_A_REPORT_VALUE',
              description: 'PII_NESTED_NOT_A_REPORT_VALUE',
              roleDetails: [],
              roleTitle: 'PII_ROLE_NOT_A_REPORT_VALUE',
              details: [],
            },
          },
        ],
      },
    });

    const inventory = await inventorySource(
      db as unknown as Parameters<typeof inventorySource>[0],
      new Date('2026-07-14T12:00:00.000Z'),
    );

    expect(Object.keys(inventory.collections)).toEqual(
      Object.keys(SOURCE_COLLECTIONS),
    );
    expect(db.calls).toEqual(Object.keys(SOURCE_COLLECTIONS));
    expect(inventory.collections.contact).toEqual({
      count: 1,
      ids: ['64b000000000000000000001'],
      keys: ['_id', 'date', 'email', 'fullName', 'message', 'subject'],
      bsonTypes: {
        _id: ['objectId'],
        date: ['date'],
        email: ['string'],
        fullName: ['string'],
        message: ['string'],
        subject: ['string'],
      },
      indexes: [{ name: '_id_', keys: { _id: 1 }, unique: true }],
      validatorHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(inventory.collections.projects_and_cases.keys).toContain(
      'projectDetails.details',
    );
    expect(
      inventory.collections.projects_and_cases.bsonTypes[
        'projectDetails.details'
      ],
    ).toEqual(['array']);
    expect(inventory.collections.about.bsonTypes['description[]']).toEqual([
      'string',
    ]);

    const output = JSON.stringify(inventory);
    for (const forbidden of [
      'martin@example.com',
      'PII_FULL_NAME_INVENTORY',
      'PII_MESSAGE_INVENTORY',
      'PII_SUBJECT_INVENTORY',
      'PII_TITLE_NOT_A_REPORT_VALUE',
      'PII_ARRAY_ELEMENT_NOT_A_REPORT_VALUE',
      'must-not-enter-reports',
      'mongodb://user:secret@mongo.invalid/database',
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it('accumulates redacted unknown-field and invalid-index issues across all ten collections', async () => {
    const unsafeFieldName = 'PII_UNKNOWN_martin@example.test';
    const unsafeIndexName = 'PII_INDEX_martin@example.test';
    const db = fakeDatabase({
      about: {
        documents: [
          {
            _id: new ObjectId('64b000000000000000000004'),
            [unsafeFieldName]: 'PII_UNKNOWN_FIELD_VALUE',
          },
        ],
      },
      languages: {
        documents: [],
        indexes: [{ name: unsafeIndexName, key: { name: 2 } }],
      },
    });

    let failure: unknown;
    try {
      await inventorySource(
        db as unknown as Parameters<typeof inventorySource>[0],
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: 'MigrationValidationError',
      issues: [
        expect.objectContaining({
          collection: 'about',
          code: 'unknown_field',
          path: '<unknown:1>',
        }),
        expect.objectContaining({
          collection: 'languages',
          code: 'invalid_value',
          path: '<index:1>',
        }),
      ],
    });
    expect(db.calls).toEqual(Object.keys(SOURCE_COLLECTIONS));
    const output = JSON.stringify(failure);
    expect(output).not.toContain(unsafeFieldName);
    expect(output).not.toContain('PII_UNKNOWN_FIELD_VALUE');
    expect(output).not.toContain(unsafeIndexName);
  });

  it('classifies BSON scalar wrappers without recursing into their internals', async () => {
    const db = fakeDatabase({
      about: {
        documents: [
          {
            _id: new ObjectId('64b000000000000000000005'),
            key: 'about',
            title: new Binary(Buffer.from([1, 2, 3])),
            info: Decimal128.fromString('123.45'),
            name: Long.fromString('9007199254740993'),
            surname: new Timestamp({ t: 10, i: 2 }),
            description: [
              new BSONRegExp('private-pattern', 'i'),
              new Double(1.25),
              new Int32(7),
              new Code('return 1'),
              new Code('return privateValue', { privateScope: true }),
              new MinKey(),
              new MaxKey(),
            ],
          },
        ],
      },
    });

    const inventory = await inventorySource(
      db as unknown as Parameters<typeof inventorySource>[0],
    );
    const about = inventory.collections.about;

    expect(about.bsonTypes).toMatchObject({
      title: ['binData'],
      info: ['decimal'],
      name: ['long'],
      surname: ['timestamp'],
      description: ['array'],
      'description[]': [
        'double',
        'int',
        'javascript',
        'javascriptWithScope',
        'maxKey',
        'minKey',
        'regex',
      ],
    });
    const reportedPaths = [...about.keys, ...Object.keys(about.bsonTypes)];
    for (const internalName of [
      'buffer',
      'bytes',
      'high',
      'low',
      'position',
      'pattern',
      'scope',
      'unsigned',
      'value',
    ]) {
      expect(reportedPaths.join('\n')).not.toContain(internalName);
    }
    expect(JSON.stringify(inventory)).not.toContain('privateScope');
    expect(JSON.stringify(inventory)).not.toContain('private-pattern');
  });

  it('preserves BSON documents and source order in snapshots', async () => {
    const first = {
      _id: new ObjectId('64b00000000000000000000f'),
      date: new Date('2026-07-14T11:00:00.123Z'),
    };
    const second = {
      _id: new ObjectId('64b000000000000000000001'),
      nested: { binary: Buffer.from([1, 2, 3]) },
    };
    const db = fakeDatabase({ contact: { documents: [first, second] } });

    const snapshot = await captureSnapshot(
      db as unknown as Parameters<typeof captureSnapshot>[0],
      ['contact'],
    );

    expect(snapshot.contact).toEqual([
      { sourceOrder: 0, value: first },
      { sourceOrder: 1, value: second },
    ]);
    expect(snapshot.contact?.[0]?.value).toBe(first);
    expect(snapshot.contact?.[1]?.value).toBe(second);
  });

  it('collects every uncovered top-level key without exposing values', async () => {
    const unsafeAlphaKey = 'PII_UNKNOWN_FIELD_martin@example.test';
    const unsafeBetaKey = 'mongodb://operator:secret@mongo.invalid/source';
    const db = fakeDatabase({
      about: {
        documents: [
          {
            _id: new ObjectId('64b000000000000000000001'),
            [unsafeAlphaKey]: 'PII_UNKNOWN_ALPHA_VALUE',
          },
          {
            _id: new ObjectId('64b000000000000000000002'),
            [unsafeBetaKey]: 'PII_UNKNOWN_BETA_VALUE',
          },
        ],
      },
    });

    await expect(
      inventorySource(db as unknown as Parameters<typeof inventorySource>[0]),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          collection: 'about',
          code: 'unknown_field',
          path: '<unknown:1>',
        }),
        expect.objectContaining({
          collection: 'about',
          code: 'unknown_field',
          path: '<unknown:2>',
        }),
      ],
    });

    try {
      await inventorySource(
        db as unknown as Parameters<typeof inventorySource>[0],
      );
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationValidationError);
      const output = JSON.stringify(error);
      expect(output).not.toContain('PII_UNKNOWN_ALPHA_VALUE');
      expect(output).not.toContain('PII_UNKNOWN_BETA_VALUE');
      expect(output).not.toContain(unsafeAlphaKey);
      expect(output).not.toContain(unsafeBetaKey);
    }
  });
});
