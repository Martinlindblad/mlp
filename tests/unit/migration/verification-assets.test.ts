import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { mapSourceDocument } from '../../../migration/mappers';
import { parseSourceDocument } from '../../../migration/source-schemas';
import { verifySnapshot } from '../../../migration/verification';

const verifySnapshotWithAssets = verifySnapshot as unknown as (
  db: unknown,
  snapshot: unknown,
  options: { publicRoot: string },
) => Promise<unknown>;

async function withTemporaryPublicRoot<T>(
  callback: (publicRoot: string) => Promise<T>,
): Promise<T> {
  const publicRoot = await mkdtemp(path.join(tmpdir(), 'mlp-verify-assets-'));
  try {
    return await callback(publicRoot);
  } finally {
    await rm(publicRoot, { force: true, recursive: true });
  }
}

function verificationFixture() {
  const ids = {
    about: new ObjectId('7f0000000000000000000001'),
    project: new ObjectId('7f0000000000000000000002'),
    pursuit: new ObjectId('7f0000000000000000000003'),
  };
  const assetUrl = (filename: string, suffix = '') =>
    ['', 'images', `${filename}${suffix}`].join('/');
  const urls = {
    aboutImage: assetUrl(
      'DO_NOT_LEAK_ABOUT_IMAGE.webp',
      '?token=DO_NOT_LEAK_QUERY',
    ),
    aboutProfile: assetUrl('DO_NOT_LEAK_ABOUT_PROFILE.webp', '#profile'),
    projectImage: assetUrl('DO_NOT_LEAK_PROJECT_IMAGE.webp'),
    projectModern: assetUrl('DO_NOT_LEAK_PROJECT_MODERN.webp', '?width=800'),
    projectLegacy: assetUrl('DO_NOT_LEAK_PROJECT_LEGACY.webp', '#legacy'),
    pursuitLeft: assetUrl('DO_NOT_LEAK_PURSUIT_LEFT.webp'),
    pursuitRight: assetUrl('DO_NOT_LEAK_PURSUIT_RIGHT.webp'),
  };
  const about = {
    _id: ids.about,
    title: 'About',
    info: 'DO_NOT_LEAK_SOURCE_CONTENT',
    name: 'Safe',
    surname: 'Identifier',
    key: 'about' as const,
    imageSource: urls.aboutImage,
    profileImage: urls.aboutProfile,
  };
  const projectSource = {
    _id: ids.project,
    title: 'Project',
    description: 'Project description',
    imageSource: urls.projectImage,
    projectDetails: {
      headline: 'Headline',
      description: 'Details',
      imageSources: [urls.projectModern],
      imagesSources: [urls.projectLegacy],
      roleDetails: [],
      roleTitle: '',
      links: [],
      details: [],
    },
  };
  const pursuit = {
    _id: ids.pursuit,
    title: 'Pursuit',
    description: 'Pursuit description',
    leftImageSource: urls.pursuitLeft,
    rightImageSource: urls.pursuitRight,
  };
  const aboutParsed = parseSourceDocument('about', about);
  const projectParsed = parseSourceDocument(
    'projects_and_cases',
    projectSource,
  );
  const pursuitParsed = parseSourceDocument('pursuit', pursuit);
  const mappedProject = mapSourceDocument(
    'projects_and_cases',
    projectParsed,
    3,
  );
  const selectedProject = {
    ...mappedProject,
    project_details: JSON.parse(mappedProject.project_details),
  };
  const rowsByTable = new Map<string, unknown[]>([
    ['profile_sections', [mapSourceDocument('about', aboutParsed, 2)]],
    ['projects', [selectedProject]],
    ['pursuits', [mapSourceDocument('pursuit', pursuitParsed, 4)]],
  ]);
  const db = {
    selectFrom(table: string) {
      const rows = rowsByTable.get(table);
      if (!rows) throw new Error(`unexpected table: ${table}`);
      const query = {
        execute: async () => rows,
        selectAll() {
          return query;
        },
      };
      return query;
    },
  };

  return {
    db,
    ids,
    snapshot: {
      about: [{ sourceOrder: 2, value: about }],
      projects_and_cases: [{ sourceOrder: 3, value: projectSource }],
      pursuit: [{ sourceOrder: 4, value: pursuit }],
    },
    urls,
  };
}

async function captureFailure(operation: () => Promise<unknown>) {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('migration verification asset integration', () => {
  it('returns deterministic redacted issues for all seven missing asset fields', async () => {
    await withTemporaryPublicRoot(async (publicRoot) => {
      const fixture = verificationFixture();
      const expectedIssues = [
        {
          code: 'asset_missing',
          collection: 'about',
          id: fixture.ids.about.toHexString(),
          path: 'imageSource',
        },
        {
          code: 'asset_missing',
          collection: 'about',
          id: fixture.ids.about.toHexString(),
          path: 'profileImage',
        },
        {
          code: 'asset_missing',
          collection: 'projects_and_cases',
          id: fixture.ids.project.toHexString(),
          path: 'imageSource',
        },
        {
          code: 'asset_missing',
          collection: 'projects_and_cases',
          id: fixture.ids.project.toHexString(),
          path: 'projectDetails.imageSources[0]',
        },
        {
          code: 'asset_missing',
          collection: 'projects_and_cases',
          id: fixture.ids.project.toHexString(),
          path: 'projectDetails.imagesSources[0]',
        },
        {
          code: 'asset_missing',
          collection: 'pursuit',
          id: fixture.ids.pursuit.toHexString(),
          path: 'leftImageSource',
        },
        {
          code: 'asset_missing',
          collection: 'pursuit',
          id: fixture.ids.pursuit.toHexString(),
          path: 'rightImageSource',
        },
      ];
      const runVerification = () =>
        verifySnapshotWithAssets(fixture.db, fixture.snapshot, { publicRoot });
      const failures = await Promise.all([
        captureFailure(runVerification),
        captureFailure(runVerification),
      ]);

      for (const failure of failures) {
        expect(failure).toMatchObject({ name: 'MigrationValidationError' });
        const issues = (failure as { issues: unknown[] }).issues;
        expect(issues).toEqual(expectedIssues);
        for (const issue of issues as Record<string, unknown>[]) {
          expect(Object.keys(issue).sort()).toEqual([
            'code',
            'collection',
            'id',
            'path',
          ]);
        }
        const serialized = JSON.stringify(failure);
        for (const value of Object.values(fixture.urls)) {
          expect(serialized).not.toContain(value);
        }
        expect(serialized).not.toContain(['', 'images', ''].join('/'));
        expect(serialized).not.toContain('DO_NOT_LEAK');
        expect(serialized).not.toContain('image_source');
        expect(serialized).not.toContain('project_details');
      }
    });
  });

  it('accepts all seven asset fields when every exact file exists', async () => {
    await withTemporaryPublicRoot(async (publicRoot) => {
      const fixture = verificationFixture();
      for (const value of Object.values(fixture.urls)) {
        const urlPath = value.split(/[?#]/, 1)[0];
        const filesystemPath = path.join(publicRoot, urlPath.slice(1));
        await mkdir(path.dirname(filesystemPath), { recursive: true });
        await writeFile(filesystemPath, 'valid fixture asset');
      }

      await expect(
        verifySnapshotWithAssets(fixture.db, fixture.snapshot, { publicRoot }),
      ).resolves.toMatchObject({
        valid: true,
        collections: {
          about: { hashMatch: true },
          projects_and_cases: { hashMatch: true },
          pursuit: { hashMatch: true },
        },
      });
    });
  });
});
