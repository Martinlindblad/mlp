import type { Kysely, Selectable } from 'kysely';
import { READ_LIMITS } from '../api/contracts';
import type { Database, ProjectsTable } from '../db/database.types';

export interface ProjectRepository {
  list(): Promise<Selectable<ProjectsTable>[]>;
  listIds(): Promise<string[]>;
  findById(id: string): Promise<Selectable<ProjectsTable> | undefined>;
}

export function createProjectRepository(
  db: Kysely<Database>,
): ProjectRepository {
  return {
    list: () =>
      db
        .selectFrom('projects')
        .selectAll()
        .orderBy('source_order', 'asc')
        .limit(READ_LIMITS.projectsAndCases)
        .execute(),
    listIds: async () =>
      (
        await db
          .selectFrom('projects')
          .select('id')
          .orderBy('source_order', 'asc')
          .execute()
      ).map(({ id }) => id),
    findById: (id) =>
      db
        .selectFrom('projects')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst(),
  };
}
