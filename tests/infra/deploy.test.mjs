import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const scriptPath = path.join(repositoryRoot, 'ops/deploy.sh');
const sourceLabel = 'https://github.com/martinlindblad/mlp';
const commit = '1234567890abcdef1234567890abcdef12345678';
const previousDigest = '1'.repeat(64);
const candidateDigest = '2'.repeat(64);
const backupDigest = '3'.repeat(64);
const previousImage = `ghcr.io/martinlindblad/mlp@sha256:${previousDigest}`;
const candidateImage = `ghcr.io/martinlindblad/mlp@sha256:${candidateDigest}`;
const backupImage = `ghcr.io/martinlindblad/mlp-backup@sha256:${backupDigest}`;

async function readRequiredScript() {
  try {
    return await readFile(scriptPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail('ops/deploy.sh is required');
    }
    throw error;
  }
}

function body(source, name) {
  const match = source.match(
    new RegExp(`^${name}\\(\\)\\s*\\{([\\s\\S]*?)^\\}`, 'mu'),
  );
  assert.ok(match, `deploy must define ${name}()`);
  return match[1];
}

function ordered(source, fragments) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    assert.ok(next > cursor, `expected ordered deploy fragment: ${fragment}`);
    cursor = next;
  }
}

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

const operationsStub = `#!/bin/bash
set -Eeuo pipefail
mlp_require_root() {
  printf 'root\\n' >>"$HARNESS_TRACE"
  [[ \${HARNESS_ROOT:-yes} == yes ]] || return 77
}
mlp_acquire_operations_lock() {
  printf 'lock\\n' >>"$HARNESS_TRACE"
  [[ \${HARNESS_LOCK_FAIL:-no} != yes ]] || return 75
}
mlp_require_root_directory() { printf 'dir %s %s\\n' "$1" "$2" >>"$HARNESS_TRACE"; }
mlp_require_root_file() { printf 'file %s %s\\n' "$1" "$2" >>"$HARNESS_TRACE"; }
mlp_atomic_replace_env() {
  file=$1 key=$2 value=$3
  printf 'persist %s\\n' "$value" >>"$HARNESS_TRACE"
  if [[ \${HARNESS_FAIL_PERSIST_ONCE:-no} == yes && ! -e "$HARNESS_STATE/persist-failed" && "$value" == "$HARNESS_CANDIDATE" ]]; then
    : >"$HARNESS_STATE/persist-failed"
    return 1
  fi
  tmp="$file.tmp"
  /usr/bin/awk -v key="$key" -v value="$value" 'BEGIN{done=0} index($0,key "=")==1 {print key "=" value; done=1; next} {print} END{if(!done) print key "=" value}' "$file" >"$tmp"
  /bin/mv -f "$tmp" "$file"
}
mlp_atomic_install_json() {
  printf 'report\\n' >>"$HARNESS_TRACE"
  [[ \${HARNESS_FAIL_REPORT:-no} != yes ]] || return 1
  /bin/cp "$1" "$2"
  /bin/chmod 0600 "$2"
}
`;

const commandStub = `#!/bin/bash
set -Eeuo pipefail
name=\${0##*/}
printf '%s' "$name" >>"$HARNESS_TRACE"
printf ' %q' "$@" >>"$HARNESS_TRACE"
printf '\\n' >>"$HARNESS_TRACE"
if [[ "$name" == docker && \${HARNESS_REQUIRE_FIXED_DOCKER_ENV:-no} == yes ]]; then
  if [[ \${DOCKER_HOST:-} != unix:///run/docker.sock || \${HOME:-} != "$HARNESS_FIXED_HOME" ||
    \${DOCKER_CONFIG:-} != "$HARNESS_FIXED_DOCKER_CONFIG" || -n \${DOCKER_CONTEXT+x} || -n \${DOCKER_TLS_VERIFY+x} ]]; then
    exit 97
  fi
fi
if [[ \${HARNESS_REQUIRE_CLEAN_PROCESS_ENV:-no} == yes ]]; then
  if [[ "$name" == git && (-n \${GIT_CONFIG_COUNT+x} || -n \${GIT_DIR+x} || -n \${GIT_WORK_TREE+x} ||
    -n \${XDG_CONFIG_HOME+x} || -n \${XDG_CACHE_HOME+x} || -n \${XDG_DATA_HOME+x}) ]]; then
    exit 98
  fi
  if [[ "$name" == node && (-n \${NODE_OPTIONS+x} || -n \${NODE_PATH+x}) ]]; then
    exit 99
  fi
fi
case "$name" in
  timeout)
    while [[ \${1:-} == --* ]]; do
      if [[ $1 == --kill-after=* || $1 == --foreground ]]; then shift; else break; fi
    done
    shift
    exec "$@"
    ;;
  git)
    case " $* " in
      *' status '*) [[ \${HARNESS_DIRTY:-no} != yes ]] || printf '?? hostile-file\\n' ;;
      *' rev-parse HEAD '*) printf '%s\\n' "$HARNESS_COMMIT" ;;
      *) exit 64 ;;
    esac
    ;;
  node)
    if [[ \${HARNESS_RECONCILE_FAIL:-no} == yes && " $* " != *' --candidate-app-image '* ]]; then exit 1; fi
    ;;
  mlp-backup)
    [[ \${HARNESS_BACKUP_FAIL:-no} != yes ]] || exit 1
    [[ \${HARNESS_BACKUP_RAW_OUTPUT:-no} != yes ]] || {
      printf 'untrusted backup stdout\\n'
      printf 'untrusted backup stderr\\n' >&2
    }
    now=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
    snapshot=$(printf 'a%.0s' {1..64})
    [[ \${HARNESS_BACKUP_REUSES_SNAPSHOT:-no} != yes ]] || snapshot=$HARNESS_OLD_SNAPSHOT
    [[ \${HARNESS_BACKUP_STALE_TIME:-no} != yes ]] || now=2000-01-01T00:00:00Z
    printf '{"status":"passed","snapshotId":"%s","startedAt":"%s","completedAt":"%s"}\\n' "$snapshot" "$now" "$now" >"$HARNESS_BACKUP_REPORT"
    ;;
  sleep) ;;
  mlp-compose)
    candidate=
    args=("$@")
    if [[ \${1:-} == --candidate-app-image ]]; then candidate=$2; shift 2; fi
    case " $* " in
      *' pull '*) [[ \${HARNESS_PULL_FAIL:-no} != yes ]] || exit 1 ;;
      *' run '*' migrator '*)
        : >"$HARNESS_STATE/migration-attempted"
        printf '%s\\n' "$candidate" >"$HARNESS_STATE/helper-image"
        printf '%s\\n' "sha256:\${candidate##*@sha256:}" >"$HARNESS_STATE/helper-image-id"
        printf '%s\\n' 'mlp-deploy-migration' >"$HARNESS_STATE/helper-operation"
        printf '%s\\n' 'mlp-prod' >"$HARNESS_STATE/helper-project"
        printf '%s\\n' 'migrator' >"$HARNESS_STATE/helper-service"
        run_id=
        previous=
        for argument in "$@"; do
          if [[ "$previous" == --label && "$argument" == com.mlp.run-id=* ]]; then
            run_id=\${argument#com.mlp.run-id=}
          fi
          previous=$argument
        done
        printf '%s\\n' "$run_id" >"$HARNESS_STATE/helper-run-id"
        printf '%064d\\n' 4 >"$HARNESS_STATE/helper-id"
        migration_exit_code=\${HARNESS_MIGRATION_EXIT_CODE:-0}
        [[ \${HARNESS_MIGRATION_FAIL:-no} != yes ]] || migration_exit_code=1
        printf '%s\\n' "$migration_exit_code" >"$HARNESS_STATE/helper-exit-code"
        if [[ \${HARNESS_CREATED_HELPER_LABEL_MISMATCH:-no} == yes ]]; then
          printf '%s\\n' 'foreign-operation' >"$HARNESS_STATE/helper-operation"
        fi
        if [[ \${HARNESS_CREATED_HELPER_SERVICE_MISMATCH:-no} == yes ]]; then
          printf '%s\\n' 'app' >"$HARNESS_STATE/helper-service"
        fi
        [[ \${HARNESS_MIGRATION_RAW_OUTPUT:-no} != yes ]] || printf 'untrusted migrator stderr\\n' >&2
        if [[ \${HARNESS_MIGRATION_CREATE_TIMEOUT:-no} == yes ]]; then
          : >"$HARNESS_STATE/helper-delayed-pending"
          exit 124
        fi
        : >"$HARNESS_STATE/helper-exists"
        if [[ \${HARNESS_COMPOSE_RETURNS_SHORT_ID:-no} == yes ]]; then
          printf '%012d\\n' 4
        else
          printf '%064d\\n' 4
        fi
        ;;
      *' up '*' app '*)
        printf '%s\\n' "$candidate" >"$HARNESS_STATE/current-image"
        if [[ "$candidate" == "$HARNESS_CANDIDATE" ]]; then
          : >"$HARNESS_STATE/candidate-attempted"
        else
          : >"$HARNESS_STATE/rollback-active"
          /bin/rm -f "$HARNESS_STATE/rollback-app-inspections"
          if [[ \${HARNESS_ROLLBACK_UP_FAIL_ONCE:-no} == yes &&
            ! -e "$HARNESS_STATE/rollback-up-failed" ]]; then
            : >"$HARNESS_STATE/rollback-up-failed"
            exit 124
          fi
        fi
        if [[ "$candidate" == "$HARNESS_CANDIDATE" && \${HARNESS_REPLACE_FAIL:-no} == yes ]]; then exit 1; fi
        ;;
    esac
    ;;
  docker)
    if [[ \${1:-} == image && \${2:-} == inspect ]]; then
      reference=\${@: -1}
      digest=\${reference##*@sha256:}
      format=
      previous=
      for argument in "$@"; do
        [[ "$previous" == --format ]] && format=$argument
        previous=$argument
      done
      if [[ "$format" == '{{.Id}}' ]]; then
        printf 'sha256:%s\\n' "$digest"
      else
        platform=linux/amd64
        source='${sourceLabel}'
        revision=$HARNESS_COMMIT
        [[ \${HARNESS_BAD_PLATFORM:-no} != yes ]] || platform=linux/arm64
        [[ \${HARNESS_BAD_SOURCE:-no} != yes ]] || source=https://invalid.example/repo
        [[ \${HARNESS_BAD_REVISION:-no} != yes ]] || revision=$(printf 'f%.0s' {1..40})
        printf 'sha256:%s|%s|%s|%s|["%s"]\\n' "$digest" "$platform" "$source" "$revision" "$reference"
      fi
      exit 0
    fi
    if [[ \${1:-} == ps ]]; then
      if [[ " $* " == *' name=^/mlp-prod-app-1$ '* ]]; then
        if [[ -e "$HARNESS_STATE/app-absent-window" ]]; then
          /bin/rm -f "$HARNESS_STATE/app-absent-window"
        else
          printf '%064d\\n' 6
        fi
        exit 0
      fi
      if [[ -e "$HARNESS_STATE/helper-delayed-pending" && ! -e "$HARNESS_STATE/helper-exists" ]]; then
        count=0
        [[ ! -e "$HARNESS_STATE/helper-ps-count" ]] || count=$(<"$HARNESS_STATE/helper-ps-count")
        count=$((count + 1))
        printf '%s\\n' "$count" >"$HARNESS_STATE/helper-ps-count"
        if ((count >= \${HARNESS_DELAYED_HELPER_AFTER_PS:-2})); then
          : >"$HARNESS_STATE/helper-exists"
          /bin/rm -f "$HARNESS_STATE/helper-delayed-pending"
        fi
      fi
      if [[ \${HARNESS_INITIAL_HELPER:-none} != none && ! -e "$HARNESS_STATE/initial-helper-created" ]]; then
        create_initial_helper=true
        if [[ -n \${HARNESS_INITIAL_HELPER_AFTER_PS:-} ]]; then
          initial_count=0
          [[ ! -e "$HARNESS_STATE/initial-helper-ps-count" ]] || initial_count=$(<"$HARNESS_STATE/initial-helper-ps-count")
          initial_count=$((initial_count + 1))
          printf '%s\\n' "$initial_count" >"$HARNESS_STATE/initial-helper-ps-count"
          if ((initial_count < HARNESS_INITIAL_HELPER_AFTER_PS)); then
            create_initial_helper=false
          fi
        fi
        if [[ "$create_initial_helper" == true ]]; then
          : >"$HARNESS_STATE/initial-helper-created"
          : >"$HARNESS_STATE/helper-exists"
          printf '%064d\\n' 5 >"$HARNESS_STATE/helper-id"
          printf '%s\\n' "$HARNESS_PREVIOUS" >"$HARNESS_STATE/helper-image"
          printf '%s\\n' "sha256:\${HARNESS_PREVIOUS##*@sha256:}" >"$HARNESS_STATE/helper-image-id"
          printf '%s\\n' "$(printf 'f%.0s' {1..40})-123" >"$HARNESS_STATE/helper-run-id"
          if [[ "$HARNESS_INITIAL_HELPER" == correct ]]; then
            printf '%s\\n' 'mlp-deploy-migration' >"$HARNESS_STATE/helper-operation"
          else
            printf '%s\\n' 'foreign-operation' >"$HARNESS_STATE/helper-operation"
          fi
          printf '%s\\n' 'mlp-prod' >"$HARNESS_STATE/helper-project"
          printf '%s\\n' 'migrator' >"$HARNESS_STATE/helper-service"
          printf '0\\n' >"$HARNESS_STATE/helper-exit-code"
        fi
      fi
      [[ \${HARNESS_DOCKER_PS_FAIL:-no} != yes ]] || exit 1
      [[ ! -e "$HARNESS_STATE/helper-exists" ]] || /bin/cat "$HARNESS_STATE/helper-id"
      exit 0
    fi
    if [[ \${1:-} == wait ]]; then
      [[ -e "$HARNESS_STATE/helper-exists" ]] || exit 1
      /bin/cat "$HARNESS_STATE/helper-exit-code"
      exit 0
    fi
    if [[ \${1:-} == rm ]]; then
      [[ \${HARNESS_HELPER_CLEANUP_FAIL:-no} != yes ]] || exit 1
      /bin/rm -f "$HARNESS_STATE/helper-exists"
      exit 0
    fi
    if [[ \${1:-} == inspect ]]; then
      format=
      previous=
      for argument in "$@"; do
        [[ "$previous" == --format ]] && format=$argument
        previous=$argument
      done
      container=\${@: -1}
      if [[ "$container" == mlp-deploy-migrator ]]; then
        [[ -e "$HARNESS_STATE/helper-exists" ]] || exit 1
        printf '%s|%s|%s|%s|%s|%s|%s|%s|exited|%s\\n' \
          "$(<"$HARNESS_STATE/helper-id")" \
          "$(<"$HARNESS_STATE/helper-operation")" \
          "$(<"$HARNESS_STATE/helper-run-id")" \
          "$(<"$HARNESS_STATE/helper-image")" \
          "$(<"$HARNESS_STATE/helper-project")" \
          "$(<"$HARNESS_STATE/helper-service")" \
          "$(<"$HARNESS_STATE/helper-image")" \
          "$(<"$HARNESS_STATE/helper-image-id")" \
          "$(<"$HARNESS_STATE/helper-exit-code")"
        exit 0
      fi
      service=\${container#mlp-prod-}
      service=\${service%-1}
      current=$(<"$HARNESS_STATE/current-image")
      if [[ "$service" == app && -e "$HARNESS_STATE/rollback-active" &&
        (-n \${HARNESS_CANDIDATE_REAPPEARS_AFTER_OLD_INSPECTIONS:-} ||
          \${HARNESS_APP_ABSENT_ONCE_DURING_STABLE:-no} == yes) ]]; then
        count=0
        [[ ! -e "$HARNESS_STATE/rollback-app-inspections" ]] || count=$(<"$HARNESS_STATE/rollback-app-inspections")
        count=$((count + 1))
        printf '%s\\n' "$count" >"$HARNESS_STATE/rollback-app-inspections"
        if [[ \${HARNESS_APP_ABSENT_ONCE_DURING_STABLE:-no} == yes &&
          ! -e "$HARNESS_STATE/app-absence-used" && "$count" -ge 3 ]]; then
          : >"$HARNESS_STATE/app-absence-used"
          : >"$HARNESS_STATE/app-absent-window"
          exit 1
        fi
        if [[ -n \${HARNESS_CANDIDATE_REAPPEARS_AFTER_OLD_INSPECTIONS:-} &&
          "$current" == "$HARNESS_PREVIOUS" &&
          (\${HARNESS_CANDIDATE_REAPPEARS_CONTINUOUS:-no} == yes ||
            ! -e "$HARNESS_STATE/candidate-reappearance-used") &&
          "$count" -ge "$HARNESS_CANDIDATE_REAPPEARS_AFTER_OLD_INSPECTIONS" ]]; then
          printf '%s\\n' "$HARNESS_CANDIDATE" >"$HARNESS_STATE/current-image"
          : >"$HARNESS_STATE/candidate-reappearance-used"
          current=$HARNESS_CANDIDATE
        fi
      fi
      digest=\${current##*@sha256:}
      health=healthy
      status=running
      if [[ "$service" == app && "$current" == "$HARNESS_CANDIDATE" && \${HARNESS_CANDIDATE_UNHEALTHY:-no} == yes ]]; then health=unhealthy; fi
      if [[ \${HARNESS_UNHEALTHY_SERVICE:-} == "$service" ]]; then health=unhealthy; fi
      if [[ \${HARNESS_STOPPED_SERVICE_ON_CANDIDATE:-} == "$service" && "$current" == "$HARNESS_CANDIDATE" ]]; then status=exited; fi
      case "$format" in
        '{{.Config.Image}}') printf '%s\\n' "$current" ;;
        '{{.State.Health.Status}}') printf '%s\\n' "$health" ;;
        '{{.State.Status}}|{{.State.Health.Status}}') printf '%s|%s\\n' "$status" "$health" ;;
        *)
          identifier="sha256:$digest"
          [[ \${HARNESS_RUNNING_ID_MISMATCH:-no} != yes || "$service" != app ]] || identifier="sha256:$(printf 'f%.0s' {1..64})"
          printf '%s|%s|%s|%s\\n' "$status" "$health" "$current" "$identifier"
          ;;
      esac
      exit 0
    fi
    exit 64
    ;;
  *) exit 64 ;;
esac
`;

async function createHarness(source, options = {}) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'mlp-deploy-'));
  const bin = path.join(sandbox, 'bin');
  const repo = path.join(sandbox, 'repo');
  const runtime = path.join(sandbox, 'etc', 'mlp');
  const reports = path.join(sandbox, 'deployment-reports');
  const backupReports = path.join(sandbox, 'backup-reports');
  const state = path.join(sandbox, 'state');
  const trace = path.join(sandbox, 'trace');
  await Promise.all([
    mkdir(bin, { recursive: true }),
    mkdir(path.join(repo, 'scripts'), { recursive: true }),
    mkdir(path.join(repo, 'ops', 'lib'), { recursive: true }),
    mkdir(path.join(runtime, 'env'), { recursive: true }),
    mkdir(reports, { recursive: true }),
    mkdir(backupReports, { recursive: true }),
    mkdir(state, { recursive: true }),
  ]);
  await writeFile(path.join(repo, 'compose.production.yml'), 'services: {}\n');
  await writeFile(path.join(repo, 'scripts/verify-production-config.mjs'), '');
  await writeFile(
    path.join(runtime, 'env/app.env'),
    `APP_IMAGE=${
      options.previousImage ?? previousImage
    }\nAPP_CONTACT_MODE=contact-enabled\n`,
  );
  await writeFile(
    path.join(runtime, 'env/backup.env'),
    `BACKUP_IMAGE=${options.backupImage ?? backupImage}\n`,
  );
  await writeFile(
    path.join(state, 'current-image'),
    `${options.runningImage ?? options.previousImage ?? previousImage}\n`,
  );
  const oldSnapshot = 'b'.repeat(64);
  await writeFile(
    path.join(backupReports, 'latest-success.json'),
    `${JSON.stringify({
      status: 'passed',
      snapshotId: oldSnapshot,
      startedAt: '2000-01-01T00:00:00Z',
      completedAt: '2000-01-01T00:00:00Z',
    })}\n`,
  );
  const operations = path.join(sandbox, 'operations.sh');
  await writeExecutable(operations, operationsStub);
  for (const name of [
    'docker',
    'git',
    'mlp-backup',
    'mlp-compose',
    'node',
    'sleep',
    'timeout',
  ]) {
    await writeExecutable(path.join(bin, name), commandStub);
  }

  const replacements = [
    [
      'readonly helper_absence_observation_count=6',
      `readonly helper_absence_observation_count=${
        options.helperAbsenceObservationCount ?? 1
      }`,
    ],
    [
      'readonly helper_settle_observation_count=30',
      `readonly helper_settle_observation_count=${
        options.helperSettleObservationCount ?? 1
      }`,
    ],
    [
      'readonly stable_observation_count=6',
      `readonly stable_observation_count=${
        options.stableObservationCount ?? 1
      }`,
    ],
    ['/opt/mlp/ops/lib/operations.sh', operations],
    ['/usr/local/sbin/mlp-compose', path.join(bin, 'mlp-compose')],
    ['/usr/local/sbin/mlp-backup', path.join(bin, 'mlp-backup')],
    ['/usr/bin/docker', path.join(bin, 'docker')],
    ['/usr/bin/git', path.join(bin, 'git')],
    ['/usr/bin/node', path.join(bin, 'node')],
    ['/usr/bin/timeout', path.join(bin, 'timeout')],
    ['/bin/sleep', path.join(bin, 'sleep')],
    ['/opt/mlp', repo],
    ['/etc/mlp', runtime],
    ['/var/lib/mlp/deployment-reports', reports],
    ['/var/lib/mlp/backup-reports', backupReports],
  ];
  let harnessSource = source;
  for (const [from, to] of replacements) {
    assert.ok(
      harnessSource.includes(from),
      `harness replacement missing: ${from}`,
    );
    harnessSource = harnessSource.replaceAll(from, to);
  }
  const harnessScript = path.join(sandbox, 'deploy.sh');
  await writeExecutable(harnessScript, harnessSource);
  const environment = {
    ...process.env,
    HARNESS_BACKUP_REPORT: path.join(backupReports, 'latest-success.json'),
    HARNESS_CANDIDATE: options.candidateImage ?? candidateImage,
    HARNESS_COMMIT: options.commit ?? commit,
    HARNESS_FIXED_DOCKER_CONFIG: path.join(runtime, 'docker-client'),
    HARNESS_FIXED_HOME: runtime,
    HARNESS_OLD_SNAPSHOT: oldSnapshot,
    HARNESS_PREVIOUS: options.previousImage ?? previousImage,
    HARNESS_ROOT: options.root ?? 'yes',
    HARNESS_STATE: state,
    HARNESS_TRACE: trace,
    MLP_SECRET_SENTINEL: 'deploy-secret-must-not-leak',
    ...options.environment,
  };
  return {
    appEnv: path.join(runtime, 'env/app.env'),
    environment,
    report: path.join(reports, 'latest.json'),
    sandbox,
    script: harnessScript,
    state,
    trace,
  };
}

function runHarness(
  harness,
  args = ['--image', candidateImage, '--commit', commit],
) {
  return spawnSync('/bin/bash', [harness.script, ...args], {
    encoding: 'utf8',
    env: harness.environment,
    timeout: 10_000,
  });
}

async function traceOf(harness) {
  try {
    return await readFile(harness.trace, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function assertRedacted(result) {
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /deploy-secret-must-not-leak/u,
  );
}

test('deploy has a fixed, privileged, root-only operations surface', async () => {
  const source = await readRequiredScript();
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  assert.equal(lines[0], '#!/bin/bash -p');
  assert.equal(lines[1], 'set +x');
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /^PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/mu);
  assert.match(source, /^source \/opt\/mlp\/ops\/lib\/operations\.sh$/mu);
  assert.match(source, /\$\{!DOCKER_@\}/u);
  assert.match(source, /\$\{!GIT_@\}/u);
  assert.match(source, /\$\{!NODE_@\}/u);
  assert.match(source, /\$\{!XDG_@\}/u);
  assert.ok(
    source.indexOf('source /opt/mlp/ops/lib/operations.sh') <
      source.indexOf('for variable in "${!DOCKER_@}"'),
  );
  assert.match(source, /^HOME=\/etc\/mlp$/mu);
  assert.match(source, /^DOCKER_CONFIG=\/etc\/mlp\/docker-client$/mu);
  assert.match(source, /^DOCKER_HOST=unix:\/\/\/run\/docker\.sock$/mu);
  assert.match(source, /mlp_require_root/u);
  assert.match(source, /mlp_acquire_operations_lock/u);
  assert.match(source, /mlp_require_root_directory \/opt\/mlp 0755/u);
  assert.match(source, /mlp_require_root_directory \/opt\/mlp\/\.git 0755/u);
  assert.match(source, /mlp_require_root_file \/opt\/mlp\/\.git\/HEAD 0644/u);
  assert.match(source, /mlp_require_root_file \/opt\/mlp\/\.git\/config 0644/u);
  assert.match(source, /mlp_require_root_file \/etc\/mlp\/env\/app\.env 0600/u);
  assert.match(
    source,
    /mlp_require_root_file \/etc\/mlp\/env\/backup\.env 0600/u,
  );
  assert.doesNotMatch(source, /\b(?:eval|command -v|docker compose|sudo)\b/u);
  assert.doesNotMatch(
    source,
    /\$\{?(?:PATH|DOCKER_HOST|COMPOSE_FILE|MLP_[A-Z_]*COMMAND)/u,
  );
  for (const fixed of [
    '/usr/local/sbin/mlp-compose',
    '/usr/local/sbin/mlp-backup',
    '/usr/bin/docker',
    '/usr/bin/git',
    '/usr/bin/node',
    '/usr/bin/timeout',
  ]) {
    assert.ok(source.includes(fixed), `missing fixed command ${fixed}`);
  }
});

test('deploy pins the local Docker socket and removes caller Docker configuration', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    candidateImage: previousImage,
    environment: {
      DOCKER_CONFIG: '/tmp/hostile-docker-config',
      DOCKER_CONTEXT: 'hostile-context',
      DOCKER_HOST: 'tcp://attacker.invalid:2375',
      DOCKER_TLS_VERIFY: '1',
      GIT_CONFIG_COUNT: '0',
      GIT_DIR: '/tmp/hostile-git-dir',
      GIT_WORK_TREE: '/tmp/hostile-git-work-tree',
      HARNESS_REQUIRE_CLEAN_PROCESS_ENV: 'yes',
      HARNESS_REQUIRE_FIXED_DOCKER_ENV: 'yes',
      HOME: '/tmp/hostile-home',
      NODE_OPTIONS: '--require=/tmp/hostile-node-preload.cjs',
      NODE_PATH: '/tmp/hostile-node-path',
      XDG_CACHE_HOME: '/tmp/hostile-xdg-cache',
      XDG_CONFIG_HOME: '/tmp/hostile-xdg-config',
      XDG_DATA_HOME: '/tmp/hostile-xdg-data',
    },
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, [
    '--image',
    previousImage,
    '--commit',
    commit,
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test('deploy encodes the corrected forward-only transaction and verified rollback', async () => {
  const source = await readRequiredScript();
  const deploy = body(source, 'deploy_candidate');
  const bounded = body(source, 'run_bounded');
  const report = body(source, 'write_deployment_report');
  const rollback = body(source, 'rollback_deployment');
  assert.match(
    source,
    /ghcr\\\.io\/martinlindblad\/mlp@sha256:\[0-9a-f\]\{64\}/u,
  );
  assert.match(source, /\[0-9a-f\]\{40\}/u);
  assert.match(source, /BACKUP_IMAGE/u);
  assert.match(source, /latest-success\.json/u);
  assert.match(source, /snapshotId/u);
  assert.match(source, /completedAt/u);
  assert.match(source, /linux\/amd64/u);
  assert.match(source, /org\.opencontainers\.image\.source/u);
  assert.match(source, /org\.opencontainers\.image\.revision/u);
  assert.match(source, new RegExp(sourceLabel.replaceAll('.', '\\.')));
  assert.match(source, /--candidate-app-image "\$image"/u);
  assert.match(source, /readonly migration_helper_name=mlp-deploy-migrator/u);
  assert.match(source, /readonly helper_absence_observation_count=6/u);
  assert.match(source, /readonly helper_settle_observation_count=30/u);
  assert.match(source, /readonly stable_observation_count=6/u);
  assert.doesNotMatch(
    bounded,
    /--foreground/u,
    "bounded non-interactive commands must run in timeout's isolated process group",
  );
  assert.match(bounded, /--kill-after=5s/u);
  assert.match(
    body(source, 'remove_migration_helper_and_prove_absent'),
    /\$\{2:-\$helper_settle_observation_count\}/u,
  );
  assert.match(
    body(source, 'run_candidate_migrator'),
    /cleanup_observations=\$helper_absence_observation_count/u,
  );
  assert.match(source, /run -d --no-deps --no-TTY/u);
  assert.match(source, /--name "\$migration_helper_name"/u);
  assert.match(source, /--label "com\.mlp\.operation=mlp-deploy-migration"/u);
  assert.match(source, /--label "com\.mlp\.run-id=\$migration_run_id"/u);
  assert.match(source, /com\.docker\.compose\.project/u);
  assert.match(source, /com\.docker\.compose\.service/u);
  assert.match(source, /"\$compose_project" == mlp-prod/u);
  assert.match(source, /"\$compose_service" == migrator/u);
  assert.match(source, /"\$docker_command" wait/u);
  assert.match(source, /"\$docker_command" rm -f/u);
  assert.doesNotMatch(body(source, 'take_fresh_backup'), /run_bounded 1800/u);
  assert.match(body(source, 'take_fresh_backup'), /"\$backup_command"/u);
  assert.match(source, /\.State\.Status/u);
  assert.match(rollback, /--candidate-app-image "\$previous_image"/u);
  assert.match(rollback, /mlp_atomic_replace_env/u);
  assert.match(rollback, /wait_for_app_image/u);
  assert.match(rollback, /wait_for_permanent_services/u);
  assert.match(report, /run_bounded 10 \/usr\/bin\/jq -n/u);
  assert.doesNotMatch(
    source,
    /\b(?:down|rollback-migration|migrate:down|down\.js)\b/u,
  );
  assert.doesNotMatch(
    deploy,
    /force-recreate[^\n]*(?:caddy|cloudflared)|(?:caddy|cloudflared)[^\n]*force-recreate/u,
  );
  for (const service of [
    'postgres',
    'app',
    'caddy',
    'cloudflared-a',
    'cloudflared-b',
  ]) {
    assert.ok(
      source.includes(service),
      `missing permanent health gate ${service}`,
    );
  }
  ordered(deploy, [
    'verify_candidate_config',
    'reconcile_stale_migration_helper',
    'take_fresh_backup',
    'pull_candidate_image',
    'verify_candidate_image',
    'require_postgres_healthy',
    'run_candidate_migrator',
    'replace_candidate_app',
    'wait_for_app_image',
    'wait_for_permanent_services',
    'mlp_atomic_replace_env',
    'reconcile_persisted_config',
    'write_deployment_report',
  ]);
});

test('successful deploy persists only after candidate and all permanent services are healthy', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: { HARNESS_COMPOSE_RETURNS_SHORT_ID: 'yes' },
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.equal(result.status, 0, result.stderr);
  assertRedacted(result);
  const trace = await traceOf(harness);
  ordered(trace, [
    'lock',
    'node',
    'mlp-backup',
    'mlp-compose --candidate-app-image',
    ' pull ',
    ' run ',
    ' migrator',
    'docker wait mlp-deploy-migrator',
    'docker rm -f mlp-deploy-migrator',
    ' up ',
    ' app',
    'persist ' + candidateImage,
    'node',
    'report',
  ]);
  assert.doesNotMatch(trace, /force-recreate (?:caddy|cloudflared)/u);
  assert.match(trace, /run -d --no-deps --no-TTY --name mlp-deploy-migrator/u);
  assert.match(trace, /--label com\.mlp\.operation=mlp-deploy-migration/u);
  assert.match(trace, /--label com\.mlp\.run-id=/u);
  await assert.rejects(readFile(path.join(harness.state, 'helper-exists')));
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    new RegExp(candidateDigest),
  );
  const report = JSON.parse(await readFile(harness.report, 'utf8'));
  assert.deepEqual(Object.keys(report).sort(), [
    'candidateCommit',
    'candidateImage',
    'completedAt',
    'previousImage',
    'status',
  ]);
  assert.equal(report.status, 'deployed');
  assert.equal(report.candidateImage, candidateImage);
  assert.equal(report.previousImage, previousImage);
});

test('deploy reconciles a correctly labeled stale migrator before backup', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: {
      HARNESS_INITIAL_HELPER: 'correct',
      HARNESS_INITIAL_HELPER_AFTER_PS: '8',
    },
    helperSettleObservationCount: 10,
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.equal(result.status, 0, result.stderr);
  const trace = await traceOf(harness);
  ordered(trace, [
    'docker ps',
    'docker rm -f mlp-deploy-migrator',
    'mlp-backup',
  ]);
  await assert.rejects(readFile(path.join(harness.state, 'helper-exists')), {
    code: 'ENOENT',
  });
});

test('deploy fails closed on a foreign stale migrator or uncertain cleanup', async (t) => {
  for (const environment of [
    { HARNESS_INITIAL_HELPER: 'mismatch' },
    {
      HARNESS_HELPER_CLEANUP_FAIL: 'yes',
      HARNESS_INITIAL_HELPER: 'correct',
    },
    { HARNESS_DOCKER_PS_FAIL: 'yes' },
  ]) {
    const harness = await createHarness(await readRequiredScript(), {
      environment,
    });
    t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
    const result = runHarness(harness);
    assert.notEqual(result.status, 0);
    const trace = await traceOf(harness);
    assert.doesNotMatch(trace, /mlp-backup| pull | up .* app/u);
    assert.match(result.stderr, /deployment failed/u);
  }
});

test('a timed-out delayed migrator is removed and proven absent before failure returns', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: {
      HARNESS_DELAYED_HELPER_AFTER_PS: '8',
      HARNESS_MIGRATION_CREATE_TIMEOUT: 'yes',
      HARNESS_MIGRATION_RAW_OUTPUT: 'yes',
    },
    helperSettleObservationCount: 10,
    stableObservationCount: 2,
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  const trace = await traceOf(harness);
  assert.match(trace, /docker rm -f mlp-deploy-migrator/u);
  assert.doesNotMatch(trace, / up .* app/u);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /untrusted migrator/u,
  );
  await assert.rejects(readFile(path.join(harness.state, 'helper-exists')), {
    code: 'ENOENT',
  });
  await assert.rejects(
    readFile(path.join(harness.state, 'helper-delayed-pending')),
    { code: 'ENOENT' },
  );
});

test('migration exit, identity, or cleanup failures are generic and never replace app', async (t) => {
  for (const environment of [
    { HARNESS_MIGRATION_EXIT_CODE: '7' },
    { HARNESS_CREATED_HELPER_LABEL_MISMATCH: 'yes' },
    { HARNESS_CREATED_HELPER_SERVICE_MISMATCH: 'yes' },
    { HARNESS_HELPER_CLEANUP_FAIL: 'yes' },
  ]) {
    const harness = await createHarness(await readRequiredScript(), {
      environment: {
        HARNESS_BACKUP_RAW_OUTPUT: 'yes',
        HARNESS_MIGRATION_RAW_OUTPUT: 'yes',
        ...environment,
      },
    });
    t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
    const result = runHarness(harness);
    assert.notEqual(result.status, 0);
    const trace = await traceOf(harness);
    assert.doesNotMatch(trace, / up .* app/u);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /untrusted (?:backup|migrator)/u,
    );
  }
});

test('candidate readiness failure restores prior app and config without schema rollback', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: { HARNESS_CANDIDATE_UNHEALTHY: 'yes' },
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  assertRedacted(result);
  const trace = await traceOf(harness);
  ordered(trace, [
    `mlp-compose --candidate-app-image ${previousImage}`,
    ' up ',
    ' app',
  ]);
  assert.doesNotMatch(trace, new RegExp(`persist ${previousImage}`));
  assert.doesNotMatch(trace, /(?:migrate:down| down )/u);
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    new RegExp(previousDigest),
  );
  assert.equal(
    (await readFile(path.join(harness.state, 'current-image'), 'utf8')).trim(),
    previousImage,
  );
});

test('persistence, reconciliation, or report failure rolls back candidate container and config', async (t) => {
  for (const [environment, rewritesPriorConfig] of [
    [{ HARNESS_FAIL_PERSIST_ONCE: 'yes' }, false],
    [{ HARNESS_RECONCILE_FAIL: 'yes' }, true],
    [{ HARNESS_FAIL_REPORT: 'yes' }, true],
  ]) {
    const harness = await createHarness(await readRequiredScript(), {
      environment,
    });
    t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
    const result = runHarness(harness);
    assert.notEqual(result.status, 0);
    const trace = await traceOf(harness);
    assert.match(trace, new RegExp(`persist ${candidateImage}`));
    if (rewritesPriorConfig) {
      assert.match(trace, new RegExp(`persist ${previousImage}`));
    } else {
      assert.doesNotMatch(trace, new RegExp(`persist ${previousImage}`));
    }
    assert.match(
      trace,
      new RegExp(
        `mlp-compose --candidate-app-image ${previousImage.replaceAll(
          '.',
          '\\.',
        )}.* up .* app`,
        'su',
      ),
    );
    assert.match(
      await readFile(harness.appEnv, 'utf8'),
      new RegExp(previousDigest),
    );
  }
});

test('fresh backup gate rejects a reused snapshot and a stale startedAt', async (t) => {
  for (const environment of [
    { HARNESS_BACKUP_REUSES_SNAPSHOT: 'yes' },
    { HARNESS_BACKUP_STALE_TIME: 'yes' },
  ]) {
    const harness = await createHarness(await readRequiredScript(), {
      environment,
    });
    t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
    const result = runHarness(harness);
    assert.notEqual(result.status, 0);
    const trace = await traceOf(harness);
    assert.match(trace, /mlp-backup/u);
    assert.doesNotMatch(trace, / pull | run .*migrator| up .*app|persist /u);
    assert.match(
      await readFile(harness.appEnv, 'utf8'),
      new RegExp(previousDigest),
    );
  }
});

test('stopped permanent service rolls back even when its health field is stale healthy', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: { HARNESS_STOPPED_SERVICE_ON_CANDIDATE: 'caddy' },
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  const trace = await traceOf(harness);
  assert.doesNotMatch(trace, /persist .*1111111111111111/u);
  assert.equal(
    (await readFile(path.join(harness.state, 'current-image'), 'utf8')).trim(),
    previousImage,
  );
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    new RegExp(previousDigest),
  );
});

test('an early permanent-service failure can never be masked by later healthy services during rollback', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: { HARNESS_UNHEALTHY_SERVICE: 'caddy' },
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /deployment and verified application rollback failed/u,
  );
  assert.doesNotMatch(result.stderr, /previous application restored/u);
});

test('rollback recreates old app again when a timed-out candidate reappears during the stable window', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: {
      HARNESS_CANDIDATE_REAPPEARS_AFTER_OLD_INSPECTIONS: '3',
      HARNESS_CANDIDATE_UNHEALTHY: 'yes',
    },
    stableObservationCount: 2,
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /previous application restored/u);
  assert.equal(
    (await readFile(path.join(harness.state, 'current-image'), 'utf8')).trim(),
    previousImage,
  );
  const trace = await traceOf(harness);
  assert.ok(
    trace.match(
      new RegExp(
        `mlp-compose --candidate-app-image ${previousImage}.* up .* app`,
        'gu',
      ),
    )?.length >= 2,
    'rollback must recreate the old app after a late candidate appears',
  );
});

test('rollback retries old app when late replacement is observed in the name-absent gap', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: {
      HARNESS_APP_ABSENT_ONCE_DURING_STABLE: 'yes',
      HARNESS_CANDIDATE_UNHEALTHY: 'yes',
    },
    stableObservationCount: 2,
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /previous application restored/u);
  assert.equal(
    (await readFile(path.join(harness.state, 'current-image'), 'utf8')).trim(),
    previousImage,
  );
});

test('rollback retries when the first bounded old-app recreate fails', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: {
      HARNESS_CANDIDATE_UNHEALTHY: 'yes',
      HARNESS_ROLLBACK_UP_FAIL_ONCE: 'yes',
    },
    stableObservationCount: 2,
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /previous application restored/u);
  assert.equal(
    (await readFile(path.join(harness.state, 'current-image'), 'utf8')).trim(),
    previousImage,
  );
  const trace = await traceOf(harness);
  assert.ok(
    trace.match(
      new RegExp(
        `mlp-compose --candidate-app-image ${previousImage}.* up .* app`,
        'gu',
      ),
    )?.length >= 2,
    'rollback must retry the old app after a bounded recreate failure',
  );
});

test('rollback fails closed when the late candidate keeps reappearing', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: {
      HARNESS_CANDIDATE_REAPPEARS_AFTER_OLD_INSPECTIONS: '3',
      HARNESS_CANDIDATE_REAPPEARS_CONTINUOUS: 'yes',
      HARNESS_CANDIDATE_UNHEALTHY: 'yes',
    },
    stableObservationCount: 2,
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /deployment and verified application rollback failed/u,
  );
  assert.doesNotMatch(result.stderr, /previous application restored/u);
});

test('candidate replacement failure also invokes verified application rollback', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: { HARNESS_REPLACE_FAIL: 'yes' },
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness);
  assert.notEqual(result.status, 0);
  const trace = await traceOf(harness);
  assert.match(
    trace,
    new RegExp(
      `mlp-compose --candidate-app-image ${previousImage.replaceAll(
        '.',
        '\\.',
      )}.* up .* app`,
      'su',
    ),
  );
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    new RegExp(previousDigest),
  );
});

test('healthy same-digest retry is a no-op without backup, migration, or replacement', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    candidateImage: previousImage,
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, [
    '--image',
    previousImage,
    '--commit',
    commit,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const trace = await traceOf(harness);
  assert.doesNotMatch(trace, /mlp-backup| run |force-recreate|persist /u);
  const report = JSON.parse(await readFile(harness.report, 'utf8'));
  assert.equal(report.status, 'no-op');
});

test('preflight, backup, pull, metadata, and migration failures never replace app', async (t) => {
  for (const environment of [
    { HARNESS_BACKUP_FAIL: 'yes' },
    { HARNESS_PULL_FAIL: 'yes' },
    { HARNESS_BAD_PLATFORM: 'yes' },
    { HARNESS_BAD_SOURCE: 'yes' },
    { HARNESS_BAD_REVISION: 'yes' },
    { HARNESS_MIGRATION_FAIL: 'yes' },
    { HARNESS_RUNNING_ID_MISMATCH: 'yes' },
  ]) {
    const harness = await createHarness(await readRequiredScript(), {
      environment,
    });
    t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
    const result = runHarness(harness);
    assert.notEqual(result.status, 0);
    const trace = await traceOf(harness);
    assert.doesNotMatch(trace, / up .* app/u);
    assert.doesNotMatch(trace, /persist /u);
    assert.match(
      await readFile(harness.appEnv, 'utf8'),
      new RegExp(previousDigest),
    );
  }
});

test('deploy rejects non-root, dirty, mutable, malformed, and unknown invocations', async (t) => {
  const source = await readRequiredScript();
  const cases = [
    [{ root: 'no' }, ['--image', candidateImage, '--commit', commit]],
    [
      { environment: { HARNESS_DIRTY: 'yes' } },
      ['--image', candidateImage, '--commit', commit],
    ],
    [{}, ['--image', 'ghcr.io/martinlindblad/mlp:latest', '--commit', commit]],
    [{}, ['--image', candidateImage, '--commit', 'short']],
    [
      {},
      ['--image', candidateImage, '--commit', commit, '--command', '/tmp/pwn'],
    ],
  ];
  for (const [options, args] of cases) {
    const harness = await createHarness(source, options);
    t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
    const result = runHarness(harness, args);
    assert.notEqual(result.status, 0);
    assertRedacted(result);
    assert.doesNotMatch(await traceOf(harness), /mlp-backup| up .* app/u);
  }
});
