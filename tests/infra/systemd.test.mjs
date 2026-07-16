import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const unitDirectory = path.join(repositoryRoot, 'infra/systemd');

const readUnit = (name) => readFile(path.join(unitDirectory, name), 'utf8');

function directives(source, name) {
  return source
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(`${name}=`))
    .map((line) => line.slice(name.length + 1));
}

function oneDirective(source, name) {
  const values = directives(source, name);
  assert.equal(values.length, 1, `${name} must occur exactly once`);
  return values[0];
}

function words(value) {
  return value.trim().split(/\s+/u).filter(Boolean);
}

const serviceContracts = {
  'mlp-db-backup.service': {
    command: '/usr/local/sbin/mlp-backup',
    timeoutStart: '1h',
    requiresDocker: true,
    readOnly: ['/opt/mlp', '/etc/mlp'],
    readWrite: [
      '/run/lock/mlp-operations.lock',
      '/run/docker.sock',
      '/etc/mlp/compose-secrets',
      '/var/lib/mlp/backup-reports',
    ],
  },
  'mlp-db-restore-test.service': {
    command: '/usr/local/sbin/mlp-restore-test',
    timeoutStart: '2h',
    requiresDocker: true,
    readOnly: ['/opt/mlp', '/etc/mlp', '/var/lib/mlp/backup-reports'],
    readWrite: [
      '/run/lock/mlp-operations.lock',
      '/run/docker.sock',
      '/etc/mlp/compose-secrets',
      '/var/lib/mlp/restore-work',
      '/var/lib/mlp/restore-reports',
    ],
  },
  'mlp-platform-health.service': {
    command: '/usr/local/sbin/mlp-status',
    timeoutStart: '90s',
    requiresDocker: false,
    readOnly: [],
    readWrite: [
      '/run/lock/mlp-operations.lock',
      '-/run/docker.sock',
      '/var/lib/mlp/status',
    ],
  },
};

test('oneshot services omit ineffective runtime limits', async () => {
  for (const name of Object.keys(serviceContracts)) {
    const source = await readUnit(name);

    assert.equal(oneDirective(source, 'Type'), 'oneshot', name);
    assert.equal(
      directives(source, 'RuntimeMaxSec').length,
      0,
      `${name}: RuntimeMaxSec is ineffective with Type=oneshot`,
    );
  }
});

test('operations services run fixed root commands inside narrow sandboxes', async () => {
  for (const [name, contract] of Object.entries(serviceContracts)) {
    const source = await readUnit(name);

    assert.equal(oneDirective(source, 'Type'), 'oneshot', name);
    assert.equal(oneDirective(source, 'User'), 'root', name);
    assert.equal(oneDirective(source, 'Group'), 'root', name);
    assert.equal(oneDirective(source, 'UMask'), '0077', name);
    assert.equal(oneDirective(source, 'ExecStart'), contract.command, name);
    assert.equal(
      oneDirective(source, 'TimeoutStartSec'),
      contract.timeoutStart,
      name,
    );

    if (contract.requiresDocker) {
      assert.deepEqual(
        words(oneDirective(source, 'Requires')),
        ['docker.service'],
        name,
      );
    } else {
      assert.deepEqual(
        directives(source, 'Requires'),
        [],
        `${name}: health reporting must not activate Docker`,
      );
    }
    assert.deepEqual(
      words(oneDirective(source, 'Wants')),
      ['network-online.target'],
      name,
    );
    assert.deepEqual(
      words(oneDirective(source, 'After')).sort(),
      ['docker.service', 'network-online.target'],
      name,
    );

    for (const [directive, expected] of Object.entries({
      NoNewPrivileges: 'true',
      PrivateDevices: 'true',
      PrivateTmp: 'true',
      ProtectControlGroups: 'true',
      ProtectClock: 'true',
      ProtectHome: 'true',
      ProtectHostname: 'true',
      ProtectKernelModules: 'true',
      ProtectKernelTunables: 'true',
      ProtectSystem: 'strict',
      LockPersonality: 'true',
      MemoryDenyWriteExecute: 'true',
      RestrictAddressFamilies: 'AF_UNIX',
      RestrictRealtime: 'true',
      RestrictSUIDSGID: 'true',
    })) {
      assert.equal(
        oneDirective(source, directive),
        expected,
        `${name}: ${directive}`,
      );
    }

    assert.deepEqual(
      words(oneDirective(source, 'ReadWritePaths')).sort(),
      [...contract.readWrite].sort(),
      `${name}: writable paths`,
    );
    if (contract.readOnly.length > 0) {
      assert.deepEqual(
        words(oneDirective(source, 'ReadOnlyPaths')).sort(),
        [...contract.readOnly].sort(),
        `${name}: read-only paths`,
      );
    }

    assert.equal(directives(source, 'Environment').length, 0, name);
    assert.equal(directives(source, 'EnvironmentFile').length, 0, name);
    assert.doesNotMatch(
      source,
      /(?:PASSWORD|SECRET|TOKEN|DATABASE_URL|MONGODB_URI)=/u,
      name,
    );
  }
});

const timerContracts = {
  'mlp-db-backup.timer': {
    calendar: '*-*-* 02:17:00 UTC',
    service: 'mlp-db-backup.service',
  },
  'mlp-db-restore-test.timer': {
    calendar: '*-*-01 03:17:00 UTC',
    service: 'mlp-db-restore-test.service',
  },
  'mlp-platform-health.timer': {
    calendar: '*-*-* *:0/5:00 UTC',
    service: 'mlp-platform-health.service',
  },
};

test('operations timers use exact UTC schedules without jitter or secrets', async () => {
  for (const [name, contract] of Object.entries(timerContracts)) {
    const source = await readUnit(name);

    assert.equal(oneDirective(source, 'OnCalendar'), contract.calendar, name);
    assert.equal(oneDirective(source, 'Persistent'), 'true', name);
    assert.equal(oneDirective(source, 'RandomizedDelaySec'), '0', name);
    assert.equal(oneDirective(source, 'AccuracySec'), '1s', name);
    assert.equal(oneDirective(source, 'Unit'), contract.service, name);
    assert.equal(oneDirective(source, 'WantedBy'), 'timers.target', name);
    assert.equal(directives(source, 'Environment').length, 0, name);
    assert.equal(directives(source, 'EnvironmentFile').length, 0, name);
    assert.doesNotMatch(
      source,
      /(?:PASSWORD|SECRET|TOKEN|DATABASE_URL|MONGODB_URI)=/u,
      name,
    );
  }
});
