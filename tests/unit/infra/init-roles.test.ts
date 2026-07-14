import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const commandTimeoutMs = 5_000;
const ttyError = 'PostgreSQL role bootstrap requires a non-interactive session';

interface PtyInvocation {
  command: string;
  args: string[];
}

interface ChildResult {
  error?: Error;
  status: number | null;
  stderr: string;
  stdout: string;
}

function runWithoutControllingTerminal(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = commandTimeoutMs,
): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let childError: Error | undefined;
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      childError = error;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          childError =
            error instanceof Error
              ? error
              : new Error('Unable to terminate PostgreSQL bootstrap child');
          child.kill('SIGKILL');
        }
      }
    }, timeoutMs);
    child.once('close', (status) => {
      clearTimeout(timeout);
      resolve({
        error: timedOut
          ? new Error('PostgreSQL bootstrap child timed out')
          : childError,
        status,
        stderr,
        stdout,
      });
    });
  });
}

function ptyInvocation(scriptPath: string): PtyInvocation | undefined {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/script')) {
    return {
      command: '/usr/bin/script',
      args: ['-q', '-e', '/dev/null', '/bin/sh', scriptPath],
    };
  }

  if (process.platform === 'linux') {
    const command = ['/usr/bin/script', '/bin/script'].find(fs.existsSync);
    const version = command
      ? spawnSync(command, ['--version'], {
          encoding: 'utf8',
          killSignal: 'SIGKILL',
          timeout: commandTimeoutMs,
        })
      : undefined;
    if (
      command &&
      version?.status === 0 &&
      /util-linux/i.test(`${version.stdout}${version.stderr}`)
    ) {
      return {
        command,
        args: [
          '-q',
          '-e',
          '-c',
          'exec /bin/sh "$INIT_ROLES_TEST_SCRIPT"',
          '/dev/null',
        ],
      };
    }
  }

  return undefined;
}

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

  it('checks for a controlling terminal before reading secrets', () => {
    const ttyProbe = script.indexOf('(: </dev/tty) 2>/dev/null');
    const firstSecretRead = script.indexOf('postgres-migrator-password');

    expect(ttyProbe).toBeGreaterThanOrEqual(0);
    expect(firstSecretRead).toBeGreaterThan(ttyProbe);
    expect(script).toContain(ttyError);
    expect(script).not.toContain('setsid');
  });

  it('continues to secret reads without a controlling terminal', async () => {
    const result = await runWithoutControllingTerminal(
      '/bin/sh',
      [scriptPath],
      {
        ...process.env,
        POSTGRES_DB: 'portfolio',
        POSTGRES_SECRET_DIR: '/does/not/exist',
        POSTGRES_USER: 'postgres',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain(ttyError);
    expect(result.stderr).toContain(
      '/does/not/exist/postgres-migrator-password',
    );
  });

  it('bounds detached children and kills their process groups', async () => {
    const runtime = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mlp-process-group-'),
    );
    const orphanMarker = path.join(runtime, 'orphaned');

    try {
      const result = await runWithoutControllingTerminal(
        '/bin/sh',
        ['-c', '(sleep 1; : >"$ORPHAN_MARKER") & sleep 2'],
        { ...process.env, ORPHAN_MARKER: orphanMarker },
        100,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 1_100);
      });

      expect(result.error?.message).toBe(
        'PostgreSQL bootstrap child timed out',
      );
      expect(fs.existsSync(orphanMarker)).toBe(false);
    } finally {
      fs.rmSync(runtime, { force: true, recursive: true });
    }
  }, 4_000);

  const pty = ptyInvocation(scriptPath);
  const controllingTerminalTest = pty ? it : it.skip;
  controllingTerminalTest(
    pty
      ? 'rejects a controlling terminal before reading secrets'
      : 'rejects a controlling terminal (skipped: no supported script utility)',
    () => {
      if (!pty) return;

      const result = spawnSync(pty.command, pty.args, {
        encoding: 'utf8',
        env: {
          ...process.env,
          INIT_ROLES_TEST_SCRIPT: scriptPath,
          POSTGRES_DB: 'portfolio',
          POSTGRES_SECRET_DIR: '/does/not/exist',
          POSTGRES_USER: 'postgres',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        killSignal: 'SIGKILL',
        timeout: 5_000,
      });
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain(ttyError);
      expect(output).not.toContain('/does/not/exist');
    },
  );

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
        killSignal: 'SIGKILL',
        timeout: commandTimeoutMs,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'POSTGRES_USER must name a dedicated bootstrap administrator',
      );
      expect(result.stderr).not.toContain('/does/not/exist');
    },
  );
});
