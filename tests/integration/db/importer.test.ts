import { ObjectId } from 'mongodb';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalHash,
  canonicalSourceRow,
} from '../../../migration/canonical';
import { importSnapshot } from '../../../migration/importer';
import type { SourceSnapshot } from '../../../migration/inventory';
import { mapSourceDocument } from '../../../migration/mappers';
import { parseSourceDocument } from '../../../migration/source-schemas';
import { verifySnapshot } from '../../../migration/verification';
import { migrateToLatest } from '../../../server/db/migrator';
import { createIsolatedDatabase } from '../../helpers/postgres';

const tables = [
  'profile_sections',
  'current_occupations',
  'hobbies',
  'languages',
  'page_cards',
  'professional_timeline',
  'projects',
  'pursuits',
  'social_links',
  'contact_messages',
] as const;

const contentTables = tables.filter((table) => table !== 'contact_messages');

function objectId(number: number): ObjectId {
  return new ObjectId(number.toString(16).padStart(24, '0'));
}

function twoRows(
  first: unknown,
  second: unknown,
): { sourceOrder: number; value: unknown }[] {
  return [
    { sourceOrder: 9, value: first },
    { sourceOrder: 3, value: second },
  ];
}

function fullSnapshot(): SourceSnapshot {
  return {
    about: twoRows(
      {
        _id: objectId(1),
        title: 'About one',
        info: 'Info one',
        name: 'Name one',
        surname: 'Surname one',
        key: 'about',
        description: [],
        imageSource: '',
      },
      {
        _id: objectId(2),
        title: 'About two',
        info: 'Info two',
        name: 'Name two',
        surname: 'Surname two',
        key: 'introduction',
      },
    ),
    current_occupation: twoRows(
      {
        _id: objectId(3),
        title: 'Developer',
        occupationType: 'Employment',
        description: 'Description one',
        from: '2024',
        to: '',
        introduction: 'Introduction one',
        name: 'Company one',
        link: '',
      },
      {
        _id: objectId(4),
        title: 'Consultant',
        occupationType: 'Contract',
        description: 'Description two',
        from: '2023',
        to: '2024',
        introduction: 'Introduction two',
        name: 'Company two',
        link: '/company',
      },
    ),
    hobbys: twoRows(
      {
        _id: objectId(5),
        title: 'Japanese one',
        content: '',
        type: 'japanese',
      },
      {
        _id: objectId(6),
        title: 'Japanese two',
        content: 'Content',
        type: 'japanese',
      },
    ),
    languages: twoRows(
      {
        _id: objectId(5),
        name: 'Swedish',
        spoken: 'Native',
        written: 'Native',
      },
      {
        _id: objectId(8),
        name: 'English',
        spoken: 'Fluent',
        written: 'Fluent',
      },
    ),
    page_cards: twoRows(
      {
        _id: objectId(9),
        title: 'About',
        description: 'Description one',
        link: '/about',
        key: 'about',
        type: 'introdcution',
      },
      {
        _id: objectId(10),
        title: 'Contact',
        description: 'Description two',
        link: '/contact',
        content: '',
        key: 'contact',
        type: 'introdcution',
      },
    ),
    proffessional_timeline: twoRows(
      {
        _id: objectId(11),
        company: 'Company',
        duration: '2024',
        title: 'Role',
        description: 'Description one',
        index: 1,
      },
      {
        _id: objectId(12),
        institution: 'School',
        qualification: '',
        duration: '2023',
        title: 'Course',
        description: 'Description two',
        index: 2,
      },
    ),
    projects_and_cases: twoRows(
      {
        _id: objectId(13),
        title: 'Project one',
        description: 'Description one',
        imageSource: '/images/background.webp',
        from: '',
        projectDetails: {
          headline: 'Headline one',
          description: 'Details one',
          imageSources: [],
          roleDetails: [],
          roleTitle: '',
          links: [],
          details: [],
        },
      },
      {
        _id: objectId(14),
        title: 'Project two',
        description: 'Description two',
        imageSource: '/images/background2.webp',
        to: '',
        projectDetails: {
          headline: 'Headline two',
          description: 'Details two',
          imagesSources: ['/images/beach.webp'],
          roleDetails: ['Design'],
          roleTitle: 'Role',
          details: [{ title: 'Result', description: 'Shipped' }],
        },
      },
    ),
    pursuit: twoRows(
      {
        _id: objectId(15),
        title: 'Pursuit one',
        description: 'Description one',
        leftImageSource: '/images/movie.webp',
        rightImageSource: '/images/porche.webp',
      },
      {
        _id: objectId(16),
        title: 'Pursuit two',
        description: 'Description two',
        leftImageSource: '/images/singapore.webp',
        rightImageSource: '/images/wallpaper.webp',
      },
    ),
    social_media: twoRows(
      {
        _id: objectId(17),
        name: 'Github',
        link: 'https://example.test/github',
      },
      {
        _id: objectId(18),
        name: 'LinkedIn',
        link: 'https://example.test/linkedin',
      },
    ),
    contact: twoRows(
      {
        _id: objectId(19),
        fullName: 'PII_FULL_NAME_IMPORT_ONE',
        email: 'pii-one@example.test',
        subject: 'PII_SUBJECT_IMPORT_ONE',
        message: 'PII_MESSAGE_IMPORT_ONE',
        date: new Date('2026-07-14T10:11:12.123Z'),
      },
      {
        _id: objectId(20),
        fullname: 'PII_FULL_NAME_IMPORT_TWO',
        email: 'pii-two@example.test',
        subject: 'PII_SUBJECT_IMPORT_TWO',
        message: 'PII_MESSAGE_IMPORT_TWO',
        date: new Date('2026-07-14T10:11:13.456Z'),
      },
    ),
  };
}

function expectRedacted(value: unknown): void {
  const output = JSON.stringify(value);
  for (const forbidden of [
    'PII_FULL_NAME_IMPORT_ONE',
    'PII_FULL_NAME_IMPORT_TWO',
    'pii-one@example.test',
    'pii-two@example.test',
    'PII_SUBJECT_IMPORT_ONE',
    'PII_SUBJECT_IMPORT_TWO',
    'PII_MESSAGE_IMPORT_ONE',
    'PII_MESSAGE_IMPORT_TWO',
    'postgres://postgres:postgres@127.0.0.1',
  ]) {
    expect(output).not.toContain(forbidden);
  }
}

describe('transactional snapshot importer and verification', () => {
  const isolated = createIsolatedDatabase();

  beforeAll(async () => {
    await isolated.start();
    await migrateToLatest(isolated.db);
  });

  beforeEach(async () => {
    await sql`drop trigger if exists fail_late_insert on social_links`.execute(
      isolated.db,
    );
    await sql`drop function if exists fail_late_insert()`.execute(isolated.db);
    for (const table of tables) {
      await sql.raw(`truncate table ${table}`).execute(isolated.db);
    }
  });

  afterAll(async () => isolated.stop());

  it('imports all ten collections atomically with exact order, hashes, and timestamps', async () => {
    const snapshot = fullSnapshot();
    const report = await importSnapshot(isolated.db, snapshot);
    const validated = await verifySnapshot(isolated.db, snapshot);

    expect(Object.keys(report.collections)).toHaveLength(10);
    for (const [collection, result] of Object.entries(report.collections)) {
      expect(result).toMatchObject({
        count: 2,
        ids: [...(result?.ids ?? [])].sort(),
        canonicalHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      const sourceRows = snapshot[collection as keyof SourceSnapshot].map(
        ({ value }) => {
          const parsed = parseSourceDocument(
            collection as keyof SourceSnapshot,
            value,
          );
          return canonicalSourceRow(collection as keyof SourceSnapshot, parsed);
        },
      );
      expect(result?.canonicalHash).toBe(canonicalHash(sourceRows));
    }
    expect(validated.valid).toBe(true);
    expect(Object.values(validated.collections)).toHaveLength(10);
    expect(Object.values(validated.collections)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceCount: 2,
          destinationCount: 2,
          idsMatch: true,
          timestampsMatch: true,
          hashMatch: true,
        }),
      ]),
    );

    for (const table of contentTables) {
      const rows = await isolated.db
        .selectFrom(table)
        .select(['id', 'source_order'])
        .orderBy('id')
        .execute();
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.source_order).sort()).toEqual([3, 9]);
    }
    const contacts = await isolated.db
      .selectFrom('contact_messages')
      .select(['id', 'created_at'])
      .orderBy('id')
      .execute();
    expect(contacts).toEqual([
      {
        id: objectId(19).toHexString(),
        created_at: new Date('2026-07-14T10:11:12.123Z'),
      },
      {
        id: objectId(20).toHexString(),
        created_at: new Date('2026-07-14T10:11:13.456Z'),
      },
    ]);
    expectRedacted(report);
    expectRedacted(validated);
  });

  it('is byte-equivalent and inserts nothing on an identical second run', async () => {
    const snapshot = fullSnapshot();
    const first = await importSnapshot(isolated.db, snapshot);
    const second = await importSnapshot(isolated.db, snapshot);

    expect(second.collections).toEqual(first.collections);
    expect(Object.keys(first).sort()).toEqual(['collections', 'generatedAt']);
    expect(Object.keys(second).sort()).toEqual(['collections', 'generatedAt']);
    expect(first.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(second.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const table of tables) {
      const result = await sql<{
        count: string;
      }>`select count(*)::text as count from ${sql.table(table)}`.execute(
        isolated.db,
      );
      expect(result.rows[0]?.count).toBe('2');
    }
  });

  it('parses the complete snapshot before SQL and rolls back invalid input', async () => {
    const snapshot = fullSnapshot();
    snapshot.social_media[1] = {
      sourceOrder: 3,
      value: {
        _id: objectId(18),
        link: 'PII_INVALID_LATE_DOCUMENT',
      },
    };

    let failure: unknown;
    try {
      await importSnapshot(isolated.db, snapshot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: 'MigrationValidationError' });
    expectRedacted(failure);
    for (const table of tables) {
      const result = await sql<{
        count: string;
      }>`select count(*)::text as count from ${sql.table(table)}`.execute(
        isolated.db,
      );
      expect(result.rows[0]?.count).toBe('0');
    }
  });

  it('rejects duplicate IDs within a collection before opening the transaction', async () => {
    const snapshot = fullSnapshot();
    snapshot.about[1] = {
      sourceOrder: 3,
      value: { ...(snapshot.about[1]?.value as object), _id: objectId(1) },
    };

    await expect(importSnapshot(isolated.db, snapshot)).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          collection: 'about',
          id: objectId(1).toHexString(),
          code: 'duplicate_id',
        }),
      ],
    });
    const rows = await isolated.db
      .selectFrom('profile_sections')
      .select('id')
      .execute();
    expect(rows).toEqual([]);
  });

  it('allows the same Mongo ObjectId in different collections', async () => {
    const snapshot = fullSnapshot();
    expect(
      (snapshot.hobbys[0]?.value as { _id: ObjectId })._id.toHexString(),
    ).toBe(
      (snapshot.languages[0]?.value as { _id: ObjectId })._id.toHexString(),
    );

    await importSnapshot(isolated.db, {
      hobbys: [snapshot.hobbys[0]],
      languages: [snapshot.languages[0]],
    });

    expect(
      await isolated.db.selectFrom('hobbies').select('id').execute(),
    ).toHaveLength(1);
    expect(
      await isolated.db.selectFrom('languages').select('id').execute(),
    ).toHaveLength(1);
  });

  it('does not open a SQL transaction for invalid or duplicate snapshots', async () => {
    let transactionCalls = 0;
    const db = {
      transaction() {
        transactionCalls += 1;
        throw new Error('transaction must not be called');
      },
    };
    const validAbout = fullSnapshot().about[0];

    await expect(
      importSnapshot(db as never, {
        about: [
          validAbout,
          { sourceOrder: 3, value: { _id: objectId(2), unsafe: 'value' } },
        ],
      }),
    ).rejects.toMatchObject({ name: 'MigrationValidationError' });
    expect(transactionCalls).toBe(0);

    await expect(
      importSnapshot(db as never, {
        about: [validAbout, { ...validAbout, sourceOrder: 3 }],
      }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'duplicate_id' })],
    });
    expect(transactionCalls).toBe(0);
  });

  it('skips an exact row but rejects a wrong source order or canonical shape', async () => {
    const source = fullSnapshot().about[0];
    const parsed = parseSourceDocument('about', source.value);
    const exact = mapSourceDocument('about', parsed, source.sourceOrder);
    await isolated.db.insertInto('profile_sections').values(exact).execute();

    const exactReport = await importSnapshot(isolated.db, { about: [source] });
    expect(exactReport.collections.about?.count).toBe(1);
    expect(
      await isolated.db.selectFrom('profile_sections').select('id').execute(),
    ).toHaveLength(1);

    await isolated.db
      .updateTable('profile_sections')
      .set({ source_order: 100 })
      .where('id', '=', exact.id)
      .execute();
    await expect(
      importSnapshot(isolated.db, { about: [source] }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'hash_mismatch' })],
    });

    await isolated.db
      .updateTable('profile_sections')
      .set({ source_order: source.sourceOrder, title: 'DIFFERENT_DESTINATION' })
      .where('id', '=', exact.id)
      .execute();
    await expect(
      importSnapshot(isolated.db, { about: [source] }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'hash_mismatch' })],
    });
  });

  it('rolls back every table when a late insert fails', async () => {
    await sql`
      create function fail_late_insert() returns trigger language plpgsql as $$
      begin
        raise exception 'late insert failure';
      end
      $$
    `.execute(isolated.db);
    await sql`
      create trigger fail_late_insert before insert on social_links
      for each row execute function fail_late_insert()
    `.execute(isolated.db);

    let failure: unknown;
    try {
      await importSnapshot(isolated.db, fullSnapshot());
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: 'MigrationValidationError' });
    expectRedacted(failure);
    for (const table of tables) {
      const result = await sql<{
        count: string;
      }>`select count(*)::text as count from ${sql.table(table)}`.execute(
        isolated.db,
      );
      expect(result.rows[0]?.count).toBe('0');
    }
  });

  it('reads complete destination tables and rejects extra rows without a report', async () => {
    const snapshot = fullSnapshot();
    await importSnapshot(isolated.db, snapshot);
    const extra = parseSourceDocument('about', {
      _id: objectId(999),
      title: 'EXTRA_DESTINATION_VALUE',
      info: 'Info',
      name: 'Name',
      surname: 'Surname',
      key: 'more',
    });
    await isolated.db
      .insertInto('profile_sections')
      .values(mapSourceDocument('about', extra, 1000))
      .execute();

    let failure: unknown;
    try {
      await verifySnapshot(isolated.db, snapshot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'MigrationValidationError',
      issues: [expect.objectContaining({ collection: 'about' })],
    });
    expect(JSON.stringify(failure)).not.toContain('EXTRA_DESTINATION_VALUE');
    expectRedacted(failure);
  });

  it('rejects a missing destination row', async () => {
    const snapshot = fullSnapshot();
    await importSnapshot(isolated.db, snapshot);
    await isolated.db
      .deleteFrom('pursuits')
      .where('id', '=', objectId(15).toHexString())
      .execute();

    await expect(verifySnapshot(isolated.db, snapshot)).rejects.toMatchObject({
      name: 'MigrationValidationError',
      issues: [expect.objectContaining({ collection: 'pursuit' })],
    });
  });

  it('rejects an exact contact timestamp mismatch without leaking either timestamp', async () => {
    const snapshot = fullSnapshot();
    await importSnapshot(isolated.db, snapshot);
    await sql`
      update contact_messages
      set created_at = ${new Date('1999-01-01T00:00:00.000Z')}
      where id = ${objectId(19).toHexString()}
    `.execute(isolated.db);

    let failure: unknown;
    try {
      await verifySnapshot(isolated.db, snapshot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'MigrationValidationError',
      issues: [expect.objectContaining({ collection: 'contact' })],
    });
    const output = JSON.stringify(failure);
    expect(output).not.toContain('1999-01-01');
    expect(output).not.toContain('2026-07-14T10:11:12.123Z');
    expectRedacted(failure);
  });
});
