import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_COLLECTIONS,
  SOURCE_COLLECTIONS,
} from '../../../migration/source-collections';
import { mapSourceDocument } from '../../../migration/mappers';
import { parseSourceDocument } from '../../../migration/source-schemas';

describe('source collection registry', () => {
  it('maps exactly the ten legacy collections to destination tables', () => {
    expect(SOURCE_COLLECTIONS).toEqual({
      about: 'profile_sections',
      current_occupation: 'current_occupations',
      hobbys: 'hobbies',
      languages: 'languages',
      page_cards: 'page_cards',
      proffessional_timeline: 'professional_timeline',
      projects_and_cases: 'projects',
      pursuit: 'pursuits',
      social_media: 'social_links',
      contact: 'contact_messages',
    });
    expect(CONTENT_COLLECTIONS).toEqual([
      'about',
      'current_occupation',
      'hobbys',
      'languages',
      'page_cards',
      'proffessional_timeline',
      'projects_and_cases',
      'pursuit',
      'social_media',
    ]);
  });
});

describe('explicit source-to-destination mappers', () => {
  it('maps a profile section and converts optional absence to SQL null', () => {
    const document = parseSourceDocument('about', {
      _id: new ObjectId('64b000000000000000000001'),
      title: '',
      info: '',
      name: '',
      surname: '',
      key: 'introduction',
    });

    expect(mapSourceDocument('about', document, 17)).toEqual({
      id: '64b000000000000000000001',
      source_order: 17,
      key: 'introduction',
      title: '',
      info: '',
      name: '',
      surname: '',
      description: null,
      image_source: null,
      link: null,
      link_text: null,
      profile_image: null,
    });
  });

  it('maps current occupation including the required title and text dates', () => {
    const document = parseSourceDocument('current_occupation', {
      _id: new ObjectId('64b000000000000000000002'),
      title: 'Developer',
      occupationType: 'Employment',
      description: 'Description',
      from: 'not-a-date',
      to: '',
      introduction: 'Introduction',
      name: 'Company',
      link: '',
    });

    expect(mapSourceDocument('current_occupation', document, 18)).toEqual({
      id: '64b000000000000000000002',
      source_order: 18,
      title: 'Developer',
      occupation_type: 'Employment',
      description: 'Description',
      from_label: 'not-a-date',
      to_label: '',
      introduction: 'Introduction',
      name: 'Company',
      link: '',
    });
  });

  it('maps hobby and language rows with exact source order', () => {
    const hobby = parseSourceDocument('hobbys', {
      _id: new ObjectId('64b000000000000000000003'),
      title: 'Japanese',
      content: '',
      type: 'japanese',
    });
    const language = parseSourceDocument('languages', {
      _id: new ObjectId('64b000000000000000000004'),
      name: 'Swedish',
      spoken: 'Native',
      written: 'Native',
    });

    expect(mapSourceDocument('hobbys', hobby, 19)).toEqual({
      id: '64b000000000000000000003',
      source_order: 19,
      title: 'Japanese',
      content: '',
      type: 'japanese',
    });
    expect(mapSourceDocument('languages', language, 20)).toEqual({
      id: '64b000000000000000000004',
      source_order: 20,
      name: 'Swedish',
      spoken: 'Native',
      written: 'Native',
    });
  });

  it('maps absent page-card content to null while preserving an empty string', () => {
    const base = {
      _id: new ObjectId('64b000000000000000000005'),
      title: 'About',
      description: 'Description',
      link: '/about',
      key: 'about',
      type: 'introdcution',
    };

    const absent = mapSourceDocument(
      'page_cards',
      parseSourceDocument('page_cards', base),
      21,
    );
    const empty = mapSourceDocument(
      'page_cards',
      parseSourceDocument('page_cards', { ...base, content: '' }),
      22,
    );

    expect(absent).toEqual({
      id: '64b000000000000000000005',
      source_order: 21,
      title: 'About',
      description: 'Description',
      link: '/about',
      content: null,
      key: 'about',
      type: 'introdcution',
    });
    expect(empty.content).toBe('');
    expect(empty.source_order).toBe(22);
  });

  it('maps timeline optional values to null and leaves duration as text', () => {
    const document = parseSourceDocument('proffessional_timeline', {
      _id: new ObjectId('64b000000000000000000006'),
      duration: '',
      title: 'Course',
      description: 'Description',
      index: 7,
    });

    expect(mapSourceDocument('proffessional_timeline', document, 23)).toEqual({
      id: '64b000000000000000000006',
      source_order: 23,
      company: null,
      institution: null,
      qualification: null,
      duration: '',
      title: 'Course',
      description: 'Description',
      sort_index: 7,
    });
  });

  it('maps independent project date absence and stringifies exact project details', () => {
    const projectDetails = {
      headline: 'Project',
      description: 'Description',
      videoID: '',
      videoTitle: '',
      videoDescription: '',
      imageSources: [],
      imagesSources: ['/legacy.png'],
      roleDetails: [],
      roleTitle: '',
      links: [],
      details: [],
    };
    const withoutFrom = parseSourceDocument('projects_and_cases', {
      _id: new ObjectId('64b000000000000000000007'),
      title: 'Project',
      description: 'Description',
      imageSource: '/image.png',
      to: '',
      projectDetails,
    });

    const mapped = mapSourceDocument('projects_and_cases', withoutFrom, 24);

    expect(mapped).toEqual({
      id: '64b000000000000000000007',
      source_order: 24,
      title: 'Project',
      description: 'Description',
      image_source: '/image.png',
      from_label: null,
      to_label: '',
      project_details: JSON.stringify(withoutFrom.projectDetails),
    });
    expect(JSON.parse(mapped.project_details)).toEqual(projectDetails);
    expect(JSON.parse(mapped.project_details)).toHaveProperty('imagesSources', [
      '/legacy.png',
    ]);
    expect(JSON.parse(mapped.project_details)).toHaveProperty(
      'imageSources',
      [],
    );
  });

  it('maps pursuit and social rows without changing empty values', () => {
    const pursuit = parseSourceDocument('pursuit', {
      _id: new ObjectId('64b000000000000000000008'),
      title: '',
      description: '',
      leftImageSource: '',
      rightImageSource: '',
    });
    const social = parseSourceDocument('social_media', {
      _id: new ObjectId('64b000000000000000000009'),
      name: 'LinkedIn',
      link: '',
    });

    expect(mapSourceDocument('pursuit', pursuit, 25)).toEqual({
      id: '64b000000000000000000008',
      source_order: 25,
      title: '',
      description: '',
      left_image_source: '',
      right_image_source: '',
    });
    expect(mapSourceDocument('social_media', social, 26)).toEqual({
      id: '64b000000000000000000009',
      source_order: 26,
      name: 'LinkedIn',
      link: '',
    });
  });

  it.each([
    ['fullName', { fullName: 'Modern Name' }, 'Modern Name'],
    ['fullname', { fullname: 'Legacy Name' }, 'Legacy Name'],
  ] as const)(
    'maps contact %s without source_order and preserves milliseconds',
    (_spelling, nameField, expectedName) => {
      const document = parseSourceDocument('contact', {
        _id: new ObjectId('64b00000000000000000000a'),
        ...nameField,
        email: 'person@example.test',
        subject: 'Hello',
        message: 'Message',
        date: new Date('2024-02-03T04:05:06.789Z'),
      });

      const mapped = mapSourceDocument('contact', document, 91);

      expect(mapped).toEqual({
        id: '64b00000000000000000000a',
        full_name: expectedName,
        email: 'person@example.test',
        subject: 'Hello',
        message: 'Message',
        created_at: new Date('2024-02-03T04:05:06.789Z'),
      });
      expect(mapped).not.toHaveProperty('source_order');
    },
  );
});
