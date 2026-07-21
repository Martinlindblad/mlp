import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  pbkdf2Sync,
} from 'node:crypto';
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

function sharedCredentialUriPattern(source) {
  const imageSecretAudit = shellFunctionBody(source, 'assert_no_image_secrets');
  const assignment = /^\s*credential_uri_pattern='(?<pattern>[^']+)'$/mu.exec(
    imageSecretAudit,
  );
  assert.ok(
    assignment?.groups?.pattern,
    'missing shared credential URI pattern',
  );
  assert.match(imageSecretAudit, /assert_no_secret_metadata/u);
  assert.match(imageSecretAudit, /find_secret_like_files/u);
  assert.equal(
    imageSecretAudit.match(/"\$credential_uri_pattern"/gu)?.length,
    2,
    'metadata and filesystem scans must receive the same credential pattern',
  );
  return assignment.groups.pattern;
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
      exit 0
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
    exit 0
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
  assert.doesNotMatch(source, /private-key path:/u);
  assert.equal(source.match(/python3 -I -/gu)?.length ?? 0, 3);
  assert.doesNotMatch(source, /python3 - (?!I)/u);
  assert.match(source, /chmod -R u\+rwX "\$WORK_DIRECTORY"/u);
  assert.doesNotMatch(source, /tar[^\n]*--mode=/u);
  for (const forbidden of [
    '\\.env',
    'run/secrets',
    'migration-artifacts',
    'PRIVATE KEY',
    'postgres\\(ql\\)\\?://',
    'mongodb://',
  ]) {
    assert.match(source, new RegExp(forbidden, 'u'));
  }
  assert.match(source, /MLP_IMAGE_GATE_SECRET_SENTINEL/u);
});

test('private-key audit recognizes complete semantic key envelopes only', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-key-audit-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const pemEnvelope = (label, bytes) => {
    const body = bytes
      .toString('base64')
      .match(/.{1,64}/gu)
      .join('\n');
    return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
  };
  const sshUint32 = (value) => {
    const encoded = Buffer.alloc(4);
    encoded.writeUInt32BE(value);
    return encoded;
  };
  const sshString = (value) => {
    const encoded = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Buffer.concat([sshUint32(encoded.length), encoded]);
  };
  const unencryptedOpenSshEnvelope = (publicKey, privateFields) => {
    const checkInteger = sshUint32(0x12345678);
    const unpaddedPrivateKeys = Buffer.concat([
      checkInteger,
      checkInteger,
      ...privateFields,
      sshString('fixture-comment'),
    ]);
    const paddingLength = (8 - (unpaddedPrivateKeys.length % 8)) % 8;
    const padding = Buffer.from(
      Array.from({ length: paddingLength }, (_, index) => index + 1),
    );
    return Buffer.concat([
      Buffer.from('openssh-key-v1\0'),
      sshString('none'),
      sshString('none'),
      sshString(Buffer.alloc(0)),
      sshUint32(1),
      sshString(publicKey),
      sshString(Buffer.concat([unpaddedPrivateKeys, padding])),
    ]);
  };
  const derTlv = (tag, contents) => {
    let encodedLength;
    if (contents.length < 0x80) {
      encodedLength = Buffer.from([contents.length]);
    } else {
      const lengthBytes = [];
      for (let value = contents.length; value > 0; value >>= 8) {
        lengthBytes.unshift(value & 0xff);
      }
      encodedLength = Buffer.from([0x80 | lengthBytes.length, ...lengthBytes]);
    }
    return Buffer.concat([Buffer.from([tag]), encodedLength, contents]);
  };
  const derSequenceContents = (encoded) => {
    assert.equal(encoded[0], 0x30);
    const firstLength = encoded[1];
    const lengthBytes = firstLength & 0x7f;
    const contentOffset = firstLength < 0x80 ? 2 : 2 + lengthBytes;
    const contentLength =
      firstLength < 0x80
        ? firstLength
        : encoded
            .subarray(2, contentOffset)
            .reduce((length, byte) => (length << 8) | byte, 0);
    assert.equal(contentOffset + contentLength, encoded.length);
    return encoded.subarray(contentOffset);
  };
  const wrapperPath = path.join(fixtureRoot, 'scan-private-keys.sh');
  const templatePath = path.join(fixtureRoot, 'template.txt');
  const binaryMarkerPath = path.join(fixtureRoot, 'binary-marker.bin');
  const relabeledDerPaths = [
    'PRIVATE KEY',
    'RSA PRIVATE KEY',
    'EC PRIVATE KEY',
    'ENCRYPTED PRIVATE KEY',
  ].map((label) => [
    label,
    path.join(
      fixtureRoot,
      `relabeled-${label.toLowerCase().replaceAll(' ', '-')}`,
    ),
  ]);
  const truncatedPkcs8Path = path.join(fixtureRoot, 'truncated-pkcs8');
  const truncatedOpenSshPath = path.join(fixtureRoot, 'truncated-openssh');
  const truncatedAeadOpenSshPath = path.join(
    fixtureRoot,
    'truncated-aead-openssh',
  );
  const semanticInvalidPaths = [
    ['PRIVATE KEY', 'invalid-pkcs8'],
    ['RSA PRIVATE KEY', 'invalid-pkcs1'],
    ['EC PRIVATE KEY', 'invalid-sec1'],
    ['ENCRYPTED PRIVATE KEY', 'invalid-encrypted-pkcs8'],
  ].map(([label, name]) => [label, path.join(fixtureRoot, name)]);
  const invalidMlDsaShapePath = path.join(fixtureRoot, 'invalid-ml-dsa-shape');
  const unassignedPqcOidPath = path.join(fixtureRoot, 'unassigned-pqc-oid');
  const openSshPrivateKeyPath = path.join(fixtureRoot, 'openssh-private-key');
  const encryptedOpenSshPrivateKeyPath = path.join(
    fixtureRoot,
    'encrypted-openssh-private-key',
  );
  const modernEncryptedOpenSshPrivateKeys = [
    'aes128-gcm@openssh.com',
    'aes256-gcm@openssh.com',
    'chacha20-poly1305@openssh.com',
  ].map((cipher) => [
    cipher,
    path.join(
      fixtureRoot,
      `encrypted-${cipher
        .replaceAll('@', '-')
        .replaceAll('.', '-')}-private-key`,
    ),
  ]);
  const rsaOpenSshPrivateKeyPath = path.join(
    fixtureRoot,
    'rsa-openssh-private-key',
  );
  const ecOpenSshPrivateKeyPath = path.join(
    fixtureRoot,
    'ec-openssh-private-key',
  );
  const skEd25519OpenSshPrivateKeyPath = path.join(
    fixtureRoot,
    'sk-ed25519-openssh-private-key',
  );
  const skEcdsaOpenSshPrivateKeyPath = path.join(
    fixtureRoot,
    'sk-ecdsa-openssh-private-key',
  );
  const pkcs8PrivateKeyPath = path.join(fixtureRoot, 'pkcs8-private-key');
  const pkcs8WithAttributesPath = path.join(
    fixtureRoot,
    'pkcs8-private-key-with-attributes-and-public-key',
  );
  const encryptedPkcs8PrivateKeyPath = path.join(
    fixtureRoot,
    'encrypted-pkcs8-private-key',
  );
  const camelliaEncryptedPkcs8PrivateKeyPath = path.join(
    fixtureRoot,
    'camellia-encrypted-pkcs8-private-key',
  );
  const dhPkcs8PrivateKeyPath = path.join(fixtureRoot, 'dh-pkcs8-private-key');
  const mlDsaPkcs8PrivateKeyPath = path.join(
    fixtureRoot,
    'ml-dsa-pkcs8-private-key',
  );
  const slhDsaPkcs8PrivateKeyPath = path.join(
    fixtureRoot,
    'slh-dsa-pkcs8-private-key',
  );
  const mlKemPkcs8PrivateKeyPath = path.join(
    fixtureRoot,
    'ml-kem-pkcs8-private-key',
  );
  const weakSaltEncryptedPkcs8PrivateKeyPath = path.join(
    fixtureRoot,
    'weak-salt-encrypted-pkcs8-private-key',
  );
  const modernPbes2PrivateKeyPaths = [
    'aria-encrypted-pkcs8-private-key',
    'sm4-encrypted-pkcs8-private-key',
    'sha512-256-prf-encrypted-pkcs8-private-key',
    'sha3-256-prf-encrypted-pkcs8-private-key',
  ].map((name) => path.join(fixtureRoot, name));
  const pkcs1PrivateKeyPath = path.join(fixtureRoot, 'pkcs1-private-key');
  const encryptedPkcs1PrivateKeyPath = path.join(
    fixtureRoot,
    'legacy-encrypted-pkcs1-private-key',
  );
  const camelliaEncryptedPkcs1PrivateKeyPath = path.join(
    fixtureRoot,
    'legacy-camellia-encrypted-pkcs1-private-key',
  );
  const sec1PrivateKeyPath = path.join(fixtureRoot, 'sec1-private-key');
  const encryptedSec1PrivateKeyPath = path.join(
    fixtureRoot,
    'legacy-encrypted-sec1-private-key',
  );
  const dsaPrivateKeySourcePath = path.join(
    fixtureRoot,
    'dsa-private-key-source',
  );
  const dsaPrivateKeyPath = path.join(fixtureRoot, 'dsa-private-key');
  const encryptedDsaPrivateKeyPath = path.join(
    fixtureRoot,
    'legacy-encrypted-dsa-private-key',
  );

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
    openSshPrivateKeyPath,
  ]);
  await execFile('ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    'fixture-passphrase',
    '-f',
    encryptedOpenSshPrivateKeyPath,
  ]);
  for (const [cipher, fixturePath] of modernEncryptedOpenSshPrivateKeys) {
    await execFile('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      'fixture-passphrase',
      '-Z',
      cipher,
      '-f',
      fixturePath,
    ]);
  }
  await execFile('ssh-keygen', [
    '-q',
    '-t',
    'rsa',
    '-b',
    '2048',
    '-N',
    '',
    '-f',
    rsaOpenSshPrivateKeyPath,
  ]);
  await execFile('ssh-keygen', [
    '-q',
    '-t',
    'ecdsa',
    '-b',
    '256',
    '-N',
    '',
    '-f',
    ecOpenSshPrivateKeyPath,
  ]);
  const openSshPem = await readFile(openSshPrivateKeyPath, 'utf8');
  const openSshEnvelope = Buffer.from(
    openSshPem
      .split('\n')
      .filter((line) => line && !line.startsWith('-----'))
      .join(''),
    'base64',
  );
  const aeadOpenSshPem = await readFile(
    modernEncryptedOpenSshPrivateKeys[0][1],
    'utf8',
  );
  const aeadOpenSshEnvelope = Buffer.from(
    aeadOpenSshPem
      .split('\n')
      .filter((line) => line && !line.startsWith('-----'))
      .join(''),
    'base64',
  );
  const { privateKey: rsaPrivateKey, publicKey: rsaPublicKey } =
    generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { privateKey: dhPrivateKey } = generateKeyPairSync('dh', {
    group: 'modp14',
  });
  const { privateKey: ecPrivateKey, publicKey: ecPublicKey } =
    generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
  const { publicKey: ed25519PublicKey } = generateKeyPairSync('ed25519');
  const { privateKey: dsaPrivateKey } = generateKeyPairSync('dsa', {
    divisorLength: 256,
    modulusLength: 2048,
  });
  await writeFile(
    dsaPrivateKeySourcePath,
    dsaPrivateKey.export({ format: 'pem', type: 'pkcs8' }),
  );
  await execFile('openssl', [
    'pkey',
    '-in',
    dsaPrivateKeySourcePath,
    '-traditional',
    '-out',
    dsaPrivateKeyPath,
  ]);
  await execFile('openssl', [
    'pkey',
    '-in',
    dsaPrivateKeySourcePath,
    '-traditional',
    '-aes-256-cbc',
    '-passout',
    'pass:fixture-passphrase',
    '-out',
    encryptedDsaPrivateKeyPath,
  ]);
  const pkcs8Der = rsaPrivateKey.export({ format: 'der', type: 'pkcs8' });
  const algorithmIdentifier = (oid, parameters) =>
    derTlv(
      0x30,
      Buffer.concat([
        derTlv(0x06, Buffer.from(oid)),
        ...(parameters === undefined ? [] : [parameters]),
      ]),
    );
  const mlDsaPrivateKey = derTlv(
    0x30,
    Buffer.concat([
      derTlv(0x04, Buffer.alloc(32, 0xa5)),
      derTlv(0x04, Buffer.alloc(2560, 0x5a)),
    ]),
  );
  const mlDsaPkcs8 = derTlv(
    0x30,
    Buffer.concat([
      derTlv(0x02, Buffer.from([0x00])),
      algorithmIdentifier([
        0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x11,
      ]),
      derTlv(0x04, mlDsaPrivateKey),
    ]),
  );
  const slhDsaPkcs8 = derTlv(
    0x30,
    Buffer.concat([
      derTlv(0x02, Buffer.from([0x00])),
      algorithmIdentifier([
        0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x14,
      ]),
      derTlv(0x04, Buffer.alloc(64, 0x6b)),
    ]),
  );
  const mlKemPkcs8 = derTlv(
    0x30,
    Buffer.concat([
      derTlv(0x02, Buffer.from([0x00])),
      algorithmIdentifier([
        0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x04, 0x01,
      ]),
      derTlv(0x04, derTlv(0x80, Buffer.alloc(64, 0x4d))),
    ]),
  );
  const shortSalt = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const weakEncryptionIv = Buffer.alloc(16, 0x3c);
  const weakEncryptionKey = pbkdf2Sync(
    'fixture-passphrase',
    shortSalt,
    2048,
    32,
    'sha256',
  );
  const weakCipher = createCipheriv(
    'aes-256-cbc',
    weakEncryptionKey,
    weakEncryptionIv,
  );
  const weakCiphertext = Buffer.concat([
    weakCipher.update(pkcs8Der),
    weakCipher.final(),
  ]);
  const weakDecipher = createDecipheriv(
    'aes-256-cbc',
    weakEncryptionKey,
    weakEncryptionIv,
  );
  assert.deepEqual(
    Buffer.concat([weakDecipher.update(weakCiphertext), weakDecipher.final()]),
    pkcs8Der,
  );
  const weakSaltEncryptedPkcs8 = derTlv(
    0x30,
    Buffer.concat([
      algorithmIdentifier(
        [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d],
        derTlv(
          0x30,
          Buffer.concat([
            algorithmIdentifier(
              [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0c],
              derTlv(
                0x30,
                Buffer.concat([
                  derTlv(0x04, shortSalt),
                  derTlv(0x02, Buffer.from([0x08, 0x00])),
                  algorithmIdentifier(
                    [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x09],
                    derTlv(0x05, Buffer.alloc(0)),
                  ),
                ]),
              ),
            ),
            algorithmIdentifier(
              [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x01, 0x2a],
              derTlv(0x04, weakEncryptionIv),
            ),
          ]),
        ),
      ),
      derTlv(0x04, weakCiphertext),
    ]),
  );
  const makePbes2Fixture = ({
    cipherName,
    cipherOid,
    keyLength,
    prfDigest,
    prfOid,
    marker,
  }) => {
    const salt = Buffer.alloc(8, marker);
    const iv = Buffer.alloc(16, marker ^ 0xff);
    const encryptionKey = pbkdf2Sync(
      'fixture-passphrase',
      salt,
      2048,
      keyLength,
      prfDigest,
    );
    const cipher = createCipheriv(cipherName, encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(pkcs8Der), cipher.final()]);
    const decipher = createDecipheriv(cipherName, encryptionKey, iv);
    assert.deepEqual(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]),
      pkcs8Der,
    );
    return derTlv(
      0x30,
      Buffer.concat([
        algorithmIdentifier(
          [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d],
          derTlv(
            0x30,
            Buffer.concat([
              algorithmIdentifier(
                [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0c],
                derTlv(
                  0x30,
                  Buffer.concat([
                    derTlv(0x04, salt),
                    derTlv(0x02, Buffer.from([0x08, 0x00])),
                    algorithmIdentifier(prfOid, derTlv(0x05, Buffer.alloc(0))),
                  ]),
                ),
              ),
              algorithmIdentifier(cipherOid, derTlv(0x04, iv)),
            ]),
          ),
        ),
        derTlv(0x04, ciphertext),
      ]),
    );
  };
  const modernPbes2PrivateKeys = [
    [
      modernPbes2PrivateKeyPaths[0],
      makePbes2Fixture({
        cipherName: 'aria-256-cbc',
        cipherOid: [0x2a, 0x83, 0x1a, 0x8c, 0x9a, 0x6e, 0x01, 0x01, 0x0c],
        keyLength: 32,
        marker: 0x11,
        prfDigest: 'sha256',
        prfOid: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x09],
      }),
    ],
    [
      modernPbes2PrivateKeyPaths[1],
      makePbes2Fixture({
        cipherName: 'sm4-cbc',
        cipherOid: [0x2a, 0x81, 0x1c, 0xcf, 0x55, 0x01, 0x68, 0x02],
        keyLength: 16,
        marker: 0x22,
        prfDigest: 'sha256',
        prfOid: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x09],
      }),
    ],
    [
      modernPbes2PrivateKeyPaths[2],
      makePbes2Fixture({
        cipherName: 'aes-256-cbc',
        cipherOid: [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x01, 0x2a],
        keyLength: 32,
        marker: 0x33,
        prfDigest: 'sha512-256',
        prfOid: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x0d],
      }),
    ],
    [
      modernPbes2PrivateKeyPaths[3],
      makePbes2Fixture({
        cipherName: 'aes-256-cbc',
        cipherOid: [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x01, 0x2a],
        keyLength: 32,
        marker: 0x44,
        prfDigest: 'sha3-256',
        prfOid: [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x0e],
      }),
    ],
  ];
  const pkcs8Contents = derSequenceContents(pkcs8Der);
  assert.deepEqual(
    pkcs8Contents.subarray(0, 3),
    Buffer.from([0x02, 0x01, 0x00]),
  );
  const oneAsymmetricKey = derTlv(
    0x30,
    Buffer.concat([
      Buffer.from([0x02, 0x01, 0x01]),
      pkcs8Contents.subarray(3),
      derTlv(0xa0, Buffer.alloc(0)),
      derTlv(
        0x81,
        Buffer.concat([
          Buffer.from([0x00]),
          rsaPublicKey.export({ format: 'der', type: 'pkcs1' }),
        ]),
      ),
    ]),
  );
  const application = 'ssh:fixture';
  const keyHandle = Buffer.from('opaque-hardware-key-handle');
  const ed25519Public = Buffer.from(
    ed25519PublicKey.export({ format: 'jwk' }).x,
    'base64url',
  );
  const ecPublicJwk = ecPublicKey.export({ format: 'jwk' });
  const ecPublic = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(ecPublicJwk.x, 'base64url'),
    Buffer.from(ecPublicJwk.y, 'base64url'),
  ]);
  const skEd25519Type = 'sk-ssh-ed25519@openssh.com';
  const skEcdsaType = 'sk-ecdsa-sha2-nistp256@openssh.com';
  const skEd25519Public = Buffer.concat([
    sshString(skEd25519Type),
    sshString(ed25519Public),
    sshString(application),
  ]);
  const skEcdsaPublic = Buffer.concat([
    sshString(skEcdsaType),
    sshString('nistp256'),
    sshString(ecPublic),
    sshString(application),
  ]);
  await Promise.all([
    writeFile(
      skEd25519OpenSshPrivateKeyPath,
      pemEnvelope(
        'OPENSSH PRIVATE KEY',
        unencryptedOpenSshEnvelope(skEd25519Public, [
          sshString(skEd25519Type),
          sshString(ed25519Public),
          sshString(application),
          Buffer.from([0x01]),
          sshString(keyHandle),
          sshString(Buffer.alloc(0)),
        ]),
      ),
    ),
    writeFile(
      skEcdsaOpenSshPrivateKeyPath,
      pemEnvelope(
        'OPENSSH PRIVATE KEY',
        unencryptedOpenSshEnvelope(skEcdsaPublic, [
          sshString(skEcdsaType),
          sshString('nistp256'),
          sshString(ecPublic),
          sshString(application),
          Buffer.from([0x01]),
          sshString(keyHandle),
          sshString(Buffer.alloc(0)),
        ]),
      ),
    ),
    writeFile(
      pkcs8PrivateKeyPath,
      rsaPrivateKey.export({ format: 'pem', type: 'pkcs8' }),
    ),
    writeFile(
      pkcs8WithAttributesPath,
      pemEnvelope('PRIVATE KEY', oneAsymmetricKey),
    ),
    writeFile(
      encryptedPkcs8PrivateKeyPath,
      rsaPrivateKey.export({
        cipher: 'aes-256-cbc',
        format: 'pem',
        passphrase: 'fixture-passphrase',
        type: 'pkcs8',
      }),
    ),
    writeFile(
      camelliaEncryptedPkcs8PrivateKeyPath,
      rsaPrivateKey.export({
        cipher: 'camellia-256-cbc',
        format: 'pem',
        passphrase: 'fixture-passphrase',
        type: 'pkcs8',
      }),
    ),
    writeFile(
      dhPkcs8PrivateKeyPath,
      dhPrivateKey.export({ format: 'pem', type: 'pkcs8' }),
    ),
    writeFile(mlDsaPkcs8PrivateKeyPath, pemEnvelope('PRIVATE KEY', mlDsaPkcs8)),
    writeFile(
      slhDsaPkcs8PrivateKeyPath,
      pemEnvelope('PRIVATE KEY', slhDsaPkcs8),
    ),
    writeFile(mlKemPkcs8PrivateKeyPath, pemEnvelope('PRIVATE KEY', mlKemPkcs8)),
    writeFile(
      weakSaltEncryptedPkcs8PrivateKeyPath,
      pemEnvelope('ENCRYPTED PRIVATE KEY', weakSaltEncryptedPkcs8),
    ),
    ...modernPbes2PrivateKeys.map(([fixturePath, encoded]) =>
      writeFile(fixturePath, pemEnvelope('ENCRYPTED PRIVATE KEY', encoded)),
    ),
    writeFile(
      invalidMlDsaShapePath,
      pemEnvelope(
        'PRIVATE KEY',
        derTlv(
          0x30,
          Buffer.concat([
            derTlv(0x02, Buffer.from([0x00])),
            algorithmIdentifier([
              0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x11,
            ]),
            derTlv(0x04, Buffer.alloc(32, 0x7a)),
          ]),
        ),
      ),
    ),
    writeFile(
      unassignedPqcOidPath,
      pemEnvelope(
        'PRIVATE KEY',
        derTlv(
          0x30,
          Buffer.concat([
            derTlv(0x02, Buffer.from([0x00])),
            algorithmIdentifier([
              0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x20,
            ]),
            derTlv(0x04, Buffer.alloc(64, 0x7b)),
          ]),
        ),
      ),
    ),
    writeFile(
      pkcs1PrivateKeyPath,
      rsaPrivateKey.export({ format: 'pem', type: 'pkcs1' }),
    ),
    writeFile(
      encryptedPkcs1PrivateKeyPath,
      rsaPrivateKey.export({
        cipher: 'aes-256-cbc',
        format: 'pem',
        passphrase: 'fixture-passphrase',
        type: 'pkcs1',
      }),
    ),
    writeFile(
      camelliaEncryptedPkcs1PrivateKeyPath,
      rsaPrivateKey.export({
        cipher: 'camellia-256-cbc',
        format: 'pem',
        passphrase: 'fixture-passphrase',
        type: 'pkcs1',
      }),
    ),
    writeFile(
      sec1PrivateKeyPath,
      ecPrivateKey.export({ format: 'pem', type: 'sec1' }),
    ),
    writeFile(
      encryptedSec1PrivateKeyPath,
      ecPrivateKey.export({
        cipher: 'aes-256-cbc',
        format: 'pem',
        passphrase: 'fixture-passphrase',
        type: 'sec1',
      }),
    ),
    writeFile(
      truncatedPkcs8Path,
      pemEnvelope('PRIVATE KEY', pkcs8Der.subarray(0, -8)),
    ),
    writeFile(
      truncatedOpenSshPath,
      pemEnvelope('OPENSSH PRIVATE KEY', openSshEnvelope.subarray(0, -8)),
    ),
    writeFile(
      truncatedAeadOpenSshPath,
      pemEnvelope('OPENSSH PRIVATE KEY', aeadOpenSshEnvelope.subarray(0, -1)),
    ),
    ...semanticInvalidPaths.map(([label, fixturePath], index) => {
      const algorithm = derTlv(0x30, derTlv(0x06, Buffer.from([0x2a, 0x03])));
      const invalidKeys = [
        derTlv(
          0x30,
          Buffer.concat([
            derTlv(0x02, Buffer.from([0x00])),
            algorithm,
            derTlv(0x04, derTlv(0x04, Buffer.from('nope'))),
          ]),
        ),
        derTlv(
          0x30,
          Buffer.concat([
            derTlv(0x02, Buffer.from([0x00])),
            ...Array.from({ length: 8 }, () =>
              derTlv(0x02, Buffer.from([0x01])),
            ),
          ]),
        ),
        derTlv(
          0x30,
          Buffer.concat([
            derTlv(0x02, Buffer.from([0x01])),
            derTlv(0x04, Buffer.from([0x00])),
          ]),
        ),
        derTlv(0x30, Buffer.concat([algorithm, derTlv(0x04, Buffer.alloc(8))])),
      ];
      return writeFile(fixturePath, pemEnvelope(label, invalidKeys[index]));
    }),
    ...relabeledDerPaths.map(([label, fixturePath]) =>
      writeFile(
        fixturePath,
        pemEnvelope(
          label,
          Buffer.concat([
            Buffer.from([0x30, 0x42, 0x04, 0x40]),
            Buffer.alloc(64, 0xa5),
          ]),
        ),
      ),
    ),
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
    [
      wrapperPath,
      templatePath,
      binaryMarkerPath,
      ...relabeledDerPaths.map(([, fixturePath]) => fixturePath),
      ...semanticInvalidPaths.map(([, fixturePath]) => fixturePath),
      invalidMlDsaShapePath,
      unassignedPqcOidPath,
      truncatedPkcs8Path,
      truncatedOpenSshPath,
      truncatedAeadOpenSshPath,
      openSshPrivateKeyPath,
      encryptedOpenSshPrivateKeyPath,
      ...modernEncryptedOpenSshPrivateKeys.map(
        ([, fixturePath]) => fixturePath,
      ),
      rsaOpenSshPrivateKeyPath,
      ecOpenSshPrivateKeyPath,
      skEd25519OpenSshPrivateKeyPath,
      skEcdsaOpenSshPrivateKeyPath,
      pkcs8PrivateKeyPath,
      pkcs8WithAttributesPath,
      encryptedPkcs8PrivateKeyPath,
      camelliaEncryptedPkcs8PrivateKeyPath,
      dhPkcs8PrivateKeyPath,
      mlDsaPkcs8PrivateKeyPath,
      slhDsaPkcs8PrivateKeyPath,
      mlKemPkcs8PrivateKeyPath,
      weakSaltEncryptedPkcs8PrivateKeyPath,
      ...modernPbes2PrivateKeys.map(([fixturePath]) => fixturePath),
      pkcs1PrivateKeyPath,
      encryptedPkcs1PrivateKeyPath,
      camelliaEncryptedPkcs1PrivateKeyPath,
      sec1PrivateKeyPath,
      encryptedSec1PrivateKeyPath,
      dsaPrivateKeyPath,
      encryptedDsaPrivateKeyPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\n'), [
    openSshPrivateKeyPath,
    encryptedOpenSshPrivateKeyPath,
    ...modernEncryptedOpenSshPrivateKeys.map(([, fixturePath]) => fixturePath),
    rsaOpenSshPrivateKeyPath,
    ecOpenSshPrivateKeyPath,
    skEd25519OpenSshPrivateKeyPath,
    skEcdsaOpenSshPrivateKeyPath,
    pkcs8PrivateKeyPath,
    pkcs8WithAttributesPath,
    encryptedPkcs8PrivateKeyPath,
    camelliaEncryptedPkcs8PrivateKeyPath,
    dhPkcs8PrivateKeyPath,
    mlDsaPkcs8PrivateKeyPath,
    slhDsaPkcs8PrivateKeyPath,
    mlKemPkcs8PrivateKeyPath,
    weakSaltEncryptedPkcs8PrivateKeyPath,
    ...modernPbes2PrivateKeys.map(([fixturePath]) => fixturePath),
    pkcs1PrivateKeyPath,
    encryptedPkcs1PrivateKeyPath,
    camelliaEncryptedPkcs1PrivateKeyPath,
    sec1PrivateKeyPath,
    encryptedSec1PrivateKeyPath,
    dsaPrivateKeyPath,
    encryptedDsaPrivateKeyPath,
  ]);

  const hostilePythonPath = path.join(fixtureRoot, 'hostile-python-path');
  const startupCanary = 'PYTHON_STARTUP_HOOK_MUST_NOT_RUN';
  await mkdir(hostilePythonPath);
  await writeFile(
    path.join(hostilePythonPath, 'sitecustomize.py'),
    `import os
os.write(2, b'${startupCanary}\\n')
os._exit(0)
`,
  );
  const isolatedResult = await execFile(
    '/bin/sh',
    [wrapperPath, pkcs8PrivateKeyPath],
    {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: hostilePythonPath },
    },
  );
  assert.equal(isolatedResult.stderr, '');
  assert.equal(isolatedResult.stdout, `${pkcs8PrivateKeyPath}\n`);
  assert.doesNotMatch(
    `${isolatedResult.stdout}${isolatedResult.stderr}`,
    new RegExp(startupCanary, 'u'),
  );
});

test('private-key audit fails closed before oversized integer arithmetic', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-key-integer-limit-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const wrapperPath = path.join(fixtureRoot, 'scan-private-keys.sh');
  const oversizedKeyPath = path.join(fixtureRoot, 'oversized-rsa-envelope');
  const derTlv = (tag, contents) => {
    const lengthBytes = [];
    for (let value = contents.length; value > 0; value >>= 8) {
      lengthBytes.unshift(value & 0xff);
    }
    const encodedLength =
      contents.length < 0x80
        ? Buffer.from([contents.length])
        : Buffer.from([0x80 | lengthBytes.length, ...lengthBytes]);
    return Buffer.concat([Buffer.from([tag]), encodedLength, contents]);
  };
  const oversizedInteger = derTlv(
    0x02,
    Buffer.concat([Buffer.from([0x01]), Buffer.alloc(1024)]),
  );
  const oversizedRsa = derTlv(
    0x30,
    Buffer.concat([
      derTlv(0x02, Buffer.from([0x00])),
      ...Array.from({ length: 8 }, () => oversizedInteger),
    ]),
  );
  const body = oversizedRsa
    .toString('base64')
    .match(/.{1,64}/gu)
    .join('\n');
  await Promise.all([
    writeFile(
      oversizedKeyPath,
      `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n`,
    ),
    writeFile(
      wrapperPath,
      `#!/bin/sh\nset -eu\n${shellFunction(
        source,
        'find_private_key_files',
      )}\nfind_private_key_files "$@"\n`,
      { mode: 0o755 },
    ),
  ]);

  const result = await execFile('/bin/sh', [wrapperPath, oversizedKeyPath], {
    encoding: 'utf8',
  }).catch((error) => error);
  assert.notEqual(result?.code ?? 0, 0);
  assert.equal(`${result?.stdout ?? ''}${result?.stderr ?? ''}`, '');
});

test('image environment audit JSON-decodes actual and literal escaped newlines', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-environment-audit-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const wrapperPath = path.join(fixtureRoot, 'scan-environment.sh');
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const actualNewlineJsonPath = path.join(fixtureRoot, 'actual-newlines.json');
  const literalEscapedNewlineJsonPath = path.join(
    fixtureRoot,
    'literal-escaped-newlines.json',
  );
  await Promise.all([
    writeFile(actualNewlineJsonPath, JSON.stringify([`KEY=${pem}`])),
    writeFile(
      literalEscapedNewlineJsonPath,
      JSON.stringify([`KEY=${pem.replaceAll('\n', '\\n')}`]),
    ),
  ]);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu
${shellFunction(source, 'decode_image_environment')}
${shellFunction(source, 'find_private_key_files')}
decode_image_environment "$1" "$2"
find_private_key_files "$2"
`,
  );
  await chmod(wrapperPath, 0o755);

  for (const environmentJsonPath of [
    actualNewlineJsonPath,
    literalEscapedNewlineJsonPath,
  ]) {
    const decodedPath = path.join(
      fixtureRoot,
      `${path.basename(environmentJsonPath)}.decoded`,
    );
    const result = await execFile(
      '/bin/sh',
      [wrapperPath, environmentJsonPath, decodedPath],
      { encoding: 'utf8' },
    );
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, `${decodedPath}\n`);
  }
});

test('private-key audit does not cross a real symlink boundary', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-key-symlink-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const scanRoot = path.join(fixtureRoot, 'scan-root');
  const outsideRoot = path.join(fixtureRoot, 'outside-root');
  const outsideKeyPath = path.join(outsideRoot, 'outside-private-key');
  const insideKeyPath = path.join(scanRoot, 'inside-private-key');
  const wrapperPath = path.join(fixtureRoot, 'scan-private-keys.sh');
  await Promise.all([mkdir(scanRoot), mkdir(outsideRoot)]);
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  await Promise.all([
    writeFile(outsideKeyPath, privateKeyPem),
    writeFile(insideKeyPath, privateKeyPem),
  ]);
  await Promise.all([
    symlink(outsideRoot, path.join(scanRoot, 'outside-directory-link')),
    symlink(outsideKeyPath, path.join(scanRoot, 'outside-file-link')),
  ]);
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nset -eu\n${shellFunction(
      source,
      'find_private_key_files',
    )}\nfind_private_key_files "$@"\n`,
  );
  await chmod(wrapperPath, 0o755);

  const result = await execFile('/bin/sh', [wrapperPath, scanRoot], {
    encoding: 'utf8',
  });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${insideKeyPath}\n`);
  const output = result.stdout;
  assert.doesNotMatch(output, new RegExp(outsideKeyPath, 'u'));
});

test('private-key audit fails closed and silently on read and traversal errors', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-key-scan-failure-test-'),
  );
  const unreadableFile = path.join(fixtureRoot, 'unreadable-key-canary');
  const traversalRoot = path.join(fixtureRoot, 'traversal-root');
  const unreadableDirectory = path.join(traversalRoot, 'unreadable-directory');
  const wrapperPath = path.join(fixtureRoot, 'scan-private-keys.sh');
  await mkdir(unreadableDirectory, { recursive: true });
  await Promise.all([
    writeFile(unreadableFile, 'read failure canary\n'),
    writeFile(
      path.join(unreadableDirectory, 'hidden'),
      'walk failure canary\n',
    ),
  ]);
  await Promise.all([
    chmod(fixtureRoot, 0o755),
    chmod(unreadableFile, 0o000),
    chmod(unreadableDirectory, 0o000),
  ]);
  context.after(async () => {
    await Promise.all([
      chmod(unreadableFile, 0o600).catch(() => {}),
      chmod(unreadableDirectory, 0o700).catch(() => {}),
    ]);
    await rm(fixtureRoot, { force: true, recursive: true });
  });
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nset -eu\n${shellFunction(
      source,
      'find_private_key_files',
    )}\nfind_private_key_files "$@"\n`,
  );
  await chmod(wrapperPath, 0o755);

  const unprivilegedIdentity =
    typeof process.getuid === 'function' && process.getuid() === 0
      ? { gid: 65534, uid: 65534 }
      : {};
  for (const failingPath of [unreadableFile, traversalRoot]) {
    const result = await execFile('/bin/sh', [wrapperPath, failingPath], {
      encoding: 'utf8',
      ...unprivilegedIdentity,
    }).catch((error) => error);
    assert.notEqual(
      result?.code ?? 0,
      0,
      `scanner accepted ${path.basename(failingPath)}`,
    );
    assert.equal(`${result?.stdout ?? ''}${result?.stderr ?? ''}`, '');
  }
});

test('metadata audit distinguishes grep no-match from scanner failure', async (context) => {
  const source = await readHarness();
  const credentialUriPattern = sharedCredentialUriPattern(source);
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-metadata-scan-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const wrapperPath = path.join(fixtureRoot, 'scan-metadata.sh');
  const cleanPath = path.join(fixtureRoot, 'clean.txt');
  const secretPath = path.join(fixtureRoot, 'secret.txt');
  const fixedFailureBin = path.join(fixtureRoot, 'fixed-failure-bin');
  const regexFailureBin = path.join(fixtureRoot, 'regex-failure-bin');
  const failureCanary = 'GREP_FAILURE_CANARY_MUST_NOT_LEAK';
  await Promise.all([mkdir(fixedFailureBin), mkdir(regexFailureBin)]);
  await Promise.all([
    writeFile(cleanPath, 'ordinary image metadata\n'),
    writeFile(
      secretPath,
      'postgres://fixture-user:test-only@database.invalid/fixture\n',
    ),
    writeFile(
      path.join(fixedFailureBin, 'grep'),
      `#!/bin/sh\nprintf '%s\\n' "${failureCanary}" >&2\nexit 23\n`,
      { mode: 0o755 },
    ),
    writeFile(
      path.join(regexFailureBin, 'grep'),
      `#!/bin/sh
if [ "$1" = '-Eiq' ]; then
  printf '%s\\n' "${failureCanary}" >&2
  exit 23
fi
exec /usr/bin/grep "$@"
`,
      { mode: 0o755 },
    ),
  ]);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu
${shellFunction(source, 'fail')}
${shellFunction(source, 'assert_no_secret_metadata')}
assert_no_secret_metadata app fixture-sentinel ${shellQuote(
      credentialUriPattern,
    )} "$@"
`,
  );
  await chmod(wrapperPath, 0o755);

  const cleanResult = await execFile('/bin/sh', [wrapperPath, cleanPath], {
    encoding: 'utf8',
  });
  assert.equal(`${cleanResult.stdout}${cleanResult.stderr}`, '');

  const detectedResult = await execFile('/bin/sh', [wrapperPath, secretPath], {
    encoding: 'utf8',
  }).catch((error) => error);
  assert.notEqual(detectedResult?.code ?? 0, 0);
  assert.match(
    detectedResult?.stderr ?? '',
    /secret-like metadata detected: app/u,
  );

  for (const failingBin of [fixedFailureBin, regexFailureBin]) {
    const failedResult = await execFile('/bin/sh', [wrapperPath, cleanPath], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${failingBin}:${process.env.PATH}` },
    }).catch((error) => error);
    const failedOutput = `${failedResult?.stdout ?? ''}${
      failedResult?.stderr ?? ''
    }`;
    assert.notEqual(failedResult?.code ?? 0, 0);
    assert.match(failedOutput, /secret metadata scan failed: app/u);
    assert.doesNotMatch(failedOutput, new RegExp(failureCanary, 'u'));
  }
});

test('secret-path audit distinguishes grep no-match from scanner failure', async (context) => {
  const source = await readHarness();
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-path-scan-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const wrapperPath = path.join(fixtureRoot, 'scan-paths.sh');
  const cleanPath = path.join(fixtureRoot, 'clean.txt');
  const forbiddenPath = path.join(fixtureRoot, 'forbidden.txt');
  const failingBin = path.join(fixtureRoot, 'failing-bin');
  const failureCanary = 'PATH_GREP_FAILURE_CANARY_MUST_NOT_LEAK';
  await mkdir(failingBin);
  await Promise.all([
    writeFile(cleanPath, 'usr/local/bin/node\n'),
    writeFile(forbiddenPath, 'srv/app/.env\n'),
    writeFile(
      path.join(failingBin, 'grep'),
      `#!/bin/sh\nprintf '%s\\n' "${failureCanary}" >&2\nexit 37\n`,
      { mode: 0o755 },
    ),
  ]);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu
${shellFunction(source, 'fail')}
${shellFunction(source, 'assert_no_forbidden_secret_paths')}
assert_no_forbidden_secret_paths app '(^|/)\\.env($|[./])' "$1"
`,
  );
  await chmod(wrapperPath, 0o755);

  const cleanResult = await execFile('/bin/sh', [wrapperPath, cleanPath], {
    encoding: 'utf8',
  });
  assert.equal(`${cleanResult.stdout}${cleanResult.stderr}`, '');

  const detectedResult = await execFile(
    '/bin/sh',
    [wrapperPath, forbiddenPath],
    {
      encoding: 'utf8',
    },
  ).catch((error) => error);
  assert.notEqual(detectedResult?.code ?? 0, 0);
  assert.match(
    detectedResult?.stderr ?? '',
    /forbidden secret path detected: app/u,
  );

  const failedResult = await execFile('/bin/sh', [wrapperPath, cleanPath], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${failingBin}:${process.env.PATH}` },
  }).catch((error) => error);
  const failedOutput = `${failedResult?.stdout ?? ''}${
    failedResult?.stderr ?? ''
  }`;
  assert.notEqual(failedResult?.code ?? 0, 0);
  assert.match(failedOutput, /secret path scan failed: app/u);
  assert.doesNotMatch(failedOutput, new RegExp(failureCanary, 'u'));
});

test('filesystem audit fails closed on injected find and grep errors', async (context) => {
  const source = await readHarness();
  const credentialUriPattern = sharedCredentialUriPattern(source);
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-filesystem-scan-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const scanRoot = path.join(fixtureRoot, 'scan-root');
  const hitsPath = path.join(fixtureRoot, 'hits.txt');
  const wrapperPath = path.join(fixtureRoot, 'scan-filesystem.sh');
  const findFailureBin = path.join(fixtureRoot, 'find-failure-bin');
  const grepFailureBin = path.join(fixtureRoot, 'grep-failure-bin');
  const regexGrepFailureBin = path.join(fixtureRoot, 'regex-grep-failure-bin');
  const failureCanary = 'FILESYSTEM_SCANNER_FAILURE_CANARY_MUST_NOT_LEAK';
  await Promise.all([
    mkdir(scanRoot),
    mkdir(findFailureBin),
    mkdir(grepFailureBin),
    mkdir(regexGrepFailureBin),
  ]);
  await Promise.all([
    writeFile(path.join(scanRoot, 'clean'), 'ordinary image content\n'),
    writeFile(
      path.join(findFailureBin, 'find'),
      `#!/bin/sh\nprintf '%s\\n' "${failureCanary}" >&2\nexit 29\n`,
      { mode: 0o755 },
    ),
    writeFile(
      path.join(grepFailureBin, 'grep'),
      `#!/bin/sh\nprintf '%s\\n' "${failureCanary}" >&2\nexit 31\n`,
      { mode: 0o755 },
    ),
    writeFile(
      path.join(regexGrepFailureBin, 'grep'),
      `#!/bin/sh
if [ "$1" = '-aEi' ]; then
  printf '%s\\n' "${failureCanary}" >&2
  exit 31
fi
exec /usr/bin/grep "$@"
`,
      { mode: 0o755 },
    ),
  ]);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu
${shellFunction(source, 'find_secret_like_files')}
if ! find_secret_like_files "$1" "$2" fixture-sentinel ${shellQuote(
      credentialUriPattern,
    )}; then
  printf '%s\n' 'secret filesystem scan failed' >&2
  exit 1
fi
`,
  );
  await chmod(wrapperPath, 0o755);

  const cleanResult = await execFile(
    '/bin/sh',
    [wrapperPath, scanRoot, hitsPath],
    { encoding: 'utf8' },
  );
  assert.equal(`${cleanResult.stdout}${cleanResult.stderr}`, '');
  assert.equal(await readFile(hitsPath, 'utf8'), '');

  const secretPath = path.join(scanRoot, 'secret');
  await writeFile(secretPath, 'fixture-sentinel\n');
  const detectedResult = await execFile(
    '/bin/sh',
    [wrapperPath, scanRoot, hitsPath],
    { encoding: 'utf8' },
  );
  assert.equal(`${detectedResult.stdout}${detectedResult.stderr}`, '');
  assert.equal(await readFile(hitsPath, 'utf8'), `${secretPath}\n`);
  await rm(secretPath);

  const credentialUriPath = path.join(scanRoot, 'credentialed-postgres-uri');
  await writeFile(
    credentialUriPath,
    'postgres://fixture-user:test-only@database.invalid/fixture\n',
  );
  const credentialResult = await execFile(
    '/bin/sh',
    [wrapperPath, scanRoot, hitsPath],
    { encoding: 'utf8' },
  );
  assert.equal(`${credentialResult.stdout}${credentialResult.stderr}`, '');
  assert.equal(await readFile(hitsPath, 'utf8'), `${credentialUriPath}\n`);
  await rm(credentialUriPath);

  for (const failingBin of [
    findFailureBin,
    grepFailureBin,
    regexGrepFailureBin,
  ]) {
    const result = await execFile(
      '/bin/sh',
      [wrapperPath, scanRoot, hitsPath],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${failingBin}:${process.env.PATH}` },
      },
    ).catch((error) => error);
    const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}`;
    assert.notEqual(result?.code ?? 0, 0);
    assert.match(output, /secret filesystem scan failed/u);
    assert.doesNotMatch(output, new RegExp(failureCanary, 'u'));
  }
});

test('failed image builds emit only bounded categorized diagnostics', async (context) => {
  const source = await readHarness();
  const buildImage = shellFunctionBody(source, 'build_image');
  const diagnosticScanner = shellHereDocument(
    shellFunction(source, 'report_build_failure'),
    'PY',
  );
  assert.ok(
    buildImage.indexOf('report_build_failure') >= 0 &&
      buildImage.indexOf('report_build_failure') <
        buildImage.indexOf('fail "image build failed'),
    'categorized diagnostics must be emitted before the build log is cleaned',
  );
  assert.doesNotMatch(
    diagnosticScanner,
    /deque\(\s*log_file\s*,/u,
    'a physical log line must be bounded before deque retention',
  );
  assert.match(diagnosticScanner, /^MAX_LINE_CHARS = 4096$/mu);
  const physicalReads = [
    ...diagnosticScanner.matchAll(/log_file\.readline\((?<size>[^)]*)\)/gu),
  ];
  assert.ok(
    physicalReads.length > 0,
    'diagnostic scanner must use sized reads',
  );
  for (const read of physicalReads) {
    assert.equal(read.groups?.size?.trim(), 'MAX_LINE_CHARS + 1');
  }
  assert.ok(
    diagnosticScanner.indexOf('log_file.readline(MAX_LINE_CHARS + 1)') <
      diagnosticScanner.indexOf('bounded_lines = deque('),
    'sized reads must occur before a prefix enters the deque',
  );
  assert.match(
    diagnosticScanner,
    /bounded_lines = deque\([\s\S]*maxlen=5000\s*\)/u,
  );
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-image-build-diagnostic-test-'),
  );
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));
  const wrapperPath = path.join(fixtureRoot, 'report-build-failure.sh');
  const logPath = path.join(fixtureRoot, 'build.log');
  const hostileLogPath = path.join(fixtureRoot, 'hostile-no-newline.log');
  const secret = 'BUILD_DIAGNOSTIC_SECRET_MUST_NOT_LEAK';
  const numericCanaries = ['8675309', '314159265', '424242'];
  await writeFile(
    logPath,
    [
      `#${numericCanaries[0]} ERROR: failed to solve: process did not complete successfully: exit code: ${numericCanaries[1]}`,
      `Dockerfile:${numericCanaries[2]}`,
      `build diagnostic categories: adversarial-${numericCanaries[0]}`,
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
  assert.equal(
    output,
    'build diagnostics: app\nbuild diagnostic categories: build-error command-exit\n',
  );
  assert.ok(output.length < 1500, 'diagnostics must remain bounded');
  for (const canary of numericCanaries) {
    assert.doesNotMatch(output, new RegExp(canary, 'u'));
  }
  assert.doesNotMatch(output, /[0-9=]/u);
  assert.doesNotMatch(output, new RegExp(secret, 'u'));
  assert.doesNotMatch(output, /postgresql:\/\//u);
  assert.doesNotMatch(output, /BEGIN PRIVATE KEY/u);

  await writeFile(
    hostileLogPath,
    `${'x'.repeat(4091)} error${'y'.repeat(256 * 1024)}`,
  );
  const hostileResult = await execFile(
    '/bin/sh',
    [wrapperPath, hostileLogPath],
    { encoding: 'utf8' },
  );
  assert.equal(
    `${hostileResult.stdout}${hostileResult.stderr}`,
    'build diagnostics: app\nbuild diagnostic categories: unclassified\n',
  );

  const readFailureCanary = '9081726354';
  const missingLogPath = path.join(
    fixtureRoot,
    `missing-build-log-${readFailureCanary}`,
  );
  const failedResult = await execFile(
    '/bin/sh',
    [wrapperPath, missingLogPath],
    {
      encoding: 'utf8',
    },
  ).catch((error) => error);
  const failedOutput = `${failedResult?.stdout ?? ''}${
    failedResult?.stderr ?? ''
  }`;
  assert.notEqual(failedResult?.code ?? 0, 0);
  assert.equal(
    failedOutput,
    'build diagnostics: app\nbuild diagnostic categories: scanner-failure\n',
  );
  assert.doesNotMatch(failedOutput, new RegExp(readFailureCanary, 'u'));
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
  assert.match(
    shellFunctionBody(source, 'assert_runtime_hardening'),
    /app\)[\s\S]*--entrypoint \/nodejs\/bin\/node[\s\S]*"\$image_reference"\s+-e 'process\.exit\(0\)'/u,
    'app hardening smoke must use the distroless Node runtime instead of /bin/true',
  );
  assert.match(source, /verify_caddy_runtime/u);
  assert.match(source, /--entrypoint \/usr\/bin\/caddy/u);
  assert.match(source, /Caddy hardened version smoke failed/u);
  assert.match(source, /Caddy version smoke produced no output/u);
  assert.match(
    source,
    /wget -q --server-response --header "Host: unknown\.invalid"/u,
  );
  assert.match(source, /\[ "\$caddy_status" = 421 \]/u);
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
  const appVerification = shellFunctionBody(source, 'start_and_verify_app');

  assert.match(
    source,
    /POSTGRES_IMAGE='postgres:18\.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'/u,
  );
  assert.doesNotMatch(
    source,
    /target=\/var\/lib\/postgresql\/data/u,
    'PostgreSQL 18 containers must not mount volumes at the legacy PGDATA path',
  );
  assert.match(
    source,
    /source=\$SOURCE_DATABASE_VOLUME,target=\/var\/lib\/postgresql"/u,
    'source PostgreSQL 18 volume must mount at the parent data directory',
  );
  assert.match(
    source,
    /source=\$TARGET_DATABASE_VOLUME,target=\/var\/lib\/postgresql"/u,
    'target PostgreSQL 18 volume must mount at the parent data directory',
  );
  assert.match(source, /create role portfolio_app login/u);
  assert.match(source, /create role portfolio_backup login/u);
  assert.match(
    source,
    /"\$APP_IMAGE"\s+\/app\/dist\/scripts\/db\/migrate\.js/u,
  );
  assert.doesNotMatch(source, /node \/app\/dist\/scripts\/db\/migrate\.js/u);
  assert.match(
    appVerification,
    /--network-alias app/u,
    'application verification must use the same short Docker DNS name as Caddy',
  );
  assert.doesNotMatch(
    appVerification,
    /--publish 127\.0\.0\.1::3000/u,
    'application verification must not depend on host port publishing',
  );
  assert.doesNotMatch(
    appVerification,
    /docker port "\$APP_CONTAINER"/u,
    'application verification must not depend on Docker host port inspection',
  );
  assert.match(
    appVerification,
    /http:\/\/app:3000/u,
    'application verification must exercise the Docker network route',
  );
  assert.doesNotMatch(
    appVerification,
    /app_wget http:\/\/app:3000\/sw-manifest\.json --output "\$manifest_file"/u,
    'sidecar fetch must not write host manifest paths inside the container',
  );
  assert.match(
    appVerification,
    /app_wget http:\/\/app:3000\/sw-manifest\.json >"\$manifest_file"/u,
    'sidecar fetch must stream the manifest back to the host for jq validation',
  );
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
  assert.match(
    source,
    /app_wget\(\)[\s\S]*wget --quiet --timeout=10 --tries=1/u,
  );
  assert.doesNotMatch(source, /--entrypoint curl/u);
  const videoRange = shellFunctionBody(source, 'verify_app_video_range');
  assert.match(videoRange, /--entrypoint \/nodejs\/bin\/node/u);
  assert.match(videoRange, /fetch\("http:\/\/app:3000\/assets\/man\.mp4"/u);
  assert.match(source, /\/assets\/man\.mp4/u);
  assert.match(videoRange, /Range: "bytes=0-31"/u);
  assert.doesNotMatch(videoRange, /wget/u);
  assert.match(source, /Content-Range/u);
  assert.match(videoRange, /response\.status !== 206/u);
  assert.match(videoRange, /content-range/u);
  assert.match(videoRange, /body\.byteLength !== 32/u);
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
  const postgresWait = shellFunctionBody(source, 'wait_for_postgres');

  assert.match(
    bootstrap,
    /create role portfolio_migrator login nosuperuser nocreatedb nocreaterole noreplication nobypassrls/u,
  );
  assert.match(
    postgresWait,
    /psql[\s\S]*--dbname "\$database_name"[\s\S]*select 1/u,
    'PostgreSQL readiness must prove the requested database exists',
  );
  assert.match(
    bootstrap,
    /alter database :"database_name" owner to portfolio_migrator/u,
  );
  assert.match(
    bootstrap,
    /bootstrap-\$database_name\.txt/u,
    'role bootstrap failures must surface bounded psql diagnostics',
  );
  assert.match(
    bootstrap,
    /PostgreSQL production role bootstrap failed: \$database_name/u,
    'role bootstrap failures must identify the database being bootstrapped',
  );
  assert.doesNotMatch(productionBootstrap, /alter schema public owner/iu);
  assert.doesNotMatch(bootstrap, /alter schema public owner/iu);
  assert.match(migrations, /--env PGUSER=portfolio_migrator/u);
  assert.doesNotMatch(migrations, /--env PGUSER=postgres/u);
  assert.match(
    migrations,
    /"\$APP_IMAGE"\s+\/app\/dist\/scripts\/db\/migrate\.js/u,
    'app-image migration smoke must pass only the script path to the distroless Node entrypoint',
  );
  assert.doesNotMatch(
    migrations,
    /"\$APP_IMAGE"\s+node\s+\/app\/dist\/scripts\/db\/migrate\.js/u,
    'app-image migration smoke must not pass a nested node executable to distroless Node',
  );
  assert.match(verification, /pg_get_userbyid\(datdba\)/u);
  assert.match(
    verification,
    /pg_get_userbyid\(nspowner\)[\s\S]*is distinct from 'pg_database_owner'/u,
  );
  assert.match(verification, /pg_get_userbyid\(relowner\)/u);
  assert.match(verification, /has_table_privilege/u);
  assert.match(
    verification,
    /003_contact_journal/u,
    'security contract must validate the current contact journal migration',
  );
  assert.match(
    verification,
    /has_function_privilege/u,
    'security contract must validate journal contact function execution grants',
  );
  assert.doesNotMatch(
    verification,
    /role_name = 'portfolio_app' and table_name = 'contact_messages'/u,
    'portfolio_app must no longer have direct contact_messages inserts',
  );
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
    /usage: mlp-migration \{export\|rehearsal\|preload\|contacts\|journal-recover\|remove-synthetic UUID\}/u,
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

test('cleanup detects absent labeled resources while IFS is newline-only', async (context) => {
  const source = await readHarness();
  const fixture = await createCleanupFixture(source, {
    containers: 'owned-resource',
    networks: 'owned-resource',
    resourceLabel: 'owned-run',
    resourceName: 'owned-resource',
    success: 1,
    volumes: 'owned-resource',
  });
  context.after(() =>
    rm(fixture.fixtureRoot, { force: true, recursive: true }),
  );

  const result = await execFile('/bin/sh', [fixture.wrapperPath], {
    encoding: 'utf8',
    env: fixture.env,
  }).catch((error) => error);
  const log = await readFile(fixture.logPath, 'utf8');

  assert.equal(result.code ?? 0, 0, `${result.stderr ?? ''}\n${log}`);
  assert.match(
    log,
    /^container ls --all --quiet --filter name=\^\/owned-resource\$$/mu,
  );
  assert.match(log, /^network ls --quiet --filter name=\^owned-resource\$$/mu);
  assert.match(log, /^volume ls --quiet --filter name=\^owned-resource\$$/mu);
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
