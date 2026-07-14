import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  canonicalDestinationRow,
  canonicalHash,
  canonicalSourceRow,
} from '../../../migration/canonical';
import { parseSourceDocument } from '../../../migration/source-schemas';

interface ProjectCanonical {
  _id: string;
  projectDetails: {
    headline: string;
    description: string;
    videoID: string;
    videoTitle: string;
    videoDescription: string;
    imageSources: string[];
    imagesSources: string[];
    roleDetails: string[];
    roleTitle: string;
    links: { title: string; path: string }[];
    details: { title: string; description: string }[];
  };
}

function projectCanonicalFixture(): ProjectCanonical {
  return {
    _id: '64b000000000000000000007',
    projectDetails: {
      headline: 'Headline',
      description: 'Description',
      videoID: 'video',
      videoTitle: 'Video title',
      videoDescription: 'Video description',
      imageSources: ['/modern.png'],
      imagesSources: ['/legacy.png'],
      roleDetails: ['Role detail'],
      roleTitle: 'Role',
      links: [{ title: 'Visit', path: '/project' }],
      details: [{ title: 'Result', description: 'Shipped' }],
    },
  };
}

describe('canonical public adapters', () => {
  it('produces equal source and destination shapes for all ten collections', () => {
    const projectDetails = {
      headline: 'Project headline',
      description: 'Project description',
      videoID: '',
      videoTitle: 'Video',
      videoDescription: 'Description',
      imageSources: [],
      imagesSources: ['/legacy.png'],
      roleDetails: ['Design'],
      roleTitle: 'Role',
      links: [{ title: 'Visit', path: '/project' }],
      details: [{ title: 'Result', description: 'Shipped' }],
    };

    const pairs = [
      [
        canonicalSourceRow(
          'about',
          parseSourceDocument('about', {
            _id: new ObjectId('64b000000000000000000001'),
            title: '',
            info: '',
            name: '',
            surname: '',
            key: 'about',
            description: [],
            imageSource: '',
          }),
        ),
        canonicalDestinationRow('about', {
          id: '64b000000000000000000001',
          source_order: 10,
          title: '',
          info: '',
          name: '',
          surname: '',
          key: 'about',
          description: [],
          image_source: '',
          link: null,
          link_text: null,
          profile_image: null,
        }),
      ],
      [
        canonicalSourceRow(
          'current_occupation',
          parseSourceDocument('current_occupation', {
            _id: new ObjectId('64b000000000000000000002'),
            title: 'Developer',
            occupationType: 'Employment',
            description: 'Description',
            from: '2024',
            to: '',
            introduction: 'Introduction',
            name: 'Company',
            link: '',
          }),
        ),
        canonicalDestinationRow('current_occupation', {
          id: '64b000000000000000000002',
          source_order: 11,
          title: 'Developer',
          occupation_type: 'Employment',
          description: 'Description',
          from_label: '2024',
          to_label: '',
          introduction: 'Introduction',
          name: 'Company',
          link: '',
        }),
      ],
      [
        canonicalSourceRow(
          'hobbys',
          parseSourceDocument('hobbys', {
            _id: new ObjectId('64b000000000000000000003'),
            title: 'Japanese',
            content: '',
            type: 'japanese',
          }),
        ),
        canonicalDestinationRow('hobbys', {
          id: '64b000000000000000000003',
          source_order: 12,
          title: 'Japanese',
          content: '',
          type: 'japanese',
        }),
      ],
      [
        canonicalSourceRow(
          'languages',
          parseSourceDocument('languages', {
            _id: new ObjectId('64b000000000000000000004'),
            name: 'Swedish',
            spoken: 'Native',
            written: 'Native',
          }),
        ),
        canonicalDestinationRow('languages', {
          id: '64b000000000000000000004',
          source_order: 13,
          name: 'Swedish',
          spoken: 'Native',
          written: 'Native',
        }),
      ],
      [
        canonicalSourceRow(
          'page_cards',
          parseSourceDocument('page_cards', {
            _id: new ObjectId('64b000000000000000000005'),
            title: 'About',
            description: 'Description',
            link: '/about',
            key: 'about',
            type: 'introdcution',
          }),
        ),
        canonicalDestinationRow('page_cards', {
          id: '64b000000000000000000005',
          source_order: 14,
          title: 'About',
          description: 'Description',
          link: '/about',
          content: null,
          key: 'about',
          type: 'introdcution',
        }),
      ],
      [
        canonicalSourceRow(
          'proffessional_timeline',
          parseSourceDocument('proffessional_timeline', {
            _id: new ObjectId('64b000000000000000000006'),
            duration: '2020–2022',
            title: 'Course',
            description: 'Description',
            index: 3,
          }),
        ),
        canonicalDestinationRow('proffessional_timeline', {
          id: '64b000000000000000000006',
          source_order: 15,
          company: null,
          institution: null,
          qualification: null,
          duration: '2020–2022',
          title: 'Course',
          description: 'Description',
          sort_index: 3,
        }),
      ],
      [
        canonicalSourceRow(
          'projects_and_cases',
          parseSourceDocument('projects_and_cases', {
            _id: new ObjectId('64b000000000000000000007'),
            title: 'Project',
            description: 'Description',
            imageSource: '/project.png',
            to: '',
            projectDetails,
          }),
        ),
        canonicalDestinationRow('projects_and_cases', {
          id: '64b000000000000000000007',
          source_order: 16,
          title: 'Project',
          description: 'Description',
          image_source: '/project.png',
          from_label: null,
          to_label: '',
          project_details: projectDetails,
        }),
      ],
      [
        canonicalSourceRow(
          'pursuit',
          parseSourceDocument('pursuit', {
            _id: new ObjectId('64b000000000000000000008'),
            title: 'Learning',
            description: 'Description',
            leftImageSource: '/left.png',
            rightImageSource: '/right.png',
          }),
        ),
        canonicalDestinationRow('pursuit', {
          id: '64b000000000000000000008',
          source_order: 17,
          title: 'Learning',
          description: 'Description',
          left_image_source: '/left.png',
          right_image_source: '/right.png',
        }),
      ],
      [
        canonicalSourceRow(
          'social_media',
          parseSourceDocument('social_media', {
            _id: new ObjectId('64b000000000000000000009'),
            name: 'Github',
            link: '',
          }),
        ),
        canonicalDestinationRow('social_media', {
          id: '64b000000000000000000009',
          source_order: 18,
          name: 'Github',
          link: '',
        }),
      ],
      [
        canonicalSourceRow(
          'contact',
          parseSourceDocument('contact', {
            _id: new ObjectId('64b00000000000000000000a'),
            fullname: 'Legacy Name',
            email: 'person@example.test',
            subject: 'Hello',
            message: 'Message',
            date: new Date('2024-02-03T04:05:06.789Z'),
          }),
        ),
        canonicalDestinationRow('contact', {
          id: '64b00000000000000000000a',
          full_name: 'Legacy Name',
          email: 'person@example.test',
          subject: 'Hello',
          message: 'Message',
          created_at: new Date('2024-02-03T04:05:06.789Z'),
        }),
      ],
    ];

    pairs.forEach(([source, destination]) =>
      expect(source).toEqual(destination),
    );
    expect(pairs[4][0]).not.toHaveProperty('content');
    expect(pairs[6][0]).not.toHaveProperty('from');
    expect(pairs[6][0]).toHaveProperty('to', '');
    expect(pairs[9][0]).toEqual({
      _id: '64b00000000000000000000a',
      fullName: 'Legacy Name',
      email: 'person@example.test',
      subject: 'Hello',
      message: 'Message',
      date: '2024-02-03T04:05:06.789Z',
    });
  });
});

describe('canonical hashes', () => {
  it('is independent of input row order and object insertion order', () => {
    const left = [
      { _id: 'b', nested: { alpha: 1, beta: 2 }, value: 'second' },
      { _id: 'a', value: 'first', nested: { beta: 2, alpha: 1 } },
    ];
    const right = [
      { nested: { alpha: 1, beta: 2 }, value: 'first', _id: 'a' },
      { value: 'second', nested: { beta: 2, alpha: 1 }, _id: 'b' },
    ];

    expect(canonicalHash(left)).toBe(canonicalHash(right));
    expect(canonicalHash(left)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses Unicode code-point ordering rather than locale or UTF-16 ordering', () => {
    const row = {
      _id: 'a',
      '\u{10000}': 'astral',
      '\uE000': 'private-use',
    };
    const codePointOrdered = JSON.stringify([
      {
        _id: 'a',
        '\uE000': 'private-use',
        '\u{10000}': 'astral',
      },
    ]);
    const expected = createHash('sha256')
      .update(codePointOrdered)
      .digest('hex');

    expect(canonicalHash([row])).toBe(expected);
  });

  it('serializes integer-like object keys in Unicode code-point order', () => {
    const expected = createHash('sha256')
      .update('[{"10":"ten","2":"two","_id":"a"}]')
      .digest('hex');

    expect(canonicalHash([{ _id: 'a', 2: 'two', 10: 'ten' }])).toBe(expected);
  });

  it('is order-independent even when duplicate row ids differ', () => {
    const first = [
      { _id: 'same', value: 'beta' },
      { _id: 'same', value: 'alpha' },
    ];

    expect(canonicalHash(first)).toBe(canonicalHash([...first].reverse()));
  });

  it('keeps array order significant', () => {
    const row = { _id: 'a', values: ['first', 'second'] };
    const reordered = { _id: 'a', values: ['second', 'first'] };

    expect(canonicalHash([row])).not.toBe(canonicalHash([reordered]));
  });

  it('is sensitive to empty strings and date milliseconds', () => {
    const absent = { _id: 'a' };
    const empty = { _id: 'a', value: '' };
    const firstDate = {
      _id: 'a',
      date: new Date('2024-02-03T04:05:06.789Z'),
    };
    const secondDate = {
      _id: 'a',
      date: new Date('2024-02-03T04:05:06.790Z'),
    };

    expect(canonicalHash([absent])).not.toBe(canonicalHash([empty]));
    expect(canonicalHash([firstDate])).not.toBe(canonicalHash([secondDate]));
  });

  it.each([
    [
      'headline',
      (row: ProjectCanonical) => {
        row.projectDetails.headline = 'Changed';
      },
    ],
    [
      'description',
      (row: ProjectCanonical) => {
        row.projectDetails.description = 'Changed';
      },
    ],
    [
      'videoID',
      (row: ProjectCanonical) => {
        row.projectDetails.videoID = 'Changed';
      },
    ],
    [
      'videoTitle',
      (row: ProjectCanonical) => {
        row.projectDetails.videoTitle = 'Changed';
      },
    ],
    [
      'videoDescription',
      (row: ProjectCanonical) => {
        row.projectDetails.videoDescription = 'Changed';
      },
    ],
    [
      'imageSources',
      (row: ProjectCanonical) => {
        row.projectDetails.imageSources[0] = 'Changed';
      },
    ],
    [
      'imagesSources',
      (row: ProjectCanonical) => {
        row.projectDetails.imagesSources[0] = 'Changed';
      },
    ],
    [
      'roleDetails',
      (row: ProjectCanonical) => {
        row.projectDetails.roleDetails[0] = 'Changed';
      },
    ],
    [
      'roleTitle',
      (row: ProjectCanonical) => {
        row.projectDetails.roleTitle = 'Changed';
      },
    ],
    [
      'links.title',
      (row: ProjectCanonical) => {
        row.projectDetails.links[0].title = 'Changed';
      },
    ],
    [
      'links.path',
      (row: ProjectCanonical) => {
        row.projectDetails.links[0].path = 'Changed';
      },
    ],
    [
      'details.title',
      (row: ProjectCanonical) => {
        row.projectDetails.details[0].title = 'Changed';
      },
    ],
    [
      'details.description',
      (row: ProjectCanonical) => {
        row.projectDetails.details[0].description = 'Changed';
      },
    ],
  ] as const)('changes when projectDetails.%s changes', (_field, mutate) => {
    const baseline = projectCanonicalFixture();
    const changed = structuredClone(baseline);
    mutate(changed);

    expect(canonicalHash([baseline])).not.toBe(canonicalHash([changed]));
  });
});
