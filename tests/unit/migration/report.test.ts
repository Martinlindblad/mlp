import {
  lstat,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MigrationReport } from '../../../migration/importer';
import { reportPath, writeReport } from '../../../migration/report';

const originalRoot = process.env.MIGRATION_REPORT_ROOT;
const temporaryRoots = new Set<string>();

afterEach(async () => {
  if (originalRoot === undefined) delete process.env.MIGRATION_REPORT_ROOT;
  else process.env.MIGRATION_REPORT_ROOT = originalRoot;
  await Promise.all(
    Array.from(temporaryRoots).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  temporaryRoots.clear();
});

async function reportRoot(): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'mlp-report-test-'));
  temporaryRoots.add(parent);
  const root = path.join(parent, 'reports');
  process.env.MIGRATION_REPORT_ROOT = root;
  return root;
}

const validMigrationReport: MigrationReport = {
  generatedAt: '2026-07-14T12:00:00.000Z',
  collections: {
    contact: {
      count: 1,
      ids: ['64b000000000000000000001'],
      canonicalHash:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  },
};

describe('migration reports', () => {
  it('writes only validated DTOs as exclusive 0600 files under a 0700 root', async () => {
    const root = await reportRoot();
    const output = reportPath('20260714-migration.json');

    await writeReport(output, validMigrationReport);

    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(
      validMigrationReport,
    );
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    await expect(writeReport(output, validMigrationReport)).rejects.toThrow(
      'report write failed',
    );
  });

  it('resolves the root at call time and rejects traversal and stale paths', async () => {
    const firstRoot = await reportRoot();
    const stale = reportPath('stale.json');
    const secondRoot = path.join(path.dirname(firstRoot), 'second-root');
    process.env.MIGRATION_REPORT_ROOT = secondRoot;

    expect(reportPath('fresh.json')).toBe(path.join(secondRoot, 'fresh.json'));
    expect(() => reportPath('../outside.json')).toThrow(
      'invalid report filename',
    );
    await expect(writeReport(stale, validMigrationReport)).rejects.toThrow(
      'report path rejected',
    );
  });

  it('rejects symlinks and paths whose resolved parent escapes the root', async () => {
    const root = await reportRoot();
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'mlp-report-outside-'),
    );
    temporaryRoots.add(outside);
    await symlink(outside, root);

    const output = path.join(root, 'linked.json');
    await expect(writeReport(output, validMigrationReport)).rejects.toThrow(
      'report path rejected',
    );
    expect((await lstat(root)).isSymbolicLink()).toBe(true);
  });

  it.each([
    {
      fullName: 'PII_FULL_NAME_REPORT',
      email: 'pii-marker@example.test',
      subject: 'PII_SUBJECT_REPORT',
      message: 'PII_MESSAGE_REPORT',
    },
    { uri: 'mongodb+srv://person:password@cluster.invalid/database' },
    { password: 'PII_PASSWORD_REPORT' },
    { token: 'PII_TOKEN_REPORT' },
    { nested: { contact: 'pii-marker@example.test' } },
  ])(
    'rejects arbitrary document-like or sensitive report input',
    async (value) => {
      await reportRoot();
      const output = reportPath('unsafe.json');

      await expect(writeReport(output, value as never)).rejects.toThrow(
        'invalid report payload',
      );
      await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rejects unsorted, duplicate, or count-inconsistent report IDs', async () => {
    await reportRoot();
    const reports = [
      {
        generatedAt: '2026-07-14T12:00:00.000Z',
        collections: {
          about: {
            count: 2,
            ids: ['64b000000000000000000002', '64b000000000000000000001'],
            canonicalHash: 'a'.repeat(64),
          },
        },
      },
      {
        generatedAt: '2026-07-14T12:00:00.000Z',
        collections: {
          about: {
            count: 2,
            ids: ['64b000000000000000000001', '64b000000000000000000001'],
            canonicalHash: 'a'.repeat(64),
          },
        },
      },
      {
        generatedAt: '2026-07-14T12:00:00.000Z',
        collections: {
          about: {
            count: 9,
            ids: ['64b000000000000000000001'],
            canonicalHash: 'a'.repeat(64),
          },
        },
      },
    ];

    for (let index = 0; index < reports.length; index += 1) {
      const report = reports[index];
      await expect(
        writeReport(reportPath(`invalid-${index}.json`), report as never),
      ).rejects.toThrow('invalid report payload');
    }
  });

  it('removes only the newly created target after a partial write failure', async () => {
    await reportRoot();
    const output = reportPath('partial.json');
    let unlinkCalls = 0;

    await expect(
      writeReport(output, validMigrationReport, {
        async open(filePath, flags, mode) {
          const handle = await open(filePath, flags, mode);
          return {
            async writeFile(value) {
              await handle.writeFile(value.slice(0, 12));
              throw new Error('injected partial write failure');
            },
            async close() {
              await handle.close();
            },
          };
        },
        async unlink(filePath) {
          unlinkCalls += 1;
          await unlink(filePath);
        },
      }),
    ).rejects.toThrow('report write failed');

    expect(unlinkCalls).toBe(1);
    await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
