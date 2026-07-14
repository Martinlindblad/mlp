import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withSourceDatabase } from '../../../migration/mongo-client';

const originalUriFile = process.env.MONGO_URI_FILE;
const originalDatabase = process.env.MONGO_DATABASE;
const temporaryRoots = new Set<string>();

afterEach(async () => {
  if (originalUriFile === undefined) delete process.env.MONGO_URI_FILE;
  else process.env.MONGO_URI_FILE = originalUriFile;
  if (originalDatabase === undefined) delete process.env.MONGO_DATABASE;
  else process.env.MONGO_DATABASE = originalDatabase;
  await Promise.all(
    Array.from(temporaryRoots).map((temporaryRootPath) =>
      rm(temporaryRootPath, { recursive: true, force: true }),
    ),
  );
  temporaryRoots.clear();
});

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), 'mlp-mongo-client-'));
  temporaryRoots.add(value);
  return value;
}

describe('migration source client configuration', () => {
  it('redacts a missing secret-file path', async () => {
    const directory = await root();
    const missing = path.join(directory, 'PII_MISSING_SECRET_FILE');
    process.env.MONGO_URI_FILE = missing;
    process.env.MONGO_DATABASE = 'PII_DATABASE_NAME';

    let failure: unknown;
    try {
      await withSourceDatabase(async () => undefined);
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(
      new Error('migration source configuration invalid'),
    );
    expect(JSON.stringify(failure)).not.toContain(missing);
    expect(JSON.stringify(failure)).not.toContain('PII_DATABASE_NAME');
  });

  it('rejects group-readable and multiline URI files generically', async () => {
    const directory = await root();
    const uriFile = path.join(directory, 'mongo-uri');
    process.env.MONGO_URI_FILE = uriFile;
    process.env.MONGO_DATABASE = 'portfolio_source';
    await writeFile(
      uriFile,
      'mongodb://operator:PII_URI_SECRET@mongo.invalid/mlp\nsecond-line\n',
      { mode: 0o600 },
    );
    await chmod(uriFile, 0o640);

    await expect(withSourceDatabase(async () => undefined)).rejects.toThrow(
      'migration source configuration invalid',
    );
    await chmod(uriFile, 0o600);
    await expect(withSourceDatabase(async () => undefined)).rejects.toThrow(
      'migration source configuration invalid',
    );
  });
});
