import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const YAML = require('yaml');

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const composePath = path.join(repositoryRoot, 'compose.migration.yml');
const scriptPath = path.join(repositoryRoot, 'ops/migration.sh');
const nativeChownPath =
  process.platform === 'darwin' ? '/usr/sbin/chown' : '/bin/chown';
const environmentPath = path.join(
  repositoryRoot,
  'infra/runtime.example/env/migration.env',
);
const digestPattern =
  /^ghcr\.io\/martinlindblad\/mlp-migration@sha256:[0-9a-f]{64}$/u;
const migrationImage = `ghcr.io/martinlindblad/mlp-migration@sha256:${'c'.repeat(
  64,
)}`;
const migrationImageId = `sha256:${'d'.repeat(64)}`;
const services = [
  'migration-contacts',
  'migration-export',
  'migration-preload',
  'migration-rehearsal',
  'migration-remove-synthetic',
];
const importServices = [
  'migration-contacts',
  'migration-preload',
  'migration-rehearsal',
];
const artifactServices = ['migration-export', ...importServices];
const migrationSecrets = {
  'mongo-uri-migration-operator': {
    file: '/etc/mlp/compose-secrets/mongo-uri-migration-operator',
    target: 'mongo-uri',
  },
  'postgres-migrator-password-migration-operator': {
    file: '/etc/mlp/compose-secrets/postgres-migrator-password-migration-operator',
    target: 'postgres-migrator-password',
  },
};

async function readRequired(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(
        `${relativePath}: required Task 10 migration artifact missing`,
      );
    }
    throw error;
  }
}

function parseYaml(source, filename) {
  try {
    return YAML.parse(source, { merge: true });
  } catch {
    assert.fail(`${filename} must be valid YAML`);
  }
}

function sortedKeys(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return Object.keys(value).sort();
}

function secretSources(service) {
  return (service.secrets ?? [])
    .map((secret) => {
      assert.ok(secret && typeof secret === 'object' && !Array.isArray(secret));
      assert.deepEqual(Object.keys(secret).sort(), ['source', 'target']);
      assert.equal(secret.target, migrationSecrets[secret.source]?.target);
      return secret.source;
    })
    .sort();
}

function volumeTargets(service) {
  return (service.volumes ?? []).map((volume) => {
    assert.ok(volume && typeof volume === 'object' && !Array.isArray(volume));
    assert.equal(volume.type, 'bind');
    assert.equal(volume.source, '/var/lib/mlp/migration-artifacts/operator');
    assert.equal(volume.target, '/migration-artifacts');
    assert.notEqual(volume.read_only, true);
    assert.equal(volume.bind?.create_host_path, false);
    return volume.target;
  });
}

function assertNoDockerSurface(service, name) {
  for (const key of [
    'build',
    'container_name',
    'depends_on',
    'devices',
    'entrypoint',
    'expose',
    'extra_hosts',
    'ipc',
    'network_mode',
    'pid',
    'ports',
    'privileged',
    'stdin_open',
    'tty',
    'volumes_from',
  ]) {
    assert.equal(service[key], undefined, `${name} forbids ${key}`);
  }
  assert.equal(service.read_only, true);
  assert.equal(service.user, '1000:1000');
  assert.equal(String(service.restart), 'no');
  assert.deepEqual(service.cap_drop, ['ALL']);
  assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
  assert.deepEqual(service.tmpfs, [
    '/tmp:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=1770',
  ]);
  assert.equal(
    service.image,
    '${MIGRATION_IMAGE:?MIGRATION_IMAGE is required}',
  );
}

function parseEnvironment(source) {
  const result = {};
  for (const [index, rawLine] of source.split(/\r?\n/u).entries()) {
    if (rawLine.length === 0) continue;
    const match = rawLine.match(/^([A-Z_][A-Z0-9_]*)=(\S+)$/u);
    assert.ok(match, `migration.env:${index + 1} must be one KEY=value record`);
    assert.equal(Object.hasOwn(result, match[1]), false, `${match[1]} repeats`);
    result[match[1]] = match[2];
  }
  return result;
}

test('migration compose exposes only fixed external networks and isolated one-shot services', async () => {
  const compose = parseYaml(
    await readRequired('compose.migration.yml'),
    'compose.migration.yml',
  );
  assert.equal(compose.name, 'mlp-migration');
  assert.deepEqual(sortedKeys(compose.services), services);
  assert.deepEqual(sortedKeys(compose.networks), ['database', 'egress']);
  assert.deepEqual(compose.networks, {
    database: { external: true, name: 'mlp-prod_database' },
    egress: { external: true, name: 'mlp-prod_egress' },
  });
  assert.equal(compose.volumes, undefined);
  assert.deepEqual(sortedKeys(compose.secrets), [
    'mongo-uri-migration-operator',
    'postgres-migrator-password-migration-operator',
  ]);
  assert.deepEqual(
    compose.secrets,
    Object.fromEntries(
      Object.entries(migrationSecrets).map(([name, { file }]) => [
        name,
        { file },
      ]),
    ),
  );

  for (const name of services) {
    const service = compose.services[name];
    assertNoDockerSurface(service, name);
    assert.deepEqual(service.profiles, [name.slice('migration-'.length)]);
    assert.deepEqual(service.command, [name.slice('migration-'.length)]);
    const networkNames = sortedKeys(service.networks);
    assert.ok(
      networkNames.every((network) => ['database', 'egress'].includes(network)),
    );
    if (networkNames.includes('egress')) {
      assert.deepEqual(service.networks.egress, { gw_priority: 1 });
    }
  }

  assert.deepEqual(sortedKeys(compose.services['migration-export'].networks), [
    'egress',
  ]);
  for (const name of importServices) {
    assert.deepEqual(sortedKeys(compose.services[name].networks), [
      'database',
      'egress',
    ]);
  }
  assert.deepEqual(
    sortedKeys(compose.services['migration-remove-synthetic'].networks),
    ['database'],
  );

  assert.deepEqual(secretSources(compose.services['migration-export']), [
    'mongo-uri-migration-operator',
  ]);
  for (const name of importServices) {
    assert.deepEqual(secretSources(compose.services[name]), [
      'mongo-uri-migration-operator',
      'postgres-migrator-password-migration-operator',
    ]);
  }
  assert.deepEqual(
    secretSources(compose.services['migration-remove-synthetic']),
    ['postgres-migrator-password-migration-operator'],
  );

  for (const name of artifactServices) {
    assert.deepEqual(volumeTargets(compose.services[name]), [
      '/migration-artifacts',
    ]);
  }
  assert.deepEqual(
    volumeTargets(compose.services['migration-remove-synthetic']),
    [],
  );

  const exportEnvironment = compose.services['migration-export'].environment;
  assert.deepEqual(exportEnvironment, {
    ARCHIVE_RECIPIENT:
      '${MIGRATION_ARCHIVE_RECIPIENT:?MIGRATION_ARCHIVE_RECIPIENT is required}',
    ARTIFACT_DIR: '/migration-artifacts/source',
    MONGO_DATABASE:
      '${MIGRATION_MONGO_DATABASE:?MIGRATION_MONGO_DATABASE is required}',
    MONGO_URI_FILE: '/run/secrets/mongo-uri',
  });

  const postgresEnvironment = {
    PGCONNECT_TIMEOUT_MS:
      '${MIGRATION_PGCONNECT_TIMEOUT_MS:?MIGRATION_PGCONNECT_TIMEOUT_MS is required}',
    PGDATABASE: '${MIGRATION_PGDATABASE:?MIGRATION_PGDATABASE is required}',
    PGHOST: '${MIGRATION_PGHOST:?MIGRATION_PGHOST is required}',
    PGPASSWORD_FILE: '/run/secrets/postgres-migrator-password',
    PGPOOL_MAX: '${MIGRATION_PGPOOL_MAX:?MIGRATION_PGPOOL_MAX is required}',
    PGPORT: '${MIGRATION_PGPORT:?MIGRATION_PGPORT is required}',
    PGUSER: '${MIGRATION_PGUSER:?MIGRATION_PGUSER is required}',
  };
  const importEnvironment = {
    ...postgresEnvironment,
    MIGRATION_REPORT_ROOT: '/migration-artifacts/reports',
    MONGO_DATABASE:
      '${MIGRATION_MONGO_DATABASE:?MIGRATION_MONGO_DATABASE is required}',
    MONGO_URI_FILE: '/run/secrets/mongo-uri',
  };
  assert.deepEqual(
    compose.services['migration-rehearsal'].environment,
    importEnvironment,
  );
  assert.deepEqual(
    compose.services['migration-preload'].environment,
    importEnvironment,
  );
  assert.deepEqual(compose.services['migration-contacts'].environment, {
    ...importEnvironment,
    CONTACT_TRAFFIC_DRAINED: 'yes',
  });
  assert.deepEqual(
    compose.services['migration-remove-synthetic'].environment,
    postgresEnvironment,
  );

  const serialized = JSON.stringify(compose);
  for (const forbidden of [
    'postgres-app-password',
    'postgres-backup-password',
    'postgres-bootstrap-password',
    'cloudflare-tunnel-token',
    'restic-password',
    '/var/run/docker.sock',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'u'));
  }
});

test('migration runtime example is exact, immutable, and non-secret', async () => {
  const environment = parseEnvironment(
    await readRequired('infra/runtime.example/env/migration.env'),
  );
  assert.deepEqual(Object.keys(environment).sort(), [
    'MIGRATION_ARCHIVE_RECIPIENT',
    'MIGRATION_IMAGE',
    'MIGRATION_MONGO_DATABASE',
    'MIGRATION_PGCONNECT_TIMEOUT_MS',
    'MIGRATION_PGDATABASE',
    'MIGRATION_PGHOST',
    'MIGRATION_PGPOOL_MAX',
    'MIGRATION_PGPORT',
    'MIGRATION_PGUSER',
  ]);
  assert.match(environment.MIGRATION_IMAGE, digestPattern);
  assert.equal(
    environment.MIGRATION_ARCHIVE_RECIPIENT,
    'UNCONFIGURED_AGE_RECIPIENT',
    'the tracked example must fail closed until the operator installs its own recoverable age recipient',
  );
  assert.equal(environment.MIGRATION_MONGO_DATABASE, 'mlp_db');
  assert.equal(environment.MIGRATION_PGHOST, 'postgres');
  assert.equal(environment.MIGRATION_PGPORT, '5432');
  assert.equal(environment.MIGRATION_PGDATABASE, 'portfolio');
  assert.equal(environment.MIGRATION_PGUSER, 'portfolio_migrator');
  assert.equal(environment.MIGRATION_PGPOOL_MAX, '2');
  assert.equal(environment.MIGRATION_PGCONNECT_TIMEOUT_MS, '5000');
  assert.doesNotMatch(
    JSON.stringify(environment),
    /mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|password|secret|private[_-]?key/iu,
  );
});

test('migration wrapper has a fixed root-only allowlisted command surface', async () => {
  const source = await readRequired('ops/migration.sh');
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  assert.equal(lines[0], '#!/bin/bash -p');
  assert.equal(lines[1], 'set +x');
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /^PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/mu);
  assert.match(source, /^export PATH LC_ALL$/mu);
  assert.match(source, /^source \/opt\/mlp\/ops\/lib\/operations\.sh$/mu);
  assert.ok(
    source.lastIndexOf('PATH=/usr/sbin:/usr/bin:/sbin:/bin') >
      source.indexOf('source /opt/mlp/ops/lib/operations.sh'),
    'the wrapper must restore its narrow fixed PATH after the shared library is sourced',
  );
  assert.match(source, /^\s*HOME=\/etc\/mlp$/mu);
  assert.match(source, /^\s*DOCKER_CONFIG=\/etc\/mlp\/docker-client$/mu);
  assert.match(source, /^\s*DOCKER_HOST=unix:\/\/\/run\/docker\.sock$/mu);
  assert.match(
    source,
    /^\s*export DOCKER_CONFIG DOCKER_HOST HOME PATH LC_ALL$/mu,
  );
  assert.match(source, /\bmlp_require_root\b/u);
  assert.match(source, /\bmlp_acquire_operations_lock\b/u);
  assert.match(source, /mlp_require_root_directory \/opt\/mlp 0755/u);
  assert.match(source, /mlp_require_root_directory \/etc\/mlp 0700/u);
  assert.match(
    source,
    /mlp_require_root_directory \/etc\/mlp\/compose-secrets 0700/u,
  );
  assert.match(
    source,
    /mlp_require_root_directory \/etc\/mlp\/docker-client 0700/u,
  );
  assert.match(
    source,
    /mlp_require_root_file \/etc\/mlp\/env\/migration\.env 0600/u,
  );
  assert.match(
    source,
    /mlp_require_root_directory \/var\/lib\/mlp\/migration-artifacts 0700/u,
  );
  assert.match(source, /1000:1000:700/u);
  assert.match(source, /\/usr\/bin\/timeout/u);
  assert.match(source, /\/usr\/local\/sbin\/mlp-backup/u);
  assert.match(source, /\/usr\/local\/sbin\/mlp-contact-mode maintenance/u);
  assert.match(source, /\/usr\/local\/libexec\/mlp\/docker-compose/u);
  assert.doesNotMatch(
    source,
    /local -a compose=\(\/usr\/bin\/docker|\/usr\/bin\/docker --config/u,
    'migration launch must never traverse the Docker CLI plugin grandchild',
  );
  assert.match(source, /--project-name mlp-migration/u);
  assert.match(source, /--project-directory \/opt\/mlp/u);
  assert.match(source, /--env-file \/etc\/mlp\/env\/migration\.env/u);
  assert.match(source, /--file \/opt\/mlp\/compose\.migration\.yml/u);
  assert.match(source, /run --detach --no-TTY --no-deps/u);
  assert.match(source, /--name "\$helper_name"/u);
  assert.match(source, /--label com\.mlp\.operation=migration/u);
  assert.match(source, /--label "com\.mlp\.migration\.operation=\$OPERATION"/u);
  assert.match(source, /--label "com\.mlp\.migration\.run-id=\$run_id"/u);
  assert.match(source, /--label "com\.mlp\.migration\.service=\$service"/u);
  assert.match(
    source,
    /--label "com\.mlp\.migration\.image=\$CONFIG_MIGRATION_IMAGE"/u,
  );
  assert.match(source, /\{\{\.Config\.Image\}\}/u);
  assert.match(source, /\{\{\.Image\}\}/u);
  assert.match(source, /\bimage inspect\b/u);
  assert.match(source, /\bcontainer wait\b/u);
  assert.match(source, /\bcontainer rm --force\b/u);
  assert.match(
    source,
    /\/usr\/bin\/timeout --foreground --signal=TERM --kill-after=5s 30s\s+\\\s+\/usr\/bin\/docker container inspect/u,
  );
  assert.match(
    source,
    /\/usr\/bin\/timeout --signal=TERM --kill-after=30s 5m\s+\\\s+"\$\{compose\[@\]\}"/u,
    "one-shot create must run in timeout's isolated process group",
  );
  assert.doesNotMatch(
    source,
    /\/usr\/bin\/timeout --foreground[^\n]*5m\s+\\\s+"\$\{compose\[@\]\}"/u,
  );
  assert.doesNotMatch(source, /run --rm/u);
  assert.match(source, /^\s*\/usr\/local\/sbin\/mlp-backup$/mu);
  assert.match(
    source,
    /^\s*\/usr\/local\/sbin\/mlp-contact-mode maintenance[^\n]*$/mu,
  );
  assert.doesNotMatch(
    source,
    /\/usr\/bin\/timeout[^\n]*(?:mlp-backup|mlp-contact-mode)/u,
  );
  assert.doesNotMatch(source, /\b(?:eval|exec \$|source \$|docker \$)\b/u);
  assert.doesNotMatch(
    source,
    /(?:echo|printf)[^\n]*(?:MLP_|MONGO_|PGPASSWORD)/u,
  );
  assert.doesNotMatch(source, /^(?:set -x|env|printenv)\b/mu);
  assert.doesNotMatch(
    source,
    /^\s*(?:export\s+)?MLP_(?:MONGO_URI|POSTGRES_MIGRATOR_PASSWORD)=/mu,
  );
  assert.match(
    source,
    /stage_migration_secret \/etc\/mlp\/secrets\/mongo-readonly-uri mongo-uri-migration-operator/u,
  );
  assert.match(
    source,
    /stage_migration_secret \/etc\/mlp\/secrets\/postgres-migrator-password postgres-migrator-password-migration-operator/u,
  );
  assert.match(source, /cleanup_migration_secrets/u);
  for (const command of [
    'export',
    'rehearsal',
    'preload',
    'contacts',
    'remove-synthetic',
  ]) {
    assert.match(source, new RegExp(`^[ \\t]*${command}\\)`, 'mu'));
  }
  assert.match(
    source,
    /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-8\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$/u,
  );
  assert.match(source, /APP_CONTACT_MODE=contact-maintenance/u);
  const mainSource = source.slice(source.indexOf('main() {'));
  assert.ok(
    mainSource.indexOf('prepare_operator') <
      mainSource.indexOf('require_contact_maintenance'),
  );
  assert.ok(
    mainSource.indexOf('prepare_operator') <
      mainSource.indexOf('/usr/local/sbin/mlp-backup'),
  );
});

async function executable(pathname, source) {
  await writeFile(pathname, source, { mode: 0o700 });
  await chmod(pathname, 0o700);
}

async function regularFile(pathname, source) {
  await writeFile(pathname, source, { mode: 0o600 });
  await chmod(pathname, 0o600);
}

async function makeHarness(database = 'portfolio', mongoDatabase = 'mlp_db') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-migration-ops-'));
  const fake = path.join(root, 'fake');
  const etc = path.join(root, 'etc-mlp');
  const envDir = path.join(etc, 'env');
  const secrets = path.join(etc, 'secrets');
  const composeSecrets = path.join(etc, 'compose-secrets');
  const dockerClient = path.join(etc, 'docker-client');
  const artifactParent = path.join(root, 'migration-artifacts');
  const artifactOperator = path.join(artifactParent, 'operator');
  await mkdir(etc, { mode: 0o700 });
  await mkdir(artifactParent, { mode: 0o700 });
  await Promise.all([
    mkdir(fake, { mode: 0o700 }),
    mkdir(envDir, { mode: 0o700 }),
    mkdir(secrets, { mode: 0o700 }),
    mkdir(composeSecrets, { mode: 0o700 }),
    mkdir(dockerClient, { mode: 0o700 }),
    mkdir(artifactOperator, { mode: 0o700 }),
  ]);
  const trace = path.join(root, 'trace');
  const lock = path.join(root, 'operations.lock');
  const dockerState = path.join(root, 'docker-state');
  await mkdir(dockerState, { mode: 0o700 });
  const ops = path.join(fake, 'operations.sh');
  const backup = path.join(fake, 'backup');
  const compose = path.join(fake, 'docker-compose');
  const contact = path.join(fake, 'contact-mode');
  const docker = path.join(fake, 'docker');
  const sleep = path.join(fake, 'sleep');
  const timeout = path.join(fake, 'timeout');
  await executable(
    ops,
    [
      'mlp_require_root() {',
      '  printf "root\\n" >>"$TEST_TRACE"',
      '  [[ ${TEST_NONROOT:-0} == 0 ]] || return 77',
      '}',
      'mlp_acquire_operations_lock() {',
      '  exec 9>>"$TEST_LOCK"',
      '  printf "lock\\n" >>"$TEST_TRACE"',
      '  [[ ${TEST_LOCK_FAILURE:-0} == 0 ]] || return 75',
      '}',
      'mlp_require_root_directory() { printf "dir:%s:%s\\n" "$1" "$2" >>"$TEST_TRACE"; }',
      'mlp_require_root_file() { printf "file:%s:%s\\n" "$1" "$2" >>"$TEST_TRACE"; }',
      '',
    ].join('\n'),
  );
  await executable(
    backup,
    [
      '#!/bin/bash',
      'printf "backup-fd9\\n" >&9 || exit 74',
      'printf "backup:mongo=%s:pg=%s\\n" "${MLP_MONGO_URI+x}" "${MLP_POSTGRES_MIGRATOR_PASSWORD+x}" >>"$TEST_TRACE"',
      'exit "${TEST_BACKUP_STATUS:-0}"',
      '',
    ].join('\n'),
  );
  await executable(
    contact,
    [
      '#!/bin/bash',
      'printf "contact-fd9\\n" >&9 || exit 74',
      'printf "contact:%s:mongo=%s:pg=%s\\n" "$*" "${MLP_MONGO_URI+x}" "${MLP_POSTGRES_MIGRATOR_PASSWORD+x}" >>"$TEST_TRACE"',
      '[[ "$*" == maintenance ]] || exit 64',
      'exit "${TEST_CONTACT_STATUS:-0}"',
      '',
    ].join('\n'),
  );
  await executable(
    docker,
    [
      '#!/bin/bash',
      'set -u',
      'printf "docker:home=%s:config=%s:host=%s:mongo=%s:pg=%s:" "$HOME" "$DOCKER_CONFIG" "$DOCKER_HOST" "${MLP_MONGO_URI+x}" "${MLP_POSTGRES_MIGRATOR_PASSWORD+x}" >>"$TEST_TRACE"',
      'printf "%s " "$@" >>"$TEST_TRACE"',
      'printf "\\n" >>"$TEST_TRACE"',
      '[[ ${TEST_DOCKER_LIST_FAILURE:-0} == 0 ]] || { [[ " $* " != *" container ls "* ]] || exit 72; }',
      'write_container() {',
      '  local file="$TEST_DOCKER_STATE/$1"',
      '  {',
      '    printf "ID=%q\\n" "$1"',
      '    printf "NAME=%q\\n" "$2"',
      '    printf "OP=%q\\n" "$3"',
      '    printf "RUN_ID=%q\\n" "$4"',
      '    printf "SERVICE=%q\\n" "$5"',
      '    printf "COMPOSE_SERVICE=%q\\n" "$6"',
      '    printf "IMAGE_LABEL=%q\\n" "$7"',
      '    printf "CONFIG_IMAGE=%q\\n" "$8"',
      '    printf "IMAGE_ID=%q\\n" "$9"',
      '    printf "STATE=%q\\n" "${10:-running}"',
      '    printf "EXIT_CODE=%q\\n" "${11:-0}"',
      '  } >"$file"',
      '}',
      'load_container() {',
      '  local wanted=$1 file',
      '  for file in "$TEST_DOCKER_STATE"/[0-9a-f]*; do',
      '    [[ -f "$file" ]] || continue',
      '    unset ID NAME OP RUN_ID SERVICE COMPOSE_SERVICE IMAGE_LABEL CONFIG_IMAGE IMAGE_ID STATE EXIT_CODE',
      '    source "$file"',
      '    if [[ "$ID" == "$wanted" || "$NAME" == "$wanted" || "/$NAME" == "$wanted" ]]; then',
      '      CONTAINER_FILE=$file',
      '      return 0',
      '    fi',
      '  done',
      '  return 1',
      '}',
      'if [[ ${1:-} == compose ]]; then',
      '  printf "docker-compose-plugin-invoked\\n" >>"$TEST_TRACE"',
      '  exit 97',
      'fi',
      'if [[ ${1:-} == image && ${2:-} == inspect ]]; then',
      '  [[ ${TEST_IMAGE_INSPECT_FAILURE:-0} == 0 ]] || exit 71',
      '  printf "%s\\n" "${TEST_IMAGE_INSPECT_ID:-$TEST_EXPECTED_IMAGE_ID}"',
      '  exit 0',
      'fi',
      'if [[ ${1:-} == container && ${2:-} == ls ]]; then',
      '  if [[ -f "$TEST_DOCKER_STATE/pending" && ${TEST_DOCKER_DELAYED_CREATE:-0} == 1 ]]; then',
      '    count=0; [[ ! -f "$TEST_DOCKER_STATE/polls" ]] || read -r count <"$TEST_DOCKER_STATE/polls"',
      '    count=$((count + 1)); printf "%s\\n" "$count" >"$TEST_DOCKER_STATE/polls"',
      '    if [[ $count -eq ${TEST_DOCKER_DELAY_POLLS:-3} ]]; then',
      '      IFS="|" read -r id name op run_id service compose_service image_label config_image image_id <"$TEST_DOCKER_STATE/pending"',
      '      write_container "$id" "$name" "$op" "$run_id" "$service" "$compose_service" "$image_label" "$config_image" "$image_id"',
      '      rm -f "$TEST_DOCKER_STATE/pending"',
      '    fi',
      '  fi',
      '  filter=',
      '  while [[ $# -gt 0 ]]; do [[ $1 != --filter ]] || { filter=$2; shift; }; shift; done',
      '  for file in "$TEST_DOCKER_STATE"/[0-9a-f]*; do',
      '    [[ -f "$file" ]] || continue',
      '    source "$file"',
      '    if [[ "$filter" == name=^/mlp-migration-job- ]]; then',
      '      [[ "$NAME" == mlp-migration-job-* ]] || continue',
      '    elif [[ "$filter" == name=^/*$ ]]; then',
      '      expected=${filter#name=^/}; expected=${expected%$}',
      '      [[ "$NAME" == "$expected" ]] || continue',
      '    fi',
      '    printf "%s\\n" "$ID"',
      '  done',
      '  exit 0',
      'fi',
      'if [[ ${1:-} == container && ${2:-} == inspect ]]; then',
      '  wanted=${!#}',
      '  load_container "$wanted" || exit 1',
      '  printf "%s|/%s|migration|%s|%s|%s|%s|%s|mlp-migration|%s|%s|%s|%s\\n" "$ID" "$NAME" "$OP" "$RUN_ID" "$SERVICE" "$IMAGE_LABEL" "$COMPOSE_SERVICE" "$CONFIG_IMAGE" "$IMAGE_ID" "$STATE" "$EXIT_CODE"',
      '  exit 0',
      'fi',
      'if [[ ${1:-} == container && ${2:-} == wait ]]; then',
      '  wanted=${!#}',
      '  load_container "$wanted" || exit 1',
      '  job_exit=${TEST_DOCKER_JOB_EXIT:-0}',
      '  write_container "$ID" "$NAME" "$OP" "$RUN_ID" "$SERVICE" "$COMPOSE_SERVICE" "$IMAGE_LABEL" "$CONFIG_IMAGE" "$IMAGE_ID" exited "$job_exit"',
      '  printf "RAW_JOB_SECRET_SENTINEL\\n" >&2',
      '  printf "%s\\n" "$job_exit"',
      '  exit "${TEST_DOCKER_WAIT_STATUS:-0}"',
      'fi',
      'if [[ ${1:-} == container && ${2:-} == rm ]]; then',
      '  wanted=${!#}',
      '  load_container "$wanted" || exit 1',
      '  [[ ${TEST_DOCKER_CLEANUP_FAILURE:-0} == 0 ]] || exit 73',
      '  rm -f "$CONTAINER_FILE"',
      '  printf "%s\\n" "$ID"',
      '  exit 0',
      'fi',
      'exit 64',
      '',
    ].join('\n'),
  );
  await executable(
    compose,
    [
      '#!/bin/bash',
      'set -u',
      'if [[ ${1:-} == version && ${2:-} == --short ]]; then',
      '  printf "%s\\n" "${TEST_COMPOSE_VERSION:-5.3.1}"',
      '  exit 0',
      'fi',
      'printf "compose:home=%s:config=%s:host=%s:mongo=%s:pg=%s:" "$HOME" "$DOCKER_CONFIG" "$DOCKER_HOST" "${MLP_MONGO_URI+x}" "${MLP_POSTGRES_MIGRATOR_PASSWORD+x}" >>"$TEST_TRACE"',
      'printf "%s " "$@" >>"$TEST_TRACE"',
      'printf "\\n" >>"$TEST_TRACE"',
      '[[ -z ${MLP_MONGO_URI+x} && -z ${MLP_POSTGRES_MIGRATOR_PASSWORD+x} ]] || exit 66',
      'while [[ $# -gt 0 && $1 != run ]]; do shift; done',
      '[[ ${1:-} == run ]] || exit 64',
      'shift',
      'name= op= run_id= service_label= image_label= service=',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    --detach|--no-TTY|--no-deps) shift ;;',
      '    --name) name=$2; shift 2 ;;',
      '    --label)',
      '      case "$2" in',
      '        com.mlp.migration.operation=*) op=${2#*=} ;;',
      '        com.mlp.migration.run-id=*) run_id=${2#*=} ;;',
      '        com.mlp.migration.service=*) service_label=${2#*=} ;;',
      '        com.mlp.migration.image=*) image_label=${2#*=} ;;',
      '      esac',
      '      shift 2',
      '      ;;',
      '    --*) shift ;;',
      '    *) service=$1; shift; break ;;',
      '  esac',
      'done',
      '[[ -n "$name" && -n "$op" && -n "$run_id" && -n "$service_label" && -n "$image_label" && "$service" == "$service_label" ]] || exit 65',
      'case "$op" in',
      '  export) required=" mongo-uri-migration-operator " ;;',
      '  remove-synthetic) required=" postgres-migrator-password-migration-operator " ;;',
      '  *) required=" mongo-uri-migration-operator postgres-migrator-password-migration-operator " ;;',
      'esac',
      'for filename in mongo-uri-migration-operator postgres-migrator-password-migration-operator; do',
      '  secret="$TEST_COMPOSE_SECRETS/$filename"',
      '  if [[ "$required" == *" $filename "* ]]; then',
      '    [[ -f "$secret" && ! -L "$secret" ]] || exit 67',
      '    lines=$(wc -l <"$secret" | tr -d " ")',
      '    [[ "$lines" == 0 ]] || exit 67',
      '    case "$filename" in',
      '      mongo-*) expected=MIGRATION_MONGO_SECRET_SENTINEL ;;',
      '      *) expected=MIGRATION_PG_SECRET_SENTINEL ;;',
      '    esac',
      '    [[ $(<"$secret") == "$expected" ]] || exit 67',
      '    metadata=$(stat -c "%u:%g:%a:%h" "$secret" 2>/dev/null || stat -f "%u:%g:%Lp:%l" "$secret")',
      '    printf "staged:%s:%s\\n" "$filename" "$metadata" >>"$TEST_TRACE"',
      '  else',
      '    [[ ! -e "$secret" && ! -L "$secret" ]] || exit 67',
      '  fi',
      'done',
      'id=$(printf "a%.0s" {1..64})',
      'printf "%s|%s|%s|%s|%s|%s|%s|%s|%s\\n" "$id" "$name" "$op" "$run_id" "$service_label" "$service" "$image_label" "$image_label" "$TEST_EXPECTED_IMAGE_ID" >"$TEST_DOCKER_STATE/pending"',
      'printf "RAW_OPERATOR_SECRET_SENTINEL\\n" >&2',
      'if [[ ${TEST_DOCKER_START_TIMEOUT:-0} == 1 ]]; then exit 124; fi',
      '{',
      '  printf "ID=%q\\n" "$id"',
      '  printf "NAME=%q\\n" "$name"',
      '  printf "OP=%q\\n" "$op"',
      '  printf "RUN_ID=%q\\n" "$run_id"',
      '  printf "SERVICE=%q\\n" "$service_label"',
      '  printf "COMPOSE_SERVICE=%q\\n" "$service"',
      '  printf "IMAGE_LABEL=%q\\n" "$image_label"',
      '  printf "CONFIG_IMAGE=%q\\n" "$image_label"',
      '  printf "IMAGE_ID=%q\\n" "$TEST_EXPECTED_IMAGE_ID"',
      '  printf "STATE=running\\nEXIT_CODE=0\\n"',
      '} >"$TEST_DOCKER_STATE/$id"',
      'rm -f "$TEST_DOCKER_STATE/pending"',
      'printf "%s\\n" "$id"',
      'exit "${TEST_DOCKER_STATUS:-0}"',
      '',
    ].join('\n'),
  );
  await chmod(compose, 0o755);
  await executable(
    sleep,
    [
      '#!/bin/bash',
      'printf "sleep:%s\\n" "$*" >>"$TEST_TRACE"',
      'exit 0',
      '',
    ].join('\n'),
  );
  await executable(
    timeout,
    [
      '#!/bin/bash',
      'printf "timeout:" >>"$TEST_TRACE"',
      'printf "%s " "$@" >>"$TEST_TRACE"',
      'printf "\\n" >>"$TEST_TRACE"',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    --foreground|--signal=*|--kill-after=*) shift ;;',
      '    30s|5m|2h) shift; break ;;',
      '    *) exit 70 ;;',
      '  esac',
      'done',
      'exec "$@"',
      '',
    ].join('\n'),
  );
  await regularFile(
    path.join(envDir, 'migration.env'),
    [
      `MIGRATION_IMAGE=${migrationImage}`,
      `MIGRATION_MONGO_DATABASE=${mongoDatabase}`,
      'MIGRATION_ARCHIVE_RECIPIENT=age19zc8msml70vjd7xagxgpudukh4w82u0mngguxvfh6s8v96aft4vqpqfy5j',
      'MIGRATION_PGHOST=postgres',
      'MIGRATION_PGPORT=5432',
      `MIGRATION_PGDATABASE=${database}`,
      'MIGRATION_PGUSER=portfolio_migrator',
      'MIGRATION_PGPOOL_MAX=2',
      'MIGRATION_PGCONNECT_TIMEOUT_MS=5000',
      '',
    ].join('\n'),
  );
  await regularFile(
    path.join(envDir, 'app.env'),
    'APP_CONTACT_MODE=contact-enabled\n',
  );
  await regularFile(
    path.join(secrets, 'mongo-readonly-uri'),
    'MIGRATION_MONGO_SECRET_SENTINEL\n',
  );
  await regularFile(
    path.join(secrets, 'postgres-migrator-password'),
    'MIGRATION_PG_SECRET_SENTINEL\n',
  );

  const original = await readRequired('ops/migration.sh');
  const replacements = [
    ['/opt/mlp/ops/lib/operations.sh', ops],
    ['/usr/local/sbin/mlp-backup', backup],
    ['/usr/local/sbin/mlp-contact-mode', contact],
    ['/usr/local/libexec/mlp/docker-compose', compose],
    ['/usr/bin/timeout', timeout],
    ['/usr/bin/sleep', sleep],
    ['/usr/bin/docker', docker],
    [
      '/bin/chown 1000:1000 --',
      `${nativeChownPath} ${process.getuid()}:${process.getgid()}`,
    ],
    ['/bin/chmod 0400 --', '/bin/chmod 0400'],
    ['/var/lib/mlp/migration-artifacts/operator', artifactOperator],
    ['/var/lib/mlp/migration-artifacts', artifactParent],
    ['/etc/mlp', etc],
    ['/opt/mlp', repositoryRoot],
    ['1000:1000', `${process.getuid()}:${process.getgid()}`],
  ];
  let materialized = original;
  for (const [from, to] of replacements) {
    assert.ok(
      materialized.includes(from),
      `test harness requires fixed ${from}`,
    );
    materialized = materialized.replaceAll(from, to);
  }
  const script = path.join(root, 'migration.sh');
  await executable(script, materialized);
  return {
    appEnv: path.join(envDir, 'app.env'),
    backup,
    compose,
    composeSecrets,
    contact,
    dockerState,
    etc,
    lock,
    root,
    script,
    trace,
  };
}

function runHarness(harness, args, extraEnvironment = {}) {
  return spawnSync('/bin/bash', [harness.script, ...args], {
    encoding: 'utf8',
    env: {
      HOME: os.homedir(),
      TEST_COMPOSE_SECRETS: harness.composeSecrets,
      TEST_DOCKER_STATE: harness.dockerState,
      TEST_EXPECTED_IMAGE_ID: migrationImageId,
      TEST_LOCK: harness.lock,
      TEST_TRACE: harness.trace,
      ...extraEnvironment,
    },
    timeout: 10_000,
  });
}

async function traceFor(harness) {
  return readFile(harness.trace, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
}

async function lockFor(harness) {
  return readFile(harness.lock, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
}

async function seedDockerContainer(
  harness,
  {
    id = 'b'.repeat(64),
    name,
    operation,
    runId,
    service,
    composeService = service,
    imageLabel = migrationImage,
    configImage = migrationImage,
    imageId = migrationImageId,
    state = 'exited',
    exitCode = '0',
  },
) {
  await regularFile(
    path.join(harness.dockerState, id),
    [
      `ID=${id}`,
      `NAME=${name}`,
      `OP=${operation}`,
      `RUN_ID=${runId}`,
      `SERVICE=${service}`,
      `COMPOSE_SERVICE=${composeService}`,
      `IMAGE_LABEL=${imageLabel}`,
      `CONFIG_IMAGE=${configImage}`,
      `IMAGE_ID=${imageId}`,
      `STATE=${state}`,
      `EXIT_CODE=${exitCode}`,
      '',
    ].join('\n'),
  );
}

async function dockerContainerFiles(harness) {
  return (await readdir(harness.dockerState)).filter((entry) =>
    /^[0-9a-f]{64}$/u.test(entry),
  );
}

test('migration wrapper isolates runtime secrets and orders backup before mutations', async (t) => {
  const cases = [
    {
      args: ['export'],
      backup: false,
      database: 'portfolio',
      staged: ['mongo-uri-migration-operator'],
    },
    {
      args: ['rehearsal'],
      backup: true,
      database: 'portfolio_rehearsal',
      staged: [
        'mongo-uri-migration-operator',
        'postgres-migrator-password-migration-operator',
      ],
    },
    {
      args: ['preload'],
      backup: true,
      database: 'portfolio',
      staged: [
        'mongo-uri-migration-operator',
        'postgres-migrator-password-migration-operator',
      ],
    },
    {
      args: ['remove-synthetic', '123e4567-e89b-12d3-a456-426614174000'],
      backup: true,
      database: 'portfolio',
      staged: ['postgres-migrator-password-migration-operator'],
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.args[0], async () => {
      const harness = await makeHarness(fixture.database);
      try {
        const result = runHarness(harness, fixture.args, {
          DOCKER_CONFIG: '/tmp/hostile-docker-config',
          HOME: '/tmp/hostile-home',
          MLP_MONGO_URI: 'HOSTILE_INHERITED_MONGO',
          MLP_POSTGRES_MIGRATOR_PASSWORD: 'HOSTILE_INHERITED_PG',
        });
        const trace = await traceFor(harness);
        assert.equal(
          result.status,
          0,
          `${result.stdout}${result.stderr}\nTRACE:\n${trace}`,
        );
        assert.match(trace, /^root\nlock\n/u);
        assert.ok(
          trace.includes(
            `compose:home=${harness.etc}:config=${path.join(
              harness.etc,
              'docker-client',
            )}:host=unix:///run/docker.sock:mongo=:pg=:--ansi never --project-name mlp-migration `,
          ),
          'the reviewed standalone Compose binary must receive only fixed Docker client state',
        );
        for (const name of fixture.staged) {
          assert.match(
            trace,
            new RegExp(
              `^staged:${name}:${process.getuid()}:${process.getgid()}:400:1$`,
              'mu',
            ),
          );
        }
        if (fixture.backup) {
          assert.match(trace, /backup:mongo=:pg=/u);
          assert.ok(trace.indexOf('backup:') < trace.indexOf('\ncompose:'));
          assert.equal(await lockFor(harness), 'backup-fd9\n');
          assert.doesNotMatch(trace, /timeout:[^\n]*backup/u);
        } else {
          assert.doesNotMatch(trace, /backup:/u);
          assert.equal(await lockFor(harness), '');
        }
        assert.doesNotMatch(
          `${result.stdout}${result.stderr}${trace}`,
          /MIGRATION_(?:MONGO|PG)_SECRET_SENTINEL|HOSTILE_INHERITED/u,
        );
        assert.doesNotMatch(trace, /docker-compose-plugin-invoked/u);
        assert.deepEqual(await readdir(harness.composeSecrets), []);
      } finally {
        await rm(harness.root, { force: true, recursive: true });
      }
    });
  }
});

test('contacts requires persisted and live-verified maintenance before backup', async () => {
  const harness = await makeHarness();
  try {
    let result = runHarness(harness, ['contacts']);
    assert.notEqual(result.status, 0);
    let trace = await traceFor(harness);
    assert.doesNotMatch(trace, /contact:|backup:|^compose:/mu);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /contact-enabled/u);

    await regularFile(harness.appEnv, 'APP_CONTACT_MODE=contact-maintenance\n');
    await rm(harness.trace, { force: true });
    result = runHarness(harness, ['contacts']);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    trace = await traceFor(harness);
    assert.match(trace, /contact:maintenance:mongo=:pg=/u);
    assert.match(trace, /backup:mongo=:pg=/u);
    assert.ok(
      trace.includes(
        `compose:home=${harness.etc}:config=${path.join(
          harness.etc,
          'docker-client',
        )}:host=unix:///run/docker.sock:mongo=:pg=:`,
      ),
    );
    assert.ok(trace.indexOf('contact:') < trace.indexOf('backup:'));
    assert.ok(trace.indexOf('backup:') < trace.indexOf('\ncompose:'));
    assert.equal(await lockFor(harness), 'contact-fd9\nbackup-fd9\n');
    assert.deepEqual(await readdir(harness.composeSecrets), []);

    await rm(harness.trace, { force: true });
    await writeFile(harness.lock, '');
    result = runHarness(harness, ['contacts'], { TEST_CONTACT_STATUS: '43' });
    assert.equal(result.status, 43);
    trace = await traceFor(harness);
    assert.match(trace, /contact:maintenance:mongo=:pg=/u);
    assert.doesNotMatch(trace, /backup:|^compose:/mu);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}${trace}`,
      /MIGRATION_(?:MONGO|PG)_SECRET_SENTINEL/u,
    );
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('migration wrapper binds each database-writing command to its intended database', async () => {
  const fixtures = [
    { args: ['export'], database: 'portfolio_rehearsal' },
    { args: ['rehearsal'], database: 'portfolio' },
    { args: ['preload'], database: 'portfolio_rehearsal' },
    { args: ['contacts'], database: 'portfolio_rehearsal', maintenance: true },
    {
      args: ['remove-synthetic', '123e4567-e89b-12d3-a456-426614174000'],
      database: 'portfolio_rehearsal',
    },
  ];

  for (const fixture of fixtures) {
    const harness = await makeHarness(fixture.database);
    try {
      if (fixture.maintenance) {
        await regularFile(
          harness.appEnv,
          'APP_CONTACT_MODE=contact-maintenance\n',
        );
      }
      const result = runHarness(harness, fixture.args);
      assert.equal(
        result.status,
        78,
        `${fixture.args[0]} must reject ${fixture.database}`,
      );
      assert.doesNotMatch(await traceFor(harness), /backup:|docker:/u);
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  }
});

test('migration wrapper pins the source MongoDB database to mlp_db', async () => {
  const accepted = await makeHarness('portfolio', 'mlp_db');
  try {
    const result = runHarness(accepted, ['export']);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    await rm(accepted.root, { force: true, recursive: true });
  }

  for (const mongoDatabase of [
    'portfolio',
    'mlp-db',
    'mlp_db.other',
    'admin',
  ]) {
    const rejected = await makeHarness('portfolio', mongoDatabase);
    try {
      const result = runHarness(rejected, ['export']);
      assert.equal(result.status, 78, `${mongoDatabase} must be rejected`);
      assert.doesNotMatch(await traceFor(rejected), /docker:/u);
    } finally {
      await rm(rejected.root, { force: true, recursive: true });
    }
  }
});

test('migration wrapper rejects non-root and every non-allowlisted argument shape', async () => {
  const fixtures = [
    [],
    ['shell'],
    ['--file', '/tmp/evil.yml'],
    ['export', 'extra'],
    ['rehearsal', '--entrypoint', '/bin/sh'],
    ['remove-synthetic'],
    ['remove-synthetic', '64b000000000000000000001'],
    ['remove-synthetic', '123e4567-e89b-12d3-a456-426614174000', '--file'],
  ];
  for (const args of fixtures) {
    const harness = await makeHarness();
    try {
      const result = runHarness(harness, args);
      assert.equal(result.status, 64, `${args.join(' ')} must be rejected`);
      assert.doesNotMatch(await traceFor(harness), /lock|backup|docker/u);
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  }

  const harness = await makeHarness();
  try {
    const result = runHarness(harness, ['export'], { TEST_NONROOT: '1' });
    assert.equal(result.status, 77);
    assert.doesNotMatch(await traceFor(harness), /lock|backup|docker/u);
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test("invalid and lock-losing runs never unlink another migration's staged secrets", async () => {
  for (const fixture of [
    { args: ['shell'], environment: {}, status: 64 },
    {
      args: ['export'],
      environment: { TEST_LOCK_FAILURE: '1' },
      status: 75,
    },
  ]) {
    const harness = await makeHarness();
    const winnerSecrets = {
      'mongo-uri-migration-operator': 'winner-mongo-secret',
      'postgres-migrator-password-migration-operator': 'winner-pg-secret',
    };
    try {
      for (const [name, value] of Object.entries(winnerSecrets)) {
        await regularFile(path.join(harness.composeSecrets, name), value);
      }
      const result = runHarness(harness, fixture.args, fixture.environment);
      assert.equal(result.status, fixture.status);
      for (const [name, value] of Object.entries(winnerSecrets)) {
        assert.equal(
          await readFile(path.join(harness.composeSecrets, name), 'utf8'),
          value,
        );
      }
      assert.doesNotMatch(await traceFor(harness), /container rm/u);
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  }
});

test('backup failure blocks every production mutation before secrets and compose', async () => {
  const harness = await makeHarness();
  try {
    const result = runHarness(harness, ['preload'], {
      TEST_BACKUP_STATUS: '42',
    });
    assert.equal(result.status, 42);
    const trace = await traceFor(harness);
    assert.match(trace, /backup:mongo=:pg=/u);
    assert.doesNotMatch(trace, /^compose:/mu);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}${trace}`,
      /SENTINEL/u,
    );
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('named migration helper returns the exact job status and redacts all raw output', async () => {
  const harness = await makeHarness();
  try {
    const result = runHarness(harness, ['preload'], {
      TEST_DOCKER_JOB_EXIT: '42',
    });
    const trace = await traceFor(harness);
    assert.equal(result.status, 42, `${result.stdout}${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^migration operator failed\n$/u);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /RAW_(?:OPERATOR|JOB)_SECRET_SENTINEL|MIGRATION_(?:MONGO|PG)_SECRET_SENTINEL/u,
    );
    assert.match(
      trace,
      /run --detach --no-TTY --no-deps --name mlp-migration-job-preload-[0-9a-f]{32} --label com\.mlp\.operation=migration --label com\.mlp\.migration\.operation=preload --label com\.mlp\.migration\.run-id=[0-9a-f]{32} --label com\.mlp\.migration\.service=migration-preload --label com\.mlp\.migration\.image=ghcr\.io\/martinlindblad\/mlp-migration@sha256:[0-9a-f]{64} migration-preload/u,
    );
    assert.match(trace, /container wait [0-9a-f]{64}/u);
    assert.match(trace, /container rm --force [0-9a-f]{64}/u);
    const dockerLines = trace
      .split('\n')
      .filter((line) => line.startsWith('docker:'));
    for (const line of dockerLines) {
      assert.match(line, /:mongo=:pg=:/u);
    }
    assert.match(trace, /^compose:[^\n]*:mongo=:pg=:/mu);
    assert.doesNotMatch(trace, /docker-compose-plugin-invoked/u);
    assert.deepEqual(await dockerContainerFiles(harness), []);
    assert.deepEqual(await readdir(harness.composeSecrets), []);
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('start timeout removes a helper that appears late and proves stable absence', async () => {
  const harness = await makeHarness();
  try {
    const result = runHarness(harness, ['preload'], {
      TEST_DOCKER_DELAYED_CREATE: '1',
      TEST_DOCKER_DELAY_POLLS: '3',
      TEST_DOCKER_START_TIMEOUT: '1',
    });
    const trace = await traceFor(harness);
    assert.equal(result.status, 124, `${result.stdout}${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^migration operator launch failed\n$/u);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /RAW_OPERATOR_SECRET_SENTINEL|MIGRATION_(?:MONGO|PG)_SECRET_SENTINEL/u,
    );
    assert.match(trace, /container rm --force [0-9a-f]{64}/u);
    assert.ok(
      trace.split('\n').filter((line) => line.includes(' container ls '))
        .length >= 30,
      'a timed-out create must keep reconciling for the full delayed-create window',
    );
    assert.deepEqual(await dockerContainerFiles(harness), []);
    assert.deepEqual(await readdir(harness.composeSecrets), []);
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('cleanup failure is fatal and never exposes raw helper output', async () => {
  const harness = await makeHarness();
  try {
    const result = runHarness(harness, ['export'], {
      TEST_DOCKER_CLEANUP_FAILURE: '1',
    });
    assert.equal(result.status, 70, `${result.stdout}${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /migration helper cleanup failed/u);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /RAW_(?:OPERATOR|JOB)_SECRET_SENTINEL|MIGRATION_MONGO_SECRET_SENTINEL/u,
    );
    assert.equal((await dockerContainerFiles(harness)).length, 1);
    assert.deepEqual((await readdir(harness.composeSecrets)).sort(), [
      'mongo-uri-migration-operator',
    ]);
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('preflight reconciles only exactly labelled stale helpers and fails closed otherwise', async (t) => {
  await t.test('valid stale helper is removed before create', async () => {
    const harness = await makeHarness();
    const runId = '1'.repeat(32);
    try {
      await seedDockerContainer(harness, {
        name: `mlp-migration-job-export-${runId}`,
        operation: 'export',
        runId,
        service: 'migration-export',
      });
      const result = runHarness(harness, ['export']);
      const trace = await traceFor(harness);
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.ok(
        trace.indexOf(`container rm --force ${'b'.repeat(64)}`) <
          trace.indexOf('\ncompose:'),
      );
      assert.deepEqual(await dockerContainerFiles(harness), []);
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  });

  await t.test(
    'late stale helper is reconciled before contact gate and backup',
    async () => {
      const harness = await makeHarness();
      const runId = '3'.repeat(32);
      const id = 'c'.repeat(64);
      try {
        await regularFile(
          path.join(harness.dockerState, 'pending'),
          [
            id,
            `mlp-migration-job-preload-${runId}`,
            'preload',
            runId,
            'migration-preload',
            'migration-preload',
            migrationImage,
            migrationImage,
            migrationImageId,
          ].join('|') + '\n',
        );
        await regularFile(
          harness.appEnv,
          'APP_CONTACT_MODE=contact-maintenance\n',
        );
        const result = runHarness(harness, ['contacts'], {
          TEST_DOCKER_DELAYED_CREATE: '1',
          TEST_DOCKER_DELAY_POLLS: '3',
        });
        const trace = await traceFor(harness);
        assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
        const removal = trace.indexOf(`container rm --force ${id}`);
        assert.ok(removal >= 0);
        assert.ok(removal < trace.indexOf('contact:maintenance'));
        assert.ok(removal < trace.indexOf('backup:'));
        assert.deepEqual(await dockerContainerFiles(harness), []);
      } finally {
        await rm(harness.root, { force: true, recursive: true });
      }
    },
  );

  await t.test('mismatched service label is not removed', async () => {
    const harness = await makeHarness();
    const runId = '2'.repeat(32);
    try {
      await seedDockerContainer(harness, {
        name: `mlp-migration-job-export-${runId}`,
        operation: 'export',
        runId,
        service: 'migration-preload',
      });
      const result = runHarness(harness, ['export']);
      const trace = await traceFor(harness);
      assert.equal(result.status, 70, `${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /migration helper reconciliation failed/u);
      assert.doesNotMatch(trace, /^compose:|container rm/mu);
      assert.equal((await dockerContainerFiles(harness)).length, 1);
      assert.doesNotMatch(
        `${result.stdout}${result.stderr}${trace}`,
        /MIGRATION_MONGO_SECRET_SENTINEL/u,
      );
    } finally {
      await rm(harness.root, { force: true, recursive: true });
    }
  });

  await t.test(
    'daemon listing uncertainty blocks secret loading and create',
    async () => {
      const harness = await makeHarness();
      try {
        const result = runHarness(harness, ['export'], {
          TEST_DOCKER_LIST_FAILURE: '1',
        });
        const trace = await traceFor(harness);
        assert.equal(result.status, 70, `${result.stdout}${result.stderr}`);
        assert.doesNotMatch(trace, /^compose:|container rm/mu);
        assert.doesNotMatch(
          `${result.stdout}${result.stderr}${trace}`,
          /MIGRATION_MONGO_SECRET_SENTINEL/u,
        );
      } finally {
        await rm(harness.root, { force: true, recursive: true });
      }
    },
  );
});
