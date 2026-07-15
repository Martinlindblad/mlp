import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
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

const dnsScriptRelative = 'scripts/acceptance/dns-authority.sh';
const tunnelScriptRelative = 'scripts/acceptance/tunnel-health.sh';
const runbookRelative = 'runbooks/cloudflare-dns-and-tunnel.md';

async function readRequired(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${relativePath}: required Task 13 artifact is missing`);
    }
    throw error;
  }
}

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, { encoding: 'utf8', mode: 0o700 });
  await chmod(filePath, 0o700);
}

function replaceFixedCommands(source, replacements) {
  let result = source;
  for (const [fixedPath, fixturePath] of replacements) {
    result = result.replaceAll(fixedPath, fixturePath);
  }
  return result;
}

function assertSecureBootstrap(source, label) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  assert.equal(lines[0], '#!/bin/bash -p', `${label} must use privileged Bash`);
  assert.equal(lines[1], 'set +x', `${label} must disable tracing first`);
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /^export LC_ALL=C$/mu);
  assert.match(source, /^trap on_exit EXIT$/mu);
  assert.match(source, /^trap 'exit 129' HUP$/mu);
  assert.match(source, /^trap 'exit 130' INT$/mu);
  assert.match(source, /^trap 'exit 143' TERM$/mu);
  assert.doesNotMatch(source, /^(?:set -x|env|printenv)\b/mu);
  assert.doesNotMatch(source, /^\s*(?:eval|source)\s/mu);
}

const identityAndMetadataStub = `#!/bin/bash
set -Eeuo pipefail
name=\${0##*/}
case "$name" in
  id)
    [[ \${1:-} == -u ]] || exit 64
    printf '0\\n'
    ;;
  stat)
    target=\${@: -1}
    if [[ \${HARNESS_UNSAFE_FILE:-} == "$target" ]]; then
      printf '0:0:644\\n'
    elif [[ -d "$target" ]]; then
      printf '0:0:700\\n'
    else
      printf '0:0:600\\n'
    fi
    ;;
  *) exit 64 ;;
esac
`;

const digStub = `#!/bin/bash
set -Eeuo pipefail
resolver=
for argument in "$@"; do
  case "$argument" in @*) resolver=\${argument#@} ;; esac
done
name=\${@: -2:1}
type=\${@: -1}
printf '%s\\t%s\\t%s\\n' "$resolver" "$name" "$type" >>"$HARNESS_TRACE"

if [[ "$type" == NS ]]; then
  if [[ \${HARNESS_BAD_NS_RESOLVER:-} == "$resolver" ]]; then
    printf 'ns1.vercel-dns.com.\\n'
  elif [[ \${HARNESS_EXTRA_NS_FIELD:-} == "$resolver" ]]; then
    printf 'ada.ns.cloudflare.com. ignored\\nbob.ns.cloudflare.com.\\n'
  else
    printf 'ada.ns.cloudflare.com.\\nbob.ns.cloudflare.com.\\n'
  fi
elif [[ "$type" == SOA ]]; then
  if [[ \${HARNESS_BAD_SOA_RESOLVER:-} == "$resolver" ]]; then
    printf 'ns1.vercel-dns.com. hostmaster.vercel.com. 1 2 3 4 5\\n'
  elif [[ \${HARNESS_EXTRA_SOA_LINE:-} == "$resolver" ]]; then
    printf 'ada.ns.cloudflare.com. dns.cloudflare.com. 1 10000 2400 604800 1800\\nunexpected\\n'
  else
    printf 'ada.ns.cloudflare.com. dns.cloudflare.com. 1 10000 2400 604800 1800\\n'
  fi
elif [[ "$name" == martin-lindblad.com. && "$type" == A ]]; then
  if [[ \${HARNESS_BAD_ORIGIN_RESOLVER:-} == "$resolver" ]]; then
    printf '203.0.113.99\\n'
  elif [[ \${HARNESS_EXTRA_ORIGIN_LINE:-} == "$resolver" ]]; then
    printf '76.76.21.21\\nunexpected warning\\n'
  else
    printf '76.76.21.21\\n'
  fi
elif [[ "$name" == www.martin-lindblad.com. && "$type" == CNAME ]]; then
  printf 'cname.vercel-dns.com.\\n'
else
  exit 65
fi
`;

const dateStub = `#!/bin/bash
set -Eeuo pipefail
[[ "$*" == *+%s* ]] || exit 64
printf '%s\\n' "$HARNESS_NOW"
`;

async function createDnsHarness(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-dns-gate-'));
  const bin = path.join(root, 'bin');
  const runtime = path.join(root, 'runtime');
  const trace = path.join(root, 'dig.trace');
  await Promise.all([
    mkdir(bin, { recursive: true }),
    mkdir(runtime, { recursive: true }),
  ]);

  const expectedNameservers = path.join(runtime, 'cloudflare-nameservers');
  const expectedOrigin = path.join(runtime, 'vercel-origin-records.tsv');
  const inventoryReport = path.join(runtime, 'dns-inventory-comparison.json');
  const stateFile = path.join(runtime, 'cloudflare-authority-start');
  await writeFile(
    expectedNameservers,
    'ada.ns.cloudflare.com.\nbob.ns.cloudflare.com.\n',
    { mode: 0o600 },
  );
  await writeFile(
    expectedOrigin,
    [
      'martin-lindblad.com.\tA\t76.76.21.21',
      'www.martin-lindblad.com.\tCNAME\tcname.vercel-dns.com.',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  await writeFile(
    inventoryReport,
    `${JSON.stringify(
      options.inventoryReport ?? {
        matchedNonNsCount: 12,
        missingMailOrVerificationRecords: [],
        missingNonNsRecords: [],
        sourceNonNsCount: 12,
        status: 'matched',
      },
    )}\n`,
    { mode: 0o600 },
  );
  if (options.state === 'symlink') {
    const victim = path.join(root, 'victim');
    await writeFile(victim, 'do-not-touch\n');
    await symlink(victim, stateFile);
  } else if (options.state !== undefined) {
    await writeFile(stateFile, `${options.state}\n`, { mode: 0o600 });
  }

  const id = path.join(bin, 'id');
  const metadata = path.join(bin, 'stat');
  const dig = path.join(bin, 'dig');
  const date = path.join(bin, 'date');
  await Promise.all([
    writeExecutable(id, identityAndMetadataStub),
    writeExecutable(metadata, identityAndMetadataStub),
    writeExecutable(dig, digStub),
    writeExecutable(date, dateStub),
  ]);

  const productionSource = await readRequired(dnsScriptRelative);
  const source = replaceFixedCommands(productionSource, [
    ['/usr/bin/id', id],
    ['/usr/bin/stat', metadata],
    ['/usr/bin/dig', dig],
    ['/bin/date', date],
  ]);
  const script = path.join(root, 'dns-authority.sh');
  await writeExecutable(script, source);

  return {
    expectedNameservers,
    expectedOrigin,
    inventoryReport,
    root,
    run(extraEnvironment = {}, args = ['martin-lindblad.com']) {
      return spawnSync('/bin/bash', ['-p', script, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          EXPECTED_NS_FILE: expectedNameservers,
          INVENTORY_REPORT_FILE: inventoryReport,
          ORIGIN_EXPECTATIONS_FILE: expectedOrigin,
          STATE_FILE: stateFile,
          HARNESS_NOW: '2000000',
          HARNESS_TRACE: trace,
          ...extraEnvironment,
        },
        timeout: 10_000,
      });
    },
    stateFile,
    trace,
  };
}

test('DNS authority gate is privileged, fixed-command, and executable', async () => {
  const source = await readRequired(dnsScriptRelative);
  const metadata = await stat(path.join(repositoryRoot, dnsScriptRelative));
  assert.notEqual(metadata.mode & 0o111, 0);
  assert.equal(metadata.mode & 0o022, 0);
  assertSecureBootstrap(source, 'DNS authority gate');
  assert.match(source, /1\.1\.1\.1 8\.8\.8\.8 9\.9\.9\.9/u);
  assert.match(source, /172800/u);
  assert.match(source, /exit 75/u);
  assert.match(source, /\/usr\/bin\/dig/u);
  assert.match(source, /\/usr\/bin\/dig -r/u);
  assert.match(source, /\/bin\/date/u);
  assert.match(source, /\/usr\/bin\/mktemp/u);
  assert.doesNotMatch(source, /\$\{(?:DIG|DATE|CURL|COMMAND|PATH)\b/u);
});

test('DNS authority timer starts atomically and opens only after 172800 seconds', async () => {
  const harness = await createDnsHarness();
  try {
    const first = harness.run();
    assert.equal(first.status, 75, `${first.stdout}\n${first.stderr}`);
    assert.match(first.stdout, /authority hold started/iu);
    assert.equal(await readFile(harness.stateFile, 'utf8'), '2000000\n');

    const early = harness.run({ HARNESS_NOW: '2172799' });
    assert.equal(early.status, 75, `${early.stdout}\n${early.stderr}`);
    assert.match(early.stdout, /elapsed 172799 seconds/iu);
    assert.match(early.stdout, /remaining 1 second/iu);

    const complete = harness.run({ HARNESS_NOW: '2172800' });
    assert.equal(complete.status, 0, `${complete.stdout}\n${complete.stderr}`);
    assert.match(
      complete.stdout,
      /authority stable for at least 172800 seconds/iu,
    );

    const queries = await readFile(harness.trace, 'utf8');
    for (const resolver of ['1.1.1.1', '8.8.8.8', '9.9.9.9']) {
      assert.match(
        queries,
        new RegExp(`${resolver}\\tmartin-lindblad\\.com\\.\\tNS`, 'u'),
      );
      assert.match(
        queries,
        new RegExp(`${resolver}\\tmartin-lindblad\\.com\\.\\tSOA`, 'u'),
      );
      assert.match(
        queries,
        new RegExp(`${resolver}\\twww\\.martin-lindblad\\.com\\.\\tCNAME`, 'u'),
      );
    }
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('DNS authority gate fails closed and restarts evidence after any observed mismatch', async (t) => {
  for (const fixture of [
    {
      environment: { HARNESS_BAD_NS_RESOLVER: '8.8.8.8' },
      label: 'delegated nameserver mismatch',
    },
    {
      environment: { HARNESS_EXTRA_NS_FIELD: '8.8.8.8' },
      label: 'ambiguous nameserver answer',
    },
    {
      environment: { HARNESS_BAD_SOA_RESOLVER: '9.9.9.9' },
      label: 'non-Cloudflare SOA',
    },
    {
      environment: { HARNESS_EXTRA_SOA_LINE: '9.9.9.9' },
      label: 'ambiguous multiline SOA answer',
    },
    {
      environment: { HARNESS_BAD_ORIGIN_RESOLVER: '1.1.1.1' },
      label: 'Vercel origin mismatch',
    },
    {
      environment: { HARNESS_EXTRA_ORIGIN_LINE: '1.1.1.1' },
      label: 'ambiguous Vercel origin answer',
    },
    {
      inventoryReport: {
        matchedNonNsCount: 11,
        missingMailOrVerificationRecords: ['_verification TXT'],
        missingNonNsRecords: ['_verification TXT'],
        sourceNonNsCount: 12,
        status: 'incomplete',
      },
      label: 'missing inventory record',
    },
  ]) {
    await t.test(fixture.label, async () => {
      const harness = await createDnsHarness({
        inventoryReport: fixture.inventoryReport,
        state: 1000000,
      });
      try {
        const result = harness.run({
          HARNESS_NOW: '2000000',
          ...fixture.environment,
        });
        assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
        await assert.rejects(readFile(harness.stateFile), { code: 'ENOENT' });
        assert.doesNotMatch(
          `${result.stdout}${result.stderr}`,
          /_verification/u,
        );
      } finally {
        await rm(harness.root, { force: true, recursive: true });
      }
    });
  }
});

test('DNS authority gate rejects unsafe state and invalid invocation without probing', async () => {
  const harness = await createDnsHarness({ state: 'symlink' });
  try {
    const invalidZone = harness.run({}, ['martin-lindblad.com;id']);
    assert.equal(invalidZone.status, 64);
    const symlinkState = harness.run();
    assert.notEqual(symlinkState.status, 0);
    await assert.rejects(readFile(harness.trace), { code: 'ENOENT' });
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('DNS authority gate rejects a multiline state file', async () => {
  const harness = await createDnsHarness({ state: '1000000\n' });
  try {
    const result = harness.run({ HARNESS_NOW: '2000000' });
    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /invalid DNS authority evidence/iu);
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('DNS authority gate rejects nameserver expectation lines with extra fields', async () => {
  const harness = await createDnsHarness({ state: 1000000 });
  try {
    await writeFile(
      harness.expectedNameservers,
      'ada.ns.cloudflare.com. ignored\\nbob.ns.cloudflare.com.\\n',
      { mode: 0o600 },
    );
    const result = harness.run({ HARNESS_NOW: '2000000' });
    assert.equal(result.status, 78, `${result.stdout}\\n${result.stderr}`);
    await assert.rejects(readFile(harness.trace), { code: 'ENOENT' });
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

const dockerStub = `#!/bin/bash
set -Eeuo pipefail
if [[ \${HARNESS_REQUIRE_FIXED_DOCKER_ENV:-no} == yes ]]; then
  if [[ \${DOCKER_HOST:-} != unix:///run/docker.sock ||
    \${DOCKER_CONFIG:-} != "$HARNESS_FIXED_DOCKER_CONFIG" ||
    \${HOME:-} != "$HARNESS_FIXED_HOME" ||
    -n \${DOCKER_CONTEXT+x} || -n \${DOCKER_TLS_VERIFY+x} ]]; then
    exit 97
  fi
fi
printf 'docker' >>"$HARNESS_TRACE"
printf ' %q' "$@" >>"$HARNESS_TRACE"
printf '\\n' >>"$HARNESS_TRACE"

case "\${1:-} \${2:-}" in
  'container ls')
    case \${HARNESS_LOCAL_CONNECTORS:-two} in
      one) printf 'cloudflared-a\\tmlp-prod-cloudflared-a-1\\n' ;;
      three) printf 'cloudflared-a\\tmlp-prod-cloudflared-a-1\\ncloudflared-b\\tmlp-prod-cloudflared-b-1\\ncloudflared-c\\tmlp-prod-cloudflared-c-1\\n' ;;
      *) printf 'cloudflared-a\\tmlp-prod-cloudflared-a-1\\ncloudflared-b\\tmlp-prod-cloudflared-b-1\\n' ;;
    esac
    ;;
  'inspect --format')
    container=\${@: -1}
    if [[ \${HARNESS_UNHEALTHY_CONNECTOR:-} == "$container" ]]; then
      printf 'running unhealthy\\n'
    else
      printf 'running healthy\\n'
    fi
    ;;
  'port mlp-prod-app-1'|'port mlp-prod-caddy-1'|'port mlp-prod-postgres-1')
    if [[ \${HARNESS_PUBLIC_ORIGIN:-} == \${2#mlp-prod-} ]]; then
      printf '3000/tcp -> 0.0.0.0:3000\\n'
    fi
    ;;
  *) exit 64 ;;
esac
`;

const curlStub = `#!/bin/bash
set -Eeuo pipefail
printf 'curl' >>"$HARNESS_TRACE"
printf ' %q' "$@" >>"$HARNESS_TRACE"
printf '\\n' >>"$HARNESS_TRACE"
url= header_file=
previous=
for argument in "$@"; do
  if [[ "$previous" == --header && "$argument" == @* ]]; then
    header_file=\${argument#@}
  fi
  case "$argument" in https://*) url=$argument ;; esac
  previous=$argument
done
[[ -n "$url" ]] || exit 64

case "$url" in
  */configurations)
    if [[ \${HARNESS_BAD_INGRESS:-no} == yes ]]; then
      printf '%s\\n' '{"success":true,"result":{"config":{"ingress":[{"hostname":"martin-lindblad.com","service":"http://caddy:8080"},{"hostname":"migration.martin-lindblad.com","service":"http://caddy:8080"},{"hostname":"www.martin-lindblad.com","service":"http://caddy:8080"},{"service":"http_status:503"}]},"source":"cloudflare"}}'
    elif [[ \${HARNESS_PATH_INGRESS:-no} == yes ]]; then
      printf '%s\\n' '{"success":true,"result":{"config":{"ingress":[{"hostname":"migration.martin-lindblad.com","path":"^/partial$","service":"http://caddy:8080"},{"hostname":"martin-lindblad.com","service":"http://caddy:8080"},{"hostname":"www.martin-lindblad.com","service":"http://caddy:8080"},{"service":"http_status:404"}]},"source":"cloudflare"}}'
    else
      printf '%s\\n' '{"success":true,"result":{"config":{"ingress":[{"hostname":"migration.martin-lindblad.com","service":"http://caddy:8080"},{"hostname":"martin-lindblad.com","service":"http://caddy:8080"},{"hostname":"www.martin-lindblad.com","service":"http://caddy:8080"},{"service":"http_status:404"}]},"source":"cloudflare"}}'
    fi
    ;;
  */connections)
    case \${HARNESS_REMOTE_CONNECTORS:-two} in
      one) printf '%s\\n' '{"success":true,"result":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","conns":[{"is_pending_reconnect":false}]}]}' ;;
      duplicate) printf '%s\\n' '{"success":true,"result":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","conns":[{"is_pending_reconnect":false}]},{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","conns":[{"is_pending_reconnect":false}]}]}' ;;
      *) printf '%s\\n' '{"success":true,"result":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","conns":[{"is_pending_reconnect":false}]},{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","conns":[{"is_pending_reconnect":false}]}]}' ;;
    esac
    ;;
  */cfd_tunnel/*)
    printf '%s\\n' '{"success":true,"result":{"name":"mlp-prod","config_src":"cloudflare","status":"healthy"}}'
    ;;
  https://migration.martin-lindblad.com/api/health/ready)
    if [[ -n "$header_file" ]] && /usr/bin/grep -q '^CF-Access-Client-Id:' "$header_file"; then
      printf '%s' "\${HARNESS_AUTH_STATUS:-200}"
    elif [[ \${HARNESS_ACCESS_REDIRECT:-yes} == yes ]]; then
      printf '%s' '302 https://mlp.cloudflareaccess.com/cdn-cgi/access/login/migration.martin-lindblad.com'
    else
      printf '%s' '200 '
    fi
    ;;
  *) exit 64 ;;
esac
`;

async function createTunnelHarness(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mlp-tunnel-gate-'));
  const bin = path.join(root, 'bin');
  const runtime = path.join(root, 'runtime');
  const secrets = path.join(runtime, 'secrets');
  const trace = path.join(root, 'command.trace');
  await Promise.all([
    mkdir(bin, { recursive: true }),
    mkdir(path.join(runtime, 'docker-client'), { recursive: true }),
    mkdir(secrets, { recursive: true }),
  ]);

  const accountIdFile = path.join(runtime, 'cloudflare-account-id');
  const tunnelIdFile = path.join(runtime, 'cloudflare-tunnel-id');
  const apiTokenFile = path.join(secrets, 'cloudflare-api-read-token');
  const accessIdFile = path.join(secrets, 'cloudflare-access-client-id');
  const accessSecretFile = path.join(
    secrets,
    'cloudflare-access-client-secret',
  );
  const apiToken = 'api-read-token-sentinel';
  const accessId = 'access-id-sentinel';
  const accessSecret = 'access-secret-sentinel';
  await Promise.all([
    writeFile(accountIdFile, `${'a'.repeat(32)}\n`, { mode: 0o600 }),
    writeFile(tunnelIdFile, '11111111-1111-4111-8111-111111111111\n', {
      mode: 0o600,
    }),
    writeFile(apiTokenFile, options.apiTokenContents ?? `${apiToken}\n`, {
      mode: 0o600,
    }),
    writeFile(accessIdFile, options.accessIdContents ?? `${accessId}\n`, {
      mode: 0o600,
    }),
    writeFile(
      accessSecretFile,
      options.accessSecretContents ?? `${accessSecret}\n`,
      { mode: 0o600 },
    ),
  ]);

  const id = path.join(bin, 'id');
  const metadata = path.join(bin, 'stat');
  const docker = path.join(bin, 'docker');
  const curl = path.join(bin, 'curl');
  await Promise.all([
    writeExecutable(id, identityAndMetadataStub),
    writeExecutable(metadata, identityAndMetadataStub),
    writeExecutable(docker, dockerStub),
    writeExecutable(curl, curlStub),
  ]);

  const productionSource = await readRequired(tunnelScriptRelative);
  const source = replaceFixedCommands(productionSource, [
    ['/usr/bin/id', id],
    ['/usr/bin/stat', metadata],
    ['/usr/bin/docker', docker],
    ['/usr/bin/curl', curl],
    ['/etc/mlp', runtime],
  ]);
  const script = path.join(root, 'tunnel-health.sh');
  await writeExecutable(script, source);

  return {
    accessId,
    accessSecret,
    apiToken,
    root,
    runtime,
    run(extraEnvironment = {}, args = []) {
      return spawnSync('/bin/bash', ['-p', script, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CF_ACCESS_CLIENT_ID_FILE: accessIdFile,
          CF_ACCESS_CLIENT_SECRET_FILE: accessSecretFile,
          CLOUDFLARE_ACCOUNT_ID_FILE: accountIdFile,
          CLOUDFLARE_API_TOKEN_FILE: apiTokenFile,
          CLOUDFLARE_TUNNEL_ID_FILE: tunnelIdFile,
          HARNESS_TRACE: trace,
          ...extraEnvironment,
        },
        timeout: 10_000,
      });
    },
    trace,
  };
}

test('tunnel gate is privileged, fixed-command, read-only, and executable', async () => {
  const source = await readRequired(tunnelScriptRelative);
  const metadata = await stat(path.join(repositoryRoot, tunnelScriptRelative));
  assert.notEqual(metadata.mode & 0o111, 0);
  assert.equal(metadata.mode & 0o022, 0);
  assertSecureBootstrap(source, 'tunnel health gate');
  assert.match(source, /mlp-prod-cloudflared-a-1/u);
  assert.match(source, /mlp-prod-cloudflared-b-1/u);
  assert.match(source, /migration\.martin-lindblad\.com/u);
  assert.match(source, /http_status:404/u);
  assert.match(source, /\/usr\/bin\/docker/u);
  assert.match(source, /\/usr\/bin\/curl/u);
  assert.match(source, /\/usr\/bin\/jq/u);
  assert.match(source, /^\s*unset "\$\{!DOCKER_@\}"$/mu);
  assert.match(source, /^\s*DOCKER_HOST=unix:\/\/\/run\/docker[.]sock$/mu);
  assert.match(source, /^\s*DOCKER_CONFIG=\/etc\/mlp\/docker-client$/mu);
  assert.match(source, /CURL_CA_BUNDLE/u);
  assert.match(source, /SSL_CERT_FILE/u);
  assert.doesNotMatch(source, /(?:--request|-X)\s+(?:POST|PUT|PATCH|DELETE)/iu);
  assert.doesNotMatch(source, /\$\{(?:CURL|DOCKER|JQ|COMMAND|PATH)\b/u);
});

test('tunnel gate proves two local and remote connectors plus public Access', async () => {
  const harness = await createTunnelHarness();
  try {
    const result = harness.run();
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, 'tunnel health passed\n');
    const trace = await readFile(harness.trace, 'utf8');
    assert.match(trace, /container ls/u);
    assert.match(trace, /mlp-prod-cloudflared-a-1/u);
    assert.match(trace, /mlp-prod-cloudflared-b-1/u);
    assert.match(trace, /mlp-prod-app-1/u);
    assert.match(trace, /mlp-prod-caddy-1/u);
    assert.match(trace, /mlp-prod-postgres-1/u);
    assert.match(trace, /\/configurations/u);
    assert.match(trace, /\/connections/u);
    assert.doesNotMatch(
      `${trace}${result.stdout}${result.stderr}`,
      new RegExp(
        [harness.apiToken, harness.accessId, harness.accessSecret].join('|'),
        'u',
      ),
    );
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('tunnel gate fails closed on every connector, route, Access, and origin regression', async (t) => {
  for (const fixture of [
    {
      environment: { HARNESS_LOCAL_CONNECTORS: 'one' },
      label: 'one local connector',
    },
    {
      environment: { HARNESS_LOCAL_CONNECTORS: 'three' },
      label: 'three local connectors',
    },
    {
      environment: {
        HARNESS_UNHEALTHY_CONNECTOR: 'mlp-prod-cloudflared-b-1',
      },
      label: 'unhealthy local connector',
    },
    {
      environment: { HARNESS_REMOTE_CONNECTORS: 'one' },
      label: 'one remote connector',
    },
    {
      environment: { HARNESS_REMOTE_CONNECTORS: 'duplicate' },
      label: 'duplicate remote connector identity',
    },
    {
      environment: { HARNESS_BAD_INGRESS: 'yes' },
      label: 'wrong ingress order and catch-all',
    },
    {
      environment: { HARNESS_PATH_INGRESS: 'yes' },
      label: 'path-limited ingress route',
    },
    {
      environment: { HARNESS_ACCESS_REDIRECT: 'no' },
      label: 'missing Access redirect',
    },
    {
      environment: { HARNESS_AUTH_STATUS: '503' },
      label: 'failed authenticated readiness',
    },
    {
      environment: { HARNESS_PUBLIC_ORIGIN: 'app-1' },
      label: 'published origin port',
    },
  ]) {
    await t.test(fixture.label, async () => {
      const harness = await createTunnelHarness();
      try {
        const result = harness.run(fixture.environment);
        assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.doesNotMatch(
          `${await readFile(harness.trace, 'utf8')}${result.stdout}${
            result.stderr
          }`,
          new RegExp(
            [harness.apiToken, harness.accessId, harness.accessSecret].join(
              '|',
            ),
            'u',
          ),
        );
      } finally {
        await rm(harness.root, { force: true, recursive: true });
      }
    });
  }
});

test('tunnel gate rejects arguments before reading credentials', async () => {
  const harness = await createTunnelHarness();
  try {
    const result = harness.run({}, ['--force']);
    assert.equal(result.status, 64);
    await assert.rejects(readFile(harness.trace), { code: 'ENOENT' });
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('tunnel gate pins local Docker and system TLS despite hostile caller environment', async () => {
  const harness = await createTunnelHarness();
  try {
    const result = harness.run({
      CURL_CA_BUNDLE: '/tmp/attacker-ca',
      DOCKER_CONFIG: '/tmp/attacker-docker',
      DOCKER_CONTEXT: 'attacker',
      DOCKER_HOST: 'tcp://attacker.invalid:2375',
      DOCKER_TLS_VERIFY: '1',
      HARNESS_FIXED_DOCKER_CONFIG: path.join(
        harness.root,
        'runtime/docker-client',
      ),
      HARNESS_FIXED_HOME: path.join(harness.root, 'runtime'),
      HARNESS_REQUIRE_FIXED_DOCKER_ENV: 'yes',
      HTTPS_PROXY: 'https://attacker.invalid',
      SSL_CERT_FILE: '/tmp/attacker-cert',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('tunnel gate rejects multiline root credential files before probing', async () => {
  const harness = await createTunnelHarness({
    apiTokenContents: 'api-read-token-sentinel\n\n',
  });
  try {
    const result = harness.run();
    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    await assert.rejects(readFile(harness.trace), { code: 'ENOENT' });
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('tunnel gate rejects an unsafe fixed Docker configuration directory', async () => {
  const harness = await createTunnelHarness();
  try {
    const result = harness.run({
      HARNESS_UNSAFE_FILE: path.join(harness.runtime, 'docker-client'),
    });
    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    await assert.rejects(readFile(harness.trace), { code: 'ENOENT' });
  } finally {
    await rm(harness.root, { force: true, recursive: true });
  }
});

test('Cloudflare runbook preserves Vercel routing until every authority gate passes', async () => {
  const source = await readRequired(runbookRelative);
  assert.match(source, /migration-artifacts\/dns/iu);
  assert.match(source, /Vercel export/iu);
  assert.match(source, /literal tab characters[\s\S]*not[\s\S]*backslash/iu);
  assert.match(source, /independent authoritative `dig`/iu);
  assert.match(source, /apex, subdomain, MX, TXT, CAA,\s+and verification/iu);
  assert.match(source, /redact[\s\S]*verification payload/iu);
  assert.match(source, /missing non-NS record[\s\S]*blocks/iu);
  assert.match(source, /DNS-only/iu);
  assert.match(source, /TTL[\s\S]*300[\s\S]*24 hours/iu);
  assert.match(source, /1\.1\.1\.1[\s\S]*8\.8\.8\.8[\s\S]*9\.9\.9\.9/u);
  assert.match(source, /172800 seconds|48 hours/iu);
  assert.match(source, /exits? 75/iu);
  assert.match(source, /change only the registrar delegation/iu);
  assert.match(source, /Vercel[\s\S]*throughout the hold/iu);
});

test('Cloudflare runbook defines exact remote tunnel, Access, and serial failover gates', async () => {
  const source = await readRequired(runbookRelative);
  assert.match(source, /named\s+exactly `mlp-prod`/iu);
  assert.match(
    source,
    /migration\.martin-lindblad\.com[\s\S]*martin-lindblad\.com[\s\S]*www\.martin-lindblad\.com[\s\S]*http_status:404/iu,
  );
  assert.match(
    source,
    /Access applies only to `migration\.martin-lindblad\.com`/iu,
  );
  assert.match(source, /operator\s+identity/iu);
  assert.match(source, /root:root[\s\S]*0600/iu);
  assert.match(source, /least-privilege[\s\S]*read-only API token/iu);
  assert.match(source, /cloudflared-a[\s\S]*restore[\s\S]*cloudflared-b/iu);
  assert.match(source, /failover[\s\S]*root-only\s+temporary header file/iu);
  assert.match(source, /two distinct[\s\S]*connector/iu);
  assert.match(source, /no app, Caddy, or PostgreSQL host port/iu);
  assert.match(source, /revoke[\s\S]*service token[\s\S]*API token/iu);
  assert.doesNotMatch(
    source,
    /(?:Bearer|Client-Secret:)\s+[A-Za-z0-9._-]{12,}/u,
  );
});
