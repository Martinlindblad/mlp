import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PostgreSQL role bootstrap', () => {
  const scriptPath = path.resolve(
    __dirname,
    '../../../infra/postgres/init-roles.sh',
  );
  const script = fs.readFileSync(scriptPath, 'utf8');
  const sqlBody = script.match(/<<'SQL'\n([\s\S]*?)\nSQL/)?.[1];

  it('atomically creates constrained roles and transfers database ownership', () => {
    expect(sqlBody).toBeDefined();
    const begin = sqlBody?.indexOf('begin;') ?? -1;
    const createMigrator =
      sqlBody?.indexOf(
        'create role portfolio_migrator login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;',
      ) ?? -1;
    const createApp = sqlBody?.indexOf('create role portfolio_app') ?? -1;
    const createBackup = sqlBody?.indexOf('create role portfolio_backup') ?? -1;
    const transferOwnership =
      sqlBody?.indexOf(
        'alter database :"db_name" owner to portfolio_migrator;',
      ) ?? -1;
    const revokePublic =
      sqlBody?.indexOf(
        'revoke connect, temporary on database :"db_name" from public;',
      ) ?? -1;
    const grant =
      sqlBody?.indexOf(
        'grant connect on database :"db_name" to portfolio_migrator, portfolio_app, portfolio_backup;',
      ) ?? -1;
    const commit = sqlBody?.indexOf('commit;') ?? -1;

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(createMigrator).toBeGreaterThan(begin);
    expect(createApp).toBeGreaterThan(createMigrator);
    expect(createBackup).toBeGreaterThan(createApp);
    expect(transferOwnership).toBeGreaterThan(createBackup);
    expect(revokePublic).toBeGreaterThan(transferOwnership);
    expect(grant).toBeGreaterThan(revokePublic);
    expect(commit).toBeGreaterThan(grant);
    expect(sqlBody).not.toContain('alter role :"migrator_role"');
  });

  it('uses POSIX shell and six client-side password prompts', () => {
    const promptStart = script.lastIndexOf(
      "printf '%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n'",
    );
    const promptEnd = script.indexOf('|\n  psql', promptStart);
    const promptInput = script.slice(promptStart, promptEnd);

    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain('set -eu');
    expect(script).toContain('${POSTGRES_SECRET_DIR:-/run/secrets}');
    expect(script).toContain('mktemp');
    expect(script).toContain('trap cleanup 0');
    expect(script).toContain('--file="$sql_file"');
    expect(script).toContain('postgres-migrator-password');
    expect(sqlBody).toContain('\\password portfolio_migrator');
    expect(sqlBody).toContain('\\password portfolio_app');
    expect(sqlBody).toContain('\\password portfolio_backup');
    expect(promptStart).toBeGreaterThanOrEqual(0);
    expect(promptEnd).toBeGreaterThan(promptStart);
    expect(promptInput.match(/"\$migrator_password"/g)).toHaveLength(2);
    expect(promptInput.match(/"\$app_password"/g)).toHaveLength(2);
    expect(promptInput.match(/"\$backup_password"/g)).toHaveLength(2);
    expect(sqlBody).not.toContain('migrator_password');
    expect(sqlBody).not.toContain('app_password');
    expect(sqlBody).not.toContain('backup_password');
    expect(script).not.toContain('--set=migrator_password');
    expect(script).not.toContain('--set=app_password');
    expect(script).not.toContain('--set=backup_password');
  });

  it.each(['portfolio_migrator', 'portfolio_app', 'portfolio_backup'])(
    'rejects reserved bootstrap role %s before reading secrets',
    (postgresUser) => {
      const result = spawnSync('/bin/sh', [scriptPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          POSTGRES_DB: 'portfolio',
          POSTGRES_SECRET_DIR: '/does/not/exist',
          POSTGRES_USER: postgresUser,
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'POSTGRES_USER must name a dedicated bootstrap administrator',
      );
      expect(result.stderr).not.toContain('/does/not/exist');
    },
  );
});
