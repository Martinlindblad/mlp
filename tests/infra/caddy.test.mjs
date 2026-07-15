import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const fixtureComposePath = path.join(
  repositoryRoot,
  'tests/infra/fixtures/caddy.compose.yml',
);
const officialCaddyReference =
  'caddy:2.10.2-alpine@sha256:' +
  '4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d';
const nodeReference =
  'node:22.23.1-bookworm-slim@sha256:' +
  '6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
const baseFixtureEnvironment = {
  ...process.env,
  MLP_NODE_IMAGE: nodeReference,
  MLP_REPOSITORY_ROOT: repositoryRoot,
};

async function readRequiredText(relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${relativePath}: required Task 9 artifact is missing`);
    }
    throw error;
  }
}

function activeLines(source) {
  return source
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.replace(/\s+/gu, ' '));
}

function blockLines(source, opener) {
  const lines = activeLines(source);
  const start = lines.indexOf(opener);
  assert.ok(start >= 0, `Caddy policy must define ${opener}`);
  let depth = 0;
  const body = [];

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '{' || line.endsWith(' {')) depth += 1;
    if (line === '}') depth -= 1;
    if (index > start && depth > 0) body.push(line);
    if (index > start && depth === 0) return body;
  }

  assert.fail(`Caddy block ${opener} is not closed`);
}

function requireExactLine(lines, expected, message) {
  assert.equal(lines.filter((line) => line === expected).length, 1, message);
}

function assertLineOrder(lines, orderedLines, message) {
  let previous = -1;
  for (const line of orderedLines) {
    const index = lines.indexOf(line);
    assert.ok(index > previous, `${message}: missing or out of order ${line}`);
    previous = index;
  }
}

function assertNoHsts(...sources) {
  assert.doesNotMatch(
    sources.join('\n'),
    /Strict-Transport-Security/iu,
    'Caddy must not emit HSTS before Cloudflare public TLS verification',
  );
}

function assertCaddyPolicy(source) {
  const lines = activeLines(source);
  assert.deepEqual(blockLines(source, '{'), ['auto_https off', 'admin off']);
  assert.ok(blockLines(source, ':8080 {').includes('route {'));

  const unknownHost =
    '@unknown_host not host martin-lindblad.com www.martin-lindblad.com migration.martin-lindblad.com';
  const missingCloudflare = '@missing_cloudflare not header CF-Connecting-IP *';
  const wwwRedirect = 'redir @www https://martin-lindblad.com{uri} 308';
  const contactModeImport = 'import /etc/caddy/modes/{$CONTACT_MODE}.caddy';
  const boundedContactLength =
    'not header_regexp Content-Length ^(?:0|[1-9][0-9]{0,3}|[12][0-9]{4}|3[01][0-9]{3}|32[0-6][0-9]{2}|327[0-5][0-9]|3276[0-8])$';
  const forwardedNodeMap =
    'map {http.request.header.CF-Connecting-IP} {forwarded_node} {';
  for (const [line, message] of [
    [unknownHost, 'Caddy must use the exact three-host allowlist'],
    ['respond @unknown_host 421', 'unknown Host must return 421'],
    [missingCloudflare, 'known hosts must require CF-Connecting-IP'],
    [
      'respond @missing_cloudflare 403',
      'missing Cloudflare identity must return 403',
    ],
    ['@www host www.martin-lindblad.com', 'www needs an exact host matcher'],
    [wwwRedirect, 'www must redirect path/query to the apex with 308'],
    [contactModeImport, 'contact mode must use the fixed mode directory'],
    ['encode zstd gzip', 'Caddy must support zstd and gzip'],
    [forwardedNodeMap, 'Caddy must render an RFC 7239 forwarding node'],
    ['reverse_proxy app:3000 {', 'Caddy must proxy only to the internal app'],
  ]) {
    requireExactLine(lines, line, message);
  }
  assertLineOrder(
    lines,
    [
      unknownHost,
      'respond @unknown_host 421',
      missingCloudflare,
      'respond @missing_cloudflare 403',
      '@www host www.martin-lindblad.com',
      wwwRedirect,
      contactModeImport,
      '@invalid_contact_length {',
      'respond @invalid_contact_length 413',
      '@contact {',
      'request_body @contact {',
      'header {',
      'header /sw.js Cache-Control "no-cache"',
      'encode zstd gzip',
      forwardedNodeMap,
      'reverse_proxy app:3000 {',
    ],
    'Host rejection, Cloudflare trust, contact policy, and proxying order',
  );

  assert.deepEqual(blockLines(source, '@invalid_contact_length {'), [
    'method POST',
    'path /api/contact/route',
    boundedContactLength,
  ]);
  assert.deepEqual(blockLines(source, '@contact {'), [
    'method POST',
    'path /api/contact/route',
  ]);
  assert.deepEqual(blockLines(source, 'request_body @contact {'), [
    'max_size 32KiB',
  ]);
  assert.deepEqual(blockLines(source, 'header {'), [
    'X-Content-Type-Options nosniff',
    'Referrer-Policy strict-origin-when-cross-origin',
    'X-Frame-Options DENY',
  ]);
  requireExactLine(
    lines,
    'header /sw.js Cache-Control "no-cache"',
    'service worker must always revalidate',
  );
  assert.deepEqual(blockLines(source, forwardedNodeMap), [
    '~^(.+:.+)$ "[${1}]"',
    '~^(.+)$ "${1}"',
  ]);

  assert.deepEqual(blockLines(source, 'transport http {'), [
    'dial_timeout 5s',
    'response_header_timeout 30s',
  ]);
  const proxyLines = blockLines(source, 'reverse_proxy app:3000 {');
  const headerUpLines = proxyLines.filter((line) =>
    line.startsWith('header_up '),
  );
  const expectedHeaderUpLines = [
    'header_up Forwarded "for=\\"{forwarded_node}\\";proto=https"',
    'header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}',
    'header_up X-Real-IP {http.request.header.CF-Connecting-IP}',
    'header_up X-Forwarded-Proto https',
  ];
  assert.deepEqual(
    headerUpLines,
    expectedHeaderUpLines,
    'Caddy must overwrite spoofed forwarding headers with one canonical trusted chain',
  );
  assertNoHsts(source);
}

function assertContactModes(enabledSource, maintenanceSource) {
  assert.deepEqual(
    activeLines(enabledSource),
    [],
    'contact-enabled mode must not intercept any request',
  );
  assert.deepEqual(activeLines(maintenanceSource), [
    '@contact_maintenance {',
    'method POST',
    'path /api/contact/route',
    '}',
    'header @contact_maintenance Retry-After 300',
    'respond @contact_maintenance "Contact form temporarily unavailable" 503',
  ]);
  assertNoHsts(enabledSource, maintenanceSource);
}

function indentation(line) {
  return line.match(/^ */u)?.[0].length ?? 0;
}

function indentedMapping(source, key, expectedIndent) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  assert.equal(
    lines.some((line) => line.includes('\t')),
    false,
    'production Compose must not use ambiguous tab indentation',
  );
  const marker = `${' '.repeat(expectedIndent)}${key}:`;
  const start = lines.findIndex((line) => line === marker);
  assert.ok(start >= 0, `production Compose must define ${key}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue;
    if (indentation(line) <= expectedIndent) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

function yamlListItems(section, itemIndent) {
  const itemPrefix = `${' '.repeat(itemIndent)}-`;
  const lines = section.split('\n');
  const items = [];
  let current = [];
  for (const line of lines) {
    if (line.startsWith(itemPrefix)) {
      if (current.length > 0) items.push(current.join('\n'));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    } else if (line.trim().length > 0 && !line.trimStart().startsWith('#')) {
      assert.fail('Compose list must use auditable block-list syntax');
    }
  }
  if (current.length > 0) items.push(current.join('\n'));
  return items;
}

function assertNoAnonymousCaddyStorage(source) {
  const caddy = indentedMapping(source, 'caddy', 2);
  assert.doesNotMatch(
    caddy,
    /^ {4}(?:ports|expose|network_mode|volumes_from):/mu,
    'Caddy must not publish or bypass its private Compose networks',
  );

  const volumes = indentedMapping(caddy, 'volumes', 4);
  const volumeItems = yamlListItems(volumes, 6);
  assert.equal(
    volumeItems.length,
    1,
    'Caddy must have only its read-only configuration bind mount',
  );
  const [configMount] = volumeItems;
  const shortConfigMount = /^ {6}- \.\/infra\/caddy:\/etc\/caddy:ro\s*$/mu.test(
    configMount,
  );
  const longConfigMount =
    /^ {6}- type: bind\s*$/mu.test(configMount) &&
    /^ {8}source: \.\/infra\/caddy\s*$/mu.test(configMount) &&
    /^ {8}target: \/etc\/caddy\s*$/mu.test(configMount) &&
    /^ {8}read_only: true\s*$/mu.test(configMount);
  assert.ok(
    shortConfigMount || longConfigMount,
    'Caddy configuration must be one explicit read-only bind mount',
  );
  assert.doesNotMatch(
    volumes,
    /(?:target:\s*)?\/(?:config|data|tmp)(?::|\s|$)/u,
    'Caddy writable paths must not be Docker volumes',
  );

  const tmpfs = indentedMapping(caddy, 'tmpfs', 4);
  const targets = yamlListItems(tmpfs, 6)
    .map((item) => item.trim().replace(/^-\s*/u, '').split(':', 1)[0])
    .sort();
  assert.deepEqual(
    targets,
    ['/config', '/data', '/tmp'].sort(),
    'Caddy must override both image volumes and /tmp with explicit tmpfs',
  );
}

const canonicalCaddyPolicy = `{
  auto_https off
  admin off
}

:8080 {
  route {
    @unknown_host not host martin-lindblad.com www.martin-lindblad.com migration.martin-lindblad.com
    respond @unknown_host 421
    @missing_cloudflare not header CF-Connecting-IP *
    respond @missing_cloudflare 403
    @www host www.martin-lindblad.com
    redir @www https://martin-lindblad.com{uri} 308
    import /etc/caddy/modes/{$CONTACT_MODE}.caddy
    @invalid_contact_length {
      method POST
      path /api/contact/route
      not header_regexp Content-Length ^(?:0|[1-9][0-9]{0,3}|[12][0-9]{4}|3[01][0-9]{3}|32[0-6][0-9]{2}|327[0-5][0-9]|3276[0-8])$
    }
    respond @invalid_contact_length 413
    @contact {
      method POST
      path /api/contact/route
    }
    request_body @contact {
      max_size 32KiB
    }
    header {
      X-Content-Type-Options nosniff
      Referrer-Policy strict-origin-when-cross-origin
      X-Frame-Options DENY
    }
    header /sw.js Cache-Control "no-cache"
    encode zstd gzip
    map {http.request.header.CF-Connecting-IP} {forwarded_node} {
      ~^(.+:.+)$ "[\${1}]"
      ~^(.+)$ "\${1}"
    }
    reverse_proxy app:3000 {
      transport http {
        dial_timeout 5s
        response_header_timeout 30s
      }
      header_up Forwarded "for=\\"{forwarded_node}\\";proto=https"
      header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
      header_up X-Real-IP {http.request.header.CF-Connecting-IP}
      header_up X-Forwarded-Proto https
    }
  }
}
`;

const canonicalMaintenanceMode = `@contact_maintenance {
  method POST
  path /api/contact/route
}
header @contact_maintenance Retry-After 300
respond @contact_maintenance "Contact form temporarily unavailable" 503
`;

const canonicalCaddyCompose = `services:
  caddy:
    volumes:
      - ./infra/caddy:/etc/caddy:ro
    tmpfs:
      - /config
      - /data
      - /tmp
  app:
    image: example.invalid/app
`;

test('Caddy validators reject trust, body-limit, maintenance, HSTS, and volume regressions', () => {
  assert.doesNotThrow(() => assertCaddyPolicy(canonicalCaddyPolicy));
  assert.doesNotThrow(() =>
    assertContactModes('# writes remain enabled\n', canonicalMaintenanceMode),
  );
  assert.doesNotThrow(() =>
    assertNoAnonymousCaddyStorage(canonicalCaddyCompose),
  );

  assert.throws(
    () =>
      assertCaddyPolicy(
        canonicalCaddyPolicy.replace(
          '@unknown_host not host martin-lindblad.com www.martin-lindblad.com migration.martin-lindblad.com\n    respond @unknown_host 421\n    @missing_cloudflare not header CF-Connecting-IP *',
          '@missing_cloudflare not header CF-Connecting-IP *\n    @unknown_host not host martin-lindblad.com www.martin-lindblad.com migration.martin-lindblad.com\n    respond @unknown_host 421',
        ),
      ),
    /Host rejection, Cloudflare trust/iu,
  );
  assert.throws(
    () =>
      assertCaddyPolicy(
        canonicalCaddyPolicy.replace(
          'header_up Forwarded "for=\\"{forwarded_node}\\";proto=https"',
          'header_up -Forwarded\n      header_up Forwarded "for=\\"{forwarded_node}\\";proto=https"',
        ),
      ),
    /overwrite spoofed forwarding headers/iu,
  );
  assert.throws(
    () =>
      assertCaddyPolicy(
        canonicalCaddyPolicy.replace(
          'header_up Forwarded "for=\\"{forwarded_node}\\";proto=https"',
          'header_up Forwarded {http.request.header.Forwarded}',
        ),
      ),
    /canonical trusted chain/iu,
  );
  assert.throws(
    () =>
      assertCaddyPolicy(
        canonicalCaddyPolicy.replace('~^(.+:.+)$ "[${1}]"\n', ''),
      ),
    /deep-equal/iu,
  );
  assert.throws(
    () =>
      assertCaddyPolicy(
        canonicalCaddyPolicy.replace('max_size 32KiB', 'max_size 32MiB'),
      ),
    /deep-equal/iu,
  );
  assert.throws(
    () =>
      assertCaddyPolicy(
        canonicalCaddyPolicy.replace(
          'not header_regexp Content-Length ^(?:0|[1-9][0-9]{0,3}|[12][0-9]{4}|3[01][0-9]{3}|32[0-6][0-9]{2}|327[0-5][0-9]|3276[0-8])$',
          'header Content-Length *',
        ),
      ),
    /deep-equal/iu,
  );
  assert.throws(
    () =>
      assertContactModes(
        '',
        canonicalMaintenanceMode.replace(
          'path /api/contact/route',
          'path /api/contact/*',
        ),
      ),
    /deep-equal/iu,
  );
  assert.throws(
    () =>
      assertCaddyPolicy(
        canonicalCaddyPolicy.replace(
          'header /sw.js Cache-Control "no-cache"',
          'header Strict-Transport-Security "max-age=1"\n    header /sw.js Cache-Control "no-cache"',
        ),
      ),
    /HSTS/iu,
  );
  assert.throws(
    () =>
      assertNoAnonymousCaddyStorage(
        canonicalCaddyCompose.replace('      - /data\n', ''),
      ),
    /explicit tmpfs/iu,
  );
  assert.throws(
    () =>
      assertNoAnonymousCaddyStorage(
        canonicalCaddyCompose.replace(
          '      - ./infra/caddy:/etc/caddy:ro',
          '      - ./infra/caddy:/etc/caddy:ro\n      - /data',
        ),
      ),
    /only its read-only configuration bind mount/iu,
  );
  assert.throws(
    () =>
      assertNoAnonymousCaddyStorage(
        canonicalCaddyCompose.replace(
          '  caddy:\n',
          '  caddy:\n    volumes_from: [app]\n',
        ),
      ),
    /private Compose networks/iu,
  );
});

test('production Caddy policy enforces the Cloudflare trust boundary before proxying', async () => {
  const source = await readRequiredText('infra/caddy/Caddyfile');
  assertCaddyPolicy(source);
});

test('contact modes keep maintenance scoped to the exact contact POST and omit HSTS', async () => {
  const [enabled, maintenance] = await Promise.all([
    readRequiredText('infra/caddy/modes/contact-enabled.caddy'),
    readRequiredText('infra/caddy/modes/contact-maintenance.caddy'),
  ]);
  assertContactModes(enabled, maintenance);
});

test('production Caddy service uses explicit tmpfs without anonymous volumes', async () => {
  const source = await readRequiredText('compose.production.yml');
  assertNoAnonymousCaddyStorage(source);
});

async function dockerAvailabilityReason() {
  try {
    await execFile('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    await execFile('docker', ['compose', 'version'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    return undefined;
  } catch {
    return 'Docker daemon/Compose unavailable; mandatory Task 9 Linux runtime gate';
  }
}

async function docker(args, options = {}) {
  return execFile('docker', args, {
    encoding: 'utf8',
    env: baseFixtureEnvironment,
    maxBuffer: 5 * 1024 * 1024,
    timeout: 120_000,
    ...options,
  });
}

const httpClientSource = `
const http = require('node:http');
const input = JSON.parse(process.argv[1]);
const body = input.bodySize ? 'x'.repeat(input.bodySize) : '';
const headers = { ...(input.headers || {}) };
if (body.length > 0 && !input.chunked) {
  headers['content-length'] = Buffer.byteLength(body);
}
const request = http.request({
  hostname: input.hostname,
  port: input.port,
  path: input.path,
  method: input.method || 'GET',
  headers,
}, (response) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => {
    const payload = Buffer.concat(chunks);
    process.stdout.write(JSON.stringify({
      status: response.statusCode,
      headers: response.headers,
      rawHeaders: response.rawHeaders,
      body: payload.toString('utf8'),
      bodyLength: payload.length,
    }));
  });
});
request.setTimeout(5000, () => request.destroy(new Error('request timeout')));
request.on('error', () => process.exit(1));
if (input.chunked && body.length > 0) {
  const split = Math.max(1, Math.floor(body.length / 2));
  request.write(body.slice(0, split));
  request.end(body.slice(split));
} else {
  request.end(body);
}
`;

function fixtureComposeArgs(projectName) {
  return [
    'compose',
    '--project-name',
    projectName,
    '--project-directory',
    repositoryRoot,
    '--file',
    fixtureComposePath,
  ];
}

async function fixtureRequest(composeArgs, options, dockerOptions = {}) {
  const { stdout } = await docker(
    [
      ...composeArgs,
      'exec',
      '-T',
      'app',
      'node',
      '-e',
      httpClientSource,
      JSON.stringify(options),
    ],
    dockerOptions,
  );
  return JSON.parse(stdout);
}

async function waitForFixture(composeArgs, hostname, port, dockerOptions = {}) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fixtureRequest(
        composeArgs,
        {
          headers: {
            host: 'martin-lindblad.com',
            'cf-connecting-ip': '127.0.0.1',
          },
          hostname,
          path: '/api/health/live',
          port,
        },
        dockerOptions,
      );
      if (response.status === 200) return;
    } catch {
      // The bounded retry is expected while the containers start.
    }
    await delay(100, undefined, { signal: dockerOptions.signal });
  }
  assert.fail(`Caddy fixture ${hostname} did not become ready`);
}

async function fixtureState(composeArgs, dockerOptions = {}) {
  const response = await fixtureRequest(
    composeArgs,
    {
      hostname: '127.0.0.1',
      path: '/__fixture/state',
      port: 3000,
    },
    dockerOptions,
  );
  assert.equal(response.status, 200);
  return JSON.parse(response.body);
}

async function assertRequestNeverDelivered(
  composeArgs,
  requestId,
  dockerOptions,
) {
  const deadline = Date.now() + 750;
  do {
    const state = await fixtureState(composeArgs, dockerOptions);
    assert.equal(
      state.some((entry) => entry.headers['x-test-id'] === requestId),
      false,
      `request ${requestId} must not reach the upstream application`,
    );
    await delay(50, undefined, { signal: dockerOptions.signal });
  } while (Date.now() < deadline);
}

async function inspectCaddyMounts(composeArgs, service, dockerOptions = {}) {
  const { stdout: idOutput } = await docker(
    [...composeArgs, 'ps', '--quiet', service],
    dockerOptions,
  );
  const containerId = idOutput.trim();
  assert.match(containerId, /^[0-9a-f]+$/u);
  const { stdout } = await docker(
    ['inspect', '--format', '{{json .Mounts}}', containerId],
    dockerOptions,
  );
  const mounts = JSON.parse(stdout);
  assert.equal(
    mounts.some(({ Type: type }) => type === 'volume'),
    false,
    `${service} must not receive anonymous Docker volumes`,
  );
  const byDestination = new Map(
    mounts.map((mount) => [mount.Destination, mount]),
  );
  for (const destination of ['/config', '/data', '/tmp']) {
    assert.equal(byDestination.get(destination)?.Type, 'tmpfs');
  }
  assert.equal(byDestination.get('/etc/caddy')?.Type, 'bind');
  assert.equal(byDestination.get('/etc/caddy')?.RW, false);
}

test(
  'Linux gate: hardened Caddy runtime enforces routing, headers, body bounds, and maintenance',
  { timeout: 240_000 },
  async (context) => {
    const unavailable = await dockerAvailabilityReason();
    if (unavailable) {
      const continuousIntegration =
        Boolean(process.env.CI) && process.env.CI !== 'false';
      if (
        continuousIntegration ||
        process.env.MLP_REQUIRE_DOCKER_GATES === '1'
      ) {
        assert.fail(unavailable);
      }
      context.skip(unavailable);
      return;
    }

    await Promise.all([
      readRequiredText('infra/caddy/Caddyfile'),
      readRequiredText('infra/caddy/modes/contact-enabled.caddy'),
      readRequiredText('infra/caddy/modes/contact-maintenance.caddy'),
      readRequiredText('compose.production.yml'),
    ]);

    const projectName = `mlp-caddy-${process.pid}-${Date.now()}`;
    const fixtureImage = `mlp-caddy-fixture:${projectName}`;
    const fixtureEnvironment = {
      ...baseFixtureEnvironment,
      MLP_CADDY_IMAGE: fixtureImage,
    };
    const composeArgs = fixtureComposeArgs(projectName);
    const runtimeOptions = { env: fixtureEnvironment, signal: context.signal };
    const runDocker = (args, options = {}) =>
      docker(args, { ...runtimeOptions, ...options });
    const request = (options) =>
      fixtureRequest(composeArgs, options, runtimeOptions);
    const state = () => fixtureState(composeArgs, runtimeOptions);
    let cleaned = false;
    let imageBuilt = false;
    const cleanup = async () => {
      if (cleaned) return;
      await docker(
        [
          ...composeArgs,
          'down',
          '--volumes',
          '--remove-orphans',
          '--timeout',
          '1',
        ],
        { env: fixtureEnvironment, timeout: 30_000 },
      );
      if (imageBuilt) {
        await docker(['image', 'rm', fixtureImage], {
          env: fixtureEnvironment,
          timeout: 30_000,
        });
      }
      cleaned = true;
    };
    context.after(cleanup);

    try {
      await runDocker([...composeArgs, 'config', '--quiet']);
      await runDocker(['pull', '--platform', 'linux/amd64', nodeReference]);
      await runDocker([
        'pull',
        '--platform',
        'linux/amd64',
        officialCaddyReference,
      ]);
      await runDocker([
        'build',
        '--platform',
        'linux/amd64',
        '--build-arg',
        `COMMIT_SHA=${'c'.repeat(40)}`,
        '--tag',
        fixtureImage,
        '--file',
        path.join(repositoryRoot, 'infra/caddy/Dockerfile'),
        repositoryRoot,
      ]);
      imageBuilt = true;
      await runDocker([
        ...composeArgs,
        'run',
        '--rm',
        '--no-deps',
        'caddy-enabled',
        'caddy',
        'validate',
        '--config',
        '/etc/caddy/Caddyfile',
        '--adapter',
        'caddyfile',
      ]);
      await runDocker([...composeArgs, 'up', '--detach']);
      await waitForFixture(composeArgs, 'caddy-enabled', 8080, runtimeOptions);
      await waitForFixture(
        composeArgs,
        'caddy-maintenance',
        8080,
        runtimeOptions,
      );

      await inspectCaddyMounts(composeArgs, 'caddy-enabled', runtimeOptions);
      await inspectCaddyMounts(
        composeArgs,
        'caddy-maintenance',
        runtimeOptions,
      );

      for (const headers of [
        { host: 'unknown.invalid' },
        {
          host: 'unknown.invalid',
          'cf-connecting-ip': '198.51.100.10',
        },
      ]) {
        const unknown = await request({
          headers,
          hostname: 'caddy-enabled',
          path: '/',
          port: 8080,
        });
        assert.equal(unknown.status, 421);
      }

      for (const host of [
        'martin-lindblad.com',
        'www.martin-lindblad.com',
        'migration.martin-lindblad.com',
      ]) {
        const missingCloudflare = await request({
          headers: { host },
          hostname: 'caddy-enabled',
          path: '/',
          port: 8080,
        });
        assert.equal(missingCloudflare.status, 403);
      }

      const redirect = await request({
        headers: {
          host: 'www.martin-lindblad.com',
          'cf-connecting-ip': '198.51.100.10',
        },
        hostname: 'caddy-enabled',
        path: '/path?q=1',
        port: 8080,
      });
      assert.equal(redirect.status, 308);
      assert.equal(
        redirect.headers.location,
        'https://martin-lindblad.com/path?q=1',
      );

      const trustedAddress = '203.0.113.24';
      for (const [address, forwardedNode] of [
        [trustedAddress, trustedAddress],
        ['2001:db8::1234', '[2001:db8::1234]'],
      ]) {
        const proxied = await request({
          headers: {
            host: 'migration.martin-lindblad.com',
            'cf-connecting-ip': address,
            forwarded: 'for=192.0.2.1;proto=http',
            'x-forwarded-for': '192.0.2.2, 192.0.2.3',
            'x-forwarded-proto': 'http',
            'x-real-ip': '192.0.2.4',
            'x-test-id': `trusted-header-replacement-${address}`,
          },
          hostname: 'caddy-enabled',
          path: '/headers',
          port: 8080,
        });
        assert.equal(proxied.status, 200);
        const proxiedBody = JSON.parse(proxied.body);
        assert.equal(
          proxiedBody.headers.forwarded,
          `for="${forwardedNode}";proto=https`,
        );
        assert.equal(proxiedBody.headers['x-forwarded-for'], address);
        assert.equal(proxiedBody.headers['x-real-ip'], address);
        assert.equal(proxiedBody.headers['x-forwarded-proto'], 'https');
        assert.equal(
          proxied.rawHeaders.filter(
            (value) => value.toLowerCase() === 'x-forwarded-for',
          ).length,
          0,
          'response must not leak request forwarding headers',
        );
        assert.equal(proxied.headers['x-content-type-options'], 'nosniff');
        assert.equal(
          proxied.headers['referrer-policy'],
          'strict-origin-when-cross-origin',
        );
        assert.equal(proxied.headers['x-frame-options'], 'DENY');
        assert.equal(proxied.headers['strict-transport-security'], undefined);
      }

      const serviceWorker = await request({
        headers: {
          host: 'martin-lindblad.com',
          'cf-connecting-ip': trustedAddress,
        },
        hostname: 'caddy-enabled',
        path: '/sw.js',
        port: 8080,
      });
      assert.equal(serviceWorker.status, 200);
      assert.equal(serviceWorker.headers['cache-control'], 'no-cache');

      for (const encoding of ['gzip', 'zstd']) {
        const encoded = await request({
          headers: {
            host: 'martin-lindblad.com',
            'accept-encoding': encoding,
            'cf-connecting-ip': trustedAddress,
          },
          hostname: 'caddy-enabled',
          path: '/large',
          port: 8080,
        });
        assert.equal(encoded.status, 200);
        assert.equal(encoded.headers['content-encoding'], encoding);
      }

      for (const [requestId, chunked] of [
        ['oversized-contact-content-length', false],
        ['oversized-contact-chunked', true],
      ]) {
        const oversized = await request({
          bodySize: 32 * 1024 + 1,
          chunked,
          headers: {
            host: 'martin-lindblad.com',
            'cf-connecting-ip': trustedAddress,
            'content-type': 'application/octet-stream',
            'x-test-id': requestId,
          },
          hostname: 'caddy-enabled',
          method: 'POST',
          path: '/api/contact/route',
          port: 8080,
        });
        assert.equal(oversized.status, 413);
        await assertRequestNeverDelivered(
          composeArgs,
          requestId,
          runtimeOptions,
        );
      }

      const chunkedWithoutLengthId = 'chunked-contact-without-length';
      const chunkedWithoutLength = await request({
        bodySize: 16,
        chunked: true,
        headers: {
          host: 'martin-lindblad.com',
          'cf-connecting-ip': trustedAddress,
          'content-type': 'application/octet-stream',
          'x-test-id': chunkedWithoutLengthId,
        },
        hostname: 'caddy-enabled',
        method: 'POST',
        path: '/api/contact/route',
        port: 8080,
      });
      assert.equal(
        chunkedWithoutLength.status,
        413,
        'contact requests without a canonical Content-Length must be rejected',
      );
      await assertRequestNeverDelivered(
        composeArgs,
        chunkedWithoutLengthId,
        runtimeOptions,
      );

      const boundaryRequestId = 'bounded-contact';
      const boundary = await request({
        bodySize: 32 * 1024,
        headers: {
          host: 'martin-lindblad.com',
          'cf-connecting-ip': trustedAddress,
          'content-type': 'application/octet-stream',
          'x-test-id': boundaryRequestId,
        },
        hostname: 'caddy-enabled',
        method: 'POST',
        path: '/api/contact/route',
        port: 8080,
      });
      assert.equal(boundary.status, 200);
      assert.ok(
        (await state()).some(
          (entry) =>
            entry.headers['x-test-id'] === boundaryRequestId &&
            entry.bodyLength === 32 * 1024 &&
            entry.complete === true &&
            entry.aborted === false,
        ),
      );

      const maintenanceRequestId = 'maintenance-contact';
      const maintenance = await request({
        bodySize: 16,
        headers: {
          host: 'martin-lindblad.com',
          'cf-connecting-ip': trustedAddress,
          'x-test-id': maintenanceRequestId,
        },
        hostname: 'caddy-maintenance',
        method: 'POST',
        path: '/api/contact/route',
        port: 8080,
      });
      assert.equal(maintenance.status, 503);
      assert.equal(maintenance.headers['retry-after'], '300');
      assert.equal(maintenance.headers['strict-transport-security'], undefined);
      await assertRequestNeverDelivered(
        composeArgs,
        maintenanceRequestId,
        runtimeOptions,
      );

      for (const request of [
        { method: 'GET', path: '/api/contact/route' },
        { method: 'POST', path: '/api/contact/route/extra' },
        { method: 'GET', path: '/api/projects_and_cases/route' },
      ]) {
        const response = await request({
          headers: {
            host: 'martin-lindblad.com',
            'cf-connecting-ip': trustedAddress,
          },
          hostname: 'caddy-maintenance',
          port: 8080,
          ...request,
        });
        assert.equal(
          response.status,
          200,
          `maintenance must not block ${request.method} ${request.path}`,
        );
      }
    } finally {
      await cleanup();
    }
  },
);
