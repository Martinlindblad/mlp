import type { GetStaticPathsResult, GetStaticPropsResult } from 'next';
import type { CasePageProps } from '../../types/DBTypes';
import { serializeProject } from '../api/serializers';
import type { ProjectRepository } from '../repositories/project-repository';

export async function buildCaseStaticPaths(
  createRepository: () => ProjectRepository,
): Promise<GetStaticPathsResult> {
  try {
    const repository = createRepository();
    return {
      paths: (await repository.listIds()).map((id) => ({ params: { id } })),
      fallback: 'blocking',
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Missing database setting:')
    ) {
      return { paths: [], fallback: 'blocking' };
    }
    throw error;
  }
}

export async function buildCaseStaticProps(
  repository: ProjectRepository,
  id: string,
): Promise<GetStaticPropsResult<CasePageProps>> {
  const row = await repository.findById(id);
  if (!row) return { notFound: true };

  return {
    props: { caseData: serializeProject(row) },
    revalidate: 5,
  };
}
