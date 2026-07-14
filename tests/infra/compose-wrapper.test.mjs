import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { logicalShellLines } from './docker-contract-helpers.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const wrapperRelativePath = 'ops/compose.sh';
const wrapperPath = path.join(repositoryRoot, wrapperRelativePath);
const dockerHarnessImage =
  'node:22.23.1-bookworm-slim@sha256:' +
  '6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
const commandTimeoutMs = 15_000;
const callerEnvironmentPrefixes = [
  'APP_',
  'BACKUP_',
  'COMPOSE_',
  'DOCKER_',
  'MIGRATOR_',
  'MLP_',
];

const secretSources = {
  MLP_CLOUDFLARE_TUNNEL_TOKEN: 'cloudflare-tunnel-token',
  MLP_POSTGRES_APP_PASSWORD: 'postgres-app-password',
  MLP_POSTGRES_BACKUP_PASSWORD: 'postgres-backup-password',
  MLP_POSTGRES_BOOTSTRAP_PASSWORD: 'postgres-bootstrap-password',
  MLP_POSTGRES_MIGRATOR_PASSWORD: 'postgres-migrator-password',
  MLP_RESTIC_PASSWORD: 'restic-password',
  MLP_RESTIC_S3_ACCESS_KEY_ID: 'restic-s3-access-key-id',
  MLP_RESTIC_S3_SECRET_ACCESS_KEY: 'restic-s3-secret-access-key',
};

const environmentFiles = {
  'app.env': {
    prefix: 'APP_',
    required: [
      'APP_CONTACT_MODE',
      'APP_IMAGE',
      'APP_PGCONNECT_TIMEOUT_MS',
      'APP_PGDATABASE',
      'APP_PGHOST',
      'APP_PGPOOL_MAX',
      'APP_PGPORT',
      'APP_PGUSER',
    ],
  },
  'backup.env': {
    prefix: 'BACKUP_',
    required: [
      'BACKUP_IMAGE',
      'BACKUP_PGDATABASE',
      'BACKUP_PGHOST',
      'BACKUP_PGPORT',
      'BACKUP_PGUSER',
      'BACKUP_RESTIC_REPOSITORY',
    ],
  },
  'migrator.env': {
    prefix: 'MIGRATOR_',
    required: [
      'MIGRATOR_PGCONNECT_TIMEOUT_MS',
      'MIGRATOR_PGDATABASE',
      'MIGRATOR_PGHOST',
      'MIGRATOR_PGPOOL_MAX',
      'MIGRATOR_PGPORT',
      'MIGRATOR_PGUSER',
    ],
  },
};

async function readRequiredText(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${relativePath}: required Task 9 artifact is missing`);
    }
    throw error;
  }
}

function shellFunctionBody(source, name) {
  const body = source.match(
    new RegExp(`^${name}\\(\\)\\s*\\{([\\s\\S]*?)^\\}`, 'mu'),
  )?.[1];
  assert.ok(body, `wrapper must define ${name}()`);
  return body;
}

function assertFixedWrapperContract(source) {
  const lines = logicalShellLines(source);
  const physicalLines = source.replaceAll('\r\n', '\n').split('\n');
  assert.equal(
    physicalLines[0],
    '#!/bin/bash -p',
    'root wrapper must use privileged mode in the fixed Debian Bash interpreter',
  );
  assert.equal(
    physicalLines[1],
    'set +x',
    'xtrace must be disabled by the first command after privileged Bash starts',
  );
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /^(?:export )?LC_ALL=C$/mu);
  assert.doesNotMatch(
    source,
    /MLP_(?:REPO|CONFIG)_ROOT/u,
    'production roots must not be environment-overridable',
  );
  assert.doesNotMatch(source, /^(?:set -x|env|printenv)\b/mu);
  assert.doesNotMatch(source, /\b(?:eval|source)\b/u);
  assert.doesNotMatch(source, /tr -d ["']?\\n/u);
  assert.doesNotMatch(
    source,
    /(?:echo|printf)[^\n]*MLP_[A-Z0-9_]+/u,
    'wrapper diagnostics must never print secret-source variables',
  );
  const startupEnvironmentSanitization = physicalLines.findIndex((line) =>
    line.startsWith('export -n '),
  );
  assert.ok(
    startupEnvironmentSanitization > 1,
    'hostile Bash startup variables must be made non-exported after xtrace is disabled',
  );
  for (const name of [
    'BASH_ENV',
    'BASHOPTS',
    'BASH_XTRACEFD',
    'ENV',
    'PS4',
    'SHELLOPTS',
  ]) {
    assert.ok(
      physicalLines[startupEnvironmentSanitization]
        .split(/\s+/u)
        .includes(name),
      `${name} must not reach Compose or a descendant shell`,
    );
  }

  const rootGuard = source.search(
    /(?:\bEUID\b|\/usr\/bin\/id -u)[^\n]*(?:-eq|==)\s*0/u,
  );
  assert.ok(rootGuard >= 0, 'wrapper must reject a non-root effective UID');
  const argumentValidation = source.indexOf(
    'validate_arguments "$@"',
    rootGuard,
  );
  assert.ok(
    argumentValidation > rootGuard,
    'override arguments must be rejected immediately after the root gate',
  );

  const validateArguments = shellFunctionBody(source, 'validate_arguments');
  for (const option of [
    '--environment',
    '--env-file',
    '--file',
    '--project-directory',
    '--project-name',
    '-f',
    '-p',
  ]) {
    assert.ok(
      validateArguments.includes(option),
      `wrapper must reject caller override ${option}`,
    );
  }
  assert.match(validateArguments, /exit (?:64|77)\b/u);

  const clearCallerEnvironment = shellFunctionBody(
    source,
    'clear_caller_environment',
  );
  for (const prefix of callerEnvironmentPrefixes) {
    assert.ok(
      clearCallerEnvironment.includes(`"\${!${prefix}@}"`),
      `wrapper must clear every inherited ${prefix} variable`,
    );
  }

  const validateDirectory = shellFunctionBody(source, 'validate_directory');
  assert.match(validateDirectory, /\[\[?[^\n]*-d/u);
  assert.match(validateDirectory, /-L/u);
  assert.match(validateDirectory, /\/usr\/bin\/stat/u);
  assert.match(validateDirectory, /0:0:700/u);

  const validateFile = shellFunctionBody(source, 'validate_file');
  assert.match(validateFile, /\[\[?[^\n]*-f/u);
  assert.match(validateFile, /-L/u);
  assert.match(validateFile, /\[\[?[^\n]*-s/u);
  assert.match(validateFile, /\/usr\/bin\/stat/u);
  assert.match(validateFile, /0:0:600/u);

  const validateEnvironment = shellFunctionBody(
    source,
    'validate_environment_file',
  );
  assert.match(validateEnvironment, /validate_file/u);
  assert.match(validateEnvironment, /prefix/u);
  assert.ok(
    validateEnvironment.includes('^[A-Z_][A-Z0-9_]*='),
    'environment files must contain only auditable KEY=value records',
  );

  const readSecret = shellFunctionBody(source, 'read_secret');
  assert.match(readSecret, /validate_file/u);
  assert.match(readSecret, /\$'\\n'/u);
  assert.match(readSecret, /\$'\\r'/u);
  assert.match(readSecret, /\/usr\/bin\/stat[^\n]*%s/u);
  assert.match(readSecret, /\$\{#[A-Za-z_][A-Za-z0-9_]*\}/u);

  for (const directory of ['/etc/mlp', '/etc/mlp/env', '/etc/mlp/secrets']) {
    assert.ok(
      lines.includes(`validate_directory ${directory}`),
      `wrapper must validate fixed directory ${directory}`,
    );
  }
  for (const [filename, { prefix }] of Object.entries(environmentFiles)) {
    assert.ok(
      lines.includes(
        `validate_environment_file /etc/mlp/env/${filename} ${prefix}`,
      ),
      `wrapper must validate ${filename} with prefix ${prefix}`,
    );
  }

  for (const [variableName, filename] of Object.entries(secretSources)) {
    assert.match(
      source,
      new RegExp(
        `^${variableName}=["']?\\$\\(read_secret /etc/mlp/secrets/${filename}\\)["']?$`,
        'mu',
      ),
      `${variableName} must come only from ${filename}`,
    );
    assert.match(
      source,
      new RegExp(`^export(?: [A-Z0-9_]+)* ${variableName}(?: |$)`, 'mu'),
      `${variableName} must be exported only to the short-lived Compose client`,
    );
  }

  const firstDirectoryValidation = source.indexOf(
    'validate_directory /etc/mlp',
    argumentValidation,
  );
  const callerEnvironmentClear = source.indexOf(
    '\nclear_caller_environment\n',
    argumentValidation,
  );
  const lastEnvironmentValidation = source.lastIndexOf(
    'validate_environment_file /etc/mlp/env/',
  );
  const firstSecretRead = Math.min(
    ...Object.keys(secretSources).map((name) => source.indexOf(`${name}=`)),
  );
  assert.ok(
    callerEnvironmentClear > argumentValidation,
    'caller environment must be cleared after the root and argument gates',
  );
  assert.ok(
    firstDirectoryValidation > callerEnvironmentClear,
    'caller environment must be cleared before runtime files are processed',
  );
  assert.ok(lastEnvironmentValidation > firstDirectoryValidation);
  assert.ok(
    firstSecretRead > lastEnvironmentValidation,
    'all paths and environment records must be validated before reading secrets',
  );

  const invocation = lines.find((line) =>
    line.startsWith('exec /usr/bin/docker compose '),
  );
  assert.equal(
    invocation,
    'exec /usr/bin/docker compose --project-name mlp-prod --project-directory /opt/mlp --env-file /etc/mlp/env/app.env --env-file /etc/mlp/env/migrator.env --env-file /etc/mlp/env/backup.env --file /opt/mlp/compose.production.yml "$@"',
    'wrapper must use one fixed project, root, env-file order, and Compose file',
  );
}

function parseEnvironmentFile(source, prefix, filename) {
  const entries = {};
  for (const [index, rawLine] of source
    .replaceAll('\r\n', '\n')
    .split('\n')
    .entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/u);
    assert.ok(match, `${filename}:${index + 1} must be KEY=value`);
    const [, key, value] = match;
    assert.ok(key.startsWith(prefix), `${filename}/${key} must use ${prefix}`);
    assert.equal(
      Object.hasOwn(entries, key),
      false,
      `${filename}/${key} repeats`,
    );
    assert.notEqual(value, '', `${filename}/${key} must be non-empty`);
    entries[key] = value;
  }
  return entries;
}

function dockerDaemonAvailable() {
  const result = spawnSync('docker', ['info'], {
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    timeout: commandTimeoutMs,
  });
  return !result.error && result.status === 0;
}

function assertNoSentinels(result, sentinels, operation) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (sentinels.some((sentinel) => output.includes(sentinel))) {
    assert.fail(`${operation} exposed a Task 9 credential sentinel`);
  }
}

async function createDockerWrapperFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-task9-wrapper-'));
  const envDirectory = path.join(root, 'env');
  const secretDirectory = path.join(root, 'secrets');
  const captureDirectory = path.join(root, 'capture');
  await Promise.all([
    mkdir(envDirectory),
    mkdir(secretDirectory),
    mkdir(captureDirectory),
  ]);

  for (const filename of Object.keys(environmentFiles)) {
    await copyFile(
      path.join(repositoryRoot, 'infra/runtime.example/env', filename),
      path.join(envDirectory, filename),
    );
  }

  const sentinels = {};
  for (const [variableName, filename] of Object.entries(secretSources)) {
    const sentinel = `TASK9_${variableName}_${randomBytes(16).toString('hex')}`;
    sentinels[variableName] = sentinel;
    await writeFile(path.join(secretDirectory, filename), `${sentinel}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  const fakeDockerPath = path.join(root, 'docker');
  await writeFile(
    fakeDockerPath,
    `#!/bin/sh
set -eu
umask 077
: > /capture/invoked
printf '%s\\n' "$@" > /capture/arguments
${Object.keys(secretSources)
  .map(
    (name) =>
      `printf '%s=%s\\n' '${name}' "\${${name}:?}" >> /capture/environment`,
  )
  .join('\n')}
/usr/bin/env > /capture/process-environment
chmod 0644 /capture/invoked /capture/arguments /capture/environment /capture/process-environment
`,
    { encoding: 'utf8', mode: 0o700 },
  );
  await chmod(fakeDockerPath, 0o700);

  const bashEnvSentinel = `TASK9_BASH_ENV_${randomBytes(16).toString('hex')}`;
  const hostileBashEnvPath = path.join(root, 'hostile-bash-env');
  await writeFile(
    hostileBashEnvPath,
    `printf '%s\\n' '${bashEnvSentinel}' >&2\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  return {
    bashEnvSentinel,
    captureDirectory,
    envDirectory,
    fakeDockerPath,
    hostileBashEnvPath,
    root,
    secretDirectory,
    sentinels,
  };
}

function dockerMount(source, target, readOnly = true) {
  return `type=bind,src=${source},dst=${target}${readOnly ? ',readonly' : ''}`;
}

function runWrapperHarness(
  fixture,
  { args = ['config'], environment = {}, mutation = ':' } = {},
) {
  const setup = `
set -eu
umask 077
mkdir -p /etc/mlp/env /etc/mlp/secrets
cp /fixtures/env/app.env /etc/mlp/env/app.env
cp /fixtures/env/migrator.env /etc/mlp/env/migrator.env
cp /fixtures/env/backup.env /etc/mlp/env/backup.env
cp /fixtures/secrets/* /etc/mlp/secrets/
cp /fixtures/compose.production.yml /opt/mlp/compose.production.yml
chmod 0700 /etc/mlp /etc/mlp/env /etc/mlp/secrets /opt/mlp
chmod 0600 /etc/mlp/env/* /etc/mlp/secrets/* /opt/mlp/compose.production.yml
${mutation}
exec /work/compose.sh "$@"
`;
  const dockerEnvironment = Object.entries(environment).flatMap(
    ([name, value]) => ['--env', `${name}=${value}`],
  );
  return spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--read-only',
      '--user',
      '0:0',
      '--security-opt',
      'no-new-privileges:true',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,noexec,mode=1777',
      '--tmpfs',
      '/etc/mlp:rw,nosuid,nodev,noexec,mode=0700',
      '--tmpfs',
      '/opt/mlp:rw,nosuid,nodev,noexec,mode=0700',
      ...dockerEnvironment,
      '--mount',
      dockerMount(wrapperPath, '/work/compose.sh'),
      '--mount',
      dockerMount(
        path.join(repositoryRoot, 'compose.production.yml'),
        '/fixtures/compose.production.yml',
      ),
      '--mount',
      dockerMount(fixture.envDirectory, '/fixtures/env'),
      '--mount',
      dockerMount(fixture.secretDirectory, '/fixtures/secrets'),
      '--mount',
      dockerMount(fixture.fakeDockerPath, '/usr/bin/docker'),
      '--mount',
      dockerMount(fixture.hostileBashEnvPath, '/fixtures/hostile-bash-env'),
      '--mount',
      dockerMount(fixture.captureDirectory, '/capture', false),
      dockerHarnessImage,
      '/bin/sh',
      '-ceu',
      setup,
      '--',
      ...args,
    ],
    {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      timeout: 120_000,
    },
  );
}

async function captureExists(directory, filename) {
  try {
    await lstat(path.join(directory, filename));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

test('root Compose wrapper fixes paths, validates before reads, and exports exactly eight sources', async () => {
  const source = await readRequiredText(wrapperRelativePath);
  assertFixedWrapperContract(source);

  const status = await lstat(wrapperPath);
  assert.equal(status.isSymbolicLink(), false);
  assert.equal(status.isFile(), true);
  assert.notEqual(status.mode & 0o111, 0, 'ops/compose.sh must be executable');
  assert.equal(
    status.mode & 0o022,
    0,
    'ops/compose.sh must not be group/world writable',
  );

  const syntax = spawnSync('/bin/bash', ['-n', wrapperPath], {
    encoding: 'utf8',
    killSignal: 'SIGKILL',
    timeout: commandTimeoutMs,
  });
  assert.equal(syntax.status, 0, 'ops/compose.sh must pass Bash syntax');
});

test('root Compose wrapper refuses non-root before paths or sentinels are inspected', async (t) => {
  await readRequiredText(wrapperRelativePath);
  if (typeof process.geteuid !== 'function' || process.geteuid() === 0) {
    t.skip(
      'current process is root; non-root refusal remains a Linux CI user gate',
    );
    return;
  }

  const sentinel = `TASK9_NONROOT_${randomBytes(16).toString('hex')}`;
  const result = spawnSync(wrapperPath, ['config'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MLP_POSTGRES_BOOTSTRAP_PASSWORD: sentinel,
    },
    killSignal: 'SIGKILL',
    timeout: commandTimeoutMs,
  });
  assert.equal(result.status, 77);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    new RegExp(sentinel, 'u'),
  );
  assert.match(result.stderr, /requires root/u);
  assert.doesNotMatch(result.stderr, /(?:\/etc\/mlp|postgres-bootstrap)/u);
});

test('root Compose wrapper ignores BASH_ENV before the non-root gate', async (t) => {
  await readRequiredText(wrapperRelativePath);
  if (typeof process.geteuid !== 'function' || process.geteuid() === 0) {
    t.skip('current process is root; non-root startup gate remains a CI gate');
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-task9-bash-env-'));
  const bashEnvPath = path.join(root, 'hostile-bash-env');
  const sentinel = `TASK9_BASH_ENV_${randomBytes(16).toString('hex')}`;
  try {
    await writeFile(
      bashEnvPath,
      `printf '%s\\n' "$MLP_POSTGRES_BOOTSTRAP_PASSWORD" >&2\n`,
      'utf8',
    );
    const environment = {
      ...process.env,
      BASH_ENV: bashEnvPath,
      MLP_POSTGRES_BOOTSTRAP_PASSWORD: sentinel,
    };
    delete environment.SHELLOPTS;
    delete environment.PS4;
    const result = spawnSync(wrapperPath, ['config'], {
      encoding: 'utf8',
      env: environment,
      killSignal: 'SIGKILL',
      timeout: commandTimeoutMs,
    });
    assert.equal(result.status, 77);
    assertNoSentinels(result, [sentinel], 'non-root BASH_ENV rejection');
    assert.match(result.stderr, /requires root/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('root Compose wrapper disables inherited xtrace before the non-root gate', async (t) => {
  await readRequiredText(wrapperRelativePath);
  if (typeof process.geteuid !== 'function' || process.geteuid() === 0) {
    t.skip('current process is root; non-root startup gate remains a CI gate');
    return;
  }

  const sentinel = `TASK9_XTRACE_${randomBytes(16).toString('hex')}`;
  const result = spawnSync(wrapperPath, ['config'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BASH_ENV: '/dev/null',
      PS4: `${sentinel} `,
      SHELLOPTS: 'xtrace',
    },
    killSignal: 'SIGKILL',
    timeout: commandTimeoutMs,
  });
  assert.equal(result.status, 77);
  assertNoSentinels(result, [sentinel], 'non-root inherited xtrace rejection');
  assert.match(result.stderr, /requires root/u);
});

test('runtime examples use collision-free prefixes and keep the Restic provider unapproved', async () => {
  const parsed = {};
  for (const [filename, contract] of Object.entries(environmentFiles)) {
    const source = await readRequiredText(
      `infra/runtime.example/env/${filename}`,
    );
    parsed[filename] = parseEnvironmentFile(source, contract.prefix, filename);
    assert.deepEqual(Object.keys(parsed[filename]).sort(), contract.required);
  }

  assert.match(
    parsed['app.env'].APP_IMAGE,
    /^ghcr\.io\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/u,
  );
  assert.match(
    parsed['backup.env'].BACKUP_IMAGE,
    /^ghcr\.io\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/u,
  );
  assert.equal(parsed['app.env'].APP_PGUSER, 'portfolio_app');
  assert.equal(parsed['migrator.env'].MIGRATOR_PGUSER, 'portfolio_migrator');
  assert.equal(parsed['backup.env'].BACKUP_PGUSER, 'portfolio_backup');
  assert.match(
    parsed['backup.env'].BACKUP_RESTIC_REPOSITORY,
    /^UNCONFIGURED_/u,
    'example deployment must remain blocked until the off-VM backend is approved',
  );

  const readme = await readRequiredText('infra/runtime.example/README.md');
  assert.match(readme, /root:root[^\n]*0700/iu);
  assert.match(readme, /0600/u);
  assert.match(readme, /does not restart[^\n]*dependents/iu);
  assert.match(readme, /Task 10[^\n]*(?:monitor|recover)/iu);
  assert.match(readme, /off-VM[^\n]*(?:backup|restore)/iu);
  assert.match(readme, /(?:provider|bucket|prefix|region)[^\n]*not approved/iu);
});

test('runtime examples contain exactly eight harmless single-line secret placeholders', async () => {
  const secretDirectory = path.join(
    repositoryRoot,
    'infra/runtime.example/secrets',
  );
  let names;
  try {
    names = (await readdir(secretDirectory)).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(
        'infra/runtime.example/secrets: required Task 9 artifact is missing',
      );
    }
    throw error;
  }
  assert.deepEqual(names, Object.values(secretSources).sort());
  for (const filename of names) {
    const filePath = path.join(secretDirectory, filename);
    const status = await lstat(filePath);
    assert.equal(status.isFile(), true, `${filename} must be a regular file`);
    assert.equal(
      status.isSymbolicLink(),
      false,
      `${filename} must not be a symlink`,
    );
    const value = await readFile(filePath, 'utf8');
    assert.match(
      value,
      /^example-only-[a-z0-9-]+\n$/u,
      `${filename} must contain one clearly harmless placeholder line`,
    );
  }
});

test(
  'root wrapper behavior rejects ownership, modes, symlinks, multiline values, and overrides without leaks',
  { timeout: 180_000 },
  async (t) => {
    if (!dockerDaemonAvailable()) {
      t.skip(
        'Docker daemon unavailable; root-owned wrapper fixture matrix remains a mandatory Linux CI gate',
      );
      return;
    }
    await readRequiredText(wrapperRelativePath);

    const fixture = await createDockerWrapperFixture();
    const sentinelValues = Object.values(fixture.sentinels);
    const inheritedVariables = Object.fromEntries(
      [
        'APP_IMAGE',
        'APP_UNREVIEWED_OVERRIDE',
        'BACKUP_IMAGE',
        'BACKUP_UNREVIEWED_OVERRIDE',
        'COMPOSE_EXPERIMENTAL',
        'COMPOSE_FILE',
        'COMPOSE_PROJECT_NAME',
        'DOCKER_CONFIG',
        'DOCKER_CONTEXT',
        'DOCKER_HOST',
        'MIGRATOR_PGHOST',
        'MIGRATOR_UNREVIEWED_OVERRIDE',
        'MLP_POSTGRES_APP_PASSWORD',
        'MLP_UNREVIEWED_OVERRIDE',
      ].map((name) => [
        name,
        `TASK9_INHERITED_${name}_${randomBytes(8).toString('hex')}`,
      ]),
    );
    const traceSentinel = `TASK9_XTRACE_${randomBytes(16).toString('hex')}`;
    try {
      const valid = runWrapperHarness(fixture, {
        args: ['config', '--format', 'json'],
        environment: {
          ...inheritedVariables,
          BASH_ENV: '/fixtures/hostile-bash-env',
          PS4: `${traceSentinel} `,
          SHELLOPTS: 'xtrace',
        },
      });
      assertNoSentinels(
        valid,
        [
          ...sentinelValues,
          ...Object.values(inheritedVariables),
          fixture.bashEnvSentinel,
          traceSentinel,
        ],
        'valid wrapper invocation',
      );
      assert.equal(valid.status, 0, 'valid root-owned runtime tree must pass');
      assert.deepEqual(
        (
          await readFile(
            path.join(fixture.captureDirectory, 'arguments'),
            'utf8',
          )
        )
          .trim()
          .split('\n'),
        [
          'compose',
          '--project-name',
          'mlp-prod',
          '--project-directory',
          '/opt/mlp',
          '--env-file',
          '/etc/mlp/env/app.env',
          '--env-file',
          '/etc/mlp/env/migrator.env',
          '--env-file',
          '/etc/mlp/env/backup.env',
          '--file',
          '/opt/mlp/compose.production.yml',
          'config',
          '--format',
          'json',
        ],
      );
      const capturedEnvironment = Object.fromEntries(
        (
          await readFile(
            path.join(fixture.captureDirectory, 'environment'),
            'utf8',
          )
        )
          .trim()
          .split('\n')
          .map((line) => {
            const separator = line.indexOf('=');
            return [line.slice(0, separator), line.slice(separator + 1)];
          }),
      );
      assert.deepEqual(capturedEnvironment, fixture.sentinels);
      const processEnvironment = new Set(
        (
          await readFile(
            path.join(fixture.captureDirectory, 'process-environment'),
            'utf8',
          )
        )
          .trim()
          .split('\n')
          .map((line) => line.slice(0, line.indexOf('='))),
      );
      for (const prefix of callerEnvironmentPrefixes) {
        const matchingNames = [...processEnvironment]
          .filter((name) => name.startsWith(prefix))
          .sort();
        if (prefix === 'MLP_') {
          assert.deepEqual(
            matchingNames,
            Object.keys(secretSources).sort(),
            'Docker must receive only the eight file-loaded MLP secret sources',
          );
          continue;
        }
        assert.equal(
          matchingNames.length > 0,
          false,
          `Docker must not inherit caller-controlled ${prefix} variables`,
        );
      }
      for (const name of [
        'BASH_ENV',
        'BASHOPTS',
        'BASH_XTRACEFD',
        'ENV',
        'PS4',
        'SHELLOPTS',
      ]) {
        assert.equal(
          processEnvironment.has(name),
          false,
          `Docker must not inherit hostile Bash variable ${name}`,
        );
      }

      const invalidTrees = [
        'chmod 0755 /etc/mlp/secrets',
        'chmod 0644 /etc/mlp/secrets/postgres-app-password',
        'chmod 0644 /etc/mlp/env/app.env',
        'chown 1:1 /etc/mlp/secrets/postgres-app-password',
        'rm /etc/mlp/secrets/postgres-app-password && ln -s postgres-backup-password /etc/mlp/secrets/postgres-app-password',
        'rm /etc/mlp/env/app.env && ln -s backup.env /etc/mlp/env/app.env',
        "printf '\\nsecond-line\\n' >> /etc/mlp/secrets/postgres-app-password",
        "printf '\\nUNSCOPED=value\\n' >> /etc/mlp/env/app.env",
      ];
      for (const mutation of invalidTrees) {
        await rm(fixture.captureDirectory, { force: true, recursive: true });
        await mkdir(fixture.captureDirectory);
        const result = runWrapperHarness(fixture, { mutation });
        assertNoSentinels(result, sentinelValues, 'invalid runtime tree');
        assert.notEqual(
          result.status,
          0,
          'unsafe runtime tree must fail closed',
        );
        assert.equal(
          await captureExists(fixture.captureDirectory, 'invoked'),
          false,
          'Docker must not run after runtime validation fails',
        );
      }

      for (const args of [
        ['--file', '/tmp/override.yml', 'config'],
        ['--file=/tmp/override.yml', 'config'],
        ['-f', '/tmp/override.yml', 'config'],
        ['-f/tmp/override.yml', 'config'],
        ['-f=/tmp/override.yml', 'config'],
        ['--project-name', 'override', 'config'],
        ['--project-name=override', 'config'],
        ['-p', 'override', 'config'],
        ['-poverride', 'config'],
        ['-p=override', 'config'],
        ['--project-directory', '/tmp', 'config'],
        ['--project-directory=/tmp', 'config'],
        ['--env-file', '/tmp/override.env', 'config'],
        ['--env-file=/tmp/override.env', 'config'],
        ['config', '--environment'],
      ]) {
        await rm(fixture.captureDirectory, { force: true, recursive: true });
        await mkdir(fixture.captureDirectory);
        const result = runWrapperHarness(fixture, { args });
        assertNoSentinels(result, sentinelValues, 'override rejection');
        assert.notEqual(
          result.status,
          0,
          'override arguments must fail closed',
        );
        assert.equal(
          await captureExists(fixture.captureDirectory, 'invoked'),
          false,
          'Docker must not run after an override is rejected',
        );
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  },
);
