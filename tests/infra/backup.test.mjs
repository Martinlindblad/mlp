import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const scriptRelativePath = 'ops/backup.sh';
const scriptPath = path.join(repositoryRoot, scriptRelativePath);
const fullSnapshotId = '0123456789abcdef'.repeat(4);

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

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

async function createSourceableScript(directory) {
  const source = await readRequiredText(scriptRelativePath);
  const operations = path.join(directory, 'operations.sh');
  const sourceable = path.join(directory, 'backup.sh');
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

async function runBackupHarness({
  helperLabel = 'backup',
  jobOutput = JSON.stringify({
    message_type: 'summary',
    snapshot_id: fullSnapshotId,
  }),
  jobStatus = 0,
  postJobStates = 'absent,absent,absent',
  removeStatus = 0,
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mlp-backup-test-'));
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
mlp_require_root() { printf '%s\n' root >>"$HARNESS_DIR/trace"; }
mlp_acquire_operations_lock() { printf '%s\n' lock >>"$HARNESS_DIR/trace"; }
mlp_require_root_directory() {
  printf 'directory:%s:%s\n' "$1" "$2" >>"$HARNESS_DIR/trace"
}
mlp_backup_now() {
  if [[ -e "$HARNESS_DIR/clock" ]]; then
    printf '%s\n' '2026-07-14T20:00:05Z'
  else
    : >"$HARNESS_DIR/clock"
    printf '%s\n' '2026-07-14T20:00:00Z'
  fi
}
mlp_backup_observe_helper() {
  local index phase state state1 state2 state3 state4 state5
  phase=pre
  if [[ -e "$HARNESS_DIR/phase" ]]; then
    phase=$(<"$HARNESS_DIR/phase")
  fi
  state=absent
  if [[ $phase == post ]]; then
    index=0
    if [[ -e "$HARNESS_DIR/observe-index" ]]; then
      index=$(<"$HARNESS_DIR/observe-index")
    fi
    IFS=, read -r state1 state2 state3 state4 state5 <<<"$POST_JOB_STATES"
    [[ -n $state2 ]] || state2=$state1
    [[ -n $state3 ]] || state3=$state2
    [[ -n $state4 ]] || state4=$state3
    [[ -n $state5 ]] || state5=$state4
    case $index in
      0) state=$state1 ;;
      1) state=$state2 ;;
      2) state=$state3 ;;
      3) state=$state4 ;;
      *) state=$state5 ;;
    esac
    printf '%s\n' "$((index + 1))" >"$HARNESS_DIR/observe-index"
  fi
  printf 'observe:%s:%s\n' "$phase" "$state" >>"$HARNESS_DIR/trace"
  case $state in
    absent) MLP_BACKUP_HELPER_PRESENT=false ;;
    present) MLP_BACKUP_HELPER_PRESENT=true ;;
    *) return 1 ;;
  esac
}
mlp_backup_read_helper_label() {
  printf '%s\n' inspect >>"$HARNESS_DIR/trace"
  printf '%s\n' "$HELPER_LABEL"
}
mlp_backup_remove_helper() {
  printf '%s\n' remove >>"$HARNESS_DIR/trace"
  return "$REMOVE_STATUS"
}
mlp_backup_pause() {
  printf '%s\n' pause >>"$HARNESS_DIR/trace"
}
mlp_backup_run_job() {
  printf '%s\n' run-job >>"$HARNESS_DIR/trace"
  printf '%s\n' post >"$HARNESS_DIR/phase"
  printf '%s\n' 0 >"$HARNESS_DIR/observe-index"
  if [[ -n "$JOB_OUTPUT" ]]; then
    printf '%s\n' "$JOB_OUTPUT"
  fi
  return "$JOB_STATUS"
}
mlp_backup_make_report_file() {
  /usr/bin/mktemp "$HARNESS_DIR/report.XXXXXX"
}
mlp_atomic_install_json() {
  local name
  name="$(/usr/bin/basename "$2")"
  /bin/cp "$1" "$HARNESS_DIR/$name"
  printf 'install:%s\n' "$name" >>"$HARNESS_DIR/trace"
}
mlp_backup_main
`;
    const result = spawnSync(
      '/bin/bash',
      ['--noprofile', '--norc', '-c', harness],
      {
        encoding: 'utf8',
        env: {
          DOCKER_CONFIG: '/tmp/hostile-docker-config',
          DOCKER_CONTEXT: 'hostile-context',
          DOCKER_HOST: 'tcp://attacker.invalid:2375',
          DOCKER_TLS_VERIFY: '1',
          HARNESS_DIR: directory,
          HELPER_LABEL: helperLabel,
          HOME: '/tmp/hostile-home',
          JOB_OUTPUT: jobOutput,
          JOB_STATUS: String(jobStatus),
          POST_JOB_STATES: postJobStates,
          REMOVE_STATUS: String(removeStatus),
          SOURCEABLE: sourceable,
        },
        timeout: 10_000,
      },
    );
    const readOptional = async (name) => {
      try {
        return JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT') return undefined;
        throw error;
      }
    };
    return {
      lastAttempt: await readOptional('last-attempt.json'),
      latestSuccess: await readOptional('latest-success.json'),
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

test('backup wrapper is fixed, root-only, serialized, and bounded', async () => {
  const source = await readRequiredText(scriptRelativePath);
  const metadata = await lstat(scriptPath);

  assert.equal(source.split(/\r?\n/u)[0], '#!/bin/bash -p');
  assert.ok((metadata.mode & 0o111) !== 0, 'backup wrapper must be executable');
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
  assert.match(
    source,
    /mlp_require_root_directory[ "']+\/var\/lib\/mlp\/backup-reports[ "']+0700/u,
  );
  assert.match(
    source,
    /mlp_require_root_directory[ "']+\/etc\/mlp\/docker-client[ "']+0700/u,
  );
  assert.match(source, /\/usr\/bin\/timeout\b/u);
  assert.match(source, /\/usr\/local\/sbin\/mlp-compose\b/u);
  assert.doesNotMatch(
    source,
    /\$\{(?:PATH|MLP_[A-Z_]*(?:COMMAND|BIN|PATH))(?::[-=?+])?/u,
  );
  assert.doesNotMatch(source, /(?:^|\s)(?:docker|flock|jq|timeout)(?:\s|$)/mu);
});

test('backup job is fixed, labeled, named, and returns its own Restic summary', async () => {
  const source = await readRequiredText(scriptRelativePath);
  assert.match(
    source,
    /\/usr\/local\/sbin\/mlp-compose --profile jobs run --rm[\s\\]+--no-TTY --no-deps[\s\\]+--name mlp-backup-helper[\s\\]+--label com\.mlp\.operation=backup db-backup/u,
  );
  assert.doesNotMatch(source, /\brestic snapshots\b|--latest 1/u);
  assert.match(source, /message_type == "summary"/u);
  assert.match(source, /\.snapshot_id/u);
  assert.match(source, /\^\[0-9a-f\]\{64\}\$/u);
  assert.doesNotMatch(source, /\brestic unlock\b/u);
  assert.match(source, /MLP_BACKUP_RECONCILE_REQUIRED=true/u);
  assert.match(source, /mlp_backup_reconcile_helper/u);
  assert.ok(
    source.indexOf('MLP_BACKUP_RECONCILE_REQUIRED=true') <
      source.indexOf('mlp_backup_run_job 2>/dev/null'),
    'the exact helper must be tracked before Compose can start creating it',
  );
  assert.match(source, /trap .*EXIT/u);
  assert.match(source, /name=\^\/\$\{MLP_BACKUP_HELPER_NAME\}\$/u);
  assert.match(source, /com\.mlp\.operation/u);

  const imageBackup = await readRequiredText('infra/backup/backup.sh');
  assert.match(imageBackup, /pg_dump --format=custom --file="\$dump"/u);
  assert.match(imageBackup, /pg_restore --list "\$dump"/u);
  assert.doesNotMatch(imageBackup, /--no-owner|--no-acl/u);
  assert.match(
    imageBackup,
    /mlp-restic backup --json --host mlp-prod[\s\\]+--tag mlp-postgresql/u,
  );
  assert.match(imageBackup, />"\$backup_json" 2>\/dev\/null/u);
  assert.match(
    imageBackup,
    /mlp-restic forget --host mlp-prod --tag mlp-postgresql[\s\\]+--group-by host,tags --keep-daily 30 --prune/u,
  );
  assert.match(
    imageBackup,
    /mlp-restic forget[^\n]+[\s\S]*?>\/dev\/null 2>&1/u,
  );
  assert.match(
    imageBackup,
    /mlp-restic check --read-data-subset=5%[\s\\]+>\/dev\/null 2>&1/u,
  );
  assert.ok(
    imageBackup.indexOf('mlp-restic check') <
      imageBackup.lastIndexOf('cat "$backup_json"'),
    'captured Restic JSON must only be emitted after retention and verification',
  );
});

test('backup image emits only captured JSON after retention and repository checks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mlp-backup-image-'));
  try {
    const bin = path.join(directory, 'bin');
    const script = path.join(directory, 'backup.sh');
    const password = path.join(directory, 'pg-password');
    const trace = path.join(directory, 'trace');
    await mkdir(bin);
    await writeFile(password, 'private-password\n', { mode: 0o600 });
    await writeExecutable(
      path.join(bin, 'pg_dump'),
      `#!/bin/sh
set -eu
for argument do
  case $argument in --file=*) dump=\${argument#--file=} ;; esac
done
: "\${dump:?missing dump}"
: >"$dump"
printf '%s\\n' pg_dump >>"$HARNESS_TRACE"
`,
    );
    await writeExecutable(
      path.join(bin, 'pg_restore'),
      `#!/bin/sh
set -eu
printf '%s\\n' pg_restore >>"$HARNESS_TRACE"
`,
    );
    const otherSnapshotId = 'abcdef0123456789'.repeat(4);
    const restic = path.join(bin, 'mlp-restic');
    await writeExecutable(
      restic,
      `#!/bin/sh
set -eu
command=\${1:?missing command}
shift
printf '%s\\n' "$command" >>"$HARNESS_TRACE"
case $command in
  backup)
    printf '%s\\n' '${JSON.stringify({
      message_type: 'status',
      snapshot_id: otherSnapshotId,
    })}'
    printf '%s\\n' '${JSON.stringify({
      message_type: 'summary',
      snapshot_id: fullSnapshotId,
    })}'
    printf '%s\\n' raw-backup-private-log >&2
    ;;
  forget)
    case " $* " in *' --group-by host,tags '*) : ;; *) exit 91 ;; esac
    printf '%s\\n' raw-forget-private-log
    printf '%s\\n' raw-forget-private-error >&2
    ;;
  check)
    printf '%s\\n' raw-check-private-log
    printf '%s\\n' raw-check-private-error >&2
    exit "\${HARNESS_CHECK_STATUS:-0}"
    ;;
  *) exit 92 ;;
esac
`,
    );
    await writeExecutable(
      path.join(bin, 'cat'),
      `#!/bin/sh
set -eu
printf 'cat:%s\\n' "\${1##*/}" >>"$HARNESS_TRACE"
exec /bin/cat "$@"
`,
    );
    const imageSource = await readRequiredText('infra/backup/backup.sh');
    const patched = imageSource
      .replace('/tmp/mlp-backup.XXXXXX', `${directory}/work.XXXXXX`)
      .replaceAll('/usr/local/bin/mlp-restic', restic);
    assert.notEqual(patched, imageSource);
    await writeExecutable(script, patched);
    const environment = {
      ...process.env,
      HARNESS_TRACE: trace,
      PATH: `${bin}:/usr/bin:/bin`,
      PGDATABASE: 'portfolio',
      PGHOST: 'postgres',
      PGPASSWORD_FILE: password,
      PGPORT: '5432',
      PGUSER: 'portfolio_backup',
    };

    const success = spawnSync('/bin/sh', [script], {
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(success.status, 0, `${success.stdout}${success.stderr}`);
    assert.equal(
      success.stdout,
      [
        JSON.stringify({
          message_type: 'status',
          snapshot_id: otherSnapshotId,
        }),
        JSON.stringify({
          message_type: 'summary',
          snapshot_id: fullSnapshotId,
        }),
        '',
      ].join('\n'),
    );
    assert.equal(success.stderr, '');
    assert.doesNotMatch(success.stdout, /raw-(?:backup|forget|check)-private/u);
    const successTrace = await readFile(trace, 'utf8');
    assert.match(
      successTrace,
      /backup\nforget\ncheck\ncat:restic-backup\.json/u,
    );

    await writeFile(trace, '');
    const failedCheck = spawnSync('/bin/sh', [script], {
      encoding: 'utf8',
      env: { ...environment, HARNESS_CHECK_STATUS: '23' },
    });
    assert.equal(failedCheck.status, 23);
    assert.equal(failedCheck.stdout, '');
    assert.equal(failedCheck.stderr, '');
    assert.doesNotMatch(
      await readFile(trace, 'utf8'),
      /cat:restic-backup\.json/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('successful backup atomically records only redacted exact snapshot metadata', async () => {
  const {
    lastAttempt,
    latestSuccess,
    result,
    temporaryReports,
    trace,
    xtrace,
  } = await runBackupHarness();
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const expected = {
    completedAt: '2026-07-14T20:00:05Z',
    snapshotId: fullSnapshotId,
    startedAt: '2026-07-14T20:00:00Z',
    status: 'passed',
  };
  assert.deepEqual(latestSuccess, expected);
  assert.deepEqual(lastAttempt, expected);
  assert.deepEqual(temporaryReports, []);
  assert.match(xtrace, /fd-preserved/u);
  assert.doesNotMatch(xtrace, /private-path|credential|password/u);
  assert.doesNotMatch(
    JSON.stringify({ lastAttempt, latestSuccess }),
    /private-path|repository|password|credential/u,
  );
  assert.match(
    trace,
    /root\nlock\ndirectory:\/etc\/mlp\/docker-client:0700\ndirectory:\/var\/lib\/mlp\/backup-reports:0700\nobserve:pre:absent[\s\S]*run-job[\s\S]*observe:post:absent/u,
  );
  assert.doesNotMatch(trace, /inventory/u);
  assert.ok(
    trace.indexOf('install:latest-success.json') <
      trace.indexOf('install:last-attempt.json'),
    'the proven snapshot must be persisted before the attempt summary',
  );
});

test('backup job stdout cannot contaminate the machine-readable snapshot ID', async () => {
  const { lastAttempt, latestSuccess, result } = await runBackupHarness({
    jobOutput: [
      JSON.stringify({
        message_type: 'status',
        snapshot_id: 'abcdef0123456789'.repeat(4),
      }),
      JSON.stringify({
        message_type: 'summary',
        snapshot_id: fullSnapshotId,
      }),
    ].join('\n'),
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, 'backup completed\n');
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /message_type|snapshot_id/u,
  );
  assert.equal(latestSuccess?.snapshotId, fullSnapshotId);
  assert.equal(lastAttempt?.snapshotId, fullSnapshotId);
});

test('failed backup updates last-attempt only and never replaces latest-success', async () => {
  const { lastAttempt, latestSuccess, result, trace } = await runBackupHarness({
    jobStatus: 23,
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(lastAttempt, {
    completedAt: '2026-07-14T20:00:05Z',
    startedAt: '2026-07-14T20:00:00Z',
    status: 'failed',
  });
  assert.equal(latestSuccess, undefined);
  assert.doesNotMatch(trace, /install:latest-success\.json/u);
  assert.match(trace, /observe:post:absent/u);
});

test('ambiguous or abbreviated job summary snapshot IDs fail closed', async () => {
  for (const jobOutput of [
    JSON.stringify({
      message_type: 'summary',
      snapshot_id: fullSnapshotId.slice(0, 12),
    }),
    [
      JSON.stringify({
        message_type: 'summary',
        snapshot_id: fullSnapshotId,
      }),
      JSON.stringify({
        message_type: 'summary',
        snapshot_id: 'abcdef0123456789'.repeat(4),
      }),
    ].join('\n'),
  ]) {
    const { lastAttempt, latestSuccess, result } = await runBackupHarness({
      jobOutput,
    });
    assert.notEqual(result.status, 0);
    assert.equal(lastAttempt?.status, 'failed');
    assert.equal(latestSuccess, undefined);
  }
});

test('timeout orphan is removed and absence is proven before failure returns', async () => {
  const { lastAttempt, latestSuccess, result, trace } = await runBackupHarness({
    jobStatus: 124,
    postJobStates: 'present,absent,absent,absent',
  });
  assert.notEqual(result.status, 0);
  assert.equal(lastAttempt?.status, 'failed');
  assert.equal(latestSuccess, undefined);
  assert.match(
    trace,
    /run-job\nobserve:post:present\ninspect\nremove\n(?:pause\n)?observe:post:absent[\s\S]*observe:post:absent[\s\S]*observe:post:absent/u,
  );
  assert.ok(
    trace.lastIndexOf('observe:post:absent') <
      trace.indexOf('install:last-attempt.json'),
    'cleanup proof must finish while the operation lock is still held',
  );
  assert.ok(
    trace.match(/^observe:post:/gmu)?.length >= 30,
    'a timed-out create must remain under observation for the daemon settle window',
  );
});

test('delayed helper appearance resets the stable-absence proof window', async () => {
  const { result, trace } = await runBackupHarness({
    jobStatus: 124,
    postJobStates: 'absent,present,absent,absent,absent',
  });
  assert.notEqual(result.status, 0);
  assert.match(
    trace,
    /observe:post:absent[\s\S]*observe:post:present\ninspect\nremove[\s\S]*observe:post:absent[\s\S]*observe:post:absent[\s\S]*observe:post:absent/u,
  );
});

test('timeout cleanup catches a helper that appears after three empty polls', async () => {
  const { result, trace } = await runBackupHarness({
    jobStatus: 124,
    postJobStates: 'absent,absent,absent,present,absent',
  });
  assert.notEqual(result.status, 0);
  assert.match(
    trace,
    /observe:post:absent[\s\S]*observe:post:absent[\s\S]*observe:post:absent[\s\S]*observe:post:present\ninspect\nremove/u,
  );
  assert.ok(trace.match(/^observe:post:/gmu)?.length >= 30);
});

test('backup preflight observes the full daemon settle window before launch', async () => {
  const { result, trace } = await runBackupHarness();
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.ok(
    trace.match(/^observe:pre:absent$/gmu)?.length >= 30,
    'preflight must not launch during a possible delayed prior create',
  );
  assert.ok(trace.lastIndexOf('observe:pre:absent') < trace.indexOf('run-job'));
});

test('cleanup failure fails closed, records no success, and remains generic', async () => {
  const { lastAttempt, latestSuccess, result, trace } = await runBackupHarness({
    postJobStates: 'present',
    removeStatus: 1,
  });
  assert.notEqual(result.status, 0);
  assert.equal(lastAttempt?.status, 'failed');
  assert.equal(latestSuccess, undefined);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.endsWith('backup failed\n'));
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /helper|container|docker/iu,
  );
  assert.match(trace, /remove/u);
  assert.doesNotMatch(trace, /install:latest-success\.json/u);
});

test('a mismatched helper label is never removed and fails closed', async () => {
  const { lastAttempt, latestSuccess, result, trace } = await runBackupHarness({
    helperLabel: 'foreign-operation',
    postJobStates: 'present',
  });
  assert.notEqual(result.status, 0);
  assert.equal(lastAttempt?.status, 'failed');
  assert.equal(latestSuccess, undefined);
  assert.match(trace, /observe:post:present\ninspect/u);
  assert.doesNotMatch(trace, /remove|install:latest-success\.json/u);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /foreign-operation|helper|container|docker/iu,
  );
});

test('backup systemd schedule is fixed, sandboxed, and secret-free', async () => {
  const service = await readRequiredText('infra/systemd/mlp-db-backup.service');
  const timer = await readRequiredText('infra/systemd/mlp-db-backup.timer');
  assert.match(service, /^Wants=network-online\.target$/mu);
  assert.match(service, /^After=docker\.service network-online\.target$/mu);
  assert.match(service, /^User=root$/mu);
  assert.match(service, /^Group=root$/mu);
  assert.match(service, /^ExecStart=\/usr\/local\/sbin\/mlp-backup$/mu);
  assert.match(service, /^TimeoutStartSec=[1-9][0-9]*(?:min|h)$/mu);
  assert.match(service, /^ProtectSystem=strict$/mu);
  assert.match(service, /^ReadWritePaths=.*\/etc\/mlp\/compose-secrets/mu);
  assert.match(service, /^ReadWritePaths=.*\/var\/lib\/mlp\/backup-reports/mu);
  assert.doesNotMatch(service, /password|token|credential|PGPASSWORD|AWS_/iu);
  assert.match(timer, /^OnCalendar=\*-\*-\* 02:17:00 UTC$/mu);
  assert.match(timer, /^Persistent=true$/mu);
  assert.match(timer, /^RandomizedDelaySec=0$/mu);
});
