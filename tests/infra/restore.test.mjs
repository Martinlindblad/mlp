import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  lstat,
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

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const scriptRelativePath = 'ops/restore-test.sh';
const scriptPath = path.join(repositoryRoot, scriptRelativePath);
const fullSnapshotId = '0123456789abcdef'.repeat(4);
const postgresImage =
  'postgres:18.4-alpine@sha256:' +
  '9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15';

async function readRequiredText(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${relativePath}: required Task 10 artifact is missing`);
    }
    throw error;
  }
}

async function createSourceableScript(directory) {
  const source = await readRequiredText(scriptRelativePath);
  const operations = path.join(directory, 'operations.sh');
  const sourceable = path.join(directory, 'restore-test.sh');
  await writeFile(operations, '# test-only operations shim\n', { mode: 0o600 });
  const replaced = source.replace(
    /^source \/opt\/mlp\/ops\/lib\/operations\.sh$/mu,
    `source ${operations}`,
  );
  assert.notEqual(
    replaced,
    source,
    'the production script must source the fixed operations library exactly',
  );
  await writeFile(sourceable, replaced, { mode: 0o700 });
  return sourceable;
}

async function runRestoreHarness({
  cleanupFailKind = '',
  delayedKind = '',
  delayedPoll = 2,
  failAt = '',
  mismatchedKind = '',
  resticLeak = false,
  resticOutput = '',
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mlp-restore-test-'));
  try {
    const sourceable = await createSourceableScript(directory);
    const harness = String.raw`
exec 8>>"$HARNESS_DIR/xtrace-fd"
BASH_XTRACEFD=8
PS4='hostile-trace '
export BASH_XTRACEFD PS4
set -x
source "$SOURCEABLE"
[[ "$DOCKER_HOST" == unix:///run/docker.sock && "$HOME" == /etc/mlp && "$DOCKER_CONFIG" == /etc/mlp/docker-client ]]
if declare -p DOCKER_CONTEXT DOCKER_TLS_VERIFY >/dev/null 2>&1; then
  exit 90
fi
[[ $- != *x* ]]
[[ $(export -p) != *BASH_XTRACEFD* ]]
printf '%s\n' fd-preserved >&8
trace() { printf '%s\n' "$1" >>"$HARNESS_DIR/trace"; }
resource_key() {
  if [[ $1 == container && $2 == "$MLP_RESTORE_HELPER" ]]; then
    printf '%s\n' helper
  else
    printf '%s\n' "$1"
  fi
}
resource_file() { printf '%s/present-%s\n' "$HARNESS_DIR" "$1"; }
mark_resource_present() { : >"$(resource_file "$1")"; }
mlp_require_root() { trace root; }
mlp_acquire_operations_lock() { trace lock; }
mlp_require_root_directory() { trace "directory:$1:$2"; }
mlp_require_root_file() { trace "file:$1:$2"; }
mlp_restore_now() {
  if [[ -e "$HARNESS_DIR/clock" ]]; then
    printf '%s\n' '2026-07-14T21:00:10Z'
  else
    : >"$HARNESS_DIR/clock"
    printf '%s\n' '2026-07-14T21:00:00Z'
  fi
}
mlp_restore_read_snapshot_id() { trace read-snapshot; printf '%s\n' "$SNAPSHOT_ID"; }
mlp_restore_random_id() { printf '%s\n' 11111111222233334444555555555555; }
mlp_restore_make_workdir() { trace work-create; }
mlp_restore_restic_snapshot() {
  trace "restic:$1:$MLP_RESTORE_HELPER"
  if [[ -n "$RESTIC_OUTPUT" ]]; then
    printf '%s\n' "$RESTIC_OUTPUT"
    printf 'restic error: %s\n' "$RESTIC_OUTPUT" >&2
  fi
  if [[ "$RESTIC_LEAK" == true ]]; then
    mark_resource_present helper
  fi
  [[ "$FAIL_AT" != restic ]]
}
mlp_restore_find_dump() { trace find-dump; printf '%s\n' "$HARNESS_DIR/work/postgresql.dump"; }
mlp_restore_prepare_postgres_files() {
  trace prepare-postgres-files
  MLP_RESTORE_DUMP_COPY="$HARNESS_DIR/work/postgresql-for-restore.dump"
  MLP_RESTORE_PASSWORD_FILE="$HARNESS_DIR/work/postgres-bootstrap-password"
}
mlp_restore_create_network() {
  trace create-network
  mark_resource_present network
  [[ "$FAIL_AT" != create-network ]]
}
mlp_restore_create_volume() {
  trace create-volume
  mark_resource_present volume
  [[ "$FAIL_AT" != create-volume ]]
}
mlp_restore_create_container() {
  trace create-container
  mark_resource_present container
  [[ "$FAIL_AT" != create-container ]]
}
mlp_restore_wait_postgres() { trace wait-postgres; }
mlp_restore_bootstrap_roles() { trace bootstrap-roles; }
mlp_restore_load_dump() { trace load-dump; }
mlp_restore_validate_representative_queries() { trace representative-queries; }
mlp_restore_validate_database() {
  trace validate
  [[ "$FAIL_AT" != validate ]]
  printf '%s\n' '10|12|9|002_runtime_grants|37|4'
}
mlp_restore_label_matches() {
  local key count_file count
  key="$(resource_key "$1" "$2")"
  trace "label:$key"
  if [[ "$key" == "$DELAYED_KIND" && ! -e "$(resource_file "$key")" ]]; then
    count_file="$HARNESS_DIR/polls-$key"
    count=0
    if [[ -e "$count_file" ]]; then
      IFS= read -r count <"$count_file"
    fi
    count=$((count + 1))
    printf '%s\n' "$count" >"$count_file"
    if ((count == DELAYED_POLL)); then
      mark_resource_present "$key"
      trace "appeared:$key"
    fi
  fi
  [[ "$key" != "$MISMATCHED_KIND" ]] || return 1
  [[ -e "$(resource_file "$key")" ]]
}
mlp_restore_remove_resource() {
  local key
  key="$(resource_key "$1" "$2")"
  trace "remove:$key"
  [[ "$key" != "$CLEANUP_FAIL_KIND" ]] || return 1
  /bin/rm -f -- "$(resource_file "$key")"
}
mlp_restore_resource_absent() {
  local key
  key="$(resource_key "$1" "$2")"
  trace "absent:$key"
  [[ ! -e "$(resource_file "$key")" ]]
}
mlp_restore_cleanup_pause() { trace cleanup-pause; }
mlp_restore_delete_workdir() { trace delete-work; }
mlp_restore_secure_evidence() { trace secure-evidence; }
mlp_restore_make_report_file() { /usr/bin/mktemp "$HARNESS_DIR/report.XXXXXX"; }
mlp_atomic_install_json() {
  local name
  name="$(/usr/bin/basename "$2")"
  /bin/cp "$1" "$HARNESS_DIR/$name"
  trace "install:$name"
}
mlp_restore_main
`;
    const result = spawnSync(
      '/bin/bash',
      ['--noprofile', '--norc', '-c', harness],
      {
        encoding: 'utf8',
        env: {
          CLEANUP_FAIL_KIND: cleanupFailKind,
          DELAYED_KIND: delayedKind,
          DELAYED_POLL: String(delayedPoll),
          DOCKER_CONFIG: '/tmp/hostile-docker-config',
          DOCKER_CONTEXT: 'hostile-context',
          DOCKER_HOST: 'tcp://attacker.invalid:2375',
          DOCKER_TLS_VERIFY: '1',
          FAIL_AT: failAt,
          HARNESS_DIR: directory,
          HOME: '/tmp/hostile-home',
          MISMATCHED_KIND: mismatchedKind,
          RESTIC_LEAK: String(resticLeak),
          RESTIC_OUTPUT: resticOutput,
          SNAPSHOT_ID: fullSnapshotId,
          SOURCEABLE: sourceable,
        },
        timeout: 10_000,
      },
    );
    let report;
    try {
      report = JSON.parse(
        await readFile(path.join(directory, 'latest-success.json'), 'utf8'),
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return {
      report,
      result,
      temporaryReports: (await readdir(directory)).filter((name) =>
        name.startsWith('report.'),
      ),
      trace: await readFile(path.join(directory, 'trace'), 'utf8'),
      xtrace: await readFile(path.join(directory, 'xtrace-fd'), 'utf8'),
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test('restore drill has a fixed privileged entrypoint and trusted paths only', async () => {
  const source = await readRequiredText(scriptRelativePath);
  const metadata = await lstat(scriptPath);
  assert.equal(source.split(/\r?\n/u)[0], '#!/bin/bash -p');
  assert.ok(
    (metadata.mode & 0o111) !== 0,
    'restore wrapper must be executable',
  );
  assert.match(source, /^set \+x$/mu);
  assert.match(
    source,
    /^export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS$/mu,
  );
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /"\$\{!DOCKER_@\}"/u);
  assert.match(source, /unset BASH_ENV.*PS4/u);
  assert.ok(
    source.indexOf('set +x') < source.indexOf('${!DOCKER_@}'),
    'xtrace must be disabled before inherited environment is inspected',
  );
  assert.ok(
    source.indexOf('${!DOCKER_@}') < source.indexOf('export DOCKER_HOST='),
    'all inherited Docker client controls must be cleared before the fixed socket',
  );
  assert.match(source, /^export HOME=\/etc\/mlp$/mu);
  assert.match(source, /^export DOCKER_CONFIG=\/etc\/mlp\/docker-client$/mu);
  assert.match(source, /^source \/opt\/mlp\/ops\/lib\/operations\.sh$/mu);
  assert.match(source, /\bmlp_require_root\b/u);
  assert.match(source, /\bmlp_acquire_operations_lock\b/u);
  assert.match(source, /\/var\/lib\/mlp\/restore-work/u);
  assert.match(
    source,
    /\/var\/lib\/mlp\/backup-reports\/latest-success\.json/u,
  );
  assert.match(
    source,
    /\/var\/lib\/mlp\/restore-reports\/latest-success\.json/u,
  );
  assert.match(
    source,
    /mlp_require_root_directory[^\n]*restore-work[^\n]*0700/u,
  );
  assert.match(
    source,
    /mlp_require_root_file[^\n]*latest-success\.json[^\n]*0600/u,
  );
  assert.match(source, /\/usr\/bin\/timeout\b/u);
  assert.match(source, /DOCKER_HOST=unix:\/\/\/run\/docker\.sock/u);
  assert.doesNotMatch(
    source,
    /\$\{(?:PATH|MLP_[A-Z_]*(?:COMMAND|BIN|PATH))(?::[-=?+])?/u,
  );
  assert.doesNotMatch(source, /(?:^|\s)(?:docker|jq|timeout)(?:\s|$)/mu);
});

test('restore selects one explicit full snapshot through the image helper', async () => {
  const source = await readRequiredText(scriptRelativePath);
  assert.match(source, /\.snapshotId/u);
  assert.match(source, /\^\[0-9a-f\]\{64\}\$/u);
  assert.match(
    source,
    /--entrypoint \/usr\/local\/bin\/mlp-restic db-backup[\s\\]+restore "?\$snapshot_id"?/u,
  );
  assert.match(source, /--target \/restore/u);
  assert.doesNotMatch(source, /\brestore latest\b/u);
  assert.doesNotMatch(source, /\brestic unlock\b/u);
  assert.match(source, /(?:chown|install)[^\n]*10001(?::10001|[^\n]*10001)/u);
  assert.match(source, /(?:chmod|install)[^\n]*0700/u);
});

test('Restic restore uses one fixed labeled helper tracked before its create attempt', async () => {
  const source = await readRequiredText(scriptRelativePath);
  const main = source.match(/mlp_restore_main\(\) \{[\s\S]*?^\}/mu)?.[0];
  assert.ok(main, 'restore main function must exist');
  assert.match(source, /MLP_RESTORE_HELPER=/u);
  assert.match(source, /--name "\$MLP_RESTORE_HELPER"/u);
  assert.match(source, /--label "\$MLP_RESTORE_OPERATION_LABEL"/u);
  assert.match(source, /--label "com\.mlp\.run-id=\$MLP_RESTORE_RUN_ID"/u);
  assert.match(source, /MLP_RESTORE_HELPER_TRACKED=false/u);
  assert.ok(
    main.indexOf('MLP_RESTORE_HELPER_TRACKED=true') >= 0 &&
      main.indexOf('MLP_RESTORE_HELPER_TRACKED=true') <
        main.indexOf('mlp_restore_restic_snapshot'),
    'the helper must be tracked before Compose can ask Docker to create it',
  );
});

test('disposable PostgreSQL is random, labeled, isolated, and hardened', async () => {
  const source = await readRequiredText(scriptRelativePath);
  const containerFunction = source.match(
    /mlp_restore_create_container\(\) \{[\s\S]*?^\}/mu,
  )?.[0];
  assert.ok(containerFunction, 'restore container function must exist');
  assert.match(source, /\/proc\/sys\/kernel\/random\/uuid/u);
  assert.match(source, /com\.mlp\.operation=restore-test/u);
  assert.match(source, /com\.mlp\.run-id/u);
  assert.match(source, /\/usr\/bin\/docker network create --internal/u);
  assert.match(source, /\/usr\/bin\/docker volume create/u);
  assert.match(source, /\/usr\/bin\/docker run/u);
  assert.match(source, /--user 70:70/u);
  assert.match(source, /--read-only/u);
  assert.match(source, /--cap-drop ALL/u);
  assert.match(source, /--security-opt no-new-privileges:true/u);
  assert.match(source, /--tmpfs \/tmp:/u);
  assert.match(source, /--tmpfs \/var\/run\/postgresql:/u);
  assert.match(source, /type=volume[^\n]*\/var\/lib\/postgresql/u);
  assert.ok(
    source.includes(postgresImage),
    'restore must use the reviewed PG 18.4 digest',
  );
  assert.doesNotMatch(containerFunction, /(?:^|\s)(?:-p|--publish)(?:\s|=)/mu);
});

test('restore recreates roles, ownership, database ACLs, and the complete runtime matrix', async () => {
  const source = await readRequiredText(scriptRelativePath);
  for (const role of [
    'portfolio_migrator',
    'portfolio_app',
    'portfolio_backup',
  ]) {
    assert.match(source, new RegExp(`create role ${role} login`, 'iu'));
  }
  assert.match(source, /password null/iu);
  assert.match(
    source,
    /create database portfolio_restore owner portfolio_migrator/iu,
  );
  assert.match(
    source,
    /revoke connect, temporary on database portfolio_restore from public/iu,
  );
  assert.match(
    source,
    /grant connect on database portfolio_restore to[\s\S]*portfolio_migrator[\s\S]*portfolio_app[\s\S]*portfolio_backup/iu,
  );
  assert.match(source, /pg_restore --list/u);
  assert.match(source, /pg_restore --exit-on-error/u);
  const loadDump = source.match(
    /mlp_restore_load_dump\(\) \{[\s\S]*?^\}/mu,
  )?.[0];
  assert.ok(loadDump, 'restore must define its dump loader');
  assert.equal(
    loadDump.match(/>\/dev\/null 2>&1/gu)?.length,
    2,
    'both pg_restore probes must suppress data-bearing stdout and stderr',
  );
  assert.match(
    source,
    /if ! mlp_restore_load_dump; then\s+printf '%s\\n' 'restore dump load failed' >&2/mu,
  );
  assert.doesNotMatch(source, /--no-owner|--no-acl/u);

  for (const table of [
    'profile_sections',
    'current_occupations',
    'hobbies',
    'languages',
    'page_cards',
    'professional_timeline',
    'projects',
    'pursuits',
    'social_links',
    'contact_messages',
    'kysely_migration',
    'kysely_migration_lock',
  ]) {
    assert.ok(source.includes(table), `restore validation must cover ${table}`);
  }
  assert.match(source, /002_runtime_grants/u);
  assert.match(source, /pg_get_userbyid\([^)]*relowner/iu);
  assert.match(source, /has_database_privilege/iu);
  assert.match(source, /has_schema_privilege/iu);
  assert.match(source, /has_table_privilege/iu);
  for (const privilege of ['select', 'insert', 'update', 'delete']) {
    assert.match(source, new RegExp(`'${privilege}'`, 'iu'));
  }
  for (const privilege of ['truncate', 'references', 'trigger']) {
    assert.match(
      source,
      new RegExp(`'${privilege}'`, 'iu'),
      `restore validation must reject unexpected ${privilege} access`,
    );
  }
  assert.match(source, /with grant option/iu);
  assert.match(source, /array_agg\(acl_entry order by acl_entry\)/iu);
  assert.doesNotMatch(source, /array_agg\([\s\S]*?order by 1\)/iu);
  assert.match(source, /jsonb_typeof\(project_details\)/iu);
});

test('pg_restore failures expose only one fixed diagnostic and no contact PII', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mlp-pg-restore-'));
  const operations = path.join(directory, 'operations.sh');
  const docker = path.join(directory, 'docker');
  const timeout = path.join(directory, 'timeout');
  const sourceable = path.join(directory, 'restore-test.sh');
  const sentinel = 'PRIVATE CONTACT alice@example.invalid message-body';
  try {
    await writeFile(operations, '# redaction test shim\n', { mode: 0o600 });
    await writeFile(
      docker,
      `#!/bin/bash\nprintf '%s\\n' '${sentinel}'\nprintf '%s\\n' '${sentinel}' >&2\nexit 42\n`,
      { mode: 0o700 },
    );
    await writeFile(
      timeout,
      `#!/bin/bash\nwhile [[ \${1:-} == --* ]]; do shift; done\nshift\nexec "$@"\n`,
      { mode: 0o700 },
    );
    const materialized = (await readRequiredText(scriptRelativePath))
      .replace(
        /^source \/opt\/mlp\/ops\/lib\/operations\.sh$/mu,
        `source ${operations}`,
      )
      .replaceAll('/usr/bin/timeout', timeout)
      .replaceAll('/usr/bin/docker', docker);
    await writeFile(sourceable, materialized, { mode: 0o700 });
    const result = spawnSync(
      '/bin/bash',
      [
        '--noprofile',
        '--norc',
        '-c',
        `source "$1"\nMLP_RESTORE_CONTAINER=redaction-test\nif ! mlp_restore_load_dump; then\n  printf '%s\\n' 'restore dump load failed' >&2\n  exit 1\nfi`,
        'pg-restore-redaction',
        sourceable,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'restore dump load failed\n');
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /alice|PRIVATE|message-body/u,
    );
    for (const name of await readdir(directory)) {
      const content = await readFile(path.join(directory, name), 'utf8');
      if (name !== 'docker') assert.doesNotMatch(content, /alice@example/u);
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('restore executes representative reads and a rolled-back contact write as runtime roles', async () => {
  const source = await readRequiredText(scriptRelativePath);
  assert.match(source, /set local role portfolio_app/iu);
  assert.match(source, /insert into contact_messages/iu);
  assert.match(source, /set local role portfolio_backup/iu);
  assert.match(source, /select count\(\*\) from kysely_migration_lock/iu);
  assert.match(source, /rollback/iu);
  assert.match(source, /mlp_restore_validate_representative_queries/iu);
});

test('successful orchestration deletes plaintext before writing a redacted atomic report', async () => {
  const { report, result, temporaryReports, trace, xtrace } =
    await runRestoreHarness();
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(report, {
    completedAt: '2026-07-14T21:00:10Z',
    counts: {
      applicationTables: 10,
      contactMessages: 4,
      contentRows: 37,
      ownedTables: 12,
      populatedContentTables: 9,
    },
    migration: '002_runtime_grants',
    snapshotId: fullSnapshotId,
    startedAt: '2026-07-14T21:00:00Z',
    status: 'passed',
  });
  assert.deepEqual(temporaryReports, []);
  assert.match(xtrace, /fd-preserved/u);
  assert.doesNotMatch(xtrace, /credential|password|private-path/u);
  assert.doesNotMatch(
    JSON.stringify(report),
    /portfolio_restore|container|network|volume|password|dump/u,
  );
  for (const kind of ['container', 'network', 'volume']) {
    assert.match(
      trace,
      new RegExp(
        `label:${kind}[\\s\\S]*remove:${kind}[\\s\\S]*absent:${kind}`,
        'u',
      ),
    );
  }
  for (const kind of ['helper', 'container', 'network', 'volume']) {
    assert.ok(
      trace.match(new RegExp(`^absent:${kind}$`, 'gmu'))?.length >= 3,
      `${kind} absence must be stable across multiple polls`,
    );
  }
  assert.ok(
    trace.indexOf('absent:volume') < trace.indexOf('delete-work') &&
      trace.indexOf('delete-work') <
        trace.indexOf('install:latest-success.json'),
    'resource absence and plaintext deletion must precede the success report',
  );
});

test('a timed-out Restic helper is removed before plaintext and raw output is redacted', async () => {
  const sensitiveOutput =
    'snapshot endpoint=s3:https://storage.invalid private-path=/restore credential=secret';
  const { report, result, trace } = await runRestoreHarness({
    failAt: 'restic',
    resticLeak: true,
    resticOutput: sensitiveOutput,
  });
  assert.notEqual(result.status, 0);
  assert.equal(report, undefined);
  assert.match(
    trace,
    /restic:[^\n]+:mlp-restore-[0-9a-f]{32}-restic[\s\S]*label:helper[\s\S]*remove:helper[\s\S]*absent:helper/u,
  );
  assert.ok(
    trace.lastIndexOf('absent:helper') < trace.indexOf('delete-work'),
    'the helper must be proven absent before plaintext deletion',
  );
  assert.match(result.stderr, /restore snapshot retrieval failed\n$/u);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /storage\.invalid|private-path|credential|secret|0123456789abcdef/u,
  );
});

test('cleanup catches a helper that appears after an initially absent create result', async () => {
  const { report, result, trace } = await runRestoreHarness({
    delayedKind: 'helper',
    failAt: 'restic',
  });
  assert.notEqual(result.status, 0);
  assert.equal(report, undefined);
  assert.match(
    trace,
    /label:helper\nabsent:helper\ncleanup-pause\nlabel:helper\nappeared:helper\nremove:helper/u,
  );
  assert.ok(
    trace.match(/^absent:helper$/gmu)?.length >= 3,
    'cleanup must restart and prove stable absence after delayed appearance',
  );
  assert.ok(
    trace.lastIndexOf('absent:helper') < trace.indexOf('delete-work'),
    'delayed helper reconciliation must finish before plaintext deletion',
  );
});

test('timeout cleanup catches a helper that appears after three empty polls', async () => {
  const { report, result, trace } = await runRestoreHarness({
    delayedKind: 'helper',
    delayedPoll: 4,
    failAt: 'restic',
  });
  assert.notEqual(result.status, 0);
  assert.equal(report, undefined);
  assert.match(
    trace,
    /absent:helper\ncleanup-pause\nlabel:helper\nabsent:helper\ncleanup-pause\nlabel:helper\nabsent:helper\ncleanup-pause\nlabel:helper\nappeared:helper\nremove:helper/u,
  );
  assert.ok(
    trace.match(/^label:helper$/gmu)?.length >= 30,
    'an uncertain helper create must remain observed for the daemon settle window',
  );
  assert.ok(trace.lastIndexOf('absent:helper') < trace.indexOf('delete-work'));
});

test('helper cleanup failure retains secured evidence and never deletes plaintext', async () => {
  const { report, result, trace } = await runRestoreHarness({
    cleanupFailKind: 'helper',
    failAt: 'restic',
    resticLeak: true,
  });
  assert.notEqual(result.status, 0);
  assert.equal(report, undefined);
  assert.match(trace, /label:helper[\s\S]*remove:helper/u);
  assert.match(trace, /secure-evidence/u);
  assert.doesNotMatch(trace, /delete-work|install:latest-success\.json/u);
});

test('cleanup mismatch retains secured evidence and never removes an unlabeled resource', async () => {
  const { report, result, trace } = await runRestoreHarness({
    failAt: 'validate',
    mismatchedKind: 'volume',
  });
  assert.notEqual(result.status, 0);
  assert.equal(report, undefined);
  assert.match(trace, /label:volume/u);
  assert.doesNotMatch(trace, /remove:volume/u);
  assert.match(trace, /secure-evidence/u);
  assert.doesNotMatch(trace, /delete-work|install:latest-success\.json/u);
});

test('a Docker create timeout still cleans a resource that the daemon labeled for this run', async () => {
  for (const failAt of [
    'create-network',
    'create-volume',
    'create-container',
  ]) {
    const kind = failAt.slice('create-'.length);
    const { report, result, trace } = await runRestoreHarness({ failAt });
    assert.notEqual(result.status, 0, failAt);
    assert.equal(report, undefined, failAt);
    assert.match(
      trace,
      new RegExp(
        `create-${kind}[\\s\\S]*label:${kind}[\\s\\S]*remove:${kind}[\\s\\S]*absent:${kind}`,
        'u',
      ),
      failAt,
    );
    assert.ok(
      trace.match(new RegExp(`^label:${kind}$`, 'gmu'))?.length >= 30,
      `${failAt} must remain observed for the daemon settle window`,
    );
    assert.match(trace, /delete-work/u, failAt);
  }
});

test('restore implementation has no unconditional plaintext cleanup shortcut', async () => {
  const source = await readRequiredText(scriptRelativePath);
  assert.doesNotMatch(source, /rm\s+(?:-[A-Za-z]*r[A-Za-z]*f|-rf|-fr)\b/u);
  assert.match(source, /mlp_restore_label_matches/u);
  assert.match(source, /mlp_restore_resource_absent/u);
  assert.match(source, /mlp_restore_secure_evidence/u);
  assert.match(source, /mlp_restore_delete_workdir/u);
});

test('restore unit permits only required state paths and has a fixed monthly schedule', async () => {
  const service = await readRequiredText(
    'infra/systemd/mlp-db-restore-test.service',
  );
  const timer = await readRequiredText(
    'infra/systemd/mlp-db-restore-test.timer',
  );
  assert.match(service, /^Wants=network-online\.target$/mu);
  assert.match(service, /^After=docker\.service network-online\.target$/mu);
  assert.match(service, /^User=root$/mu);
  assert.match(service, /^Group=root$/mu);
  assert.match(service, /^ExecStart=\/usr\/local\/sbin\/mlp-restore-test$/mu);
  assert.match(service, /^TimeoutStartSec=[1-9][0-9]*(?:min|h)$/mu);
  assert.match(service, /^ProtectSystem=strict$/mu);
  assert.match(service, /^ReadWritePaths=.*\/etc\/mlp\/compose-secrets/mu);
  assert.match(service, /^ReadWritePaths=.*\/var\/lib\/mlp\/restore-work/mu);
  assert.match(service, /^ReadWritePaths=.*\/var\/lib\/mlp\/restore-reports/mu);
  assert.doesNotMatch(service, /password|token|credential|PGPASSWORD|AWS_/iu);
  assert.match(timer, /^OnCalendar=\*-\*-01 03:17:00 UTC$/mu);
  assert.match(timer, /^Persistent=true$/mu);
  assert.match(timer, /^RandomizedDelaySec=0$/mu);
});

test('disaster-recovery runbook preserves evidence and requires explicit proof', async () => {
  const runbook = await readRequiredText(
    'runbooks/postgresql-disaster-recovery.md',
  );
  assert.match(runbook, /\/usr\/local\/sbin\/mlp-restore-test/u);
  assert.match(runbook, /64-(?:character|hex)|64 [ -]?hex/iu);
  assert.match(runbook, /owner|ownership/iu);
  assert.match(runbook, /ACL|privilege matrix/iu);
  assert.match(runbook, /retain|preserve/iu);
  assert.match(
    runbook,
    /\/var\/lib\/mlp\/restore-reports\/latest-success\.json/u,
  );
  assert.doesNotMatch(runbook, /drop\s+database/iu);
  assert.doesNotMatch(runbook, /compose\s+down[^\n]*-v/iu);
  assert.doesNotMatch(runbook, /docker\s+volume\s+rm/iu);
  assert.doesNotMatch(runbook, /restic\s+(?:restore\s+latest|unlock)/iu);
});
