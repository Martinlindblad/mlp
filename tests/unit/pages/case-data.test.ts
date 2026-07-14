import { describe, expect, it, vi } from 'vitest';
import {
  buildCaseStaticPaths,
  buildCaseStaticProps,
} from '../../../server/pages/case-data';
import type { ProjectRepository } from '../../../server/repositories/project-repository';

const project = {
  id: '64b000000000000000000006',
  source_order: 3,
  title: 'Project',
  description: 'Description',
  image_source: '/image.png',
  from_label: null,
  to_label: 'Present',
  project_details: {
    headline: 'Legacy project',
    description: 'Project description',
    roleDetails: ['Developer'],
    roleTitle: 'Role',
    details: [{ title: 'Detail', description: 'Detail description' }],
  },
};

function createRepository(
  overrides: Partial<ProjectRepository> = {},
): ProjectRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    listIds: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('case page data', () => {
  it('maps project IDs to blocking static paths', async () => {
    const repository = createRepository({
      listIds: vi
        .fn()
        .mockResolvedValue(['64b000000000000000000001', 'legacy-id']),
    });

    await expect(buildCaseStaticPaths(() => repository)).resolves.toEqual({
      paths: [
        { params: { id: '64b000000000000000000001' } },
        { params: { id: 'legacy-id' } },
      ],
      fallback: 'blocking',
    });
  });

  it('returns no build-time paths when database settings are absent', async () => {
    await expect(
      buildCaseStaticPaths(() => {
        throw new Error('Missing database setting: DATABASE_HOST');
      }),
    ).resolves.toEqual({ paths: [], fallback: 'blocking' });
  });

  it('does not hide unexpected build-time database errors', async () => {
    await expect(
      buildCaseStaticPaths(() => {
        throw new Error('postgres host secret');
      }),
    ).rejects.toThrow('postgres host secret');
  });

  it('returns notFound for an unknown project ID', async () => {
    const repository = createRepository();

    await expect(buildCaseStaticProps(repository, 'missing')).resolves.toEqual({
      notFound: true,
    });
  });

  it('serializes a found project and enables five-second revalidation', async () => {
    const repository = createRepository({
      findById: vi.fn().mockResolvedValue(project),
    });

    await expect(buildCaseStaticProps(repository, project.id)).resolves.toEqual(
      {
        props: {
          caseData: {
            _id: project.id,
            title: project.title,
            description: project.description,
            imageSource: project.image_source,
            to: project.to_label,
            projectDetails: project.project_details,
          },
        },
        revalidate: 5,
      },
    );
    expect(repository.findById).toHaveBeenCalledWith(project.id);
  });
});
