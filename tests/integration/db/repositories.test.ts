import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { READ_LIMITS } from '../../../server/api/contracts';
import { migrateToLatest } from '../../../server/db/migrator';
import {
  createContentRepository,
  type ContentRepository,
} from '../../../server/repositories/content-repository';
import {
  createProjectRepository,
  type ProjectRepository,
} from '../../../server/repositories/project-repository';
import { createIsolatedDatabase } from '../../helpers/postgres';

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
