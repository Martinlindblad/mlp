import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(__dirname, '../../..');
const exportScript = path.join(
  repositoryRoot,
  'scripts/migration/export-mongo.sh',
);
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    Array.from(temporaryRoots).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
  temporaryRoots.clear();
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function executable(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, source, { mode: 0o700 });
}

describe('migration operator safety', () => {
  it('uses mongodump config instead of putting the Mongo URI in argv', async () => {
    const source = await readFile(exportScript, 'utf8');
    const mongodumpCommand = source
      .split('\n')
      .find((line) => /^mongodump\b/.test(line.trim()));

    expect(mongodumpCommand).toContain('--config');
    expect(mongodumpCommand).not.toContain('--uri');
    expect(source).not.toMatch(/mongodump[^\n]*(?:MONGO_URI|\$uri)/);
    expect(source).toContain('umask 077');
    expect(source).toContain('encrypted_tmp="$work/');
    expect(source).toContain('mv -n -- "$encrypted_tmp" "$archive"');
    expect(source).toContain('100.17.0)');
  });

  it('encrypts to a temporary file, exposes only the final path, and cleans secrets', async () => {
    const root = await temporaryRoot('mlp-export-test-');
    const bin = path.join(root, 'bin');
    const artifacts = path.join(root, 'artifacts');
    const uriFile = path.join(root, 'mongo-uri');
    const argsLog = path.join(root, 'mongodump-args');
    const configLog = path.join(root, 'mongodump-config');
    const statLog = path.join(root, 'stat-args');
    await import('node:fs/promises').then(({ mkdir }) =>
      Promise.all([
        mkdir(bin, { mode: 0o700 }),
        mkdir(artifacts, { mode: 0o700 }),
      ]),
    );
    await chmod(artifacts, 0o777);
    const secretUri =
      'mongodb+srv://operator:SECRET_URI_VALUE@mongo.invalid/mlp';
    await writeFile(uriFile, `${secretUri}\n`, { mode: 0o600 });
    await executable(
      path.join(bin, 'mongodump'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == --version ]]; then printf 'mongodump version: 100.17.0\\n'; exit 0; fi
printf '%s\\n' "$*" >"$FAKE_ARGS_LOG"
config=''
for argument in "$@"; do case "$argument" in --config=*) config="\${argument#--config=}";; esac; done
test -n "$config"
test "$(stat -c '%a' "$config" 2>/dev/null || stat -f '%Lp' "$config")" = 600
grep -F 'SECRET_URI_VALUE' "$config" >/dev/null
printf '%s' "$config" >"$FAKE_CONFIG_LOG"
printf 'PLAINTEXT_ARCHIVE_FIXTURE'
`,
    );
    await executable(
      path.join(bin, 'age'),
      `#!/usr/bin/env bash
set -euo pipefail
output=''
while (($#)); do
  case "$1" in --output) output="$2"; shift 2;; *) shift;; esac
done
cat >/dev/null
printf 'FAKE_ENCRYPTED_ARCHIVE' >"$output"
`,
    );
    await executable(
      path.join(bin, 'stat'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_STAT_LOG"
case "\${1:-}" in
  -c)
    test "\${2:-}" = '%a'
    node -e 'const {mode}=require("node:fs").statSync(process.argv[1]); process.exit((mode & 0o777) === 0o600 ? 0 : 1)' "\${3:-}"
    echo 600
    exit 0
    ;;
  -f) echo GNU_FILESYSTEM_DIAGNOSTIC; exit 1 ;;
  *) exit 99 ;;
esac
`,
    );

    const result = await run('bash', [exportScript], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      MONGO_URI_FILE: uriFile,
      MONGO_DATABASE: 'portfolio_source',
      ARCHIVE_RECIPIENT: 'age1testrecipient',
      ARTIFACT_DIR: artifacts,
      FAKE_ARGS_LOG: argsLog,
      FAKE_CONFIG_LOG: configLog,
      FAKE_STAT_LOG: statLog,
    });

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect((await readFile(statLog, 'utf8')).split('\n')[0]).toMatch(/^-c %a /);
    expect(result.stdout.trim()).toMatch(
      /\/mongo-final-\d{8}T\d{6}Z\.archive\.gz\.age$/,
    );
    expect(result.stdout).not.toContain(secretUri);
    const files = await readdir(artifacts);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.archive\.gz\.age$/);
    const archive = path.join(artifacts, files[0] ?? 'missing');
    expect(await readFile(archive, 'utf8')).toBe('FAKE_ENCRYPTED_ARCHIVE');
    expect((await stat(archive)).mode & 0o777).toBe(0o600);
    expect((await stat(artifacts)).mode & 0o777).toBe(0o700);
    const args = await readFile(argsLog, 'utf8');
    expect(args).toContain('--config=');
    expect(args).not.toContain(secretUri);
    expect(args).not.toContain('SECRET_URI_VALUE');
    const configPath = await readFile(configLog, 'utf8');
    await expect(lstat(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects every mongodump version except the pinned 100.17.0', async () => {
    const root = await temporaryRoot('mlp-export-version-');
    const bin = path.join(root, 'bin');
    const uriFile = path.join(root, 'mongo-uri');
    const artifacts = path.join(root, 'artifacts');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
    await writeFile(
      uriFile,
      'mongodb://operator:VERSION_SECRET@mongo.invalid/mlp\n',
      { mode: 0o600 },
    );
    await executable(
      path.join(bin, 'mongodump'),
      `#!/usr/bin/env bash
printf 'mongodump version: 100.17.1\n'
`,
    );
    await executable(path.join(bin, 'age'), '#!/usr/bin/env bash\nexit 99\n');

    const result = await run('bash', [exportScript], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      MONGO_URI_FILE: uriFile,
      MONGO_DATABASE: 'portfolio_source',
      ARCHIVE_RECIPIENT: 'age1testrecipient',
      ARTIFACT_DIR: artifacts,
    });

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain('VERSION_SECRET');
    await expect(lstat(artifacts)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes config and partial encrypted output after an encryption failure', async () => {
    const root = await temporaryRoot('mlp-export-failure-');
    const bin = path.join(root, 'bin');
    const artifacts = path.join(root, 'artifacts');
    const uriFile = path.join(root, 'mongo-uri');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
    await writeFile(
      uriFile,
      'mongodb://operator:FAILURE_SECRET@mongo.invalid/mlp\n',
      { mode: 0o600 },
    );
    await executable(
      path.join(bin, 'mongodump'),
      `#!/usr/bin/env bash
if [[ "\${1:-}" == --version ]]; then printf 'mongodump version: 100.17.0\\n'; exit 0; fi
printf PLAINTEXT_PARTIAL
`,
    );
    await executable(
      path.join(bin, 'age'),
      `#!/usr/bin/env bash
output=''
while (($#)); do
  case "$1" in --output) output="$2"; shift 2;; *) shift;; esac
done
cat >/dev/null
printf PARTIAL_CIPHERTEXT >"$output"
exit 9
`,
    );

    const result = await run('bash', [exportScript], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      MONGO_URI_FILE: uriFile,
      MONGO_DATABASE: 'portfolio_source',
      ARCHIVE_RECIPIENT: 'age1testrecipient',
      ARTIFACT_DIR: artifacts,
    });

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain('FAILURE_SECRET');
    expect(await readdir(artifacts)).toEqual([]);
  });

  it('refuses a final-name collision without overwriting the existing archive', async () => {
    const root = await temporaryRoot('mlp-export-collision-');
    const bin = path.join(root, 'bin');
    const artifacts = path.join(root, 'artifacts');
    const uriFile = path.join(root, 'mongo-uri');
    await import('node:fs/promises').then(({ mkdir }) =>
      Promise.all([mkdir(bin), mkdir(artifacts)]),
    );
    await writeFile(uriFile, 'mongodb://operator:secret@mongo.invalid/mlp\n', {
      mode: 0o600,
    });
    await writeFile(
      path.join(artifacts, 'mongo-final-20260714T120000Z.archive.gz.age'),
      'EXISTING_ARCHIVE',
      { mode: 0o600 },
    );
    await executable(
      path.join(bin, 'date'),
      '#!/usr/bin/env bash\nprintf 20260714T120000Z\n',
    );
    await executable(
      path.join(bin, 'mongodump'),
      `#!/usr/bin/env bash
if [[ "\${1:-}" == --version ]]; then printf 'mongodump version: 100.17.0\\n'; exit 0; fi
printf PLAINTEXT
`,
    );
    await executable(
      path.join(bin, 'age'),
      `#!/usr/bin/env bash
while (($#)); do case "$1" in --output) output="$2"; shift 2;; *) shift;; esac; done
cat >/dev/null
printf NEW_CIPHERTEXT >"$output"
`,
    );

    const result = await run('bash', [exportScript], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      MONGO_URI_FILE: uriFile,
      MONGO_DATABASE: 'portfolio_source',
      ARCHIVE_RECIPIENT: 'age1testrecipient',
      ARTIFACT_DIR: artifacts,
    });

    expect(result.code).not.toBe(0);
    expect(
      await readFile(
        path.join(artifacts, 'mongo-final-20260714T120000Z.archive.gz.age'),
        'utf8',
      ),
    ).toBe('EXISTING_ARCHIVE');
    expect(await readdir(artifacts)).toEqual([
      'mongo-final-20260714T120000Z.archive.gz.age',
    ]);
  });

  it('keeps migration-only modules out of the production TypeScript entrypoint', async () => {
    const tsconfig = JSON.parse(
      await readFile(
        path.join(repositoryRoot, 'tsconfig.migration.json'),
        'utf8',
      ),
    ) as { include: string[] };
    const packageJson = JSON.parse(
      await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(tsconfig.include).toContain('migration/**/*.ts');
    expect(packageJson.scripts).toMatchObject({
      'migration:rehearsal': 'tsx scripts/migration/run-rehearsal.ts',
      'migration:preload': 'tsx scripts/migration/preload-content.ts',
      'migration:contacts': 'tsx scripts/migration/finalize-contacts.ts',
      'migration:remove-synthetic':
        'tsx scripts/migration/remove-synthetic-contact.ts',
      'migration:typecheck': 'tsc --project tsconfig.migration.json',
    });
  });

  it('keeps source, target-role, finalize, and cleanup CLI boundaries explicit', async () => {
    const readScript = (name: string) =>
      readFile(path.join(repositoryRoot, 'scripts/migration', name), 'utf8');
    const [rehearsal, preload, finalize, cleanup, runtime] = await Promise.all([
      readScript('run-rehearsal.ts'),
      readScript('preload-content.ts'),
      readScript('finalize-contacts.ts'),
      readScript('remove-synthetic-contact.ts'),
      readScript('operator-runtime.ts'),
    ]);

    expect(rehearsal).toContain('withSourceDatabase');
    expect(preload).toContain('CONTENT_COLLECTIONS');
    expect(finalize).toContain("captureSnapshot(source, ['contact'])");
    expect(finalize).toContain("CONTACT_TRAFFIC_DRAINED !== 'yes'");
    const sourceCaptureIndex = finalize.indexOf(
      'const snapshot = await withSourceDatabase',
    );
    const targetFinalizationIndex = finalize.indexOf(
      'await withMigrationTarget',
    );
    expect(sourceCaptureIndex).toBeGreaterThanOrEqual(0);
    expect(targetFinalizationIndex).toBeGreaterThan(sourceCaptureIndex);
    expect(cleanup).not.toContain('withSourceDatabase');
    expect(cleanup).not.toContain('MONGO_');
    expect(cleanup).toContain('process.argv.slice(2)');
    expect(cleanup).toContain('mongoIdPattern');
    expect(cleanup).toContain('uuidPattern');
    expect(runtime).toContain("config.user !== 'portfolio_migrator'");
    for (const source of [rehearsal, preload, finalize, cleanup]) {
      expect(source).toContain('runOperator');
      expect(source).not.toContain('console.error');
    }
    expect(rehearsal.indexOf('verifySnapshot')).toBeLessThan(
      rehearsal.indexOf('writeReport('),
    );
    const finalizerIndex = finalize.indexOf('finalizeContactSnapshot(');
    const reportIndex = finalize.indexOf('writeReport(');
    expect(finalizerIndex).toBeGreaterThanOrEqual(0);
    expect(reportIndex).toBeGreaterThan(finalizerIndex);
  });
});
