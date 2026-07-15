import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const scriptPath = path.join(repositoryRoot, 'ops/contact-mode.sh');

async function readRequiredScript() {
  try {
    return await readFile(scriptPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT')
      assert.fail('ops/contact-mode.sh is required');
    throw error;
  }
}

function body(source, name) {
  const match = source.match(
    new RegExp(`^${name}\\(\\)\\s*\\{([\\s\\S]*?)^\\}`, 'mu'),
  );
  assert.ok(match, `contact-mode must define ${name}()`);
  return match[1];
}

function probeProgram(source) {
  const match = body(source, 'probe_contact_mode').match(
    /read -r -d '' probe <<'JS' \|\| true\n([\s\S]*?)\nJS/u,
  );
  assert.ok(match, 'contact-mode must embed a fixed Node probe');
  return match[1];
}

async function runProbe(program, host, port, expected) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', program, host, String(port), expected],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('contact probe test timed out'));
    }, 5_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ signal, status, stderr, stdout });
    });
  });
}

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

const operationsStub = `#!/bin/bash
set -Eeuo pipefail
mlp_require_root() { printf 'root\\n' >>"$HARNESS_TRACE"; [[ \${HARNESS_ROOT:-yes} == yes ]] || return 77; }
mlp_acquire_operations_lock() { printf 'lock\\n' >>"$HARNESS_TRACE"; [[ \${HARNESS_LOCK_FAIL:-no} != yes ]] || return 75; }
mlp_require_root_directory() { printf 'dir %s %s\\n' "$1" "$2" >>"$HARNESS_TRACE"; }
mlp_require_root_file() { printf 'file %s %s\\n' "$1" "$2" >>"$HARNESS_TRACE"; }
mlp_atomic_replace_env() {
  file=$1 key=$2 value=$3
  printf 'persist %s\\n' "$value" >>"$HARNESS_TRACE"
  if [[ \${HARNESS_PERSIST_FAIL_ONCE:-no} == yes && ! -e "$HARNESS_STATE/persist-failed" && "$value" != "$HARNESS_PRIOR_MODE" ]]; then
    : >"$HARNESS_STATE/persist-failed"
    return 1
  fi
  tmp="$file.tmp"
  /usr/bin/awk -v key="$key" -v value="$value" 'BEGIN{done=0} index($0,key "=")==1 {print key "=" value; done=1; next} {print} END{if(!done) print key "=" value}' "$file" >"$tmp"
  /bin/mv -f "$tmp" "$file"
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
case "$name" in
  timeout)
    while [[ \${1:-} == --* ]]; do
      if [[ $1 == --kill-after=* || $1 == --foreground ]]; then shift; else break; fi
    done
    shift
    exec "$@"
    ;;
  mlp-compose)
    mode=$(/usr/bin/sed -n 's/^APP_CONTACT_MODE=//p' "$HARNESS_APP_ENV")
    previous_mode=$(<"$HARNESS_STATE/caddy-mode")
    if [[ \${HARNESS_LATE_TARGET_DURING_ROLLBACK:-no} == yes &&
      "$mode" == "$HARNESS_PRIOR_MODE" && "$previous_mode" != "$HARNESS_PRIOR_MODE" ]]; then
      printf '%s\\n' "$previous_mode" >"$HARNESS_STATE/late-target-mode"
      : >"$HARNESS_STATE/rollback-active"
    fi
    printf '%s\\n' "$mode" >"$HARNESS_STATE/caddy-mode"
    if [[ \${HARNESS_RECREATE_FAIL_ONCE:-no} == yes && ! -e "$HARNESS_STATE/recreate-failed" ]]; then
      : >"$HARNESS_STATE/recreate-failed"
      exit 1
    fi
    ;;
  docker)
    if [[ \${1:-} == inspect ]]; then
      format=
      previous=
      for argument in "$@"; do
        [[ "$previous" == --format ]] && format=$argument
        previous=$argument
      done
      container=\${@: -1}
      mode=$(<"$HARNESS_STATE/caddy-mode")
      health=healthy
      [[ "$container" != mlp-prod-app-1 || \${HARNESS_APP_UNHEALTHY:-no} != yes ]] || health=unhealthy
      case "$format" in
        '{{.State.Status}}|{{.State.Health.Status}}') printf 'running|%s\\n' "$health" ;;
        '{{range .Config.Env}}{{println .}}{{end}}') printf 'CONTACT_MODE=%s\\n' "$mode" ;;
        '{{.State.Health.Status}}') printf '%s\\n' "$health" ;;
        *) exit 64 ;;
      esac
      exit 0
    fi
    if [[ \${1:-} == exec ]]; then
      expected=\${@: -1}
      actual=$(<"$HARNESS_STATE/caddy-mode")
      if [[ \${HARNESS_PROBE_FAIL_ONCE:-no} == yes && ! -e "$HARNESS_STATE/probe-failed" && "$actual" != "$HARNESS_PRIOR_MODE" ]]; then
        : >"$HARNESS_STATE/probe-failed"
        exit 1
      fi
      matched=false
      [[ "$actual" == "$expected" ]] && matched=true
      if [[ "$matched" == true &&
        \${HARNESS_LATE_TARGET_DURING_ROLLBACK:-no} == yes &&
        -e "$HARNESS_STATE/rollback-active" &&
        ! -e "$HARNESS_STATE/late-target-fired" &&
        "$actual" == "$HARNESS_PRIOR_MODE" ]]; then
        : >"$HARNESS_STATE/late-target-fired"
        /bin/cp "$HARNESS_STATE/late-target-mode" "$HARNESS_STATE/caddy-mode"
        printf 'late target %s\\n' "$(<"$HARNESS_STATE/caddy-mode")" >>"$HARNESS_TRACE"
      fi
      [[ "$matched" == true ]]
      exit
    fi
    exit 64
    ;;
  sleep) exit 0 ;;
  *) exit 64 ;;
esac
`;

async function createHarness(source, options = {}) {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'mlp-contact-mode-'));
  const bin = path.join(sandbox, 'bin');
  const runtime = path.join(sandbox, 'etc', 'mlp');
  const state = path.join(sandbox, 'state');
  const trace = path.join(sandbox, 'trace');
  const priorMode = options.priorMode ?? 'contact-maintenance';
  await Promise.all([
    mkdir(bin, { recursive: true }),
    mkdir(path.join(runtime, 'env'), { recursive: true }),
    mkdir(state, { recursive: true }),
  ]);
  const appEnv = path.join(runtime, 'env/app.env');
  await writeFile(appEnv, `APP_CONTACT_MODE=${priorMode}\nAPP_IMAGE=fixture\n`);
  await writeFile(
    path.join(state, 'caddy-mode'),
    `${options.caddyMode ?? priorMode}\n`,
  );
  const operations = path.join(sandbox, 'operations.sh');
  await writeExecutable(operations, operationsStub);
  for (const name of ['docker', 'mlp-compose', 'sleep', 'timeout']) {
    await writeExecutable(path.join(bin, name), commandStub);
  }
  const replacements = [
    ['/opt/mlp/ops/lib/operations.sh', operations],
    ['/usr/local/sbin/mlp-compose', path.join(bin, 'mlp-compose')],
    ['/usr/bin/docker', path.join(bin, 'docker')],
    ['/usr/bin/timeout', path.join(bin, 'timeout')],
    ['/bin/sleep', path.join(bin, 'sleep')],
    ['/etc/mlp', runtime],
  ];
  let harnessSource = source;
  for (const [from, to] of replacements) {
    assert.ok(
      harnessSource.includes(from),
      `harness replacement missing: ${from}`,
    );
    harnessSource = harnessSource.replaceAll(from, to);
  }
  const harnessScript = path.join(sandbox, 'contact-mode.sh');
  await writeExecutable(harnessScript, harnessSource);
  return {
    appEnv,
    environment: {
      ...process.env,
      HARNESS_APP_ENV: appEnv,
      HARNESS_FIXED_DOCKER_CONFIG: path.join(runtime, 'docker-client'),
      HARNESS_FIXED_HOME: runtime,
      HARNESS_PRIOR_MODE: priorMode,
      HARNESS_ROOT: options.root ?? 'yes',
      HARNESS_STATE: state,
      HARNESS_TRACE: trace,
      MLP_SECRET_SENTINEL: 'contact-secret-must-not-leak',
      ...options.environment,
    },
    sandbox,
    script: harnessScript,
    state,
    trace,
  };
}

function runHarness(harness, mode) {
  return spawnSync('/bin/bash', [harness.script, ...(mode ? [mode] : [])], {
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

test('contact mode is a fixed root-only, locked operation', async () => {
  const source = await readRequiredScript();
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  assert.equal(lines[0], '#!/bin/bash -p');
  assert.equal(lines[1], 'set +x');
  assert.match(source, /^set -Eeuo pipefail$/mu);
  assert.match(source, /^umask 077$/mu);
  assert.match(source, /^PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/mu);
  assert.match(source, /^source \/opt\/mlp\/ops\/lib\/operations\.sh$/mu);
  assert.match(source, /\$\{!DOCKER_@\}/u);
  assert.ok(
    source.indexOf('source /opt/mlp/ops/lib/operations.sh') <
      source.indexOf('for variable in "${!DOCKER_@}"'),
  );
  assert.match(source, /^HOME=\/etc\/mlp$/mu);
  assert.match(source, /^DOCKER_CONFIG=\/etc\/mlp\/docker-client$/mu);
  assert.match(source, /^DOCKER_HOST=unix:\/\/\/run\/docker\.sock$/mu);
  assert.match(source, /mlp_require_root/u);
  assert.match(source, /mlp_acquire_operations_lock/u);
  assert.match(source, /mlp_require_root_directory \/etc\/mlp 0700/u);
  assert.match(source, /mlp_require_root_file \/etc\/mlp\/env\/app\.env 0600/u);
  assert.doesNotMatch(source, /\b(?:eval|command -v|sudo|docker compose)\b/u);
  assert.doesNotMatch(
    source,
    /\$\{?(?:PATH|DOCKER_HOST|COMPOSE_FILE|MLP_[A-Z_]*COMMAND)/u,
  );
});

test('contact mode pins the local Docker socket and removes caller Docker configuration', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: {
      DOCKER_CONFIG: '/tmp/hostile-docker-config',
      DOCKER_CONTEXT: 'hostile-context',
      DOCKER_HOST: 'tcp://attacker.invalid:2375',
      DOCKER_TLS_VERIFY: '1',
      HARNESS_REQUIRE_FIXED_DOCKER_ENV: 'yes',
      HOME: '/tmp/hostile-home',
    },
    priorMode: 'contact-enabled',
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, 'enabled');
  assert.equal(result.status, 0, result.stderr);
});

test('contact probe sends the public Host while connecting directly to Caddy', async (t) => {
  const source = await readRequiredScript();
  const probe = body(source, 'probe_contact_mode');
  const program = probeProgram(source);
  assert.match(program, /node:http/u);
  assert.match(program, /http\.request/u);
  assert.doesNotMatch(program, /\bfetch\s*\(/u);
  assert.match(program, /statusCode\s*===\s*503/u);
  assert.match(probe, /retry-after/u);
  assert.match(probe, /['"]300['"]/u);
  assert.match(program, /statusCode\s*===\s*400/u);
  assert.match(probe, /CF-Connecting-IP/u);
  assert.match(probe, /Content-Type/u);

  let observed;
  const server = createServer((request, response) => {
    let requestBody = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      requestBody += chunk;
    });
    request.on('end', () => {
      observed = {
        body: requestBody,
        connectingIp: request.headers['cf-connecting-ip'],
        host: request.headers.host,
        method: request.method,
        url: request.url,
      };
      response.writeHead(503, { 'Retry-After': '300' });
      response.end();
    });
  });
  t.after(() => server.close());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const result = await runProbe(
    program,
    '127.0.0.1',
    address.port,
    'contact-maintenance',
  );
  assert.deepEqual(result, { signal: null, status: 0, stderr: '', stdout: '' });
  assert.deepEqual(observed, {
    body: '{}',
    connectingIp: '127.0.0.1',
    host: 'martin-lindblad.com',
    method: 'POST',
    url: '/api/contact/route',
  });
});

test('enabling waits for app readiness and recreates only Caddy', async () => {
  const source = await readRequiredScript();
  const switchBody = body(source, 'switch_contact_mode');
  const bounded = body(source, 'run_bounded');
  const readiness = switchBody.indexOf('require_app_ready');
  const persist = switchBody.indexOf('mlp_atomic_replace_env');
  assert.ok(readiness >= 0 && persist > readiness);
  assert.doesNotMatch(
    bounded,
    /--foreground/u,
    "bounded non-interactive commands must run in timeout's isolated process group",
  );
  assert.match(bounded, /--kill-after=5s/u);
  assert.match(source, /--no-deps --force-recreate caddy/u);
  assert.doesNotMatch(
    source,
    /force-recreate[^\n]*(?:app|cloudflared)|(?:app|cloudflared)[^\n]*force-recreate/u,
  );
});

test('enabled switch persists, recreates only Caddy, and verifies 400 mode', async (t) => {
  const harness = await createHarness(await readRequiredScript());
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, 'enabled');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /contact-secret-must-not-leak/u,
  );
  const trace = await traceOf(harness);
  assert.match(trace, /docker inspect .*mlp-prod-app-1/u);
  assert.match(trace, /persist contact-enabled/u);
  assert.match(trace, /mlp-compose up -d --no-deps --force-recreate caddy/u);
  assert.doesNotMatch(trace, /force-recreate (?:app|cloudflared)/u);
  assert.match(trace, /docker exec .*contact-enabled/u);
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    /APP_CONTACT_MODE=contact-enabled/u,
  );
});

test('maintenance switch verifies 503 with Retry-After semantics', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    priorMode: 'contact-enabled',
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, 'maintenance');
  assert.equal(result.status, 0, result.stderr);
  const trace = await traceOf(harness);
  assert.match(trace, /persist contact-maintenance/u);
  assert.match(trace, /docker exec .*contact-maintenance/u);
});

test('an already verified target mode is an idempotent no-op', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    priorMode: 'contact-enabled',
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, 'enabled');
  assert.equal(result.status, 0, result.stderr);
  const trace = await traceOf(harness);
  assert.doesNotMatch(trace, /persist |mlp-compose/u);
  assert.match(trace, /docker exec .*contact-enabled/u);
});

test('probe or recreate failure restores prior env and Caddy mode', async (t) => {
  for (const environment of [
    { HARNESS_PROBE_FAIL_ONCE: 'yes' },
    { HARNESS_RECREATE_FAIL_ONCE: 'yes' },
  ]) {
    const harness = await createHarness(await readRequiredScript(), {
      environment,
      priorMode: 'contact-maintenance',
    });
    t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
    const result = runHarness(harness, 'enabled');
    assert.notEqual(result.status, 0);
    const trace = await traceOf(harness);
    assert.match(trace, /persist contact-enabled/u);
    assert.match(trace, /persist contact-maintenance/u);
    assert.match(
      await readFile(harness.appEnv, 'utf8'),
      /APP_CONTACT_MODE=contact-maintenance/u,
    );
    assert.equal(
      (await readFile(path.join(harness.state, 'caddy-mode'), 'utf8')).trim(),
      'contact-maintenance',
    );
  }
});

test('rollback reconciles a target Caddy that appears after the first prior-mode proof', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: {
      HARNESS_LATE_TARGET_DURING_ROLLBACK: 'yes',
      HARNESS_PROBE_FAIL_ONCE: 'yes',
    },
    priorMode: 'contact-maintenance',
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, 'enabled');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /prior mode restored/u);
  const trace = await traceOf(harness);
  assert.match(trace, /late target contact-enabled/u);
  assert.ok(
    trace.match(/mlp-compose up -d --no-deps --force-recreate caddy/gmu)
      ?.length >= 3,
    'target create plus at least two prior-mode reconciliations are required',
  );
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    /APP_CONTACT_MODE=contact-maintenance/u,
  );
  assert.equal(
    (await readFile(path.join(harness.state, 'caddy-mode'), 'utf8')).trim(),
    'contact-maintenance',
  );
});

test('atomic persistence failure still performs verified prior-mode restoration', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: { HARNESS_PERSIST_FAIL_ONCE: 'yes' },
    priorMode: 'contact-maintenance',
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, 'enabled');
  assert.notEqual(result.status, 0);
  const trace = await traceOf(harness);
  assert.match(trace, /persist contact-enabled/u);
  assert.match(trace, /persist contact-maintenance/u);
  assert.match(trace, /mlp-compose up -d --no-deps --force-recreate caddy/u);
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    /APP_CONTACT_MODE=contact-maintenance/u,
  );
  assert.equal(
    (await readFile(path.join(harness.state, 'caddy-mode'), 'utf8')).trim(),
    'contact-maintenance',
  );
});

test('mismatched initial Caddy mode fails closed before mutation', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    caddyMode: 'contact-enabled',
    priorMode: 'contact-maintenance',
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, 'maintenance');
  assert.notEqual(result.status, 0);
  const trace = await traceOf(harness);
  assert.doesNotMatch(trace, /persist |mlp-compose/u);
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    /APP_CONTACT_MODE=contact-maintenance/u,
  );
});

test('unready app blocks re-enable before config mutation', async (t) => {
  const harness = await createHarness(await readRequiredScript(), {
    environment: { HARNESS_APP_UNHEALTHY: 'yes' },
  });
  t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
  const result = runHarness(harness, 'enabled');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(await traceOf(harness), /persist |mlp-compose/u);
  assert.match(
    await readFile(harness.appEnv, 'utf8'),
    /APP_CONTACT_MODE=contact-maintenance/u,
  );
});

test('contact mode rejects non-root and every non-allowlisted invocation', async (t) => {
  const source = await readRequiredScript();
  for (const [options, args] of [
    [{ root: 'no' }, ['enabled']],
    [{}, []],
    [{}, ['on']],
    [{}, ['enabled', 'extra']],
  ]) {
    const harness = await createHarness(source, options);
    t.after(() => rm(harness.sandbox, { recursive: true, force: true }));
    const result = spawnSync('/bin/bash', [harness.script, ...args], {
      encoding: 'utf8',
      env: harness.environment,
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(await traceOf(harness), /persist |mlp-compose/u);
  }
});
