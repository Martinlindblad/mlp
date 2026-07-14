import { describe, expect, it } from 'vitest';
import {
  serializeCurrentOccupation,
  serializeHobby,
  serializeLanguage,
  serializePageCard,
  serializeProfileSection,
  serializeProject,
  serializePursuit,
  serializeSocialLink,
  serializeTimeline,
} from '../../../server/api/serializers';

describe('legacy serializers', () => {
  it('maps snake_case and omits SQL null without exposing source order', () => {
    expect(
      serializeProfileSection({
        id: '64b000000000000000000001',
        source_order: 4,
        key: 'introduction',
        title: 'Hej',
        info: 'Portfolio',
        name: 'Martin',
        surname: 'Lindblad',
        description: null,
        image_source: null,
        link: null,
        link_text: null,
        profile_image: null,
      }),
    ).toEqual({
      _id: '64b000000000000000000001',
      key: 'introduction',
      title: 'Hej',
      info: 'Portfolio',
      name: 'Martin',
      surname: 'Lindblad',
    });
  });

  it('preserves empty profile values while mapping every optional field', () => {
    expect(
      serializeProfileSection({
        id: '64b000000000000000000002',
        source_order: 0,
        key: 'about',
        title: '',
        info: '',
        name: '',
        surname: '',
        description: [],
        image_source: '',
        link: '',
        link_text: '',
        profile_image: '',
      }),
    ).toEqual({
      _id: '64b000000000000000000002',
      key: 'about',
      title: '',
      info: '',
      name: '',
      surname: '',
      description: [],
      imageSource: '',
      link: '',
      linkText: '',
      profileImage: '',
    });
  });

  it('maps timeline sort_index to index', () => {
    expect(
      serializeTimeline({
        id: '64b000000000000000000003',
        source_order: 0,
        company: null,
        institution: 'School',
        qualification: null,
        duration: '2020–2022',
        title: 'Course',
        description: 'Description',
        sort_index: 7,
      }),
    ).toEqual({
      _id: '64b000000000000000000003',
      institution: 'School',
      duration: '2020–2022',
      title: 'Course',
      description: 'Description',
      index: 7,
    });
  });

  it('preserves the required current occupation title', () => {
    expect(
      serializeCurrentOccupation({
        id: '64b000000000000000000004',
        source_order: 9,
        title: 'Current role',
        occupation_type: 'Employment',
        description: 'Description',
        from_label: '2024',
        to_label: 'Present',
        introduction: 'Introduction',
        name: 'Company',
        link: '',
      }),
    ).toEqual({
      _id: '64b000000000000000000004',
      title: 'Current role',
      occupationType: 'Employment',
      description: 'Description',
      from: '2024',
      to: 'Present',
      introduction: 'Introduction',
      name: 'Company',
      link: '',
    });
  });

  it('omits a null page-card content field but preserves an empty string', () => {
    const base = {
      id: '64b000000000000000000005',
      source_order: 1,
      title: 'About',
      description: 'Description',
      link: '/about',
      key: 'about',
      type: 'introdcution',
    };

    expect(serializePageCard({ ...base, content: null })).toEqual({
      _id: '64b000000000000000000005',
      title: 'About',
      description: 'Description',
      link: '/about',
      key: 'about',
      type: 'introdcution',
    });
    expect(serializePageCard({ ...base, content: '' })).toHaveProperty(
      'content',
      '',
    );
  });

  it('omits null project dates and preserves legacy project detail keys', () => {
    const projectDetails = {
      headline: 'Legacy project',
      description: 'Description',
      imagesSources: ['/legacy-image.png'],
      roleDetails: [],
      roleTitle: 'Role',
      details: [],
    };

    expect(
      serializeProject({
        id: '64b000000000000000000006',
        source_order: 3,
        title: 'Project',
        description: 'Description',
        image_source: '/image.png',
        from_label: null,
        to_label: null,
        project_details: projectDetails,
      }),
    ).toEqual({
      _id: '64b000000000000000000006',
      title: 'Project',
      description: 'Description',
      imageSource: '/image.png',
      projectDetails,
    });
  });

  it('maps the remaining content shapes without storage metadata', () => {
    expect(
      serializeHobby({
        id: '64b000000000000000000007',
        source_order: 1,
        title: 'Photography',
        content: 'Cameras',
        type: 'japanese',
      }),
    ).toEqual({
      _id: '64b000000000000000000007',
      title: 'Photography',
      content: 'Cameras',
      type: 'japanese',
    });
    expect(
      serializeLanguage({
        id: '64b000000000000000000008',
        source_order: 2,
        name: 'Swedish',
        spoken: 'Native',
        written: 'Native',
      }),
    ).toEqual({
      _id: '64b000000000000000000008',
      name: 'Swedish',
      spoken: 'Native',
      written: 'Native',
    });
    expect(
      serializePursuit({
        id: '64b000000000000000000009',
        source_order: 3,
        title: 'Pursuit',
        description: 'Description',
        left_image_source: '/left.png',
        right_image_source: '/right.png',
      }),
    ).toEqual({
      _id: '64b000000000000000000009',
      title: 'Pursuit',
      description: 'Description',
      leftImageSource: '/left.png',
      rightImageSource: '/right.png',
    });
    expect(
      serializeSocialLink({
        id: '64b00000000000000000000a',
        source_order: 4,
        name: 'Github',
        link: 'https://github.com/example',
      }),
    ).toEqual({
      _id: '64b00000000000000000000a',
      name: 'Github',
      link: 'https://github.com/example',
    });
  });
});
