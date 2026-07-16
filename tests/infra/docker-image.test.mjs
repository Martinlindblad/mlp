import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertDockerignoreContract,
  assertExactFinalCopies,
  assertExecutableRegularFile,
  assertFailSafeCleanupTraps,
  assertFixedRuntimeUserAndRootCopies,
  assertLiteralDigestBases,
  assertNoBroadDistCopy,
  assertNoFinalCopyAll,
  assertNoSecretDockerMetadata,
  assertOciRevisionMetadata,
  assertOrdered,
  assertPgPasswordLifecycle,
  assertPosixScript,
  assertPreservesDumpOwnershipAndAcls,
  assertWholePublicTreeCopy,
  dockerStages,
  finalDockerStage,
  logicalShellLines,
  readRequiredJson,
  readRequiredText,
} from './docker-contract-helpers.mjs';

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const literalFixtureDigest = '0123456789abcdef'.repeat(4);
const nodeTag = 'node:22.23.1-bookworm-slim';
const nodeReference =
  `${nodeTag}@sha256:` +
  '6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
const postgresReference =
  'postgres:18.4-alpine@sha256:' +
  '9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15';
const resticReference =
  'restic/restic:0.18.1@sha256:' +
  '39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76';
const alpineReference =
  'alpine:3.24.1@sha256:' +
  '28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';

function dockerfileWithFinalInstruction(instruction) {
  return `FROM ${nodeTag}@sha256:${literalFixtureDigest} AS runner\n${instruction}\n`;
}

function assertRequiredRuntimeCopy(copyLines, source, destination) {
  assert.ok(
    copyLines.some(
      (line) => line.includes(source) && line.endsWith(destination),
    ),
    `missing narrow runtime copy ${source} -> ${destination}`,
  );
}

async function assertPosixSyntax(relativePath) {
  await execFile('/bin/sh', ['-n', path.join(repositoryRoot, relativePath)], {
    encoding: 'utf8',
  });
}

function assertReadableNonemptySecret(source, variableName) {
  assert.match(
    source,
    new RegExp(`\\$\\{${variableName}:\\?`, 'u'),
    `${variableName} must be required`,
  );
  assert.match(
    source,
    new RegExp(`-r[ "']+\\$\\{?${variableName}\\}?`, 'u'),
    `${variableName} must name a readable file`,
  );
  assert.match(
    source,
    new RegExp(`-s[ "']+\\$\\{?${variableName}\\}?`, 'u'),
    `${variableName} must name a non-empty file`,
  );
}

function assertSafeMuslStaticResticProof(resticProof) {
  assert.ok(resticProof, 'Restic tool stage must inspect dynamic linkage');
  assertOrdered(
    resticProof,
    [
      'set +e',
      'ldd_output="$(ldd /usr/bin/restic 2>&1)"',
      'ldd_status=$?',
      'set -e',
      'test "$ldd_status" -ne 0',
      'case "$ldd_output" in',
      '*": /usr/bin/restic: Not a valid dynamic program") : ;;',
      '*) exit 1 ;;',
      'esac',
    ],
    'Restic static-link proof must require the safe musl path/diagnostic suffix',
  );
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readWhenPresent(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = (await readFile(filePath, 'utf8')).trim();
      if (value.length > 0) return value;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(20);
  }
  assert.fail('signal harness child did not start within its bound');
}

function killProcessGroup(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function waitForClose(child, timeoutMs = 7_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      killProcessGroup(child);
      reject(new Error('signal harness wrapper exceeded its exit bound'));
    }, timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function assertProcessGone(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
    await delay(20);
  }
  assert.fail('signal harness child was not reaped within its bound');
}

async function assertProcessGroupGone(processGroupId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-processGroupId, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
    await delay(20);
  }
  assert.fail('signal harness process group still contains an orphan');
}

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, { encoding: 'utf8', mode: 0o700 });
  await chmod(filePath, 0o700);
}

const childStubSource = `#!/bin/sh
set -eu
name=\${0##*/}
if [ "$name" = pg_dump ]; then
  dump_file=
  previous=
  for argument in "$@"; do
    if [ "$previous" = --file ] || [ "$previous" = -f ]; then
      dump_file=$argument
    fi
    case "$argument" in
      --file=*) dump_file=\${argument#--file=} ;;
    esac
    previous=$argument
  done
  if [ -n "$dump_file" ]; then : > "$dump_file"; fi
fi
if [ "$name" = "$HARNESS_TARGET" ]; then
  printf '%s\\n' "$$" > "$HARNESS_PID_FILE"
  if [ "\${HARNESS_IGNORE_TERM:-no}" = yes ]; then
    trap '' TERM
  else
    trap 'exit 143' TERM
  fi
  while :; do :; done
fi
exit 0
`;

const databaseStubSource = `#!/bin/sh
set -eu
name=\${0##*/}
case "$name" in
  pg_dump)
    dump_file=
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --file=*) dump_file=\${1#--file=} ;;
        --file|-f)
          shift
          dump_file=\${1:?missing dump file}
          ;;
      esac
      shift
    done
    [ -n "$dump_file" ] || exit 64
    : > "$dump_file"
    ;;
  pg_restore) ;;
  *) exit 64 ;;
esac
`;

function createSignalWrapperFixture(command, graceSeconds) {
  return `#!/bin/sh
set -eu
umask 077
child_pid=
cleanup() {
  set +e
  status=$1
  trap - 0 HUP INT TERM
  exit "$status"
}
run_child() {
  "$@" &
  child_pid=$!
  set +e
  wait "$child_pid"
  status=$?
  child_pid=
  set -e
  return "$status"
}
forward_signal() {
  set +e
  signal=$1
  status=$2
  trap - HUP INT TERM
  if [ -n "$child_pid" ]; then
    kill -TERM "$child_pid" 2>/dev/null
    sleep ${graceSeconds}
    kill -KILL "$child_pid" 2>/dev/null
    wait "$child_pid" 2>/dev/null
    child_pid=
  fi
  cleanup "$status"
}
trap 'cleanup $?' 0
trap 'forward_signal HUP 129' HUP
trap 'forward_signal INT 130' INT
trap 'forward_signal TERM 143' TERM
run_child ${command} "$@"
status=$?
exit "$status"
`;
}

const signalWrapperFixture = createSignalWrapperFixture(
  '/usr/local/bin/restic',
  1,
);
const nestedOuterSignalFixture = createSignalWrapperFixture(
  '/usr/local/bin/mlp-restic',
  3,
);
const nestedInnerSignalFixture = createSignalWrapperFixture(
  '/usr/local/bin/restic',
  1,
);

async function assertSignalForwarding(
  source,
  { childName, ignoreTerm = false, kind, signal, status },
) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'mlp-task8-signal-'));
  const bin = path.join(sandbox, 'bin');
  const childPidFile = path.join(sandbox, 'child.pid');
  let childPid;
  let wrapper;
  try {
    await mkdir(bin);
    for (const name of ['pg_dump', 'pg_restore', 'mlp-restic', 'restic']) {
      await writeExecutable(path.join(bin, name), childStubSource);
    }
    for (const name of [
      'pg-password',
      'restic-password',
      's3-access-key-id',
      's3-secret-access-key',
    ]) {
      await writeFile(path.join(sandbox, name), 'task8-harness-value\n', {
        mode: 0o600,
      });
    }

    let harnessSource = source;
    if (kind === 'backup') {
      harnessSource = harnessSource
        .replace('/tmp/mlp-backup.XXXXXX', `${sandbox}/work.XXXXXX`)
        .replaceAll('/usr/local/bin/mlp-restic', path.join(bin, 'mlp-restic'));
      assert.notEqual(harnessSource, source, 'backup harness patch must apply');
    } else {
      harnessSource = harnessSource.replaceAll(
        '/usr/local/bin/restic',
        path.join(bin, 'restic'),
      );
      assert.notEqual(harnessSource, source, 'restic harness patch must apply');
    }
    const wrapperPath = path.join(sandbox, `${kind}.sh`);
    await writeExecutable(wrapperPath, harnessSource);

    const environment = {
      ...process.env,
      HARNESS_PID_FILE: childPidFile,
      HARNESS_IGNORE_TERM: ignoreTerm ? 'yes' : 'no',
      HARNESS_TARGET: childName,
      PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      PGDATABASE: 'portfolio',
      PGHOST: 'database',
      PGPASSWORD_FILE: path.join(sandbox, 'pg-password'),
      PGPORT: '5432',
      PGUSER: 'portfolio_backup',
      RESTIC_PASSWORD_FILE: path.join(sandbox, 'restic-password'),
      RESTIC_REPOSITORY: 's3:https://storage.invalid/mlp',
      RESTIC_S3_ACCESS_KEY_ID_FILE: path.join(sandbox, 's3-access-key-id'),
      RESTIC_S3_SECRET_ACCESS_KEY_FILE: path.join(
        sandbox,
        's3-secret-access-key',
      ),
    };
    wrapper = spawn('/bin/sh', [wrapperPath], {
      detached: true,
      env: environment,
      stdio: 'ignore',
    });
    const close = waitForClose(wrapper);
    childPid = Number(await readWhenPresent(childPidFile));
    assert.ok(Number.isInteger(childPid) && childPid > 1);
    assert.doesNotThrow(
      () => process.kill(wrapper.pid, signal),
      'wrapper-only signal must be delivered',
    );
    const result = await close;
    assert.deepEqual(result, { code: status, signal: null });
    await assertProcessGone(childPid);
    if (kind === 'backup') {
      assert.equal(
        (await readdir(sandbox)).some((name) => name.startsWith('work.')),
        false,
        'backup signal cleanup must remove its bounded work directory',
      );
    }
  } finally {
    killProcessGroup(wrapper);
    if (childPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    await rm(sandbox, { force: true, recursive: true });
  }
}

async function assertNestedSignalForwarding(
  outerSource,
  innerSource,
  { actualScripts = false } = {},
) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'mlp-task8-nested-'));
  const bin = path.join(sandbox, 'bin');
  const innerPidFile = path.join(sandbox, 'inner.pid');
  const resticPidFile = path.join(sandbox, 'restic.pid');
  let innerPid;
  let outer;
  let resticPid;
  try {
    await mkdir(bin);
    for (const name of ['pg_dump', 'pg_restore']) {
      await writeExecutable(path.join(bin, name), databaseStubSource);
    }
    for (const name of [
      'pg-password',
      'restic-password',
      's3-access-key-id',
      's3-secret-access-key',
    ]) {
      await writeFile(path.join(sandbox, name), 'task8-harness-value\n', {
        mode: 0o600,
      });
    }

    const resticPath = path.join(sandbox, 'restic');
    await writeExecutable(
      resticPath,
      `#!/bin/sh
set -eu
printf '%s\\n' "$$" > "$RESTIC_PID_FILE"
trap '' TERM
while :; do :; done
`,
    );

    const innerPath = path.join(sandbox, 'inner-restic.sh');
    const patchedInnerSource = innerSource.replaceAll(
      '/usr/local/bin/restic',
      resticPath,
    );
    assert.notEqual(
      patchedInnerSource,
      innerSource,
      'nested harness must patch the real Restic path',
    );
    await writeExecutable(innerPath, patchedInnerSource);
    const launcherPath = path.join(sandbox, 'mlp-restic');
    await writeExecutable(
      launcherPath,
      `#!/bin/sh
set -eu
printf '%s\\n' "$$" > "$INNER_PID_FILE"
exec /bin/sh "${innerPath}" "$@"
`,
    );

    const outerPath = path.join(sandbox, 'outer-backup.sh');
    let patchedOuterSource = outerSource.replaceAll(
      '/usr/local/bin/mlp-restic',
      launcherPath,
    );
    assert.notEqual(
      patchedOuterSource,
      outerSource,
      'nested harness must patch the real mlp-restic path',
    );
    if (actualScripts) {
      const patchedWorkSource = patchedOuterSource.replace(
        '/tmp/mlp-backup.XXXXXX',
        `${sandbox}/work.XXXXXX`,
      );
      assert.notEqual(
        patchedWorkSource,
        patchedOuterSource,
        'nested harness must bound the real backup work directory',
      );
      patchedOuterSource = patchedWorkSource;
    }
    await writeExecutable(outerPath, patchedOuterSource);
    outer = spawn('/bin/sh', [outerPath], {
      detached: true,
      env: {
        ...process.env,
        INNER_PID_FILE: innerPidFile,
        PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        PGDATABASE: 'portfolio',
        PGHOST: 'database',
        PGPASSWORD_FILE: path.join(sandbox, 'pg-password'),
        PGPORT: '5432',
        PGUSER: 'portfolio_backup',
        RESTIC_PASSWORD_FILE: path.join(sandbox, 'restic-password'),
        RESTIC_PID_FILE: resticPidFile,
        RESTIC_REPOSITORY: 's3:https://storage.invalid/mlp',
        RESTIC_S3_ACCESS_KEY_ID_FILE: path.join(sandbox, 's3-access-key-id'),
        RESTIC_S3_SECRET_ACCESS_KEY_FILE: path.join(
          sandbox,
          's3-secret-access-key',
        ),
      },
      stdio: 'ignore',
    });
    const close = waitForClose(outer, 9_000);
    [innerPid, resticPid] = await Promise.all([
      readWhenPresent(innerPidFile).then(Number),
      readWhenPresent(resticPidFile).then(Number),
    ]);
    assert.ok(Number.isInteger(innerPid) && innerPid > 1);
    assert.ok(Number.isInteger(resticPid) && resticPid > 1);
    assert.notEqual(innerPid, resticPid);

    assert.doesNotThrow(
      () => process.kill(outer.pid, 'SIGINT'),
      'nested harness must signal only the outer wrapper PID',
    );
    assert.deepEqual(await close, { code: 130, signal: null });
    await assertProcessGone(innerPid);
    await assertProcessGone(resticPid);
    await assertProcessGroupGone(outer.pid);
  } finally {
    killProcessGroup(outer);
    for (const pid of [innerPid, resticPid]) {
      if (!pid) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
    await rm(sandbox, { force: true, recursive: true });
  }
}

async function assertUnsafeResticRepositoryRejected(source, repository) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'mlp-task8-restic-'));
  try {
    const invokedMarker = path.join(sandbox, 'restic-invoked');
    const resticPath = path.join(sandbox, 'restic');
    await writeExecutable(
      resticPath,
      `#!/bin/sh\n: > "${invokedMarker}"\nexit 0\n`,
    );
    const wrapperPath = path.join(sandbox, 'restic.sh');
    await writeExecutable(
      wrapperPath,
      source.replaceAll('/usr/local/bin/restic', resticPath),
    );
    for (const name of ['password', 'access-key-id', 'secret-access-key']) {
      await writeFile(path.join(sandbox, name), 'task8-harness-value\n', {
        mode: 0o600,
      });
    }
    const result = await execFile('/bin/sh', [wrapperPath, 'snapshots'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RESTIC_PASSWORD_FILE: path.join(sandbox, 'password'),
        RESTIC_REPOSITORY: repository,
        RESTIC_S3_ACCESS_KEY_ID_FILE: path.join(sandbox, 'access-key-id'),
        RESTIC_S3_SECRET_ACCESS_KEY_FILE: path.join(
          sandbox,
          'secret-access-key',
        ),
      },
    }).catch((error) => error);
    assert.equal(result?.code, 64, 'unsafe Restic repository must fail closed');
    assert.equal(
      `${result?.stdout ?? ''}${result?.stderr ?? ''}`.includes(repository),
      false,
      'repository validation must not echo the rejected value',
    );
    await assert.rejects(lstat(invokedMarker), { code: 'ENOENT' });
  } finally {
    await rm(sandbox, { force: true, recursive: true });
  }
}

test('Docker contract rejects overridable bases, broad copies, writable ownership, and secret history', () => {
  const overridable =
    `ARG NODE_IMAGE=${nodeTag}@sha256:${literalFixtureDigest}\n` +
    'FROM ${NODE_IMAGE} AS runner\n';
  assert.throws(
    () => assertLiteralDigestBases(overridable, [nodeReference]),
    /overridable build argument/iu,
  );
  assert.throws(
    () =>
      assertLiteralDigestBases(
        `FROM ${nodeTag}@sha256:${literalFixtureDigest} AS runner\n`,
        [nodeReference],
      ),
    /exact reviewed index digest/iu,
  );

  const canonicalOci =
    `FROM ${nodeTag}@sha256:${literalFixtureDigest} AS runner\n` +
    'ARG COMMIT_SHA\n' +
    `RUN printf '%s\\n' "$COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$'\n` +
    'LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"\n';
  assert.doesNotThrow(() => assertOciRevisionMetadata(canonicalOci));
  assert.throws(
    () =>
      assertOciRevisionMetadata(
        canonicalOci.replace(
          `grep -Eq '^[0-9a-f]{40}$'`,
          `grep -Eq '^[0-9a-f]{40}$' || true`,
        ),
      ),
    /canonical fail-closed/iu,
  );
  assert.throws(
    () =>
      assertOciRevisionMetadata(
        `${canonicalOci}LABEL org.opencontainers.image.revision="override"\n`,
      ),
    /exactly one canonical LABEL/iu,
  );

  assert.throws(
    () =>
      assertNoBroadDistCopy(
        dockerfileWithFinalInstruction(
          'COPY --from=builder --chown=0:0 /app/dist ./dist',
        ),
      ),
    /broad application dist copy/iu,
  );

  for (const broadInstruction of [
    'COPY . /app',
    'ADD ["./", "/app"]',
    'COPY --from=builder /app /runtime',
    'COPY --from=builder /app/. /runtime',
  ]) {
    assert.throws(
      () =>
        assertNoFinalCopyAll(dockerfileWithFinalInstruction(broadInstruction)),
      /broad context\/stage root/iu,
    );
  }

  assert.throws(
    () =>
      assertExactFinalCopies(
        dockerfileWithFinalInstruction(
          'COPY --chown=0:0 --chmod=0444 safe.txt /safe.txt\nRUN chmod 0666 /safe.txt',
        ),
        [{ source: 'safe.txt', destination: '/safe.txt' }],
      ),
    /widen ownership or modes/iu,
  );

  assert.throws(
    () =>
      assertFixedRuntimeUserAndRootCopies(
        dockerfileWithFinalInstruction(
          'COPY --chown=node:node /app/server.js /app/server.js\nUSER 1000:1000',
        ),
        '1000:1000',
      ),
    /root-owned/iu,
  );

  assert.throws(
    () =>
      assertNoSecretDockerMetadata(
        dockerfileWithFinalInstruction('ARG DATABASE_URL'),
      ),
    /secret-related metadata/iu,
  );

  assert.throws(
    () =>
      assertDockerignoreContract('.env*\n**/secrets/**\n!**\n', {
        requiredPatterns: ['.env*', '**/secrets/**'],
      }),
    /negations are forbidden/iu,
  );
});

test('application image is immutable, non-root, read-only, and narrowly packaged', async () => {
  const source = await readRequiredText(repositoryRoot, 'Dockerfile');
  assertLiteralDigestBases(source, [
    nodeReference,
    nodeReference,
    nodeReference,
    nodeReference,
  ]);
  assert.deepEqual(
    dockerStages(source).map(({ name }) => name),
    ['deps', 'builder', 'age', 'runner'],
  );
  assertNoSecretDockerMetadata(source);
  assert.doesNotMatch(
    source,
    /(?:age-keygen|AGE-SECRET-KEY|identity)/u,
    'application image must not contain recovery identities or age-keygen',
  );
  assertOciRevisionMetadata(source);
  assertFixedRuntimeUserAndRootCopies(source, '1000:1000');
  assertNoFinalCopyAll(source);
  assertExactFinalCopies(source, [
    {
      from: 'builder',
      source: '/app/.next/standalone',
      destination: './',
    },
    {
      from: 'builder',
      source: '/app/.next/static',
      destination: './.next/static',
    },
    { from: 'builder', source: '/app/public', destination: './public' },
    {
      from: 'builder',
      source: '/app/dist/scripts/db',
      destination: './dist/scripts/db',
    },
    {
      from: 'builder',
      source: '/app/dist/server/db',
      destination: './dist/server/db',
    },
    {
      from: 'builder',
      source: '/app/node_modules/kysely/dist/migration',
      destination: './node_modules/kysely/dist/migration',
    },
    {
      from: 'age',
      source: '/usr/local/bin/age',
      destination: '/usr/local/bin/age',
    },
  ]);
  assertNoBroadDistCopy(source);
  assertWholePublicTreeCopy(source);

  const stages = dockerStages(source);
  assert.match(
    stages[0].instructions.join('\n'),
    /yarn install --frozen-lockfile/u,
    'dependency stage must use the lockfile',
  );
  assert.match(
    stages[1].instructions.join('\n'),
    /^RUN yarn build:production$/mu,
    'builder must use the deterministic production build',
  );
  assert.match(
    stages[2].instructions.join('\n'),
    /ADD --checksum=sha256:bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377 https:\/\/github\.com\/FiloSottile\/age\/releases\/download\/v1\.3\.1\/age-v1\.3\.1-linux-amd64\.tar\.gz \/tmp\/age\.tgz/u,
    'age stage must download the exact reviewed release archive',
  );
  assert.match(
    stages[2].instructions.join('\n'),
    /uname -m[^\n]*x86_64/u,
    'age stage must fail closed on unexpected architecture',
  );
  assert.match(
    stages[2].instructions.join('\n'),
    /sha256sum -c/u,
    'age stage must verify the release archive inside the image build',
  );
  assert.match(
    stages[2].instructions.join('\n'),
    /tar[^\n]*age\/age/u,
    'age stage must extract only the age executable',
  );
  assert.match(
    stages[2].instructions.join('\n'),
    /install[^\n]*-o root -g root -m 0555[^\n]*\/usr\/local\/bin\/age/u,
    'age executable must be installed as root-owned 0555',
  );
  assert.match(
    stages[2].instructions.join('\n'),
    /stat -c '%U:%G %a' \/usr\/local\/bin\/age/u,
    'age build stage must prove root ownership and 0555 mode without root writability checks',
  );
  assert.doesNotMatch(
    stages[2].instructions.join('\n'),
    /test ! -w \/usr\/local\/bin\/age/u,
    'root build stage cannot prove non-writability with test -w because root bypasses mode bits',
  );

  const final = finalDockerStage(source);
  const finalSource = final.instructions.join('\n');
  const copyLines = final.instructions.filter((line) => /^COPY\s/iu.test(line));
  assertRequiredRuntimeCopy(copyLines, '/app/.next/standalone', './');
  assertRequiredRuntimeCopy(copyLines, '/app/.next/static', './.next/static');
  assertRequiredRuntimeCopy(copyLines, '/app/public', './public');
  assertRequiredRuntimeCopy(
    copyLines,
    '/app/dist/scripts/db',
    './dist/scripts/db',
  );
  assertRequiredRuntimeCopy(
    copyLines,
    '/app/dist/server/db',
    './dist/server/db',
  );
  assertRequiredRuntimeCopy(
    copyLines,
    '/app/node_modules/kysely/dist/migration',
    './node_modules/kysely/dist/migration',
  );
  assertRequiredRuntimeCopy(copyLines, '/usr/local/bin/age', '/usr/local/bin/age');
  assert.doesNotMatch(
    finalSource,
    /(?:scripts\/migration|mongo-client|export-mongo|dist-migration|\/app\/migration(?:\/|\s)|\/app\/dist(?:\s|$))/iu,
    'application image must exclude Task 6 ETL/Mongo/operator code',
  );
  assert.match(
    finalSource,
    /apt-get purge -y --allow-remove-essential[\s\S]*\bapt\b[\s\S]*\blibgnutls30\b/u,
    'runtime image must remove apt and libgnutls so base-image private-key fixtures are not shipped',
  );
  assert.match(
    finalSource,
    /test ! -e \/usr\/lib\/x86_64-linux-gnu\/libgnutls\.so\.30\.34\.3/u,
    'runtime image must prove the known libgnutls private-key fixture is absent',
  );
  assert.match(
    finalSource,
    /test ! -e \/usr\/bin\/apt-get/u,
    'runtime image must prove apt-get is absent after the package-manager purge',
  );
  for (const packageName of [
    'bsdutils',
    'gzip',
    'libacl1',
    'libblkid1',
    'libtinfo6',
    'libuuid1',
    'ncurses-base',
    'perl-base',
    'util-linux',
    'zlib1g',
  ]) {
    assert.match(
      finalSource,
      new RegExp(`\\b${packageName}\\b`, 'u'),
      `${packageName} must be removed from the app runtime image`,
    );
  }
  assert.match(
    finalSource,
    /rm -rf[\s\S]*\/usr\/local\/lib\/node_modules\/npm[\s\S]*\/usr\/local\/bin\/npm[\s\S]*\/usr\/local\/bin\/npx/u,
    'runtime image must remove npm and npx from the final Node image',
  );
  assert.match(
    finalSource,
    /test ! -e \/usr\/local\/lib\/node_modules\/npm/u,
    'runtime image must prove npm global modules are absent',
  );
  assert.match(
    finalSource,
    /test ! -e \/usr\/local\/bin\/npm/u,
    'runtime image must prove npm is absent',
  );
  assert.match(
    finalSource,
    /test ! -e \/usr\/local\/bin\/npx/u,
    'runtime image must prove npx is absent',
  );
  assertOrdered(
    finalSource,
    [
      'apt-get purge -y --allow-remove-essential',
      'test ! -e /usr/lib/x86_64-linux-gnu/libgnutls.so.30.34.3',
      'USER 1000:1000',
    ],
    'package-manager/private-key-fixture purge must run as root before dropping to the runtime user',
  );
  assert.match(finalSource, /ENV\s[^\n]*NODE_ENV=production/u);
  assert.match(finalSource, /ENV\s[^\n]*HOSTNAME=0\.0\.0\.0/u);
  assert.match(finalSource, /ENV\s[^\n]*PORT=3000/u);
  assert.match(finalSource, /^WORKDIR \/app$/mu);
  assert.match(
    finalSource,
    /^RUN test "\$\(age --version\)" = "v1\.3\.1" && test ! -w \/usr\/local\/bin\/age$/mu,
    'final app image must prove the exact age version and non-writability as the runtime user',
  );
  assert.match(finalSource, /^EXPOSE 3000$/mu);
  assert.match(finalSource, /^CMD \["node",\s*"server\.js"\]$/mu);

  const healthcheck = final.instructions.find((line) =>
    /^HEALTHCHECK\s/iu.test(line),
  );
  assert.ok(healthcheck, 'application image requires a readiness healthcheck');
  assert.match(healthcheck, /http:\/\/127\.0\.0\.1:3000\/api\/health\/ready/u);
  const healthTimeout = Number(healthcheck.match(/--timeout=([0-9]+)s/u)?.[1]);
  const abortTimeout = Number(
    healthcheck.match(/AbortSignal\.timeout\(([0-9]+)\)/u)?.[1],
  );
  assert.ok(Number.isFinite(healthTimeout), 'health timeout must be explicit');
  assert.ok(
    Number.isFinite(abortTimeout),
    'health abort bound must be explicit',
  );
  assert.ok(
    abortTimeout < healthTimeout * 1000,
    'internal readiness abort must be shorter than container health timeout',
  );
});

test('application Docker context excludes secrets, ETL, artifacts, and history inputs', async () => {
  const source = await readRequiredText(repositoryRoot, '.dockerignore');
  const packageJson = await readRequiredJson(repositoryRoot, 'package.json');
  assertDockerignoreContract(source, {
    requiredPatterns: [
      '.git',
      '.github',
      '.next',
      '.superpowers',
      'node_modules',
      'dist',
      'migration-artifacts',
      'migration',
      'scripts/migration',
      '.env*',
      '**/.env*',
      '**/secrets/**',
      '**/*.pem',
      '**/*.key',
      '**/*.age',
      '**/*.archive*',
      'infra/runtime.example/secrets',
      'docs',
      'tests',
    ],
  });
  assert.equal(
    packageJson.dependencies?.['@vercel/speed-insights'],
    undefined,
    'self-hosted application runtime must not retain Vercel Speed Insights',
  );
  await assert.rejects(
    lstat(path.join(repositoryRoot, 'public/vercel.svg')),
    'self-hosted application public assets must not retain Vercel branding',
  );
});

test('Next standalone output preserves five-second ISR on a read-only root', async () => {
  const configPath = path.join(repositoryRoot, 'next.config.js');
  const requireFromTest = createRequire(import.meta.url);
  const config = requireFromTest(configPath);

  assert.equal(config.output, 'standalone');
  assert.equal(
    config.experimental?.isrFlushToDisk,
    false,
    'disk-backed ISR flushing must be disabled for read-only execution',
  );
});

test('database migrator build is deterministic and tsconfig output is narrow', async () => {
  const packageJson = await readRequiredJson(repositoryRoot, 'package.json');
  const migrationDockerfile = await readRequiredText(
    repositoryRoot,
    'infra/migration/Dockerfile',
  );
  assert.equal(
    packageJson.scripts?.['build:scripts'],
    'rm -rf dist && tsc --project tsconfig.scripts.json',
  );
  assert.equal(
    packageJson.scripts?.['build:production'],
    'yarn build:scripts && next build',
  );

  const config = await readRequiredJson(
    repositoryRoot,
    'tsconfig.scripts.json',
  );
  assert.deepEqual(config.include, ['scripts/db/**/*.ts', 'server/db/**/*.ts']);
  assert.equal(config.compilerOptions?.rootDir, '.');
  assert.equal(config.compilerOptions?.outDir, 'dist');
  assert.equal(config.compilerOptions?.module, 'commonjs');
  assert.equal(config.compilerOptions?.target, 'ES2022');
  assert.equal(config.compilerOptions?.noEmit, false);
  assert.equal(config.compilerOptions?.noEmitOnError, true);
  assert.equal(config.compilerOptions?.incremental, false);
  assert.equal(
    JSON.stringify(config).includes('migration'),
    false,
    'app migrator build must exclude Task 6 migration code',
  );

  const migrationBuilder = dockerStages(migrationDockerfile).find(
    ({ name }) => name === 'builder',
  );
  assert.ok(migrationBuilder, 'migration image requires a builder stage');
  assert.ok(
    migrationBuilder.instructions.some((instruction) =>
      instruction.includes('server/repositories/contact-repository.ts'),
    ),
    'migration builder must include type-only contact repository imports used by journal recovery',
  );
  const migrationFinal = finalDockerStage(migrationDockerfile).instructions.join(
    '\n',
  );
  assert.doesNotMatch(
    migrationFinal,
    /server\/repositories/u,
    'migration runtime must not copy repository implementation code for type-only imports',
  );
});

test('normalized public source includes worker, manifest, video, and lower-case cases', async () => {
  const required = [
    'public/sw.js',
    'public/sw-manifest.json',
    'public/manifest.json',
    'public/assets/man.mp4',
    'public/images/profilepicture.webp',
    'public/images/cases/mackmyra.webp',
  ];
  for (const relativePath of required) {
    const status = await lstat(path.join(repositoryRoot, relativePath));
    assert.equal(
      status.isFile(),
      true,
      `${relativePath} must be a regular file`,
    );
  }
});

test('backup image pins tools, CA support, labels, ownership, and fixed UID', async () => {
  const source = await readRequiredText(
    repositoryRoot,
    'infra/backup/Dockerfile',
  );
  assertLiteralDigestBases(source, [
    resticReference,
    postgresReference,
    alpineReference,
  ]);
  assert.deepEqual(
    dockerStages(source).map(({ name }) => name),
    ['restic', 'postgres-tools', 'backup'],
  );
  assertNoSecretDockerMetadata(source);
  assertOciRevisionMetadata(source);
  assertFixedRuntimeUserAndRootCopies(source, '10001:10001');
  assertNoFinalCopyAll(source);
  assertExactFinalCopies(source, [
    {
      from: 'postgres-tools',
      source: '/pg-runtime/',
      destination: '/',
    },
    {
      from: 'restic',
      source: '/usr/bin/restic',
      destination: '/usr/local/bin/restic',
    },
    {
      from: 'restic',
      source: '/etc/ssl/certs/ca-certificates.crt',
      destination: '/etc/ssl/certs/ca-certificates.crt',
    },
    {
      source: 'infra/backup/backup.sh',
      destination: '/usr/local/bin/mlp-backup',
    },
    {
      source: 'infra/backup/restic.sh',
      destination: '/usr/local/bin/mlp-restic',
    },
  ]);

  const resticProof = dockerStages(source)[0].instructions.find(
    (instruction) =>
      /^RUN\s/iu.test(instruction) &&
      instruction.includes('ldd /usr/bin/restic'),
  );
  assertSafeMuslStaticResticProof(resticProof);
  const postgresTools = dockerStages(source)[1].instructions.join('\n');
  assert.match(postgresTools, /ldd[^\n]*pg_dump/u);
  assert.match(postgresTools, /ldd[^\n]*pg_restore/u);
  assert.match(postgresTools, /readlink -f/u);
  assert.match(postgresTools, /\/pg-runtime/u);
  assert.match(
    postgresTools,
    /ld-musl-\.\*\\\.so\\\.1/u,
    'postgres tool closure must use a BusyBox awk-compatible musl interpreter exclusion',
  );
  assert.doesNotMatch(
    postgresTools,
    /ld-musl-\[\^\//u,
    'BusyBox awk treats an unescaped slash inside a bracket expression as the regex delimiter',
  );
  for (const library of [
    'libpq',
    'libzstd',
    'liblz4',
    'libcrypto',
    'libz',
    'libssl',
    'libgssapi_krb5',
    'libldap',
    'libkrb5',
    'libk5crypto',
    'libcom_err',
    'libkrb5support',
    'liblber',
    'libsasl2',
    'libkeyutils',
  ]) {
    assert.match(
      postgresTools,
      new RegExp(`${library}\\.so`, 'u'),
      `postgres tool closure must prove ${library} symlink and target`,
    );
  }
  assert.match(
    postgresTools,
    /(?:cp -a|tar\s)/u,
    'postgres tool closure must preserve library symlinks',
  );

  const finalSource = finalDockerStage(source).instructions.join('\n');
  assert.doesNotMatch(
    finalSource,
    /(?:apk|apt-get|apt)\s+(?:add|install)/u,
    'backup image must not depend on mutable package repositories',
  );
  assert.doesNotMatch(
    finalSource,
    /(?:^VOLUME\s|^EXPOSE\s|\bPGDATA\b)/imu,
    'backup runtime must not inherit PostgreSQL server metadata',
  );
  const pgRuntimeCopy = finalDockerStage(source).instructions.find(
    (instruction) =>
      /^COPY\s/iu.test(instruction) &&
      instruction.includes('--from=postgres-tools') &&
      instruction.includes('/pg-runtime/') &&
      instruction.endsWith('/'),
  );
  assert.ok(
    pgRuntimeCopy,
    'backup image must copy only the PostgreSQL closure',
  );
  assert.match(pgRuntimeCopy, /--chmod=0?555(?:\s|$)/u);
  const caCopy = finalDockerStage(source).instructions.find(
    (instruction) =>
      /^COPY\s/iu.test(instruction) &&
      instruction.includes('--from=restic') &&
      instruction.includes('/etc/ssl/certs/ca-certificates.crt') &&
      instruction.endsWith('/etc/ssl/certs/ca-certificates.crt'),
  );
  assert.ok(
    caCopy,
    'backup image must copy the CA bundle from the digest-pinned Restic stage',
  );
  assert.match(caCopy, /--chmod=0?444(?:\s|$)/u);

  const finalInstructions = finalDockerStage(source).instructions;
  const userIndex = finalInstructions.indexOf('USER 10001:10001');
  const runtimeProof = finalInstructions
    .slice(userIndex + 1)
    .find((instruction) => /^RUN\s/iu.test(instruction));
  assert.ok(
    runtimeProof,
    'backup image must prove tools and CA as runtime UID 10001',
  );
  for (const [versionCommand, version] of [
    ['pg_dump --version', '18.4'],
    ['pg_restore --version', '18.4'],
    ['restic version', '0.18.1'],
  ]) {
    assert.match(runtimeProof, new RegExp(versionCommand, 'u'));
    assert.match(runtimeProof, new RegExp(version.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(
    runtimeProof,
    /test -r \/etc\/ssl\/certs\/ca-certificates\.crt/u,
  );
  assert.match(
    runtimeProof,
    /test ! -w \/etc\/ssl\/certs\/ca-certificates\.crt/u,
  );
  for (const [sourcePath, destination] of [
    ['/usr/bin/restic', '/usr/local/bin/restic'],
    ['infra/backup/backup.sh', '/usr/local/bin/mlp-backup'],
    ['infra/backup/restic.sh', '/usr/local/bin/mlp-restic'],
  ]) {
    const line = finalDockerStage(source).instructions.find(
      (instruction) =>
        /^COPY\s/iu.test(instruction) &&
        instruction.includes(sourcePath) &&
        instruction.endsWith(destination),
    );
    assert.ok(line, `missing backup tool copy ${sourcePath}`);
    assert.match(line, /--chmod=0?555(?:\s|$)/u);
  }
  assert.match(
    finalSource,
    /^ENTRYPOINT \["\/usr\/local\/bin\/mlp-backup"\]$/mu,
  );
  assert.doesNotMatch(
    finalSource,
    /^CMD\s/mu,
    'new exec-form ENTRYPOINT must reset inherited CMD to an effective empty value',
  );
});

test('backup validators reject Bash, owner/ACL stripping, and retained PGPASSWORD', async () => {
  const safeResticProof =
    `RUN set +e; ldd_output="$(ldd /usr/bin/restic 2>&1)"; ` +
    `ldd_status=$?; set -e; test "$ldd_status" -ne 0; ` +
    `case "$ldd_output" in ` +
    `*": /usr/bin/restic: Not a valid dynamic program") : ;; ` +
    `*) exit 1 ;; esac`;
  assertSafeMuslStaticResticProof(safeResticProof);
  assert.throws(
    () =>
      assertSafeMuslStaticResticProof(
        safeResticProof.replace(
          'Not a valid dynamic program',
          'unexpected ldd diagnostic',
        ),
      ),
    /safe musl path\/diagnostic suffix/iu,
  );
  assert.throws(
    () =>
      assertPosixScript('#!/usr/bin/env bash\nset -Eeuo pipefail\numask 077\n'),
    /POSIX \/bin\/sh/iu,
  );
  assert.throws(
    () =>
      assertPreservesDumpOwnershipAndAcls(
        'pg_dump --format=custom --no-owner --no-acl --file="$dump"\n',
      ),
    /preserve PostgreSQL owners and ACLs/iu,
  );
  assert.throws(
    () =>
      assertPgPasswordLifecycle(
        'pg_dump --format=custom\npg_restore --list "$dump"\n/usr/local/bin/mlp-restic backup "$dump"\n',
      ),
    /unset PGPASSWORD/iu,
  );
  assert.throws(
    () =>
      assertFailSafeCleanupTraps(
        'cleanup() {\n' +
          '  status=$1\n' +
          '  exit "$status"\n' +
          '}\n' +
          'trap cleanup 0 HUP INT TERM\n',
      ),
    /disable errexit/iu,
  );
  assertFailSafeCleanupTraps(signalWrapperFixture);
  assertFailSafeCleanupTraps(nestedOuterSignalFixture, { graceSeconds: 3 });
  assertFailSafeCleanupTraps(nestedInnerSignalFixture, { graceSeconds: 1 });
  await assertSignalForwarding(signalWrapperFixture, {
    childName: 'restic',
    ignoreTerm: true,
    kind: 'restic',
    signal: 'SIGINT',
    status: 130,
  });
  await assertNestedSignalForwarding(
    nestedOuterSignalFixture,
    nestedInnerSignalFixture,
  );
});

test('POSIX backup creates and verifies an owner/ACL-preserving dump safely', async () => {
  const relativePath = 'infra/backup/backup.sh';
  const source = await readRequiredText(repositoryRoot, relativePath);
  assertPosixScript(source);
  await assertExecutableRegularFile(repositoryRoot, relativePath);
  await assertPosixSyntax(relativePath);
  assertReadableNonemptySecret(source, 'PGPASSWORD_FILE');
  assert.match(source, /mktemp -d ["']?\/tmp\/mlp-backup\.XXXXXX/u);
  assertFailSafeCleanupTraps(source, {
    graceSeconds: 3,
    requiredCleanupFragments: ['unset PGPASSWORD', 'rm -rf'],
  });
  assert.match(source, /rm -rf (?:-- )?["']?\$\{?work\}?/u);
  assert.match(
    source,
    /export RESTIC_CACHE_DIR=["']?\$\{?work\}?\/restic-cache/u,
  );
  assert.match(source, /pg_dump[\s\\]+--format=(?:custom|c)\b/u);
  assert.match(source, /pg_dump[^\n]*(?:--file=|-f[\s"])/u);
  assertPreservesDumpOwnershipAndAcls(source);
  assertPgPasswordLifecycle(source);
  assert.match(source, /run_child[\s\\]+pg_dump\b/u);
  assert.match(source, /run_child[\s\\]+pg_restore[\s\\]+--list\b/u);

  const resticCommands = logicalShellLines(source).filter((line) =>
    line.includes('run_child /usr/local/bin/mlp-restic'),
  );
  const scopedCommand = (subcommand) => {
    const command = resticCommands.find((line) =>
      line.includes(`mlp-restic ${subcommand}`),
    );
    assert.ok(command, `backup must run scoped Restic ${subcommand}`);
    assert.match(command, /--host(?:=| )mlp-prod\b/u);
    assert.match(command, /--tag(?:=| )mlp-postgresql\b/u);
    return command;
  };
  scopedCommand('backup');
  const forgetCommand = scopedCommand('forget');
  assert.match(forgetCommand, /--keep-daily(?:=| )30\b/u);
  assert.match(forgetCommand, /--prune\b/u);
  const checkCommand = resticCommands.find((line) =>
    line.includes('mlp-restic check'),
  );
  assert.ok(checkCommand, 'backup must run Restic check');
  assert.match(checkCommand, /--read-data-subset=5%(?:\s|$)/u);
  assert.doesNotMatch(source, /^(?:set -x|env|printenv)\b/mu);
  assert.doesNotMatch(
    source,
    /(?:echo|printf)[^\n]*(?:PGPASSWORD|RESTIC_PASSWORD|AWS_)/iu,
  );
  for (const [childName, signal, status, ignoreTerm] of [
    ['pg_dump', 'SIGHUP', 129, true],
    ['pg_restore', 'SIGINT', 130, false],
    ['mlp-restic', 'SIGTERM', 143, false],
  ]) {
    await assertSignalForwarding(source, {
      childName,
      ignoreTerm,
      kind: 'backup',
      signal,
      status,
    });
  }
  const resticSource = await readRequiredText(
    repositoryRoot,
    'infra/backup/restic.sh',
  );
  await assertNestedSignalForwarding(source, resticSource, {
    actualScripts: true,
  });
});

test('POSIX mlp-restic scopes file-backed backend credentials to one invocation', async () => {
  const relativePath = 'infra/backup/restic.sh';
  const source = await readRequiredText(repositoryRoot, relativePath);
  assertPosixScript(source);
  await assertExecutableRegularFile(repositoryRoot, relativePath);
  await assertPosixSyntax(relativePath);
  assert.match(source, /\$\{RESTIC_REPOSITORY:\?/u);
  for (const variableName of [
    'RESTIC_PASSWORD_FILE',
    'RESTIC_S3_ACCESS_KEY_ID_FILE',
    'RESTIC_S3_SECRET_ACCESS_KEY_FILE',
  ]) {
    assertReadableNonemptySecret(source, variableName);
  }
  assert.match(source, /export AWS_ACCESS_KEY_ID=/u);
  assert.match(source, /export AWS_SECRET_ACCESS_KEY=/u);
  assert.match(
    source,
    /run_child[\s\\]+\/usr\/local\/bin\/restic[\s\\]+["']?\$@["']?/u,
  );
  assert.doesNotMatch(
    source,
    /exec[\s\\]+\/usr\/local\/bin\/restic/u,
    'helper must regain control to unset backend credentials',
  );
  assert.match(source, /unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY/u);
  assertFailSafeCleanupTraps(source, {
    graceSeconds: 1,
    requiredCleanupFragments: ['unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY'],
  });
  assert.match(source, /exit ["']?\$\{?status\}?/u);
  assert.doesNotMatch(source, /^(?:set -x|env|printenv)\b/mu);
  assert.doesNotMatch(
    source,
    /(?:echo|printf)[^\n]*(?:RESTIC_PASSWORD|AWS_)/iu,
  );
  assert.doesNotMatch(
    source,
    /(?:echo|printf)[^\n]*RESTIC_REPOSITORY/iu,
    'Restic helper must not print its repository value',
  );
  for (const repository of [
    's3:https://user:password@storage.invalid/mlp',
    's3:https://storage.invalid/mlp?token=task8',
    's3:https://storage.invalid/mlp?access_key=task8',
  ]) {
    await assertUnsafeResticRepositoryRejected(source, repository);
  }
  for (const [signal, status, ignoreTerm] of [
    ['SIGHUP', 129, true],
    ['SIGINT', 130, false],
    ['SIGTERM', 143, false],
  ]) {
    await assertSignalForwarding(source, {
      childName: 'restic',
      ignoreTerm,
      kind: 'restic',
      signal,
      status,
    });
  }
});
