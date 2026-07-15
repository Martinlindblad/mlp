import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

async function readRequired(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${relativePath}: required Task 10 artifact is missing`);
    }
    throw error;
  }
}

function functionBody(source, name) {
  const body = source.match(
    new RegExp(`^${name}\\(\\)\\s*\\{([\\s\\S]*?)^\\}`, 'mu'),
  )?.[1];
  assert.ok(body, `operations library must define ${name}()`);
  return body;
}

function assertSecureShellBootstrap(source, label) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  assert.equal(lines[0], '#!/bin/bash -p', `${label} must use privileged Bash`);
  assert.equal(lines[1], 'set +x', `${label} must disable tracing first`);
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.doesNotMatch(source, /^(?:set -x|env|printenv)\b/mu);
  assert.doesNotMatch(source, /\b(?:eval|docker restart|compose down)\b/iu);
}

test('shared operations library fixes root validation, the reentrant lock, and atomic writes', async () => {
  const source = await readRequired('ops/lib/operations.sh');
  const metadata = await stat(
    path.join(repositoryRoot, 'ops/lib/operations.sh'),
  );
  assert.notEqual(metadata.mode & 0o111, 0);
  assert.equal(metadata.mode & 0o022, 0);
  assert.equal(source.replaceAll('\r\n', '\n').split('\n')[0], '#!/bin/bash');
  assert.match(
    source,
    /^export PATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/mu,
  );
  assert.doesNotMatch(source, /\$\{(?:PATH|MLP_[A-Z0-9_]*COMMAND)/u);
  assert.doesNotMatch(source, /^\s*(?:eval|source)\s/mu);

  const requireRoot = functionBody(source, 'mlp_require_root');
  assert.match(requireRoot, /(?:EUID|\/usr\/bin\/id -u)/u);
  assert.match(requireRoot, /exit 77/u);

  const lock = functionBody(source, 'mlp_acquire_operations_lock');
  assert.match(lock, /\/run\/lock\/mlp-operations\.lock/u);
  assert.match(lock, /\/proc\/\$\$\/fd\/9/u);
  assert.match(lock, /\/usr\/bin\/readlink/u);
  assert.match(lock, /-L/u);
  assert.match(lock, /\/usr\/bin\/stat/u);
  assert.match(lock, /exec 9<>"\$lock"/u);
  assert.match(lock, /\/usr\/bin\/flock --nonblock 9/u);
  assert.match(lock, /\/usr\/bin\/flock --timeout 30 9/u);

  const requireDirectory = functionBody(source, 'mlp_require_root_directory');
  assert.match(requireDirectory, /-d/u);
  assert.match(requireDirectory, /-L/u);
  assert.match(requireDirectory, /\/usr\/bin\/stat/u);
  assert.match(requireDirectory, /0:0/u);

  const requireFile = functionBody(source, 'mlp_require_root_file');
  assert.match(requireFile, /-f/u);
  assert.match(requireFile, /-L/u);
  assert.match(requireFile, /-s/u);
  assert.match(requireFile, /\/usr\/bin\/stat/u);
  assert.match(requireFile, /0:0/u);

  const atomicJson = functionBody(source, 'mlp_atomic_install_json');
  assert.match(atomicJson, /\/usr\/bin\/jq/u);
  assert.match(atomicJson, /\/usr\/bin\/mktemp/u);
  assert.match(atomicJson, /\/usr\/bin\/install/u);
  assert.match(atomicJson, /\/bin\/mv/u);
  assert.match(atomicJson, /0600/u);

  const atomicEnvironment = functionBody(source, 'mlp_atomic_replace_env');
  assert.match(atomicEnvironment, /\/usr\/bin\/awk/u);
  assert.match(atomicEnvironment, /\/usr\/bin\/mktemp/u);
  assert.match(atomicEnvironment, /\/usr\/bin\/install/u);
  assert.match(atomicEnvironment, /\/bin\/mv/u);
  assert.match(atomicEnvironment, /0600/u);
});

test('platform status checks five services and freshness without recovery side effects', async () => {
  const source = await readRequired('ops/status.sh');
  assertSecureShellBootstrap(source, 'platform status');
  assert.match(source, /^source \/opt\/mlp\/ops\/lib\/operations\.sh$/mu);
  assert.match(source, /^unset "\$\{!DOCKER_@\}"$/mu);
  assert.match(source, /^HOME=\/etc\/mlp$/mu);
  assert.match(source, /^DOCKER_CONFIG=\/etc\/mlp\/docker-client$/mu);
  assert.match(source, /^DOCKER_HOST=unix:\/\/\/run\/docker\.sock$/mu);
  assert.match(source, /^export DOCKER_CONFIG DOCKER_HOST HOME$/mu);
  assert.match(source, /mlp_require_root/u);
  assert.match(source, /mlp_acquire_operations_lock/u);
  assert.match(
    source,
    /permanent_services=\(app caddy cloudflared-a cloudflared-b postgres\)/u,
  );
  assert.match(source, /\/usr\/bin\/docker inspect/u);
  assert.match(source, /\.State\.Health/u);
  assert.match(source, /\.RestartCount/u);
  assert.match(
    source,
    /\/var\/lib\/mlp\/backup-reports\/latest-success\.json/u,
  );
  assert.match(source, /\/var\/lib\/mlp\/backup-reports\/last-attempt\.json/u);
  assert.match(
    source,
    /\/var\/lib\/mlp\/restore-reports\/latest-success\.json/u,
  );
  assert.match(source, /\/bin\/df/u);
  assert.match(source, /\/proc\/meminfo/u);
  assert.match(source, /129600/u, 'backup freshness must be at most 36 hours');
  assert.match(source, /2851200/u, 'restore freshness must be at most 33 days');
  assert.match(source, /disk_used_percent/u);
  assert.match(source, /memory_available_percent/u);
  assert.match(source, /mlp_atomic_install_json/u);
  assert.match(source, /\/var\/lib\/mlp\/status\/latest\.json/u);
  assert.doesNotMatch(
    source,
    /(?:restart|stop|kill|rm|down|up)["' ]+(?:postgres|mlp-prod)/iu,
    'the status check must report only and never recover automatically',
  );
});

test('platform status emits only generic healthy and failed reports under fake probes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-status-test-'));
  const sourcePath = path.join(root, 'status.sh');
  const capturePath = path.join(root, 'latest.json');
  const sentinel = 'contact-person@example.invalid PRIVATE MESSAGE';
  const source = (await readRequired('ops/status.sh')).replace(
    'source /opt/mlp/ops/lib/operations.sh',
    ': # operations library replaced only inside the test fixture',
  );
  await writeFile(sourcePath, source, { encoding: 'utf8', mode: 0o700 });

  const harness = `
source "$1"
mlp_fail() { printf '%s\\n' 'status harness failed' >&2; exit "\${2:-1}"; }
mlp_require_root() { :; }
mlp_acquire_operations_lock() { :; }
mlp_require_root_directory() { :; }
status_now_epoch() { printf '%s\\n' 2000000; }
status_now_iso() { printf '%s\\n' '2030-01-01T00:00:00Z'; }
status_inspect_service() {
  if [[ \${UNHEALTHY:-0} == 1 && "$1" == app ]]; then
    printf '%s\\n' 'exited unhealthy 8'
  else
    printf '%s\\n' 'running healthy 1'
  fi
}
status_snapshot_epoch() {
  case "$1" in
    *backup*) printf '%s\\n' 1996400 ;;
    *) printf '%s\\n' 1913600 ;;
  esac
}
status_last_backup_attempt_passed() { [[ \${FAILED_BACKUP:-0} == 0 ]]; }
status_disk_used_percent() { printf '%s\\n' "\${FAKE_DISK:-42}"; }
status_memory_available_percent() { printf '%s\\n' 60; }
status_new_report() { printf '%s\\n' "$CAPTURE.tmp"; }
status_build_report() {
  printf '{"checkedAt":"%s","status":"%s","checks":{"permanentServices":%s,"unhealthyServices":%s,"restartCount":%s,"backupAgeSeconds":%s,"restoreAgeSeconds":%s,"diskUsedPercent":%s,"memoryAvailablePercent":%s,"lastBackupAttemptPassed":%s}}\\n' \\
    "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9" "\${10}" "\${11}" >"$1"
}
status_publish_report() { /bin/cp "$1" "$CAPTURE"; }
main
`;

  try {
    for (const [label, extraEnvironment, expectedStatus, expectedExit] of [
      ['healthy', {}, 'passed', 0],
      [
        'unhealthy',
        { FAILED_BACKUP: '1', FAKE_DISK: '90', UNHEALTHY: '1' },
        'failed',
        1,
      ],
    ]) {
      const result = spawnSync(
        '/bin/bash',
        ['-p', '-c', harness, `status-${label}`, sourcePath],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ...extraEnvironment,
            CAPTURE: capturePath,
            PII_SENTINEL: sentinel,
          },
          timeout: 10_000,
        },
      );
      assert.equal(result.status, expectedExit, `${label} status exit`);
      assert.doesNotMatch(
        `${result.stdout}${result.stderr}`,
        /PRIVATE MESSAGE/u,
      );
      const report = JSON.parse(await readFile(capturePath, 'utf8'));
      assert.equal(report.status, expectedStatus);
      assert.equal(report.checks.permanentServices, 5);
      assert.equal(JSON.stringify(report).includes(sentinel), false);
      assert.deepEqual(Object.keys(report).sort(), [
        'checkedAt',
        'checks',
        'status',
      ]);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('tmpfiles creates only reviewed root-only state and one operator-owned child', async () => {
  const lines = (await readRequired('infra/tmpfiles.d/mlp.conf'))
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  assert.deepEqual(lines, [
    'f /run/lock/mlp-operations.lock 0600 root root -',
    'd /etc/mlp/compose-secrets 0700 root root -',
    'd /etc/mlp/docker-client 0700 root root -',
    'd /var/lib/mlp 0700 root root -',
    'd /var/lib/mlp/backup-reports 0700 root root -',
    'd /var/lib/mlp/deployment-reports 0700 root root -',
    'd /var/lib/mlp/migration-artifacts 0700 root root -',
    'd /var/lib/mlp/migration-artifacts/operator 0700 1000 1000 -',
    'd /var/lib/mlp/restore-reports 0700 root root -',
    'd /var/lib/mlp/restore-work 0700 root root -',
    'd /var/lib/mlp/status 0700 root root -',
  ]);
});
