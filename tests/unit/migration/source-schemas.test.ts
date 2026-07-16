import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { MigrationValidationError } from '../../../migration/errors';
import type { SourceCollection } from '../../../migration/source-collections';
import {
  allowedSourceKeys,
  parseSourceDocument,
} from '../../../migration/source-schemas';

const ids = {
  about: '64b000000000000000000001',
  current_occupation: '64b000000000000000000002',
  hobbys: '64b000000000000000000003',
  languages: '64b000000000000000000004',
  page_cards: '64b000000000000000000005',
  proffessional_timeline: '64b000000000000000000006',
  projects_and_cases: '64b000000000000000000007',
  pursuit: '64b000000000000000000008',
  social_media: '64b000000000000000000009',
  contact: '64b00000000000000000000a',
} as const satisfies Record<SourceCollection, string>;

const validFixtures = {
  about: {
    _id: new ObjectId(ids.about),
    title: 'Hej',
    info: 'Portfolio',
    name: 'Martin',
    surname: 'Lindblad',
    key: 'introduction',
  },
  current_occupation: {
    _id: new ObjectId(ids.current_occupation),
    title: 'Developer',
    occupationType: 'Employment',
    description: 'Builds products',
    from: '2024',
    to: 'Present',
    introduction: 'Current role',
    name: 'Example AB',
    link: 'https://example.test',
  },
  hobbys: {
    _id: new ObjectId(ids.hobbys),
    title: 'Japanese',
    content: 'Language studies',
    type: 'japanese',
  },
  languages: {
    _id: new ObjectId(ids.languages),
    name: 'Swedish',
    spoken: 'Native',
    written: 'Native',
  },
  page_cards: {
    _id: new ObjectId(ids.page_cards),
    title: 'About',
    description: 'Read more',
    link: '/about',
    key: 'about',
    type: 'introdcution',
  },
  proffessional_timeline: {
    _id: new ObjectId(ids.proffessional_timeline),
    institution: 'University',
    duration: '2020–2022',
    title: 'Programme',
    description: 'Studies',
    index: 3,
  },
  projects_and_cases: {
    _id: new ObjectId(ids.projects_and_cases),
    title: 'Portfolio',
    description: 'A project',
    imageSource: '/portfolio.png',
    projectDetails: {
      headline: 'Portfolio headline',
      description: 'Project details',
      videoID: 'video-id',
      videoTitle: 'Video title',
      videoDescription: 'Video description',
      imageSources: ['/modern.png'],
      imagesSources: ['/legacy.png'],
      roleDetails: ['Design', 'Development'],
      roleTitle: 'Role',
      links: [{ title: 'Visit', path: 'https://example.test/project' }],
      details: [{ title: 'Result', description: 'Shipped' }],
    },
  },
  pursuit: {
    _id: new ObjectId(ids.pursuit),
    title: 'Learning',
    description: 'Always learning',
    leftImageSource: '/left.png',
    rightImageSource: '/right.png',
  },
  social_media: {
    _id: new ObjectId(ids.social_media),
    name: 'Github',
    link: 'https://github.com/example',
  },
  contact: {
    _id: new ObjectId(ids.contact),
    fullName: 'Example Person',
    email: 'person@example.test',
    subject: 'Hello',
    message: 'A private message',
    date: new Date('2024-02-03T04:05:06.789Z'),
  },
} satisfies Record<SourceCollection, Record<string, unknown>>;

const entries = Object.entries(validFixtures) as [
  SourceCollection,
  Record<string, unknown>,
][];

function validationError(
  collection: SourceCollection,
  input: unknown,
): MigrationValidationError {
  try {
    parseSourceDocument(collection, input);
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationValidationError);
    return error as MigrationValidationError;
  }
  throw new Error('expected source parsing to fail');
}

describe('strict source schemas', () => {
  it.each(entries)(
    'accepts a valid %s source document',
    (collection, input) => {
      expect(parseSourceDocument(collection, input)).toEqual(input);
    },
  );

  it.each(entries)(
    'rejects an unknown top-level field in %s',
    (collection, input) => {
      const error = validationError(collection, {
        ...input,
        unexpected: 'private value',
      });

      expect(error.issues).toEqual(
        expect.arrayContaining([
          {
            collection,
            id: ids[collection],
            code: 'unknown_field',
            path: '<unknown>',
          },
        ]),
      );
    },
  );

  it.each([
    ['about', 'title'],
    ['current_occupation', 'title'],
    ['hobbys', 'content'],
    ['languages', 'spoken'],
    ['page_cards', 'description'],
    ['proffessional_timeline', 'duration'],
    ['projects_and_cases', 'title'],
    ['pursuit', 'leftImageSource'],
    ['social_media', 'link'],
    ['contact', 'date'],
  ] as const)('rejects a missing required %s.%s field', (collection, field) => {
    const input: Record<string, unknown> = { ...validFixtures[collection] };
    delete input[field];

    expect(() => parseSourceDocument(collection, input)).toThrow(
      MigrationValidationError,
    );
  });

  it.each([
    ['project', { ...validFixtures.projects_and_cases, unknownProject: true }],
    [
      'projectDetails',
      {
        ...validFixtures.projects_and_cases,
        projectDetails: {
          ...validFixtures.projects_and_cases.projectDetails,
          unknownDetails: true,
        },
      },
    ],
    [
      'projectDetails.links[]',
      {
        ...validFixtures.projects_and_cases,
        projectDetails: {
          ...validFixtures.projects_and_cases.projectDetails,
          links: [{ title: 'Visit', path: '/project', unknownLink: true }],
        },
      },
    ],
    [
      'projectDetails.details[]',
      {
        ...validFixtures.projects_and_cases,
        projectDetails: {
          ...validFixtures.projects_and_cases.projectDetails,
          details: [
            { title: 'Result', description: 'Shipped', unknownDetail: true },
          ],
        },
      },
    ],
  ])('rejects unknown fields at the %s boundary', (_label, input) => {
    expect(() => parseSourceDocument('projects_and_cases', input)).toThrow(
      MigrationValidationError,
    );
  });

  it('reports only redacted structural issues', () => {
    const error = validationError('projects_and_cases', {
      ...validFixtures.projects_and_cases,
      projectDetails: {
        ...validFixtures.projects_and_cases.projectDetails,
        details: [
          {
            title: 42,
            description: 'mongodb://private-user:private-pass@private-host',
          },
        ],
        'person@example.test': 'A private value',
      },
    });

    expect(error.message).toMatch(
      /^migration validation failed with \d+ issue\(s\)$/,
    );
    expect(error.issues).toEqual(
      expect.arrayContaining([
        {
          collection: 'projects_and_cases',
          id: ids.projects_and_cases,
          code: 'invalid_value',
          path: 'projectDetails.details.0.title',
        },
        {
          collection: 'projects_and_cases',
          id: ids.projects_and_cases,
          code: 'unknown_field',
          path: 'projectDetails.<unknown>',
        },
      ]),
    );

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain('person@example.test');
    expect(serialized).not.toContain('private-user');
    expect(serialized).not.toContain('private-pass');
    expect(serialized).not.toContain('private-host');
    expect(serialized).not.toContain('A private value');
    expect(serialized).not.toContain('ZodError');
  });

  it('uses a safe id marker when the source id cannot be trusted', () => {
    const error = validationError('contact', {
      ...validFixtures.contact,
      _id: '64b00000000000000000000a',
    });

    expect(error.issues.every((issue) => issue.id === 'unknown')).toBe(true);
  });

  it('accepts either contact name spelling separately and rejects both together', () => {
    const common = {
      _id: new ObjectId(ids.contact),
      email: 'person@example.test',
      subject: 'Hello',
      message: 'Message',
      date: new Date('2024-02-03T04:05:06.789Z'),
    };

    expect(
      parseSourceDocument('contact', { ...common, fullName: 'Full Name' }),
    ).toHaveProperty('fullName', 'Full Name');
    expect(
      parseSourceDocument('contact', { ...common, fullname: 'Legacy Name' }),
    ).toHaveProperty('fullname', 'Legacy Name');
    expect(() =>
      parseSourceDocument('contact', {
        ...common,
        fullName: 'Full Name',
        fullname: 'Legacy Name',
      }),
    ).toThrow(MigrationValidationError);
  });

  it.each([
    ['about', { ...validFixtures.about, key: 'unknown' }],
    ['hobbys', { ...validFixtures.hobbys, type: 'unknown' }],
    ['page_cards key', { ...validFixtures.page_cards, key: 'unknown' }],
    ['page_cards type', { ...validFixtures.page_cards, type: 'introduction' }],
    ['social_media', { ...validFixtures.social_media, name: 'GitHub' }],
  ])('rejects values outside the closed %s set', (label, input) => {
    const collection = label.startsWith('page_cards')
      ? 'page_cards'
      : (label as SourceCollection);
    expect(() => parseSourceDocument(collection, input)).toThrow(
      MigrationValidationError,
    );
  });

  it('preserves empty strings, optional absence, and date milliseconds', () => {
    const pageCard = parseSourceDocument('page_cards', {
      ...validFixtures.page_cards,
      content: '',
    });
    const project = parseSourceDocument('projects_and_cases', {
      ...validFixtures.projects_and_cases,
      from: '',
      to: '',
    });
    const timeline = parseSourceDocument('proffessional_timeline', {
      ...validFixtures.proffessional_timeline,
      duration: '',
    });
    const contact = parseSourceDocument('contact', validFixtures.contact);

    expect(pageCard).toHaveProperty('content', '');
    expect(project).toMatchObject({ from: '', to: '' });
    expect(timeline.duration).toBe('');
    expect(contact.date.toISOString()).toBe('2024-02-03T04:05:06.789Z');
    expect(
      parseSourceDocument('page_cards', validFixtures.page_cards),
    ).not.toHaveProperty('content');
  });

  it('normalizes legacy timeline integer strings without accepting loose numbers', () => {
    const parsed = parseSourceDocument('proffessional_timeline', {
      ...validFixtures.proffessional_timeline,
      index: '6',
    });

    expect(parsed.index).toBe(6);
    for (const index of [' 6', '6 ', '6.5', '', 'six']) {
      expect(() =>
        parseSourceDocument('proffessional_timeline', {
          ...validFixtures.proffessional_timeline,
          index,
        }),
      ).toThrow(MigrationValidationError);
    }
  });

  it('exposes only registered top-level source keys', () => {
    expect(Array.from(allowedSourceKeys('contact')).sort()).toEqual([
      '_id',
      'date',
      'email',
      'fullName',
      'fullname',
      'message',
      'subject',
    ]);
    expect(allowedSourceKeys('projects_and_cases')).not.toContain('unknown');
  });
});
