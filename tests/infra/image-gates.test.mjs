import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const harnessPath = path.join(
  repositoryRoot,
  'scripts',
  'ci',
  'verify-images.sh',
);

async function runHarness(env, args = []) {
  return execFile('/bin/sh', [harnessPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env,
  }).catch((error) => error);
}

async function readHarness() {
  return readFile(harnessPath, 'utf8');
}

function shellFunctionBody(source, name) {
  const marker = `${name}() {\n`;
  const lineMarker = `\n${marker}`;
  const lineStart = source.indexOf(lineMarker);
  const start = source.startsWith(marker)
    ? 0
    : lineStart === -1
    ? -1
    : lineStart + 1;
  assert.notEqual(start, -1, `missing shell function: ${name}`);
  const bodyStart = start + marker.length;
  const remainder = source.slice(bodyStart);
  const end = remainder.search(/^\}\n/gmu);
  assert.notEqual(end, -1, `unterminated shell function: ${name}`);
  return remainder.slice(0, end);
}

function shellFunction(source, name) {
  return `${name}() {\n${shellFunctionBody(source, name)}}\n`;
}

function shellHereDocument(source, name) {
  const marker = `<<'${name}'\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing shell here-document: ${name}`);
  const bodyStart = start + marker.length;
  const endMarker = `\n${name}\n`;
  const end = source.indexOf(endMarker, bodyStart);
  assert.notEqual(end, -1, `unterminated shell here-document: ${name}`);
  return source.slice(bodyStart, end);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function withoutDockerEndpointOverrides(extra = {}) {
  const environment = { ...process.env };
  for (const variableName of [
    'BUILDKIT_HOST',
    'BUILDX_BUILDER',
    'DOCKER_CERT_PATH',
    'DOCKER_CONTEXT',
    'DOCKER_HOST',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
  ]) {
    delete environment[variableName];
  }
  return { ...environment, ...extra };
}

const cleanupFunctionNames = [
  'labeled_resource_state',
  'remove_labeled_resource',
  'cleanup_labeled_resource',
  'image_reference_state',
  'cleanup_image_reference',
  'cleanup_failure_images',
  'cleanup',
  'install_cleanup_traps',
];

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

async function createCleanupFixture(source, options = {}) {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-cleanup-test-'),
  );
  const binDirectory = path.join(fixtureRoot, 'bin');
  const stateDirectory = path.join(fixtureRoot, 'state');
  const cleanupWork = path.join(fixtureRoot, 'cleanup-work');
  const logPath = path.join(fixtureRoot, 'docker.log');
  const removeMarker = path.join(fixtureRoot, 'remove-entered');
  await Promise.all([
    mkdir(binDirectory),
    mkdir(stateDirectory),
    mkdir(cleanupWork),
    writeFile(logPath, ''),
  ]);

  const dockerPath = path.join(binDirectory, 'docker');
  await writeFile(
    dockerPath,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG"
kind=$1
action=$2
last=
for argument in "$@"; do last=$argument; done
if [ "$kind" = image ]; then
  state="$FAKE_DOCKER_STATE/image"
  case $action in
    inspect)
      [ -f "$state" ] || exit 1
      case "$*" in
        *'.Id'*) sed -n '1p' "$state" ;;
        *'org.opencontainers.image.revision'*) sed -n '2p' "$state" ;;
        *) exit 2 ;;
      esac
      ;;
    ls)
      [ -f "$state" ] && sed -n '1p' "$state"
      ;;
    rm)
      [ "$last" = "$FAKE_RESOURCE_NAME" ] || exit 2
      if [ "\${FAKE_EXPECT_LOCK_OPEN:-0}" -eq 1 ]; then
        if ( : >&9 ) 2>/dev/null; then
          printf '%s\n' lock-open >>"$FAKE_DOCKER_LOG"
        else
          printf '%s\n' lock-closed >>"$FAKE_DOCKER_LOG"
          exit 3
        fi
      fi
      [ "\${FAKE_REMOVE_FAIL:-0}" -ne 1 ] || exit 1
      [ -z "\${FAKE_REMOVE_DELAY:-}" ] || {
        : >"$FAKE_REMOVE_MARKER"
        /bin/sleep "$FAKE_REMOVE_DELAY"
      }
      rm -f "$state"
      ;;
    *) exit 2 ;;
  esac
  exit 0
fi

state="$FAKE_DOCKER_STATE/resource"
case $action in
  inspect)
    [ -f "$state" ] || exit 1
    sed -n '1p' "$state"
    ;;
  ls)
    [ -f "$state" ] && printf '%s\\n' "$FAKE_RESOURCE_NAME"
    ;;
  rm)
    [ "$last" = "$FAKE_RESOURCE_NAME" ] || exit 2
    [ "\${FAKE_REMOVE_FAIL:-0}" -ne 1 ] || exit 1
    [ -z "\${FAKE_REMOVE_DELAY:-}" ] || {
      : >"$FAKE_REMOVE_MARKER"
      /bin/sleep "$FAKE_REMOVE_DELAY"
    }
    rm -f "$state"
    ;;
  *) exit 2 ;;
esac
`,
  );
  await chmod(dockerPath, 0o755);

  if (options.resourceLabel) {
    await writeFile(
      path.join(stateDirectory, 'resource'),
      `${options.resourceLabel}\n`,
    );
  }
  if (options.imageId) {
    await writeFile(
      path.join(stateDirectory, 'image'),
      `${options.imageId}\n${options.imageRevision ?? 'a'.repeat(40)}\n`,
    );
  }
  const wrapperPath = path.join(fixtureRoot, 'fixture.sh');
  const functions = cleanupFunctionNames
    .map((name) => shellFunction(source, name))
    .join('\n');
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -u
RUN_ID=owned-run
COMMIT_SHA=${'a'.repeat(40)}
STAGING_IMAGE_SUFFIX=staging-${'a'.repeat(40)}-fixture
SUCCESS=${options.success ?? 0}
TRACKED_CONTAINERS=${shellQuote(options.containers ?? '')}
TRACKED_NETWORKS=${shellQuote(options.networks ?? '')}
TRACKED_VOLUMES=${shellQuote(options.volumes ?? '')}
TRACKED_IMAGES=${shellQuote(options.images ?? '')}
WORK_DIRECTORY="$CLEANUP_WORK"
PROMOTION_LOCK_FILE="$CLEANUP_WORK.promotion-lock"
PROMOTION_LOCK_HELD=${options.promotionLockHeld ? 1 : 0}
if [ "$PROMOTION_LOCK_HELD" -eq 1 ]; then
  exec 9>>"$PROMOTION_LOCK_FILE"
fi
MLP_IMAGE_GATE_SECRET_SENTINEL=fixture-secret
${functions}
sleep() { :; }
install_cleanup_traps
if [ "${options.waitForSignal ? 'yes' : 'no'}" = yes ]; then
  printf 'ready\\n'
  while :; do /bin/sleep 0.05; done
fi
exit 0
`,
  );
  await chmod(wrapperPath, 0o755);

  return {
    cleanupWork,
    fixtureRoot,
    logPath,
    removeMarker,
    stateDirectory,
    wrapperPath,
    env: {
      ...process.env,
      CLEANUP_WORK: cleanupWork,
      FAKE_DOCKER_LOG: logPath,
      FAKE_DOCKER_STATE: stateDirectory,
      FAKE_EXPECT_LOCK_OPEN: options.expectLockOpen ? '1' : '0',
      FAKE_REMOVE_DELAY: options.removeDelay ?? '',
      FAKE_REMOVE_FAIL: options.removeFail ? '1' : '0',
      FAKE_REMOVE_MARKER: removeMarker,
      FAKE_RESOURCE_NAME: options.resourceName ?? 'owned-resource',
      PATH: `${binDirectory}:${process.env.PATH}`,
    },
  };
}

test('image gate rejects a missing or malformed commit SHA before using Docker', async () => {
  const secret = 'IMAGE_GATE_INPUT_SECRET_MUST_NOT_LEAK';
  for (const commitSha of [
    '',
    'ABCDEF',
    'a'.repeat(39),
    'A'.repeat(40),
    'g'.repeat(40),
  ]) {
    const result = await runHarness({
      COMMIT_SHA: commitSha,
      MLP_IMAGE_GATE_TEST_SECRET: secret,
      PATH: '/path/that/does/not/exist',
    });

    assert.equal(result?.code, 64);
    assert.match(
      `${result?.stdout ?? ''}${result?.stderr ?? ''}`,
      /COMMIT_SHA must be exactly 40 lowercase hexadecimal characters/u,
    );
    assert.doesNotMatch(
      `${result?.stdout ?? ''}${result?.stderr ?? ''}`,
      new RegExp(secret, 'u'),
    );
  }
});

test('image gate rejects positional arguments before using Docker', async () => {
  const secret = 'IMAGE_GATE_ARGUMENT_SECRET_MUST_NOT_LEAK';
  const result = await runHarness(
    {
      COMMIT_SHA: 'a'.repeat(40),
      MLP_IMAGE_GATE_TEST_SECRET: secret,
      PATH: '/path/that/does/not/exist',
    },
    ['unexpected'],
  );
  const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}`;

  assert.equal(result?.code, 64);
  assert.match(output, /usage: verify-images\.sh/u);
  assert.doesNotMatch(output, new RegExp(secret, 'u'));
});

test('image gate fails closed and redacts daemon diagnostics when Docker is unavailable', async (t) => {
  const temporaryBin = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-gate-bin-'),
  );
  t.after(() => rm(temporaryBin, { force: true, recursive: true }));
  const secret = 'IMAGE_GATE_DOCKER_SECRET_MUST_NOT_LEAK';
  const dockerStub = path.join(temporaryBin, 'docker');
  await writeFile(
    dockerStub,
    `#!/bin/sh\nprintf '%s\\n' "${secret}" >&2\nexit 1\n`,
    { mode: 0o700 },
  );
  await chmod(dockerStub, 0o700);

  const result = await runHarness({
    COMMIT_SHA: 'a'.repeat(40),
    MLP_IMAGE_GATE_TEST_SECRET: secret,
    PATH: temporaryBin,
  });
  const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}`;

  assert.notEqual(result?.code, 0);
  assert.match(output, /Docker daemon is required/u);
  assert.doesNotMatch(output, /skip(?:ped)?/iu);
  assert.doesNotMatch(output, new RegExp(secret, 'u'));
  assert.doesNotMatch(await readHarness(), /skip(?:ped)?/iu);
});

test('image gate rejects endpoint and builder overrides before any Docker call', async (t) => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-gate-endpoint-'),
  );
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const dockerLog = path.join(temporaryRoot, 'docker.log');
  const dockerStub = path.join(temporaryRoot, 'docker');
  await writeFile(
    dockerStub,
    `#!/bin/sh
printf '%s\n' "$*" >>"$DOCKER_CALL_LOG"
exit 0
`,
  );
  await chmod(dockerStub, 0o700);

  const overrides = {
    BUILDKIT_HOST: 'tcp://remote-buildkit.invalid:1234',
    BUILDX_BUILDER: 'remote-builder',
    DOCKER_CERT_PATH: '/tmp/untrusted-docker-certs',
    DOCKER_CONTEXT: 'remote-context',
    DOCKER_HOST: 'tcp://remote-docker.invalid:2376',
    DOCKER_TLS: '1',
    DOCKER_TLS_VERIFY: '1',
  };
  for (const [variableName, value] of Object.entries(overrides)) {
    await writeFile(dockerLog, '');
    const result = await runHarness(
      withoutDockerEndpointOverrides({
        COMMIT_SHA: 'a'.repeat(40),
        DOCKER_CALL_LOG: dockerLog,
        PATH: `${temporaryRoot}:${process.env.PATH}`,
        [variableName]: value,
      }),
    );
    const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}`;

    assert.notEqual(result?.code, 0, `${variableName} was accepted`);
    assert.match(output, new RegExp(variableName, 'u'));
    assert.equal(await readFile(dockerLog, 'utf8'), '');
  }

  const source = await readHarness();
  assert.match(source, /DOCKER_CLI=.*command -v docker/u);
  assert.match(
    source,
    /"\$DOCKER_CLI" --host unix:\/\/\/var\/run\/docker\.sock "\$@"/u,
  );
});

test('image gate builds and inspects the exact four-image linux-amd64 matrix', async () => {
  const source = await readHarness();
  const expectedRows = [
    'app|Dockerfile|1000:1000|mlp-image-gate-app',
    'backup|infra/backup/Dockerfile|10001:10001|mlp-image-gate-backup',
    'caddy|infra/caddy/Dockerfile|65532:65532|mlp-image-gate-caddy',
    'migration|infra/migration/Dockerfile|1000:1000|mlp-image-gate-migration',
  ];

  for (const row of expectedRows) {
    const escaped = row.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    assert.equal(
      source.match(new RegExp(`^${escaped}$`, 'gmu'))?.length ?? 0,
      1,
      `missing exact image matrix row: ${row}`,
    );
  }

  assert.match(source, /docker buildx build[\s\S]*--platform linux\/amd64/u);
  assert.match(source, /builder_endpoint_count/u);
  assert.match(source, /builder_endpoint_count" -eq 1/u);
  assert.match(source, /unix:\/\/\/var\/run\/docker\.sock/u);
  assert.match(
    source,
    /docker buildx inspect --bootstrap "\$IMAGE_GATE_BUILDER_NAME"/u,
  );
  assert.equal(
    source.match(/--builder "\$IMAGE_GATE_BUILDER_NAME"/gu)?.length,
    2,
  );
  assert.match(source, /--build-arg "COMMIT_SHA=\$COMMIT_SHA"/u);
  assert.match(source, /--load/u);
  assert.match(source, /INVALID_COMMIT_SHA="\$\{COMMIT_SHA\}A"/u);
  assert.match(source, /negative COMMIT_SHA build unexpectedly succeeded/u);
  assert.match(source, /docker image inspect --format='\{\{\.Id\}\}'/u);
  assert.match(
    source,
    /index \.Config\.Labels "org\.opencontainers\.image\.revision"/u,
  );
  assert.match(source, /docker image inspect --format='\{\{\.Os\}\}'/u);
  assert.match(
    source,
    /docker image inspect --format='\{\{\.Architecture\}\}'/u,
  );
  assert.match(
    source,
    /docker image inspect --format='\{\{\.Config\.User\}\}'/u,
  );
  assert.match(source, /\^sha256:\[0-9a-f\]\{64\}\$/u);
});

test('image gate audits image history, configuration, and exported filesystem for secrets', async () => {
  const source = await readHarness();

  assert.match(source, /docker history --no-trunc/u);
  assert.match(
    source,
    /docker image inspect --format='\{\{json \.Config\.Env\}\}'/u,
  );
  assert.match(source, /docker create/u);
  assert.match(source, /docker export/u);
  assert.match(source, /tar -tf/u);
  assert.match(source, /grep -Eiq -- "\$credential_uri_pattern"/u);
  assert.match(source, /find_private_key_files/u);
  assert.match(source, /chmod -R u\+rwX "\$WORK_DIRECTORY"/u);
  assert.doesNotMatch(source, /tar[^\n]*--mode=/u);
  for (const forbidden of [
    '\\.env',
    'run/secrets',
    'migration-artifacts',
    'PRIVATE KEY',
    'postgresql://',
    'mongodb://',
  ]) {
    assert.match(source, new RegExp(forbidden, 'u'));
  }
  assert.match(source, /MLP_IMAGE_GATE_SECRET_SENTINEL/u);
});

test('private-key audit rejects a complete real key but not PEM marker templates', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-key-audit-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const wrapperPath = path.join(fixtureRoot, 'scan-private-keys.sh');
  const templatePath = path.join(fixtureRoot, 'template.txt');
  const binaryMarkerPath = path.join(fixtureRoot, 'binary-marker.bin');
  const privateKeyPath = path.join(fixtureRoot, 'real-private-key');

  await writeFile(
    templatePath,
    [
      '-----BEGIN PRIVATE KEY-----',
      '{{ BASE64_PRIVATE_KEY }}',
      '-----END PRIVATE KEY-----',
      '',
    ].join('\n'),
  );
  await writeFile(
    binaryMarkerPath,
    Buffer.concat([
      Buffer.from([0, 1, 2, 3]),
      Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----'),
      Buffer.from([0, 255, 4, 5]),
    ]),
  );
  await execFile('ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-f',
    privateKeyPath,
  ]);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nset -eu\n${shellFunction(
      source,
      'find_private_key_files',
    )}\nfind_private_key_files "$@"\n`,
  );
  await chmod(wrapperPath, 0o755);

  const result = await execFile(
    '/bin/sh',
    [wrapperPath, templatePath, binaryMarkerPath, privateKeyPath],
    { encoding: 'utf8' },
  );
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\n'), [privateKeyPath]);
});

test('failed image builds emit only bounded categorized diagnostics', async (context) => {
  const source = await readHarness();
  const buildImage = shellFunctionBody(source, 'build_image');
  assert.ok(
    buildImage.indexOf('report_build_failure') >= 0 &&
      buildImage.indexOf('report_build_failure') <
        buildImage.indexOf('fail "image build failed'),
    'categorized diagnostics must be emitted before the build log is cleaned',
  );
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-build-diagnostic-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const wrapperPath = path.join(fixtureRoot, 'report-build-failure.sh');
  const logPath = path.join(fixtureRoot, 'build.log');
  const secret = 'BUILD_DIAGNOSTIC_SECRET_MUST_NOT_LEAK';
  await writeFile(
    logPath,
    [
      '#7 ERROR: failed to solve: process did not complete successfully: exit code: 17',
      'Dockerfile:42',
      `postgresql://operator:${secret}@database.invalid/portfolio`,
      '-----BEGIN PRIVATE KEY-----',
      secret,
      '-----END PRIVATE KEY-----',
      `token=${secret}`,
      '',
    ].join('\n'),
  );
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nset -eu\n${shellFunction(
      source,
      'report_build_failure',
    )}\nreport_build_failure app "$1"\n`,
  );
  await chmod(wrapperPath, 0o755);

  const result = await execFile('/bin/sh', [wrapperPath, logPath], {
    encoding: 'utf8',
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /build diagnostics: app/u);
  assert.match(output, /build-error=1/u);
  assert.match(output, /command-exit=1/u);
  assert.match(output, /dockerfile-lines=42/u);
  assert.ok(output.length < 1500, 'diagnostics must remain bounded');
  assert.doesNotMatch(output, new RegExp(secret, 'u'));
  assert.doesNotMatch(output, /postgresql:\/\//u);
  assert.doesNotMatch(output, /BEGIN PRIVATE KEY/u);
});

test('image gate enforces hardened runtime settings and retains only verified success tags', async () => {
  const source = await readHarness();

  assert.match(source, /\[ "\$#" -eq 0 \]/u);
  assert.match(source, /--read-only/u);
  assert.match(source, /--cap-drop ALL/u);
  assert.match(source, /--security-opt no-new-privileges:true/u);
  assert.match(
    source,
    /docker container inspect --format='\{\{\.HostConfig\.ReadonlyRootfs\}\}'/u,
  );
  assert.match(
    source,
    /docker container inspect --format='\{\{json \.HostConfig\.CapDrop\}\}'/u,
  );
  assert.match(
    source,
    /docker container inspect --format='\{\{json \.HostConfig\.SecurityOpt\}\}'/u,
  );
  assert.match(source, /assert_runtime_hardening/u);
  assert.match(source, /verify_caddy_runtime/u);
  assert.match(source, /getcap \/usr\/bin\/caddy/u);
  assert.match(source, /RUN_RANDOM_SUFFIX=\$\{WORK_DIRECTORY##\*\.\}/u);
  assert.match(
    source,
    /STAGING_IMAGE_SUFFIX="staging-\$COMMIT_SHA-\$RUN_RANDOM_SUFFIX"/u,
  );
  assert.match(
    source,
    /RUN_ID="mlp-image-gate-\$COMMIT_SHA-\$RUN_RANDOM_SUFFIX"/u,
  );
  assert.doesNotMatch(source, /RUN_ID=.*\$\$/u);
  assert.match(
    source,
    /PROMOTION_LOCK_FILE="\/tmp\/mlp-image-gate-promotion-\$COMMIT_SHA\.lock"/u,
  );
  assert.doesNotMatch(source, /PROMOTION_LOCK_FILE="\$\{TMPDIR:-\/tmp\}/u);
  assert.match(source, /flock --exclusive --nonblock 9/u);
  assert.match(source, /image_reference="\$image_tag:\$STAGING_IMAGE_SUFFIX"/u);
  assert.match(
    source,
    /record_image_id "\$image_reference" "\$image_id" always/u,
  );
  assert.match(source, /assert_image_tag_absent/u);
  assert.match(source, /promote_image "\$APP_IMAGE" "\$APP_CANONICAL_IMAGE"/u);
  assert.match(
    source,
    /promote_image "\$CADDY_IMAGE" "\$CADDY_CANONICAL_IMAGE"/u,
  );
  assert.match(source, /acquire_promotion_lock/u);
  assert.match(source, /verify_promoted_image/u);
  assert.match(
    shellFunctionBody(source, 'promote_image'),
    /\[ "\$PROMOTION_LOCK_HELD" -eq 1 \]/u,
  );
  assert.equal(source.match(/docker image tag /gu)?.length, 1);
  assert.match(source, /\[ "\$SUCCESS" -ne 1 \]/u);
  assert.match(source, /SUCCESS=1/u);
});

test('image gate migrates a source database and exercises app health, precache, and byte ranges', async () => {
  const source = await readHarness();

  assert.match(
    source,
    /POSTGRES_IMAGE='postgres:18\.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'/u,
  );
  assert.match(source, /create role portfolio_app login/u);
  assert.match(source, /create role portfolio_backup login/u);
  assert.match(source, /node \/app\/dist\/scripts\/db\/migrate\.js/u);
  for (const pathName of [
    '/api/health/live',
    '/api/health/ready',
    '/sw.js',
    '/sw-manifest.json',
  ]) {
    assert.match(source, new RegExp(pathName.replaceAll('/', '\\/'), 'u'));
  }
  assert.match(source, /jq --exit-status/u);
  assert.match(source, /type == "array"/u);
  assert.match(source, /curl[\s\S]*--fail/u);
  assert.match(source, /\/assets\/man\.mp4/u);
  assert.match(source, /Range: bytes=0-31/u);
  assert.match(source, /Content-Range/u);
  assert.match(source, /\[ "\$range_status" -eq 206 \]/u);
  assert.match(source, /\[ "\$range_bytes" -eq 32 \]/u);
});

test('image gate uses the restricted migrator as owner and proves the production ACL contract before and after restore', async () => {
  const source = await readHarness();
  const productionBootstrap = await readFile(
    path.join(repositoryRoot, 'infra', 'postgres', 'init-roles.sh'),
    'utf8',
  );
  const bootstrap = shellFunctionBody(source, 'bootstrap_database_roles');
  const migrations = shellFunctionBody(source, 'run_database_migrations');
  const verification = shellFunctionBody(
    source,
    'verify_database_security_contract',
  );
  const restore = shellFunctionBody(source, 'run_backup_restore_cycle');

  assert.match(
    bootstrap,
    /create role portfolio_migrator login nosuperuser nocreatedb nocreaterole noreplication nobypassrls/u,
  );
  assert.match(
    bootstrap,
    /alter database :"database_name" owner to portfolio_migrator/u,
  );
  assert.doesNotMatch(productionBootstrap, /alter schema public owner/iu);
  assert.doesNotMatch(bootstrap, /alter schema public owner/iu);
  assert.match(migrations, /--env PGUSER=portfolio_migrator/u);
  assert.doesNotMatch(migrations, /--env PGUSER=postgres/u);
  assert.match(verification, /pg_get_userbyid\(datdba\)/u);
  assert.match(
    verification,
    /pg_get_userbyid\(nspowner\)[\s\S]*is distinct from 'pg_database_owner'/u,
  );
  assert.match(verification, /pg_get_userbyid\(relowner\)/u);
  assert.match(verification, /has_table_privilege/u);
  assert.match(verification, /portfolio_app/u);
  assert.match(verification, /portfolio_backup/u);
  assert.match(verification, /application_table_count <> 10/u);
  assert.match(verification, /owned_table_count <> 12/u);
  assert.match(verification, /runtime_roles\(role_name\)/u);
  assert.match(verification, /runtime_tables\(table_name\)/u);
  assert.doesNotMatch(source, /create table image_gate_restore_marker/u);
  assert.match(source, /insert into profile_sections/u);
  assert.equal(
    source.match(/^\s*verify_database_security_contract /gmu)?.length,
    2,
    'security contract must run after migration and after restore',
  );
  assert.equal(
    source.match(/^\s*bootstrap_database_roles /gmu)?.length,
    2,
    'source and restore databases must bootstrap the same production roles',
  );
  assert.match(restore, /exec pg_restore/u);
  assert.match(restore, /--username postgres/u);
  assert.doesNotMatch(restore, /--no-owner|--no-acl/u);
  assert.match(
    restore,
    /psql --no-psqlrc --quiet --tuples-only --no-align --dbname imagegate_restore/u,
  );
});

test('image gate performs a real PostgreSQL dump through Restic and restores it with pg_restore', async () => {
  const source = await readHarness();

  assert.match(source, /\/usr\/local\/bin\/mlp-backup/u);
  assert.match(
    source,
    /--entrypoint \/usr\/local\/bin\/mlp-restic[\s\S]*"\$BACKUP_IMAGE" init/u,
  );
  assert.match(source, /RESTIC_REPOSITORY=\/restic/u);
  assert.match(source, /message_type == "summary"/u);
  assert.match(source, /snapshot_id/u);
  assert.match(
    source,
    /--entrypoint \/usr\/local\/bin\/mlp-restic[\s\S]*"\$BACKUP_IMAGE" restore/u,
  );
  assert.match(source, /postgresql\.dump/u);
  assert.match(source, /pg_restore --exit-on-error/u);
  assert.match(source, /imagegate_restore/u);
  assert.match(source, /profile_sections/u);
  assert.match(source, /image-gate-restore-ok/u);
  assert.match(source, /run_backup_restore_cycle/u);
});

test('image gate verifies the operator tools, exact public tree, and fail-closed dispatcher', async () => {
  const source = await readHarness();

  for (const expectedToolCheck of [
    'node --version',
    'v22.23.1',
    'mongodump --version',
    'mongodump version: 100.17.0',
    'age --version',
    'v1.3.1',
  ]) {
    assert.match(
      source,
      new RegExp(expectedToolCheck.replaceAll('.', '\\.'), 'u'),
    );
  }
  assert.match(source, /\[ "\$operator_uid" -eq 1000 \]/u);
  assert.match(source, /write_public_tree_manifest/u);
  assert.match(source, /sha256sum/u);
  assert.match(source, /cmp -s/u);
  for (const invalidInvocation of [
    'no-arguments',
    'unknown-command',
    'wrong-export-arity',
    'missing-remove-uuid',
    'extra-remove-argument',
  ]) {
    assert.match(source, new RegExp(invalidInvocation, 'u'));
  }
  assert.match(source, /\[ "\$dispatcher_status" -eq 64 \]/u);
  assert.match(
    source,
    /usage: mlp-migration \{export\|rehearsal\|preload\|contacts\|remove-synthetic UUID\}/u,
  );
  assert.match(source, /verify_migration_operator/u);
});

test('image gate executes every valid migration dispatcher path without an external Mongo service', async () => {
  const source = await readHarness();
  const operator = shellFunctionBody(source, 'verify_migration_operator');

  assert.match(operator, /mongodump-stub/u);
  assert.match(operator, /--network none/u);
  assert.match(operator, /"\$MIGRATION_IMAGE" export/u);
  assert.match(operator, /age-encryption\.org\/v1/u);
  assert.match(operator, /\[ "\$artifact_bytes" -gt 200 \]/u);
  assert.match(operator, /ssh-keygen -q -t ed25519/u);
  assert.match(operator, /age --decrypt --identity/u);
  assert.match(operator, /deterministic-image-gate-mongo-archive/u);
  assert.match(operator, /\/app\/scripts\/migration\/run-rehearsal\.js/u);
  assert.match(operator, /\/app\/scripts\/migration\/preload-content\.js/u);
  assert.match(operator, /\/app\/scripts\/migration\/finalize-contacts\.js/u);
  assert.match(
    operator,
    /for dispatcher_command in rehearsal preload contacts/u,
  );
  assert.match(operator, /"\$MIGRATION_IMAGE" "\$dispatcher_command"/u);
  assert.match(operator, /CONTACT_TRAFFIC_DRAINED=yes/u);
  assert.match(operator, /--env PGUSER=portfolio_migrator/u);
  assert.match(
    operator,
    /"\$MIGRATION_IMAGE" remove-synthetic "\$synthetic_contact_id"/u,
  );
  assert.match(operator, /synthetic contact removed/u);
  assert.match(
    operator,
    /protected_contact_id=00000000-0000-4000-8000-000000000002/u,
  );
  assert.match(operator, /Protected Image Gate/u);
  assert.match(operator, /protected_contact_state/u);
  assert.match(operator, /must survive/u);
  assert.doesNotMatch(operator, /mongo:|mongod:/u);
});

test('operator export verifier accepts only the exact decrypted deterministic payload', async (context) => {
  const source = await readHarness();
  const verifier = shellHereDocument(source, 'OPERATOR_EXPORT_VERIFIER');
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-export-verifier-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const artifactDirectory = path.join(fixtureRoot, 'artifacts');
  const binDirectory = path.join(fixtureRoot, 'bin');
  const artifactPath = path.join(
    artifactDirectory,
    'mongo-final-20260715T000000Z.archive.gz.age',
  );
  const identityPath = path.join(fixtureRoot, 'age-identity');
  const verifierPath = path.join(fixtureRoot, 'verify-export');
  await Promise.all([mkdir(artifactDirectory), mkdir(binDirectory)]);
  await writeFile(
    artifactPath,
    `age-encryption.org/v1\n${'ciphertext'.repeat(32)}\n`,
  );
  await chmod(artifactPath, 0o600);
  await writeFile(identityPath, 'ephemeral-test-identity\n');
  await chmod(identityPath, 0o400);
  await writeFile(verifierPath, `${verifier}\n`);
  await chmod(verifierPath, 0o755);

  await writeFile(
    path.join(binDirectory, 'age'),
    `#!/bin/sh
set -eu
[ "$1" = --decrypt ]
[ "$2" = --identity ]
[ "$3" = "$AGE_IDENTITY_FILE" ]
[ "$4" = "$EXPECTED_ARTIFACT" ]
case \${FAKE_AGE_MODE-} in
  correct) printf '%s' 'deterministic-image-gate-mongo-archive' ;;
  wrong) printf '%s' 'wrong-image-gate-mongo-archive' ;;
  empty) : ;;
  truncated)
    printf '%s' 'deterministic-image-gate-mongo-archive'
    exit 1
    ;;
  *) exit 2 ;;
esac
`,
  );
  await writeFile(
    path.join(binDirectory, 'stat'),
    `#!/bin/sh
set -eu
[ "$1" = -c ]
format=$2
file=$3
case $format in
  %s) /usr/bin/wc -c <"$file" | /usr/bin/tr -d '[:space:]' ;;
  %a)
    if [ "$file" = "$AGE_IDENTITY_FILE" ]; then printf '400\\n'; else printf '600\\n'; fi
    ;;
  %u:%g) printf '1000:1000\\n' ;;
  *) exit 2 ;;
esac
`,
  );
  await Promise.all([
    chmod(path.join(binDirectory, 'age'), 0o755),
    chmod(path.join(binDirectory, 'stat'), 0o755),
  ]);

  const baseEnvironment = {
    ...process.env,
    AGE_IDENTITY_FILE: identityPath,
    ARTIFACT_DIR: artifactDirectory,
    EXPECTED_ARTIFACT: artifactPath,
    PATH: `${binDirectory}:${process.env.PATH}`,
  };
  const accepted = await execFile('/bin/sh', [verifierPath], {
    encoding: 'utf8',
    env: { ...baseEnvironment, FAKE_AGE_MODE: 'correct' },
  });
  assert.equal(accepted.stdout, '');

  for (const rejectedMode of ['wrong', 'empty', 'truncated']) {
    await assert.rejects(
      execFile('/bin/sh', [verifierPath], {
        encoding: 'utf8',
        env: { ...baseEnvironment, FAKE_AGE_MODE: rejectedMode },
      }),
      `${rejectedMode} payload was accepted`,
    );
  }
});

test('node dispatcher target stub rejects absent and symlinked compiled targets', async (context) => {
  const source = await readHarness();
  const stub = shellHereDocument(source, 'NODE_TARGET_STUB');
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-node-target-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const regularTarget = path.join(fixtureRoot, 'compiled-target.js');
  const symlinkTarget = path.join(fixtureRoot, 'compiled-target-link.js');
  const missingTarget = path.join(fixtureRoot, 'missing-target.js');
  const stubPath = path.join(fixtureRoot, 'node-target-stub');
  await writeFile(regularTarget, 'export {};\n');
  await chmod(regularTarget, 0o444);
  await symlink(regularTarget, symlinkTarget);
  await writeFile(stubPath, `${stub}\n`);
  await chmod(stubPath, 0o755);

  const accepted = await execFile('/bin/sh', [stubPath, regularTarget], {
    encoding: 'utf8',
    env: { ...process.env, EXPECTED_NODE_TARGET: regularTarget },
  });
  assert.equal(accepted.stdout, `${regularTarget}\n`);

  for (const rejectedTarget of [missingTarget, symlinkTarget]) {
    await assert.rejects(
      execFile('/bin/sh', [stubPath, rejectedTarget], {
        encoding: 'utf8',
        env: { ...process.env, EXPECTED_NODE_TARGET: rejectedTarget },
      }),
      `${rejectedTarget} was accepted`,
    );
  }
});

test('image gate cleanup is labeled, deterministic, redacted, and preserves only successful verified tags', async () => {
  const source = await readHarness();
  const cleanup = shellFunctionBody(source, 'cleanup');
  const containerCleanup = source.indexOf(
    'docker container rm --force --volumes',
  );
  const networkCleanup = source.indexOf('docker network rm');
  const volumeCleanup = source.indexOf('docker volume rm --force');
  const imageCleanup = source.indexOf('docker image rm --force');
  const workCleanup = source.indexOf(
    'rm -rf "$WORK_DIRECTORY"',
    source.indexOf('\ncleanup() {'),
  );
  const failureImageCleanup = cleanup.indexOf('cleanup_failure_images');
  const promotionLockRelease = cleanup.indexOf('exec 9>&-');

  assert.ok(containerCleanup >= 0);
  assert.ok(networkCleanup > containerCleanup);
  assert.ok(volumeCleanup > networkCleanup);
  assert.ok(imageCleanup > volumeCleanup);
  assert.ok(workCleanup > imageCleanup);
  assert.ok(promotionLockRelease > failureImageCleanup);
  assert.doesNotMatch(cleanup, /rmdir/u);
  assert.match(source, /mlp\.image-gate\.run=\$RUN_ID/u);
  assert.match(source, /trap cleanup 0/u);
  assert.match(source, /trap 'exit 129' HUP/u);
  assert.match(source, /trap 'exit 130' INT/u);
  assert.match(source, /trap 'exit 143' TERM/u);
  assert.match(
    source,
    /unset[\s\S]*AWS_ACCESS_KEY_ID[\s\S]*AWS_SECRET_ACCESS_KEY/u,
  );
  assert.match(source, /unset[\s\S]*PGPASSWORD/u);
  assert.match(source, /unset[\s\S]*MLP_IMAGE_GATE_SECRET_SENTINEL/u);
  assert.doesNotMatch(source, /docker system prune/u);
});

test('initialization failure removes secrets under the early cleanup trap', async (context) => {
  const source = await readHarness();
  const earlyTrap = source.indexOf('trap early_cleanup 0');
  const firstSecretWrite = source.indexOf('>"$POSTGRES_PASSWORD_FILE"');
  assert.ok(earlyTrap >= 0 && earlyTrap < firstSecretWrite);

  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-early-cleanup-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const cleanupWork = path.join(fixtureRoot, 'work');
  const wrapperPath = path.join(fixtureRoot, 'fixture.sh');
  await mkdir(cleanupWork);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu
WORK_DIRECTORY=${shellQuote(cleanupWork)}
${shellFunction(source, 'early_cleanup')}
trap early_cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' secret >"$WORK_DIRECTORY/secret"
false
`,
  );
  await chmod(wrapperPath, 0o755);

  const result = await execFile('/bin/sh', [wrapperPath], {
    encoding: 'utf8',
  }).catch((error) => error);
  assert.equal(result.code, 1, result.stderr ?? '');
  await assert.rejects(access(cleanupWork));
});

test('cleanup removes an extracted read-only filesystem tree', async (context) => {
  const source = await readHarness();
  const fixture = await createCleanupFixture(source, { success: 1 });
  context.after(() =>
    rm(fixture.fixtureRoot, { force: true, recursive: true }),
  );
  const readOnlyDirectory = path.join(fixture.cleanupWork, 'rootfs', 'nested');
  await mkdir(readOnlyDirectory, { recursive: true });
  await writeFile(path.join(readOnlyDirectory, 'file'), 'read-only\n');
  await chmod(path.join(readOnlyDirectory, 'file'), 0o444);
  await chmod(readOnlyDirectory, 0o555);
  await chmod(path.dirname(readOnlyDirectory), 0o555);

  const result = await execFile('/bin/sh', [fixture.wrapperPath], {
    encoding: 'utf8',
    env: fixture.env,
  }).catch((error) => error);

  assert.equal(result.code ?? 0, 0, result.stderr ?? '');
  await assert.rejects(access(fixture.cleanupWork));
});

test('cleanup retries a stuck owned resource and converts nominal success to failure', async (context) => {
  const source = await readHarness();
  const fixture = await createCleanupFixture(source, {
    containers: 'owned-resource',
    resourceLabel: 'owned-run',
    resourceName: 'owned-resource',
    removeFail: true,
    success: 1,
  });
  context.after(() =>
    rm(fixture.fixtureRoot, { force: true, recursive: true }),
  );

  const result = await execFile('/bin/sh', [fixture.wrapperPath], {
    encoding: 'utf8',
    env: fixture.env,
  }).catch((error) => error);
  const log = await readFile(fixture.logPath, 'utf8');

  assert.equal(result.code, 1, `${result.stderr ?? ''}\n${log}`);
  assert.equal(
    log.match(/^container rm --force --volumes owned-resource$/gmu)?.length,
    3,
  );
  await assert.rejects(access(fixture.cleanupWork));
});

test('cleanup never deletes foreign labeled resources or mismatched image IDs', async (context) => {
  const source = await readHarness();
  const fixtures = [
    await createCleanupFixture(source, {
      containers: 'foreign-resource',
      resourceLabel: 'some-other-run',
      resourceName: 'foreign-resource',
      success: 1,
    }),
    await createCleanupFixture(source, {
      imageId: `sha256:${'b'.repeat(64)}`,
      images: `gate:test|sha256:${'c'.repeat(64)}|failure`,
      resourceName: 'gate:test',
      success: 0,
    }),
  ];
  context.after(() =>
    Promise.all(
      fixtures.map((fixture) =>
        rm(fixture.fixtureRoot, { force: true, recursive: true }),
      ),
    ),
  );

  for (const fixture of fixtures) {
    const result = await execFile('/bin/sh', [fixture.wrapperPath], {
      encoding: 'utf8',
      env: fixture.env,
    }).catch((error) => error);
    const log = await readFile(fixture.logPath, 'utf8');

    assert.equal(result.code, 1);
    assert.doesNotMatch(log, /(?:container|image) rm/u);
  }
});

test('canonical cleanup runs while the promotion flock descriptor remains held', async (context) => {
  const imageId = `sha256:${'d'.repeat(64)}`;
  const source = await readHarness();
  const fixture = await createCleanupFixture(source, {
    expectLockOpen: true,
    imageId,
    images: `gate:test|${imageId}|failure`,
    promotionLockHeld: true,
    resourceName: 'gate:test',
    success: 0,
  });
  context.after(() =>
    rm(fixture.fixtureRoot, { force: true, recursive: true }),
  );

  const result = await execFile('/bin/sh', [fixture.wrapperPath], {
    encoding: 'utf8',
    env: fixture.env,
  });
  const log = await readFile(fixture.logPath, 'utf8');

  assert.equal(result.stderr, '');
  assert.match(log, /^image rm --force gate:test$/gmu);
  assert.match(log, /^lock-open$/gmu);
  assert.doesNotMatch(log, /^lock-closed$/gmu);
  await assert.rejects(access(path.join(fixture.stateDirectory, 'image')));
});

test('a canonical cleanup failure is recorded before the promotion flock descriptor closes', async (context) => {
  const imageId = `sha256:${'e'.repeat(64)}`;
  const source = await readHarness();
  const fixture = await createCleanupFixture(source, {
    expectLockOpen: true,
    imageId,
    images: `gate:test|${imageId}|failure`,
    promotionLockHeld: true,
    removeFail: true,
    resourceName: 'gate:test',
    success: 0,
  });
  context.after(() =>
    rm(fixture.fixtureRoot, { force: true, recursive: true }),
  );

  const result = await execFile('/bin/sh', [fixture.wrapperPath], {
    encoding: 'utf8',
    env: fixture.env,
  }).catch((error) => error);
  const log = await readFile(fixture.logPath, 'utf8');

  assert.equal(result.code, 1);
  assert.equal(log.match(/^image rm --force gate:test$/gmu)?.length, 3);
  assert.equal(log.match(/^lock-open$/gmu)?.length, 3);
  assert.doesNotMatch(log, /^lock-closed$/gmu);
});

test('a second termination signal cannot bypass in-progress cleanup', async (context) => {
  const source = await readHarness();
  const fixture = await createCleanupFixture(source, {
    containers: 'owned-resource',
    removeDelay: '0.25',
    resourceLabel: 'owned-run',
    resourceName: 'owned-resource',
    success: 0,
    waitForSignal: true,
  });
  context.after(() =>
    rm(fixture.fixtureRoot, { force: true, recursive: true }),
  );

  const child = spawn('/bin/sh', [fixture.wrapperPath], {
    env: fixture.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  await waitFor(
    () => stdout.includes('ready\n'),
    'fixture did not become ready',
  );

  child.kill('SIGTERM');
  await waitFor(
    () =>
      access(fixture.removeMarker).then(
        () => true,
        () => false,
      ),
    'cleanup did not start removing its owned resource',
  );
  child.kill('SIGTERM');

  const result = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(result, { code: 143, signal: null });
  await assert.rejects(access(path.join(fixture.stateDirectory, 'resource')));
  await assert.rejects(access(fixture.cleanupWork));
});

test('promotion rechecks a canonical tag and never overwrites a late collision', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-promotion-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const binDirectory = path.join(fixtureRoot, 'bin');
  const collisionPath = path.join(fixtureRoot, 'collision');
  const logPath = path.join(fixtureRoot, 'docker.log');
  const dockerPath = path.join(binDirectory, 'docker');
  const wrapperPath = path.join(fixtureRoot, 'fixture.sh');
  await mkdir(binDirectory);
  await writeFile(
    dockerPath,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG"
action=$2
last=
for argument in "$@"; do last=$argument; done
case $action in
  ls)
    if [ -f "$FAKE_COLLISION" ]; then
      printf '%s\\n' 'sha256:${'b'.repeat(64)}'
    else
      : >"$FAKE_COLLISION"
    fi
    ;;
  inspect)
    if [ "$last" = gate:staging ]; then
      printf '%s\\n' 'sha256:${'a'.repeat(64)}'
    else
      printf '%s\\n' 'sha256:${'b'.repeat(64)}'
    fi
    ;;
  tag) ;;
  *) exit 2 ;;
esac
`,
  );
  await chmod(dockerPath, 0o755);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -u
PATH=${shellQuote(`${binDirectory}:${process.env.PATH}`)}
export PATH
FAKE_COLLISION=${shellQuote(collisionPath)}
FAKE_DOCKER_LOG=${shellQuote(logPath)}
export FAKE_COLLISION FAKE_DOCKER_LOG
WORK_DIRECTORY=${shellQuote(fixtureRoot)}
TRACKED_IMAGES=
PROMOTION_LOCK_HELD=1
fail() { printf '%s\\n' "$1" >&2; exit 1; }
${shellFunction(source, 'track_image')}
${shellFunction(source, 'assert_image_tag_absent')}
${shellFunction(source, 'promote_image')}
sleep() { :; }
promote_image gate:staging gate:canonical
`,
  );
  await chmod(wrapperPath, 0o755);

  const result = await execFile('/bin/sh', [wrapperPath], {
    encoding: 'utf8',
  }).catch((error) => error);
  const log = await readFile(logPath, 'utf8');

  assert.equal(result.code, 1);
  assert.doesNotMatch(log, /^image tag /gmu);
});

test('promotion flock acquisition closes its descriptor before replaying a process-group termination', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-lock-signal-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const binDirectory = path.join(fixtureRoot, 'bin');
  const lockFile = path.join(fixtureRoot, 'promotion.lock');
  const statePath = path.join(fixtureRoot, 'descriptor-state');
  const flockPath = path.join(binDirectory, 'flock');
  const wrapperPath = path.join(fixtureRoot, 'fixture.sh');
  await mkdir(binDirectory);
  await writeFile(
    flockPath,
    `#!/bin/sh
set -eu
[ "$1" = --exclusive ]
[ "$2" = --nonblock ]
[ "$3" = 9 ]
kill -TERM "$PPID" "$$"
`,
  );
  await chmod(flockPath, 0o755);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -u
PATH=${shellQuote(`${binDirectory}:${process.env.PATH}`)}
export PATH
PROMOTION_LOCK_FILE=${shellQuote(lockFile)}
PROMOTION_LOCK_HELD=0
LOCK_STATE=${shellQuote(statePath)}
cleanup() {
  status=$?
  trap - 0 HUP INT TERM
  if ( : >&9 ) 2>/dev/null; then
    printf 'cleanup-open:%s\\n' "$PROMOTION_LOCK_HELD" >"$LOCK_STATE"
    exec 9>&-
  else
    printf 'cleanup-closed:%s\\n' "$PROMOTION_LOCK_HELD" >"$LOCK_STATE"
  fi
  exit "$status"
}
install_cleanup_traps() {
  trap cleanup 0
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}
fail() {
  if ( : >&9 ) 2>/dev/null; then
    printf 'fail-open:%s\\n' "$PROMOTION_LOCK_HELD" >"$LOCK_STATE"
  else
    printf 'fail-closed:%s\\n' "$PROMOTION_LOCK_HELD" >"$LOCK_STATE"
  fi
  printf '%s\\n' "$1" >&2
  exit 1
}
${shellFunction(source, 'acquire_promotion_lock')}
install_cleanup_traps
acquire_promotion_lock
exit 0
`,
  );
  await chmod(wrapperPath, 0o755);

  const result = await execFile('/bin/sh', [wrapperPath], {
    detached: true,
    encoding: 'utf8',
  }).catch((error) => error);

  assert.equal(result.code, 143);
  assert.equal(await readFile(statePath, 'utf8'), 'cleanup-closed:0\n');
});

test('an ambiguous failed flock acquisition closes its inherited descriptor before failing', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-lock-ambiguous-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const binDirectory = path.join(fixtureRoot, 'bin');
  const lockFile = path.join(fixtureRoot, 'promotion.lock');
  const statePath = path.join(fixtureRoot, 'descriptor-state');
  const flockPath = path.join(binDirectory, 'flock');
  const wrapperPath = path.join(fixtureRoot, 'fixture.sh');
  await mkdir(binDirectory);
  await writeFile(
    flockPath,
    `#!/bin/sh
set -eu
[ "$1" = --exclusive ]
[ "$2" = --nonblock ]
[ "$3" = 9 ]
exit 1
`,
  );
  await chmod(flockPath, 0o755);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -u
PATH=${shellQuote(`${binDirectory}:${process.env.PATH}`)}
export PATH
PROMOTION_LOCK_FILE=${shellQuote(lockFile)}
PROMOTION_LOCK_HELD=0
LOCK_STATE=${shellQuote(statePath)}
cleanup() { status=$?; trap - 0 HUP INT TERM; exit "$status"; }
install_cleanup_traps() {
  trap cleanup 0
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}
fail() {
  if ( : >&9 ) 2>/dev/null; then
    printf 'fail-open:%s\\n' "$PROMOTION_LOCK_HELD" >"$LOCK_STATE"
  else
    printf 'fail-closed:%s\\n' "$PROMOTION_LOCK_HELD" >"$LOCK_STATE"
  fi
  exit 1
}
${shellFunction(source, 'acquire_promotion_lock')}
install_cleanup_traps
acquire_promotion_lock
exit 0
`,
  );
  await chmod(wrapperPath, 0o755);

  await assert.rejects(
    execFile('/bin/sh', [wrapperPath], { encoding: 'utf8' }),
  );
  assert.equal(await readFile(statePath, 'utf8'), 'fail-closed:0\n');
});

test('a recorded staging image ID replaces its interrupt-safe pending record', async () => {
  const source = await readHarness();
  const script = `
set -eu
TRACKED_IMAGES=
fail() { exit 1; }
${shellFunction(source, 'track_image')}
${shellFunction(source, 'record_image_id')}
track_image gate:staging PENDING always
record_image_id gate:staging sha256:recorded always
printf '%s\n' "$TRACKED_IMAGES"
`;

  const result = await execFile('/bin/sh', ['-c', script], {
    encoding: 'utf8',
  });
  assert.equal(result.stdout, 'gate:staging|sha256:recorded|always\n');
});
