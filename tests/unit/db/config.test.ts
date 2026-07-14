import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDatabaseConfig } from '../../../server/db/config';

describe('database configuration', () => {
  let directory: string;
  let passwordFile: string;

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'mlp-db-config-'));
    passwordFile = path.join(directory, 'password');
    writeFileSync(passwordFile, 'file-secret\n', { mode: 0o600 });
  });

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  function validEnv(
    overrides: Partial<NodeJS.ProcessEnv> = {},
  ): NodeJS.ProcessEnv {
    return {
      NODE_ENV: 'test',
      PGHOST: ' database ',
      PGDATABASE: ' portfolio ',
      PGUSER: ' application ',
      PGPASSWORD_FILE: ` ${passwordFile} `,
      ...overrides,
    };
  }

  it('keeps defaults and trims numeric settings', () => {
    expect(loadDatabaseConfig(validEnv())).toEqual({
      host: 'database',
      port: 5432,
      database: 'portfolio',
      user: 'application',
      password: 'file-secret',
      maxConnections: 5,
      connectionTimeoutMillis: 5000,
    });

    expect(
      loadDatabaseConfig(
        validEnv({
          PGPORT: ' 65535 ',
          PGPOOL_MAX: ' 12 ',
          PGCONNECT_TIMEOUT_MS: ' 7500 ',
        }),
      ),
    ).toMatchObject({
      port: 65535,
      maxConnections: 12,
      connectionTimeoutMillis: 7500,
    });
  });

  it.each([
    ['PGPORT', 'not-a-number'],
    ['PGPORT', '0'],
    ['PGPORT', '65536'],
    ['PGPORT', '1.5'],
    ['PGPOOL_MAX', '0'],
    ['PGPOOL_MAX', '-1'],
    ['PGPOOL_MAX', '2.5'],
    ['PGCONNECT_TIMEOUT_MS', '0'],
    ['PGCONNECT_TIMEOUT_MS', 'Infinity'],
    ['PGCONNECT_TIMEOUT_MS', '1.5'],
  ])('rejects invalid %s without exposing its value', (setting, value) => {
    expect(() => loadDatabaseConfig(validEnv({ [setting]: value }))).toThrow(
      new Error(`Invalid database setting: ${setting}`),
    );
  });
});
