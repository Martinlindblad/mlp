import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const runbookRelativePath = 'runbooks/rehearsal-and-cutover.md';
const smokeRelativePath = 'scripts/acceptance/production-smoke.sh';
const redactionRelativePath = 'scripts/acceptance/log-redaction.sh';

async function readRequired(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${relativePath}: required Task 14 artifact is missing`);
    }
    throw error;
  }
}

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

function assertOrdered(source, gates) {
  let cursor = 0;
  for (const [label, pattern] of gates) {
    const match = pattern.exec(source.slice(cursor));
    assert.ok(match, `cutover runbook must contain ordered gate: ${label}`);
    cursor += (match.index ?? 0) + match[0].length;
  }
}

test('runbook makes every rehearsal and cutover gate ordered and explicit', async () => {
  const source = await readRequired(runbookRelativePath);

  assertOrdered(source, [
    ['encrypted source archive', /^### Gate 1: Encrypted source archive$/imu],
    ['source inventory', /^### Gate 2: Source inventory$/imu],
    ['strict full rehearsal', /^### Gate 3: Strict full rehearsal$/imu],
    [
      'off-VM backup and restore',
      /^### Gate 4: Off-VM backup and isolated restore$/imu,
    ],
    [
      '48-hour DNS authority proof',
      /^### Gate 5: 48-hour DNS authority proof$/imu,
    ],
    ['24-hour TTL-300 proof', /^### Gate 6: 24-hour TTL-300 proof$/imu],
    ['migration-host checks', /^### Gate 7: Migration-host checks$/imu],
    [
      'content preload and hash match',
      /^### Gate 8: Content preload and hash match$/imu,
    ],
    ['maintenance enable', /^### Gate 9: Enable contact maintenance$/imu],
    [
      'apex and www tunnel switch',
      /^### Gate 10: Switch apex and `www` to the tunnel$/imu,
    ],
    ['300-second wait', /^### Gate 11: Wait one 300-second TTL$/imu],
    [
      'Vercel traffic stop',
      /^### Gate 12: Confirm Vercel traffic has stopped$/imu,
    ],
    [
      'final contact transaction and hash match',
      /^### Gate 13: Final contact transaction and hash match$/imu,
    ],
    [
      'internal synthetic insert and delete',
      /^### Gate 14: Internal synthetic insert and delete$/imu,
    ],
    ['contact enable', /^### Gate 15: Enable contact writes$/imu],
    [
      'public synthetic insert and delete commit point',
      /^### Gate 16: Public synthetic insert and delete — PostgreSQL write commit point$/imu,
    ],
    ['HSTS enable', /^### Gate 17: Enable HSTS$/imu],
    ['24-hour observation', /^### Gate 18: 24-hour acceptance observation$/imu],
  ]);
});

test('runbook binds rehearsal to strict migration and redacted evidence contracts', async () => {
  const source = await readRequired(runbookRelativePath);

  assert.match(
    source,
    /temporary Atlas user[\s\S]*read-only[\s\S]*`mlp_db` database/iu,
  );
  assert.match(source, /MONGO_URI_FILE[\s\S]*root-readable/iu);
  assert.match(source, /MongoDB Database Tools[\s\S]*100\.17\.0/iu);
  assert.match(source, /mongodump --version[\s\S]*100\.17\.0/iu);
  assert.match(source, /\bage\b/iu);
  assert.match(source, /no source writes/iu);
  assert.match(source, /portfolio_rehearsal/u);
  assert.match(source, /Kysely migrations twice/iu);
  assert.match(source, /all ten collections[\s\S]*one transaction/iu);
  assert.match(source, /source-key inventory[\s\S]*allowed-key/iu);
  assert.match(
    source,
    /counts[\s\S]*sorted IDs[\s\S]*timestamps[\s\S]*canonical hashes/iu,
  );
  assert.match(source, /repository integration tests/iu);
  assert.match(source, /Playwright/iu);
  assert.match(
    source,
    /encrypted archive[\s\S]*redacted reports[\s\S]*off-VM/iu,
  );
  assert.match(
    source,
    /verify[\s\S]*hashes[\s\S]*drop[\s\S]*portfolio_rehearsal/iu,
  );
  assert.match(source, /PII[\s\S]*blocks cutover/iu);

  for (const command of [
    '/usr/local/sbin/mlp-migration export',
    '/usr/local/sbin/mlp-migration rehearsal',
    '/usr/local/sbin/mlp-migration preload',
    '/usr/local/sbin/mlp-migration contacts',
    '/usr/local/sbin/mlp-migration remove-synthetic',
    '/usr/local/sbin/mlp-backup',
    '/usr/local/sbin/mlp-restore-test',
    '/usr/local/sbin/mlp-contact-mode maintenance',
    '/usr/local/sbin/mlp-contact-mode enabled',
    'scripts/acceptance/production-smoke.sh',
    'scripts/acceptance/log-redaction.sh --since 24h',
  ]) {
    assert.ok(source.includes(command), `runbook must use ${command}`);
  }
  assert.match(
    source,
    /\/usr\/local\/sbin\/mlp-compose exec -T -e[\s\S]*\bapp\s+node -e/iu,
  );
  assert.doesNotMatch(source, /\bsudo\s+docker\b/iu);

  assert.doesNotMatch(source, /mongodb(?:\+srv)?:\/\/[^\s`]+/iu);
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\/[^\s`]+/iu);
  assert.doesNotMatch(source, /(?:password|token)\s*=\s*["'][^"'$]+["']/iu);
});

test('runbook requires the reviewed atomic contact finalizer before Gate 14', async () => {
  const source = await readRequired(runbookRelativePath);

  assert.match(
    source,
    /If final contact import and all\s+verification are not inside the same\s+rollback-capable\s+transaction,\s+cutover\s+completion must not be declared/iu,
  );
  assert.match(
    source,
    /reviewed `finalizeContactSnapshot\(\)`[\s\S]*serializable[\s\S]*PostgreSQL 18\.4 integration\s+test[\s\S]*mismatch[\s\S]*rolls back inserted rows[\s\S]*do not proceed to Gate 14/iu,
  );
  assert.doesNotMatch(
    source,
    /current `importSnapshot\(\)` commits before\s+`verifySnapshot\(\)`/iu,
  );
  assert.match(
    source,
    /If Gate 13 fails[\s\S]*atomic transaction[\s\S]*rolled back[\s\S]*If a later pre-write gate fails after Gate 13 succeeded[\s\S]*leave the verified\s+PostgreSQL rows intact[\s\S]*idempotently/iu,
  );
  assert.doesNotMatch(
    source,
    /Roll back the uncommitted PostgreSQL contact import transaction/iu,
  );
});

test('runbook has a timed pre-write rollback branch and a one-way commit point', async () => {
  const source = await readRequired(runbookRelativePath);
  const rollbackIndex = source.indexOf('## Pre-write rollback branch');
  const commitIndex = source.indexOf('POSTGRESQL_WRITE_COMMIT_POINT');
  const postCommitIndex = source.indexOf('## Post-commit recovery boundary');

  assert.ok(rollbackIndex >= 0, 'pre-write rollback branch is required');
  assert.ok(
    commitIndex > rollbackIndex,
    'rollback branch must precede commit point',
  );
  assert.ok(
    postCommitIndex > commitIndex,
    'post-commit recovery boundary must follow commit point',
  );
  assert.match(source, /UTC[\s\S]*CUTOVER_STARTED_AT_EPOCH/iu);
  assert.match(source, /maintenance_window_seconds[\s\S]*<= 1800/iu);
  assert.match(source, /abort[\s\S]*before[\s\S]*contact writes are enabled/iu);
  assert.match(source, /authority[\s\S]*>= 172800/iu);
  assert.match(
    source,
    /ORIGIN_EXPECTATIONS_FILE=\/etc\/mlp\/vercel-origin-records\.tsv/u,
  );
  assert.match(
    source,
    /INVENTORY_REPORT_FILE=\/var\/lib\/mlp\/dns-inventory-comparison\.json/u,
  );
  assert.match(source, /authority stable for at least 172800 seconds/u);
  assert.match(
    source,
    /resolver,\s+SOA,\s+origin,\s+or inventory mismatch[\s\S]*removes the state file[\s\S]*new 172800-second hold/iu,
  );
  assert.match(source, /TTL[\s\S]*>= 86400/iu);
  assert.match(source, /\.name == "mlp-prod"/u);
  assert.match(source, /\^\[0-9a-f-\]\{36\}\$/u);
  assert.match(source, /prior[\s\S]*apex[\s\S]*`www`[\s\S]*record JSON/iu);
  assert.match(source, /503[\s\S]*Retry-After: 300[\s\S]*contact POST/iu);
  assert.match(source, /restore[\s\S]*Vercel[\s\S]*contact writes/iu);
  assert.match(
    source,
    /Gate 13 fails[\s\S]*atomic transaction[\s\S]*rolled back/iu,
  );
  assert.match(
    source,
    /later pre-write gate fails after Gate 13 succeeded[\s\S]*PostgreSQL rows intact/iu,
  );
  assert.match(source, /without modifying or deleting Atlas/iu);

  const postCommit = source.slice(postCommitIndex);
  assert.match(postCommit, /rollback to stale MongoDB\/Vercel is forbidden/iu);
  assert.match(postCommit, /PostgreSQL restore or a forward fix/iu);
  assert.doesNotMatch(postCommit, /restore[^\n]*DNS[^\n]*Vercel/iu);

  for (const evidence of [
    'dns_authority_seconds >= 172800',
    'maintenance_window_seconds <= 1800',
    'source_destination_collections = 10',
    'source_destination_mismatches = 0',
    'tunnel_connectors_healthy = 2',
    'backup = passed',
    'isolated_restore = passed',
    'observation_seconds >= 86400',
    'unexpected_errors = 0',
    'pii_log_matches = 0',
  ]) {
    assert.ok(
      source.includes(evidence),
      `runbook evidence missing: ${evidence}`,
    );
  }
});

const fakeSmokeCommands = String.raw`#!/bin/bash
set -Eeuo pipefail
name=$(/usr/bin/basename "$0")
printf '%s' "$name" >>"$HARNESS_TRACE"
printf ' %q' "$@" >>"$HARNESS_TRACE"
printf '\n' >>"$HARNESS_TRACE"
case "$name" in
  curl)
    url=
    for argument in "$@"; do
      case "$argument" in https://*) url=$argument ;; esac
    done
    [[ -n "$url" ]] || exit 64
    if [[ "$url" == 'https://www.martin-lindblad.com/path?q=1' ]]; then
      printf 'HTTP/2 308\r\nlocation: https://martin-lindblad.com/path?q=1\r\n\r\n'
    elif [[ "$*" == *'%{http_code}'* ]]; then
      if [[ "$*" == *'Range: bytes=0-1023'* ]]; then
        printf '206'
      elif [[ -n "$HARNESS_FAIL_PATH" && "$url" == *"$HARNESS_FAIL_PATH" ]]; then
        printf '500'
      else
        printf '200'
      fi
    elif [[ "$url" == */manifest.json ]]; then
      printf '%s\n' '{"icons":[{"src":"/favicon.ico"}]}'
    elif [[ "$url" == */api/* ]]; then
      if [[ -n "$HARNESS_NON_ARRAY_PATH" && "$url" == *"$HARNESS_NON_ARRAY_PATH" ]]; then
        printf '%s\n' '{}'
      else
        printf '%s\n' '[]'
      fi
    fi
    ;;
  jq)
    input=$(/bin/cat)
    case "$*" in
      *'type == "array"'*) [[ "$input" == '[]' ]] ;;
      *'.icons | length > 0'*) [[ "$input" == *'"icons":['* ]] ;;
      *) exit 64 ;;
    esac
    ;;
  *) exit 64 ;;
esac
`;

async function runProductionSmoke(args = [], extraEnvironment = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-smoke-test-'));
  const bin = path.join(root, 'bin');
  const trace = path.join(root, 'trace');
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(bin, { recursive: true }),
  );
  for (const command of ['curl', 'jq']) {
    await writeExecutable(path.join(bin, command), fakeSmokeCommands);
  }
  try {
    const result = spawnSync(
      '/bin/bash',
      [path.join(repositoryRoot, smokeRelativePath), ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HARNESS_FAIL_PATH: '',
          HARNESS_NON_ARRAY_PATH: '',
          HARNESS_TRACE: trace,
          PATH: `${bin}:/usr/bin:/bin`,
          ...extraEnvironment,
        },
        timeout: 10_000,
      },
    );
    let commands = '';
    try {
      commands = await readFile(trace, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return { commands, result };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test('production smoke is executable, strict, and allowlists only reviewed origins', async () => {
  const source = await readRequired(smokeRelativePath);
  const metadata = await stat(path.join(repositoryRoot, smokeRelativePath));

  assert.equal(source.split(/\r?\n/u)[0], '#!/usr/bin/env bash');
  assert.notEqual(metadata.mode & 0o111, 0);
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /https:\/\/martin-lindblad\.com/u);
  assert.match(source, /https:\/\/migration\.martin-lindblad\.com/u);
  assert.doesNotMatch(source, /\bcurl\b[^\n]*\s-k(?:\s|$)/u);
  assert.doesNotMatch(source, /\beval\b/u);

  const invalid = await runProductionSmoke(['https://attacker.invalid']);
  assert.equal(invalid.result.status, 64);
  assert.equal(invalid.commands, '');

  const extra = await runProductionSmoke([
    'https://martin-lindblad.com',
    'https://attacker.invalid',
  ]);
  assert.equal(extra.result.status, 64);
  assert.equal(extra.commands, '');
});

test('production smoke checks pages, array APIs, redirect, range request, and manifest', async () => {
  const { commands, result } = await runProductionSmoke();

  assert.equal(result.status, 0, `${result.stderr}\n${commands}`);
  assert.equal(result.stdout, 'production smoke passed\n');
  for (const route of [
    '/',
    '/about',
    '/experience',
    '/showcases',
    '/cases',
    '/contact',
    '/api/health/live',
    '/api/health/ready',
    '/api/about',
    '/api/introduction',
    '/api/currentOccupation',
    '/api/languages',
    '/api/list',
    '/api/pageCards',
    '/api/professionalTimeline',
    '/api/projectsAndCases',
    '/api/pursuit',
    '/api/socialmedia',
    '/assets/man.mp4',
    '/manifest.json',
  ]) {
    assert.ok(commands.includes(route), `smoke command missing ${route}`);
  }
  assert.match(commands, /Range:\\ bytes=0-1023/u);
  assert.ok(commands.includes('%\\{http_code\\}'));
  assert.ok(commands.includes('https://www.martin-lindblad.com/path\\?q=1'));

  const failedPage = await runProductionSmoke([], {
    HARNESS_FAIL_PATH: '/api/health/ready',
  });
  assert.notEqual(failedPage.result.status, 0);
  assert.match(failedPage.result.stderr, /\/api\/health\/ready returned 500/u);

  const failedShape = await runProductionSmoke([], {
    HARNESS_NON_ARRAY_PATH: '/api/languages',
  });
  assert.notEqual(failedShape.result.status, 0);
});

const fakeCompose = String.raw`#!/bin/bash
set -Eeuo pipefail
printf '%q ' "$@" >"$HARNESS_COMPOSE_TRACE"
printf '\n' >>"$HARNESS_COMPOSE_TRACE"
[[ "$1" == logs ]]
/bin/cat "$HARNESS_LOG_FIXTURE"
`;

async function runLogRedaction(logs, args = ['--since', '1h']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-redaction-test-'));
  const compose = path.join(root, 'mlp-compose');
  const fixture = path.join(root, 'logs');
  const script = path.join(root, 'log-redaction.sh');
  const trace = path.join(root, 'trace');
  const source = await readRequired(redactionRelativePath);
  const replaced = source.replaceAll('/usr/local/sbin/mlp-compose', compose);
  assert.notEqual(
    replaced,
    source,
    'redaction script must use fixed Compose wrapper',
  );
  await Promise.all([
    writeExecutable(compose, fakeCompose),
    writeExecutable(script, replaced),
    writeFile(fixture, logs, { mode: 0o600 }),
  ]);
  try {
    const harness = String.raw`source "$1"
require_root() { :; }
shift
main "$@"
`;
    const result = spawnSync(
      '/bin/bash',
      [
        '--noprofile',
        '--norc',
        '-c',
        harness,
        'redaction-harness',
        script,
        ...args,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HARNESS_COMPOSE_TRACE: trace,
          HARNESS_LOG_FIXTURE: fixture,
          PII_SENTINEL: 'inherited-secret-must-not-print',
        },
        timeout: 10_000,
      },
    );
    let composeArguments = '';
    try {
      composeArguments = await readFile(trace, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return { composeArguments, result };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test('log redaction is a fixed root-only bounded Compose inspection', async () => {
  const source = await readRequired(redactionRelativePath);
  const metadata = await stat(path.join(repositoryRoot, redactionRelativePath));

  assert.equal(source.split(/\r?\n/u)[0], '#!/bin/bash -p');
  assert.equal(source.split(/\r?\n/u)[1], 'set +x');
  assert.notEqual(metadata.mode & 0o111, 0);
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /\brequire_root\b/u);
  assert.match(source, /\/usr\/local\/sbin\/mlp-compose/u);
  assert.match(source, /--since/u);
  assert.match(source, /^\s*trap 'exit 129' HUP$/mu);
  assert.match(source, /^\s*trap 'exit 130' INT$/mu);
  assert.match(source, /^\s*trap 'exit 143' TERM$/mu);
  assert.doesNotMatch(source, /\beval\b|^(?:set -x|env|printenv)\b/mu);

  const invalid = await runLogRedaction('', ['--since', '25h']);
  assert.equal(invalid.result.status, 64);
  assert.equal(invalid.composeArguments, '');

  const unbounded = await runLogRedaction('', ['--since', 'all']);
  assert.equal(unbounded.result.status, 64);
  assert.equal(unbounded.composeArguments, '');
});

test('log redaction reports only per-service counts for a clean window', async () => {
  const logs = [
    'mlp-prod-app-1  | 2026-07-15T00:00:00Z request completed',
    'mlp-prod-caddy-1  | 2026-07-15T00:00:01Z handled request',
    'mlp-prod-cloudflared-a-1  | 2026-07-15T00:00:02Z connected',
    'mlp-prod-cloudflared-b-1  | 2026-07-15T00:00:03Z connected',
    'mlp-prod-postgres-1  | 2026-07-15T00:00:04Z checkpoint complete',
  ].join('\n');
  const { composeArguments, result } = await runLogRedaction(`${logs}\n`);

  assert.equal(result.status, 0, result.stderr);
  assert.match(composeArguments, /^logs --since 1h --no-color --timestamps /u);
  for (const service of [
    'app',
    'postgres',
    'migrator',
    'caddy',
    'cloudflared-a',
    'cloudflared-b',
    'db-backup',
  ]) {
    assert.match(
      result.stdout,
      new RegExp(`^${service} log_lines=\\d+$`, 'mu'),
    );
    assert.ok(composeArguments.includes(service));
  }
  assert.match(result.stdout, /^log redaction passed$/mu);
  assert.doesNotMatch(result.stdout, /request completed|checkpoint complete/u);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /inherited-secret-must-not-print/u,
  );
});

test('log redaction fails generically without echoing any sensitive match', async (t) => {
  const cases = [
    ['email address', 'user@example.invalid'],
    ['fullName JSON key', '{"fullName":"Private Person"}'],
    ['email JSON key', '{"email":"private value"}'],
    ['subject JSON key', '{"subject":"private value"}'],
    ['message JSON key', '{"message":"private value"}'],
    ['credential URI', 'postgres://portfolio:private@postgres/portfolio'],
    ['Atlas variable', 'NEXT_ATLAS_URI=private'],
    ['PostgreSQL password variable', 'PGPASSWORD=private'],
    ['tunnel token variable', 'CLOUDFLARE_TUNNEL_TOKEN=private'],
    [
      'encoded tunnel token',
      'eyJhbGciOiJub25lIn0eyJ0dW5uZWwiOiJwcml2YXRlLXRva2VuLXZhbHVlIn0',
    ],
    ['request stack trace', '    at contactHandler (/app/server.js:42:7)'],
    ['bare request stack trace', '    at /app/server.js:42:7'],
  ];

  for (const [label, sentinel] of cases) {
    await t.test(label, async () => {
      const { result } = await runLogRedaction(
        `mlp-prod-app-1  | 2026-07-15T00:00:00Z ${sentinel}\n`,
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^log redaction failed$/mu);
      assert.doesNotMatch(
        `${result.stdout}${result.stderr}`,
        new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      );
      assert.match(result.stdout, /^app log_lines=1$/mu);
    });
  }
});
