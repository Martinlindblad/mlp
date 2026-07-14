import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const commandTimeoutMs = 10_000;
const postgresBinaries = [
  'initdb',
  'pg_ctl',
  'psql',
  'createdb',
  'postgres',
] as const;
const repositoryRoot = path.resolve(__dirname, '../../..');
const bootstrapScript = path.join(
  repositoryRoot,
  'infra/postgres/init-roles.sh',
);

interface CommandResult {
  error?: Error;
  status: number | null;
  stderr: string;
  stdout: string;
}

interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface PostgresAvailability {
  available: boolean;
  reason: string;
}

function run(
  command: string,
  args: string[],
  options: CommandOptions = {},
): CommandResult {
  const result = spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    timeout: commandTimeoutMs,
  });
  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function runWithoutControllingTerminal(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      detached: true,
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
    }, 10_000);
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

function requireSuccess(result: CommandResult, operation: string): void {
  if (result.error || result.status !== 0) {
    throw new Error(`PostgreSQL 18 bootstrap test ${operation} failed`);
  }
}

function detectPostgres18(): PostgresAvailability {
  if (process.platform === 'win32') {
    return { available: false, reason: 'POSIX process support is required' };
  }

  for (const binary of postgresBinaries) {
    const result = run(binary, ['--version']);
    if (result.error || result.status !== 0) {
      return { available: false, reason: `${binary} is unavailable` };
    }
    if (!/\b18\.4(?:\s|\)|$)/.test(`${result.stdout}${result.stderr}`)) {
      return { available: false, reason: `${binary} is not PostgreSQL 18.4` };
    }
  }

  return { available: true, reason: '' };
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve a PostgreSQL test port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function query(port: number, statement: string): string {
  const result = run('psql', [
    '-X',
    '-h',
    '127.0.0.1',
    '-p',
    String(port),
    '-U',
    'postgres',
    '-d',
    'portfolio',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ]);
  requireSuccess(result, 'query');
  return result.stdout.trim();
}

function databaseAclTuples(port: number): string[] {
  const output = query(
    port,
    `select
       case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
       acl.privilege_type,
       acl.is_grantable,
       grantor.rolname
     from pg_database database
     cross join lateral aclexplode(
       coalesce(database.datacl, acldefault('d', database.datdba))
     ) acl
     left join pg_roles grantee on grantee.oid = acl.grantee
     join pg_roles grantor on grantor.oid = acl.grantor
     where database.datname = current_database()
     order by 1, 2, 3, 4`,
  );
  return output.split('\n');
}

function assertNoPlaintextSecrets(
  secrets: string[],
  capturedSources: string[],
): void {
  const leaked = secrets.some((secret) =>
    capturedSources.some((source) => source.includes(secret)),
  );
  if (leaked) throw new Error('Plaintext PostgreSQL role secret was exposed');
}

function assertTemporarySqlRemoved(directory: string): void {
  const remains = fs
    .readdirSync(directory)
    .some((name) => name.startsWith('portfolio-init.'));
  if (remains) throw new Error('PostgreSQL bootstrap temporary SQL remained');
}

function executablePath(command: string): string | undefined {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.resolve(directory || '.', command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return undefined;
}

function createLateFailurePsqlWrapper(directory: string): void {
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(
    path.join(directory, 'psql'),
    [
      '#!/bin/sh',
      'set -eu',
      "sql_file=''",
      'for argument do',
      '  case "$argument" in',
      '    --file=*) sql_file=${argument#--file=} ;;',
      '  esac',
      'done',
      'if [ -z "$sql_file" ]; then',
      "  printf '%s\\n' 'Expected bootstrap SQL file argument' >&2",
      '  exit 1',
      'fi',
      "awk '",
      '  $0 == "commit;" {',
      '    print "select portfolio_test_force_late_failure();"',
      '  }',
      '  { print }',
      '\' "$sql_file" >"$sql_file.injected"',
      'mv "$sql_file.injected" "$sql_file"',
      'exec "$POSTGRES_TEST_REAL_PSQL" "$@"',
      '',
    ].join('\n'),
    { mode: 0o700 },
  );
}

const availability = detectPostgres18();
const postgresDescribe = availability.available ? describe : describe.skip;

postgresDescribe(
  availability.available
    ? 'PostgreSQL 18 role bootstrap'
    : `PostgreSQL 18 role bootstrap (skipped: ${availability.reason})`,
  () => {
    it('rolls back failures and creates leak-free least-privilege roles', async () => {
      const port = await reserveLoopbackPort();
      const runtime = fs.mkdtempSync(
        path.join(os.tmpdir(), 'mlp-pg18-bootstrap-'),
      );
      const data = path.join(runtime, 'data');
      const serverLog = path.join(runtime, 'postgres.log');
      const secretDirectory = path.join(runtime, 'secrets');
      const sqlDirectory = path.join(runtime, 'sql');
      const wrapperDirectory = path.join(runtime, 'bin');
      let serverStarted = false;

      try {
        fs.mkdirSync(secretDirectory, { mode: 0o700 });
        fs.mkdirSync(sqlDirectory, { mode: 0o700 });
        createLateFailurePsqlWrapper(wrapperDirectory);

        const realPsql = executablePath('psql');
        if (!realPsql) {
          throw new Error('PostgreSQL bootstrap test psql is unavailable');
        }

        const secrets = ['migrator', 'app', 'backup'].map(
          (role) => `MLP_PG18_${role}_${randomBytes(32).toString('hex')}`,
        );
        const secretFiles = [
          'postgres-migrator-password',
          'postgres-app-password',
          'postgres-backup-password',
        ];
        secretFiles.forEach((name, index) => {
          fs.writeFileSync(
            path.join(secretDirectory, name),
            `${secrets[index]}\n`,
            { mode: 0o600 },
          );
        });

        const bootstrapEnvironment: NodeJS.ProcessEnv = {
          ...process.env,
          PGHOST: '127.0.0.1',
          PGPORT: String(port),
          POSTGRES_DB: 'portfolio',
          POSTGRES_SECRET_DIR: secretDirectory,
          POSTGRES_USER: 'postgres',
          TMPDIR: sqlDirectory,
        };
        const runBootstrap = (
          env: NodeJS.ProcessEnv = bootstrapEnvironment,
        ): Promise<CommandResult> =>
          runWithoutControllingTerminal('/bin/sh', [bootstrapScript], {
            cwd: repositoryRoot,
            env,
          });

        requireSuccess(
          run('initdb', [
            '-D',
            data,
            '-U',
            'postgres',
            '--auth-local=trust',
            '--auth-host=trust',
            '--no-locale',
          ]),
          'initialization',
        );
        const startResult = run('pg_ctl', [
          '-D',
          data,
          '-l',
          serverLog,
          '-o',
          `-h 127.0.0.1 -p ${port} -c log_statement=all`,
          '-w',
          'start',
        ]);
        serverStarted =
          startResult.status === 0 ||
          fs.existsSync(path.join(data, 'postmaster.pid'));
        requireSuccess(startResult, 'startup');
        requireSuccess(
          run('createdb', [
            '-h',
            '127.0.0.1',
            '-p',
            String(port),
            '-U',
            'postgres',
            '-O',
            'postgres',
            'portfolio',
          ]),
          'database creation',
        );
        expect(query(port, 'show server_version')).toMatch(/^18\.4(?:\s|$)/);

        const failedBootstrap = await runBootstrap({
          ...bootstrapEnvironment,
          PATH: `${wrapperDirectory}${path.delimiter}${
            bootstrapEnvironment.PATH ?? ''
          }`,
          POSTGRES_TEST_REAL_PSQL: realPsql,
        });
        const failedClientOutput = `${failedBootstrap.stdout}${failedBootstrap.stderr}`;
        assertNoPlaintextSecrets(secrets, [
          failedClientOutput,
          fs.readFileSync(serverLog, 'utf8'),
        ]);
        expect(failedClientOutput).toContain(
          'portfolio_test_force_late_failure',
        );
        expect(failedBootstrap.error).toBeUndefined();
        expect(failedBootstrap.status).toBe(3);
        assertTemporarySqlRemoved(sqlDirectory);
        expect(
          query(
            port,
            `select
                 count(*) filter (
                   where rolname in (
                     'portfolio_migrator', 'portfolio_app', 'portfolio_backup'
                   )
                 ),
                 (select pg_get_userbyid(datdba) from pg_database
                  where datname = current_database())
               from pg_roles`,
          ),
        ).toBe('0|postgres');
        expect(databaseAclTuples(port)).toEqual([
          'PUBLIC|CONNECT|f|postgres',
          'PUBLIC|TEMPORARY|f|postgres',
          'postgres|CONNECT|f|postgres',
          'postgres|CREATE|f|postgres',
          'postgres|TEMPORARY|f|postgres',
        ]);

        const successfulBootstrap = await runBootstrap();
        const successfulClientOutput = `${successfulBootstrap.stdout}${successfulBootstrap.stderr}`;
        assertNoPlaintextSecrets(secrets, [
          failedClientOutput,
          successfulClientOutput,
          fs.readFileSync(serverLog, 'utf8'),
        ]);
        if (successfulBootstrap.status !== 0) {
          throw new Error('PostgreSQL role bootstrap clean run failed');
        }
        assertTemporarySqlRemoved(sqlDirectory);

        expect(
          query(
            port,
            `select
                 pg_get_userbyid(datdba),
                 rol.rolsuper,
                 rol.rolcreatedb,
                 rol.rolcreaterole,
                 rol.rolreplication,
                 rol.rolbypassrls,
                 rol.rolcanlogin,
                 (select count(*) from pg_authid
                  where rolname in (
                    'portfolio_migrator', 'portfolio_app', 'portfolio_backup'
                  ) and rolpassword like 'SCRAM-SHA-256$%')
               from pg_database
               cross join pg_roles rol
               where datname = current_database()
               and rol.rolname = 'portfolio_migrator'`,
          ),
        ).toBe('portfolio_migrator|f|f|f|f|f|t|3');
        expect(databaseAclTuples(port)).toEqual([
          'portfolio_app|CONNECT|f|portfolio_migrator',
          'portfolio_backup|CONNECT|f|portfolio_migrator',
          'portfolio_migrator|CONNECT|f|portfolio_migrator',
          'portfolio_migrator|CREATE|f|portfolio_migrator',
          'portfolio_migrator|TEMPORARY|f|portfolio_migrator',
        ]);
      } finally {
        try {
          if (serverStarted) {
            requireSuccess(
              run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']),
              'shutdown',
            );
          }
        } finally {
          fs.rmSync(runtime, { force: true, recursive: true });
        }
      }
    }, 30_000);
  },
);
