import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { READ_LIMITS } from '../../../server/api/contracts';
import { migrateToLatest } from '../../../server/db/migrator';
import { createContactRepository } from '../../../server/repositories/contact-repository';
import {
  createContentRepository,
  type ContentRepository,
} from '../../../server/repositories/content-repository';
import {
  createProjectRepository,
  type ProjectRepository,
} from '../../../server/repositories/project-repository';
import { createIsolatedDatabase } from '../../helpers/postgres';

const journalInput = {
  id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
  fullName: 'Martin Lindblad',
  email: 'martin@example.com',
  subject: 'Hello',
  message: 'Message',
  createdAt: new Date('2026-07-16T12:00:00.123Z'),
  journalSchema: 'mlp.contact.v1' as const,
  journalKeyId: 'journal-2026-01',
  journalMac: 'ERERERERERERERERERERERERERERERERERERERERERE',
};

const repositoryErrorMessage = 'contact persistence unavailable';

function legacyId(value: number): string {
  return value.toString(16).padStart(24, '0');
}

function descendingSourceOrders(limit: number): number[] {
  return Array.from({ length: limit + 1 }, (_, index) => limit + 1 - index);
}

function expectedIds(base: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    legacyId(base + index + 1),
  );
}

describe('PostgreSQL content repositories', () => {
  const isolated = createIsolatedDatabase();
  let content!: ContentRepository;
  let projects!: ProjectRepository;

  beforeAll(async () => {
    await isolated.start();
    await migrateToLatest(isolated.db);
    content = createContentRepository(isolated.db);
    projects = createProjectRepository(isolated.db);

    await isolated.db
      .insertInto('profile_sections')
      .values(
        descendingSourceOrders(READ_LIMITS.about).map((sourceOrder) => ({
          id: legacyId(100 + sourceOrder),
          source_order: sourceOrder,
          key: sourceOrder === READ_LIMITS.about + 1 ? 'introduction' : 'about',
          title: `Profile ${sourceOrder}`,
          info: 'Info',
          name: 'Martin',
          surname: 'Lindblad',
          description: null,
          image_source: null,
          link: null,
          link_text: null,
          profile_image: null,
        })),
      )
      .execute();
    await isolated.db
      .insertInto('current_occupations')
      .values(
        descendingSourceOrders(READ_LIMITS.currentOccupation).map(
          (sourceOrder) => ({
            id: legacyId(200 + sourceOrder),
            source_order: sourceOrder,
            title: `Role ${sourceOrder}`,
            occupation_type: 'Employment',
            description: 'Description',
            from_label: '2024',
            to_label: 'Present',
            introduction: 'Introduction',
            name: 'Company',
            link: '',
          }),
        ),
      )
      .execute();
    await isolated.db
      .insertInto('hobbies')
      .values(
        descendingSourceOrders(READ_LIMITS.hobbies).map((sourceOrder) => ({
          id: legacyId(300 + sourceOrder),
          source_order: sourceOrder,
          title: `Hobby ${sourceOrder}`,
          content: 'Content',
          type: 'japanese',
        })),
      )
      .execute();
    await isolated.db
      .insertInto('languages')
      .values(
        descendingSourceOrders(READ_LIMITS.languages).map((sourceOrder) => ({
          id: legacyId(400 + sourceOrder),
          source_order: sourceOrder,
          name: `Language ${sourceOrder}`,
          spoken: 'Fluent',
          written: 'Fluent',
        })),
      )
      .execute();
    await isolated.db
      .insertInto('page_cards')
      .values(
        descendingSourceOrders(READ_LIMITS.pageCards).map((sourceOrder) => ({
          id: legacyId(500 + sourceOrder),
          source_order: sourceOrder,
          title: `Card ${sourceOrder}`,
          description: 'Description',
          link: '/about',
          content: sourceOrder === 1 ? null : '',
          key: 'about',
          type: 'introdcution',
        })),
      )
      .execute();
    await isolated.db
      .insertInto('professional_timeline')
      .values(
        descendingSourceOrders(READ_LIMITS.professionalTimeline).map(
          (sourceOrder) => ({
            id: legacyId(600 + sourceOrder),
            source_order: sourceOrder,
            company: null,
            institution: 'School',
            qualification: null,
            duration: '2020–2022',
            title: `Timeline ${sourceOrder}`,
            description: 'Description',
            sort_index: sourceOrder,
          }),
        ),
      )
      .execute();
    await isolated.db
      .insertInto('projects')
      .values(
        descendingSourceOrders(READ_LIMITS.projectsAndCases).map(
          (sourceOrder) => ({
            id: legacyId(700 + sourceOrder),
            source_order: sourceOrder,
            title: `Project ${sourceOrder}`,
            description: 'Description',
            image_source: '/image.png',
            from_label: sourceOrder === 1 ? null : '2020',
            to_label: sourceOrder === 1 ? null : '2021',
            project_details: JSON.stringify({
              headline: 'Project',
              description: 'Description',
              imagesSources:
                sourceOrder === READ_LIMITS.projectsAndCases + 1
                  ? ['/legacy-image.png']
                  : undefined,
              roleDetails: [],
              roleTitle: 'Role',
              details: [],
            }),
          }),
        ),
      )
      .execute();
    await isolated.db
      .insertInto('pursuits')
      .values(
        descendingSourceOrders(READ_LIMITS.pursuit).map((sourceOrder) => ({
          id: legacyId(800 + sourceOrder),
          source_order: sourceOrder,
          title: `Pursuit ${sourceOrder}`,
          description: 'Description',
          left_image_source: '/left.png',
          right_image_source: '/right.png',
        })),
      )
      .execute();
    await isolated.db
      .insertInto('social_links')
      .values(
        descendingSourceOrders(READ_LIMITS.socialmedia).map((sourceOrder) => ({
          id: legacyId(900 + sourceOrder),
          source_order: sourceOrder,
          name: 'Github',
          link: `https://example.com/${sourceOrder}`,
        })),
      )
      .execute();
  });

  afterAll(async () => isolated.stop());

  it('orders and applies fixed limits to profile and introduction reads', async () => {
    expect((await content.findProfileSections()).map(({ id }) => id)).toEqual(
      expectedIds(100, READ_LIMITS.about),
    );
    expect((await content.findIntroduction()).map(({ id }) => id)).toEqual([
      legacyId(100 + READ_LIMITS.about + 1),
    ]);
  });

  it('orders and applies the fixed current occupation limit', async () => {
    expect(
      (await content.findCurrentOccupations()).map(({ id }) => id),
    ).toEqual(expectedIds(200, READ_LIMITS.currentOccupation));
  });

  it('orders and applies the fixed hobbies limit', async () => {
    expect((await content.findHobbies()).map(({ id }) => id)).toEqual(
      expectedIds(300, READ_LIMITS.hobbies),
    );
  });

  it('orders and applies the fixed languages limit', async () => {
    expect((await content.findLanguages()).map(({ id }) => id)).toEqual(
      expectedIds(400, READ_LIMITS.languages),
    );
  });

  it('orders and applies the fixed page cards limit', async () => {
    expect((await content.findPageCards()).map(({ id }) => id)).toEqual(
      expectedIds(500, READ_LIMITS.pageCards),
    );
  });

  it('orders and applies the fixed timeline limit', async () => {
    expect((await content.findTimeline()).map(({ id }) => id)).toEqual(
      expectedIds(600, READ_LIMITS.professionalTimeline),
    );
  });

  it('orders and applies the fixed projects limit', async () => {
    expect((await projects.list()).map(({ id }) => id)).toEqual(
      expectedIds(700, READ_LIMITS.projectsAndCases),
    );
  });

  it('orders and applies the fixed pursuits limit', async () => {
    expect((await content.findPursuits()).map(({ id }) => id)).toEqual(
      expectedIds(800, READ_LIMITS.pursuit),
    );
  });

  it('orders and applies the fixed social links limit', async () => {
    expect((await content.findSocialLinks()).map(({ id }) => id)).toEqual(
      expectedIds(900, READ_LIMITS.socialmedia),
    );
  });

  it('lists ordered project IDs and finds an unchanged text ID', async () => {
    const outsideListId = legacyId(700 + READ_LIMITS.projectsAndCases + 1);

    expect(await projects.listIds()).toEqual(
      expectedIds(700, READ_LIMITS.projectsAndCases + 1),
    );
    expect(outsideListId).toHaveLength(24);
    expect((await projects.findById(outsideListId))?.id).toBe(outsideListId);
  });
});

describe('PostgreSQL contact journal repository', () => {
  const isolated = createIsolatedDatabase();

  beforeAll(async () => {
    await isolated.start();
    await migrateToLatest(isolated.db);
  });

  afterAll(async () => isolated.stop(), 20_000);

  it('returns inserted for first write and matched for exact retry', async () => {
    const repository = createContactRepository(isolated.pool);

    await expect(
      repository.ensureJournalContact(
        journalInput,
        new AbortController().signal,
      ),
    ).resolves.toBe('inserted');
    await expect(
      repository.ensureJournalContact(
        journalInput,
        new AbortController().signal,
      ),
    ).resolves.toBe('matched');
  });

  it('uses parameterized SQL and maps unknown outcomes without leaking values', async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({
      rows: [{ outcome: 'secret unexpected outcome' }],
    });
    const connect = vi.fn(
      (
        callback: (
          error: Error | undefined,
          client: { query: typeof query; release: typeof release },
        ) => void,
      ) => callback(undefined, { query, release }),
    );
    const repository = createContactRepository({ connect } as never);

    await expect(
      repository.ensureJournalContact(
        {
          ...journalInput,
          id: '72eb8a54-d43b-45d5-9ea7-77b5834eeed3',
          message: 'sentinel-message-secret',
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(repositoryErrorMessage);

    expect(query).toHaveBeenCalledWith({
      text: expect.stringContaining('$1'),
      values: [
        '72eb8a54-d43b-45d5-9ea7-77b5834eeed3',
        journalInput.fullName,
        journalInput.email,
        journalInput.subject,
        'sentinel-message-secret',
        journalInput.createdAt,
        journalInput.journalSchema,
        journalInput.journalKeyId,
        journalInput.journalMac,
      ],
    });
    expect(query.mock.calls[0]?.[0].text).not.toContain(
      'sentinel-message-secret',
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects already-aborted requests without acquiring a client', async () => {
    const connect = vi.fn();
    const repository = createContactRepository({ connect } as never);
    const controller = new AbortController();
    controller.abort();

    await expect(
      repository.ensureJournalContact(journalInput, controller.signal),
    ).rejects.toThrow(repositoryErrorMessage);
    expect(connect).not.toHaveBeenCalled();
  });

  it('destroys a queued client when abort wins acquisition', async () => {
    const release = vi.fn();
    let deliver:
      | ((error: Error | undefined, client: { release: typeof release }) => void)
      | undefined;
    const connect = vi.fn(
      (
        callback: (
          error: Error | undefined,
          client: { release: typeof release },
        ) => void,
      ) => {
        deliver = callback;
      },
    );
    const repository = createContactRepository({ connect } as never);
    const controller = new AbortController();

    const promise = repository.ensureJournalContact(
      {
        ...journalInput,
        id: '73eb8a54-d43b-45d5-9ea7-77b5834eeed3',
      },
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toThrow(repositoryErrorMessage);

    deliver?.(undefined, { release });
    expect(release).toHaveBeenCalledWith(true);
  });

  it('destroys the dedicated client when an in-flight query is aborted', async () => {
    const locked = {
      ...journalInput,
      id: '74eb8a54-d43b-45d5-9ea7-77b5834eeed3',
    };
    const repository = createContactRepository(isolated.pool);
    await repository.ensureJournalContact(locked, new AbortController().signal);

    const lockClient = await isolated.pool.connect();
    try {
      await lockClient.query('begin');
      await lockClient.query(
        'select * from public.contact_messages where id = $1 for update',
        [locked.id],
      );

      const controller = new AbortController();
      const promise = repository.ensureJournalContact(locked, controller.signal);
      setTimeout(() => controller.abort(), 100);

      await expect(promise).rejects.toThrow(repositoryErrorMessage);
      await expectNoActiveEnsureJournalContactQuery();
    } finally {
      await lockClient.query('rollback').catch(() => undefined);
      lockClient.release();
    }

    const count = await isolated.db
      .selectFrom('contact_messages')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('id', '=', locked.id)
      .executeTakeFirstOrThrow();
    expect(count.count).toBe('1');
  }, 10_000);

  async function expectNoActiveEnsureJournalContactQuery(): Promise<void> {
    const deadline = Date.now() + 2_000;
    for (;;) {
      const result = await sql<{ count: number }>`
        select count(*)::int as count
        from pg_stat_activity
        where datname = current_database()
        and pid <> pg_backend_pid()
        and state = 'active'
        and query like '%ensure_journal_contact%'
      `.execute(isolated.db);
      if (result.rows[0]?.count === 0) return;
      if (Date.now() >= deadline) {
        expect(result.rows[0]?.count).toBe(0);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
});
