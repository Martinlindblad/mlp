import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapSourceDocument } from '../../../migration/mappers';
import { parseSourceDocument } from '../../../migration/source-schemas';
import { migrateToLatest } from '../../../server/db/migrator';
import { createIsolatedDatabase } from '../../helpers/postgres';

describe('project migration mapper PostgreSQL round trip', () => {
  const isolated = createIsolatedDatabase();

  beforeAll(async () => {
    await isolated.start();
    await migrateToLatest(isolated.db);
  });

  afterAll(async () => isolated.stop());

  it('round-trips exact modern and legacy project detail keys through JSONB', async () => {
    const document = parseSourceDocument('projects_and_cases', {
      _id: new ObjectId('64b000000000000000000007'),
      title: 'Project',
      description: 'Description',
      imageSource: '/project.png',
      from: '',
      projectDetails: {
        headline: 'Project headline',
        description: 'Project description',
        videoID: '',
        videoTitle: 'Video',
        videoDescription: 'Description',
        imageSources: ['/modern.png'],
        imagesSources: ['/legacy.png'],
        roleDetails: ['Design', 'Development'],
        roleTitle: 'Role',
        links: [{ title: 'Visit', path: '/project' }],
        details: [{ title: 'Result', description: 'Shipped' }],
      },
    });
    const mapped = mapSourceDocument('projects_and_cases', document, 37);

    expect(typeof mapped.project_details).toBe('string');
    await isolated.db.insertInto('projects').values(mapped).execute();

    const selected = await isolated.db
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', document._id.toHexString())
      .executeTakeFirstOrThrow();

    expect(selected.project_details).toEqual(document.projectDetails);
    expect(selected.project_details).toMatchObject({
      imageSources: ['/modern.png'],
      imagesSources: ['/legacy.png'],
    });
    expect(selected.source_order).toBe(37);
    expect(selected.from_label).toBe('');
    expect(selected.to_label).toBeNull();
  });
});
