import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectDetailsSchema } from '../../../migration/source-schemas';

const repositoryRoot = path.resolve(__dirname, '../../..');
const seedScript = path.join(repositoryRoot, 'tests/fixtures/seed-postgres.ts');
const tsxCommand = path.join(repositoryRoot, 'node_modules/.bin/tsx');
const postgresCommands = ['createdb', 'initdb', 'pg_ctl', 'psql'] as const;
const projectId = '64b000000000000000000009';
const contentTables = [
  'current_occupations',
  'hobbies',
  'languages',
  'page_cards',
  'professional_timeline',
  'profile_sections',
  'projects',
  'pursuits',
  'social_links',
] as const;
const expectedIds = {
  current_occupations: ['64b000000000000000000002'],
  hobbies: ['64b000000000000000000003'],
  languages: ['64b000000000000000000004'],
  page_cards: ['64b000000000000000000005'],
  professional_timeline: ['64b000000000000000000006'],
  profile_sections: ['64b000000000000000000001'],
  projects: [projectId],
  pursuits: ['64b000000000000000000008'],
  social_links: ['64b000000000000000000007'],
} as const;
const projectDetails = {
  headline: 'Legacy portfolio case',
  description: 'A deterministic browser acceptance fixture.',
  videoID: '',
  videoTitle: '',
  videoDescription: '',
  imageSources: ['/images/cases/livsstilsverktyget.webp'],
  imagesSources: ['/images/cases/imaginecare.webp'],
  roleDetails: ['Frontend development'],
  roleTitle: 'Role',
  links: [{ title: 'Case', path: `/cases/${projectId}` }],
  details: [{ title: 'Result', description: 'Acceptance fixture ready.' }],
};

interface CommandResult {
  error?: Error;
  status: number | null;
  stderr: string;
  stdout: string;
}

interface SeedSnapshot {
  contactCount: number;
  ids: Record<(typeof contentTables)[number], string[]>;
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env,
    killSignal: 'SIGKILL',
    timeout: 30_000,
  });
  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function requireSuccess(result: CommandResult, operation: string): void {
  if (result.error || result.status !== 0) {
    throw new Error(`PostgreSQL seed contract ${operation} failed`);
  }
}

function readPostmasterPid(data: string): number | undefined {
  try {
    const firstLine = fs
      .readFileSync(path.join(data, 'postmaster.pid'), 'utf8')
      .split(/\r?\n/, 1)[0];
    if (!firstLine || !/^[1-9]\d*$/.test(firstLine)) return undefined;
    const pid = Number(firstLine);
    return Number.isSafeInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
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

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise((resolve) => {
      setTimeout(resolve, Math.min(25, remainingMs));
    });
  }
  return true;
}

function detectPostgres18(): { available: boolean; reason: string } {
  if (process.platform === 'win32') {
    return { available: false, reason: 'POSIX PostgreSQL is required' };
  }
  for (const command of postgresCommands) {
    const result = run(command, ['--version']);
    if (result.error || result.status !== 0) {
      return { available: false, reason: `${command} is unavailable` };
    }
    if (!/\b18\.\d+(?:\s|\)|$)/.test(`${result.stdout}${result.stderr}`)) {
      return { available: false, reason: `${command} is not PostgreSQL 18` };
    }
  }
  return { available: true, reason: '' };
}

async function reserveLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve a PostgreSQL seed test port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function snapshot(client: Client): Promise<SeedSnapshot> {
  const ids = {} as Record<(typeof contentTables)[number], string[]>;
  for (const table of contentTables) {
    const result = await client.query<{ id: string }>(
      `select id from ${table} order by source_order, id`,
    );
    ids[table] = result.rows.map(({ id }) => id);
  }
  const contacts = await client.query<{ count: number }>(
    'select count(*)::int as count from contact_messages',
  );
  return { contactCount: contacts.rows[0]?.count ?? -1, ids };
}

const availability = detectPostgres18();
const postgresDescribe = availability.available ? describe : describe.skip;

postgresDescribe(
  availability.available
    ? 'deterministic PostgreSQL browser seed'
    : `deterministic PostgreSQL browser seed (skipped: ${availability.reason})`,
  () => {
    let client: Client | undefined;
    let data = '';
    let postmasterPid: number | undefined;
    let runtime = '';
    let serverStartAttempted = false;
    let seedEnvironment: NodeJS.ProcessEnv;

    async function stopPostgresRuntime(): Promise<void> {
      if (!serverStartAttempted) return;
      postmasterPid ??= readPostmasterPid(data);
      if (postmasterPid !== undefined && isProcessAlive(postmasterPid)) {
        for (const mode of ['fast', 'immediate'] as const) {
          run('pg_ctl', ['-D', data, '-m', mode, '-t', '2', '-w', 'stop']);
          if (await waitForProcessExit(postmasterPid, 250)) break;
        }
      }
      if (postmasterPid !== undefined && isProcessAlive(postmasterPid)) {
        try {
          process.kill(postmasterPid, 'SIGTERM');
        } catch {
          // The liveness proof below decides whether cleanup may continue.
        }
        await waitForProcessExit(postmasterPid, 2_000);
      }
      if (postmasterPid !== undefined && isProcessAlive(postmasterPid)) {
        try {
          process.kill(postmasterPid, 'SIGKILL');
        } catch {
          // The liveness proof below decides whether cleanup may continue.
        }
        await waitForProcessExit(postmasterPid, 2_000);
      }
      if (postmasterPid !== undefined && isProcessAlive(postmasterPid)) {
        throw new Error('PostgreSQL seed postmaster remained alive');
      }
      const status = run('pg_ctl', ['-D', data, 'status']);
      if (status.error || status.status !== 3) {
        throw new Error('PostgreSQL seed shutdown could not be proven');
      }
      postmasterPid = undefined;
      serverStartAttempted = false;
    }

    async function cleanRuntime(): Promise<void> {
      let cleanupError: unknown;
      if (client) {
        try {
          await client.end();
        } catch (error) {
          cleanupError = error;
        } finally {
          client = undefined;
        }
      }
      try {
        await stopPostgresRuntime();
      } catch (error) {
        cleanupError ??= error;
      }
      if (serverStartAttempted) {
        throw new Error('PostgreSQL seed contract cleanup failed', {
          cause: cleanupError,
        });
      }
      if (runtime) {
        try {
          fs.rmSync(runtime, { force: true, recursive: true });
          data = '';
          runtime = '';
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (cleanupError) {
        throw new Error('PostgreSQL seed contract cleanup failed', {
          cause: cleanupError,
        });
      }
    }

    beforeAll(async () => {
      const port = await reserveLoopbackPort();
      runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-seed-pg18-'));
      data = path.join(runtime, 'data');
      const log = path.join(runtime, 'postgres.log');
      const passwordFile = path.join(runtime, 'migrator-password');
      fs.writeFileSync(passwordFile, 'seed-test-only\n', { mode: 0o600 });
      try {
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
        serverStartAttempted = true;
        const startResult = run('pg_ctl', [
          '-D',
          data,
          '-l',
          log,
          '-o',
          `-h 127.0.0.1 -p ${port}`,
          '-w',
          'start',
        ]);
        postmasterPid = readPostmasterPid(data);
        requireSuccess(startResult, 'startup');
        requireSuccess(
          run('psql', [
            '-X',
            '-h',
            '127.0.0.1',
            '-p',
            String(port),
            '-U',
            'postgres',
            '-d',
            'postgres',
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            [
              'create role portfolio_migrator login;',
              'create role portfolio_app;',
              'create role portfolio_backup;',
            ].join(' '),
          ]),
          'role creation',
        );
        requireSuccess(
          run('createdb', [
            '-h',
            '127.0.0.1',
            '-p',
            String(port),
            '-U',
            'postgres',
            '-O',
            'portfolio_migrator',
            'portfolio_seed',
          ]),
          'database creation',
        );
        seedEnvironment = {
          ...process.env,
          PGCONNECT_TIMEOUT_MS: '5000',
          PGDATABASE: 'portfolio_seed',
          PGHOST: '127.0.0.1',
          PGPASSWORD_FILE: passwordFile,
          PGPOOL_MAX: '2',
          PGPORT: String(port),
          PGUSER: 'portfolio_migrator',
        };
        client = new Client({
          host: '127.0.0.1',
          port,
          database: 'portfolio_seed',
          user: 'portfolio_migrator',
        });
        await client.connect();
      } catch (error) {
        await cleanRuntime();
        throw error;
      }
    }, 45_000);

    afterAll(async () => {
      await cleanRuntime();
    }, 15_000);

    it('migrates and seeds exact valid content twice as portfolio_migrator', async () => {
      const firstRun = run(tsxCommand, [seedScript], seedEnvironment);
      expect(firstRun, firstRun.stderr).toMatchObject({
        error: undefined,
        status: 0,
        stderr: '',
        stdout: 'PostgreSQL fixture seeded\n',
      });

      const firstSnapshot = await snapshot(client as Client);
      expect(firstSnapshot).toEqual({
        contactCount: 0,
        ids: expectedIds,
      });

      const secondRun = run(tsxCommand, [seedScript], seedEnvironment);
      expect(secondRun, secondRun.stderr).toMatchObject({
        error: undefined,
        status: 0,
        stderr: '',
        stdout: 'PostgreSQL fixture seeded\n',
      });
      expect(await snapshot(client as Client)).toEqual(firstSnapshot);

      const languageRatings = await (client as Client).query<{
        spoken: string;
        written: string;
      }>('select spoken, written from languages');
      expect(languageRatings.rows).toEqual([{ spoken: '5', written: '5' }]);
      for (const rating of Object.values(languageRatings.rows[0] ?? {})) {
        expect(Number.isInteger(Number(rating))).toBe(true);
        expect(Number(rating)).toBeGreaterThanOrEqual(0);
        expect(Number(rating)).toBeLessThanOrEqual(5);
      }

      const identity = await (client as Client).query<{
        current_user: string;
        database_owner: string;
      }>(`
        select current_user, pg_get_userbyid(datdba) as database_owner
        from pg_database where datname = current_database()
      `);
      expect(identity.rows).toEqual([
        {
          current_user: 'portfolio_migrator',
          database_owner: 'portfolio_migrator',
        },
      ]);

      const owners = await (client as Client).query<{
        tableowner: string;
        tablename: string;
      }>(`
        select tablename, tableowner from pg_tables
        where schemaname = 'public' order by tablename
      `);
      expect(owners.rows).toHaveLength(12);
      expect(new Set(owners.rows.map(({ tableowner }) => tableowner))).toEqual(
        new Set(['portfolio_migrator']),
      );

      const project = await (client as Client).query<{
        id: string;
        image_source: string;
        project_details: unknown;
        title: string;
      }>('select id, title, image_source, project_details from projects');
      expect(project.rows).toEqual([
        {
          id: projectId,
          title: 'Legacy Portfolio Case',
          image_source: '/images/cases/libra.webp',
          project_details: projectDetails,
        },
      ]);
      expect(
        projectDetailsSchema.parse(project.rows[0]?.project_details),
      ).toEqual(projectDetails);
      expect(
        Object.keys(project.rows[0]?.project_details ?? {}).sort(),
      ).toEqual(Object.keys(projectDetails).sort());

      const imagePaths = await (client as Client).query<{ path: string }>(`
        select image_source as path from profile_sections where image_source is not null
        union all select profile_image from profile_sections where profile_image is not null
        union all select image_source from projects
        union all select left_image_source from pursuits
        union all select right_image_source from pursuits
        union all select jsonb_array_elements_text(project_details->'imageSources') from projects
        union all select jsonb_array_elements_text(project_details->'imagesSources') from projects
        order by path
      `);
      expect(imagePaths.rows.map(({ path: imagePath }) => imagePath)).toEqual([
        '/images/cases/imaginecare.webp',
        '/images/cases/libra.webp',
        '/images/cases/livsstilsverktyget.webp',
        '/images/developer.webp',
        '/images/laptop.webp',
        '/images/phone.webp',
        '/images/profilepicture.webp',
      ]);
      for (const { path: imagePath } of imagePaths.rows) {
        expect(imagePath).toMatch(
          /^\/images\/[a-z0-9][a-z0-9/_-]*\.(?:png|svg|webp)$/,
        );
        expect(imagePath).not.toContain('..');
      }
    }, 45_000);

    it('proves postmaster death before removing data when pg_ctl stop fails', async () => {
      const pid = postmasterPid;
      const runtimePath = runtime;
      const realPgCtl = executablePath('pg_ctl');
      expect(pid).toBeDefined();
      expect(realPgCtl).toBeDefined();
      expect(isProcessAlive(pid as number)).toBe(true);
      const wrapperDirectory = path.join(runtime, 'failing-pg-ctl');
      const wrapper = path.join(wrapperDirectory, 'pg_ctl');
      fs.mkdirSync(wrapperDirectory, { mode: 0o700 });
      fs.writeFileSync(
        wrapper,
        [
          '#!/bin/sh',
          'case " $* " in',
          '  *" stop "*) exit 1 ;;',
          'esac',
          `exec ${JSON.stringify(realPgCtl)} "$@"`,
          '',
        ].join('\n'),
        { mode: 0o700 },
      );
      const originalPath = process.env.PATH;
      process.env.PATH = `${wrapperDirectory}${path.delimiter}${
        originalPath ?? ''
      }`;
      try {
        await cleanRuntime();
      } finally {
        process.env.PATH = originalPath;
      }
      expect(isProcessAlive(pid as number)).toBe(false);
      expect(fs.existsSync(runtimePath)).toBe(false);
    }, 15_000);
  },
);
