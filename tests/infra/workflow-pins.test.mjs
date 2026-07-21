import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '../..');
const workflowDirectory = path.join(root, '.github', 'workflows');
const packagePath = path.join(root, 'package.json');
const workflowPaths = {
  ci: path.join(workflowDirectory, 'ci.yml'),
  publish: path.join(workflowDirectory, 'publish-image.yml'),
};

const approvedActions = new Map([
  [
    'actions/attest',
    'a1948c3f048ba23858d222213b7c278aabede763', // v4.1.1
  ],
  [
    'actions/checkout',
    '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0', // v7.0.0
  ],
  [
    'actions/download-artifact',
    '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', // v8.0.1
  ],
  [
    'actions/setup-node',
    '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', // v6.4.0
  ],
  [
    'actions/upload-artifact',
    '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', // v7.0.1
  ],
  [
    'docker/login-action',
    'af1e73f918a031802d376d3c8bbc3fe56130a9b0', // v4.4.0
  ],
  [
    'docker/setup-buildx-action',
    'bb05f3f5519dd87d3ba754cc423b652a5edd6d2c', // v4.2.0
  ],
  [
    'sigstore/cosign-installer',
    '6f9f17788090df1f26f669e9d70d6ae9567deba6', // v4.1.2
  ],
]);

function readYaml(file) {
  return parse(fs.readFileSync(file, 'utf8'));
}

function collectUses(value, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectUses(entry, result);
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'uses') result.push(entry);
      collectUses(entry, result);
    }
  }
  return result;
}

function triggerNames(workflow) {
  return Object.keys(workflow.on ?? {}).sort();
}

function assertPinnedActions(workflow) {
  const uses = collectUses(workflow);
  assert.ok(uses.length > 0, 'workflow must use reviewed actions');
  for (const reference of uses) {
    assert.equal(typeof reference, 'string');
    const match = /^([^@]+)@([0-9a-f]{40})$/.exec(reference);
    assert.ok(
      match,
      `action is not pinned by a full lowercase SHA: ${reference}`,
    );
    assert.equal(
      approvedActions.get(match[1]),
      match[2],
      `action pin is not allowlisted: ${reference}`,
    );
  }
}

function assertSafeWorkflowText(source) {
  for (const forbidden of [
    /pull_request_target/u,
    /workflow_run/u,
    /(?:^|\s)ssh(?:\s|$)/imu,
    /(?:^|\s)scp(?:\s|$)/imu,
    /(?:^|\s)rsync(?:\s|$)/imu,
    /mlp-deploy/u,
    /appleboy\//u,
    /webfactory\/ssh/u,
    /(?:@|:)(?:main|master|latest|v\d+)(?:\s|$)/mu,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
}

function allJobs(workflow) {
  const jobs = Object.values(workflow.jobs ?? {});
  assert.ok(jobs.length > 0, 'workflow must define jobs');
  return jobs;
}

test('CI is pinned, read-only, and proves quality, PostgreSQL, browser, and Linux images', () => {
  const source = fs.readFileSync(workflowPaths.ci, 'utf8');
  const workflow = parse(source);

  assert.deepEqual(triggerNames(workflow), ['pull_request', 'push']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency?.['cancel-in-progress'], true);
  assertSafeWorkflowText(source);
  assertPinnedActions(workflow);

  assert.deepEqual(Object.keys(workflow.jobs ?? {}).sort(), [
    'browser',
    'images',
    'postgres',
    'quality',
  ]);
  for (const job of allJobs(workflow)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
  }

  for (const required of [
    '22.23.1',
    '1.22.22',
    'yarn install --frozen-lockfile',
    'yarn lint',
    'yarn typecheck',
    'yarn migration:typecheck',
    'yarn test:unit',
    'yarn test:integration',
    'yarn test:assets',
    'yarn test:images',
    'yarn test:ops',
    'yarn test:compose',
    'yarn build:production',
    'yarn build:migration',
    'tests/fixtures/seed-postgres.ts',
    'tests/integration/db/e2e-seed.test.ts',
    'yarn playwright install --with-deps chromium',
    'yarn test:e2e',
    'scripts/ci/verify-images.sh',
    'portfolio_migrator',
    'portfolio_app',
    'PGPASSWORD_FILE',
  ]) {
    assert.ok(source.includes(required), `CI omits ${required}`);
  }

  assert.match(source, /actionlint[_-]1\.7\.12/u);
  assert.match(source, /actionlint_1\.7\.12_linux_amd64\.tar\.gz/u);
  assert.doesNotMatch(source, /actionlint_1\.7\.12_linux_x86_64\.tar\.gz/u);
  assert.match(
    source,
    /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/u,
  );
  assert.match(source, /docker-compose-linux-x86_64/u);
  assert.match(
    source,
    /f9ebc6ebdb19d769b793c245a736caaeb198c62587f13b25c660c13b4987f959/u,
  );
  assert.match(source, /caddy_2\.10\.2_linux_amd64\.tar\.gz/u);
  assert.match(
    source,
    /747df7ee74de188485157a383633a1a963fd9233b71fbb4a69ddcbcc589ce4e2cc82dacf5dbbe136cb51d17e14c59daeb5d9bc92487610b0f3b93680b2646546/u,
  );
});

test('ordinary CI explicitly runs the Proxmox and Cloudflare suites', () => {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const workflow = readYaml(workflowPaths.ci);
  const qualityCommands = (workflow.jobs?.quality?.steps ?? []).flatMap(
    (step) =>
      typeof step.run === 'string'
        ? step.run
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter(Boolean)
        : [],
  );

  assert.equal(
    packageJson.scripts?.['test:proxmox'],
    'node --test tests/infra/proxmox.test.mjs',
  );
  assert.equal(
    packageJson.scripts?.['test:cloudflare'],
    'node --test tests/infra/cloudflare-gates.test.mjs',
  );
  assert.equal(
    qualityCommands.filter((command) => command === 'yarn test:proxmox').length,
    1,
  );
  assert.equal(
    qualityCommands.filter((command) => command === 'yarn test:cloudflare')
      .length,
    1,
  );
});

test('manual publication gates all four exact amd64 images before signing and anonymous verification', () => {
  const source = fs.readFileSync(workflowPaths.publish, 'utf8');
  const workflow = parse(source);

  assert.deepEqual(triggerNames(workflow), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, {});
  assertSafeWorkflowText(source);
  assertPinnedActions(workflow);
  assert.deepEqual(Object.keys(workflow.jobs ?? {}).sort(), [
    'build-scan',
    'publish',
    'sign-attest',
    'verify-release',
  ]);
  for (const job of allJobs(workflow)) {
    assert.equal(job['runs-on'], 'ubuntu-24.04');
  }

  assert.deepEqual(workflow.jobs['build-scan'].permissions, {
    contents: 'read',
  });
  assert.deepEqual(workflow.jobs.publish.permissions, {
    packages: 'write',
  });
  assert.deepEqual(workflow.jobs['sign-attest'].permissions, {
    attestations: 'write',
    contents: 'read',
    'id-token': 'write',
    packages: 'write',
  });
  assert.deepEqual(workflow.jobs['verify-release'].permissions, {
    contents: 'read',
  });

  for (const required of [
    'ghcr.io/martinlindblad/mlp',
    'ghcr.io/martinlindblad/mlp-backup',
    'ghcr.io/martinlindblad/mlp-caddy',
    'ghcr.io/martinlindblad/mlp-migration',
    'linux/amd64',
    'COMMIT_SHA',
    'scripts/ci/verify-images.sh',
    'v0.70.0',
    '8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9',
    '--severity HIGH,CRITICAL',
    '--ignore-unfixed=false',
    '--scanners secret',
    '--format spdx-json',
    'cosign sign --yes',
    'cosign verify',
    'gh attestation verify',
    '--predicate-type https://spdx.dev/Document/v2.3',
    'create-storage-record: false',
    'push-to-registry: true',
    'DOCKER_CONFIG',
    '"auths":{}',
  ]) {
    assert.ok(source.includes(required), `publication omits ${required}`);
  }

  assert.match(source, /^\s*environment:\s*production-images\s*$/mu);
  assert.doesNotMatch(source, /continue-on-error/u);
  assert.doesNotMatch(source, /ignore-unfixed:\s*true/u);
  assert.doesNotMatch(source, /COSIGN_(?:KEY|PASSWORD)|cosign\.key/u);
  assert.match(source, /docker push "\$tagged" \| tee/u);
  assert.match(source, /digest: \(sha256:\[0-9a-f\]\{64\}\) size:/u);
  assert.match(
    source,
    /index \.Config\.Labels "org\.opencontainers\.image\.revision"/u,
    'publish metadata inspection must pass literal template quotes to Docker',
  );
  assert.doesNotMatch(
    source,
    /index \.Config\.Labels \\"org\.opencontainers\.image\.revision\\"/u,
    'publish metadata inspection must not pass escaped quotes into the Docker template',
  );
  assert.match(
    source,
    /imagetools inspect "\$\{image\}@\$\{digest\}" --format/u,
  );
  assert.match(
    source,
    /identity='https:\/\/github\.com\/Martinlindblad\/mlp\/\.github\/workflows\/publish-image\.yml@refs\/heads\/main'/u,
    'attestation identity must match the exact GitHub repository casing emitted in certificates',
  );
  assert.match(
    source,
    /--signer-workflow Martinlindblad\/mlp\/\.github\/workflows\/publish-image\.yml/u,
    'attestation signer workflow must match the exact GitHub repository casing',
  );
  assert.doesNotMatch(
    source,
    /identity='https:\/\/github\.com\/martinlindblad\/mlp\/\.github\/workflows\/publish-image\.yml@refs\/heads\/main'/u,
    'attestation identity must not force lowercase repository casing',
  );
  assert.doesNotMatch(source, /imagetools inspect "\$tagged" --format/u);
  assert.match(source, /scan_and_save caddy\b/u);
  assert.match(source, /publish_one caddy "\$CADDY_IMAGE" 65532:65532/u);
  assert.match(
    source,
    /CADDY_DIGEST: \$\{\{ needs\.publish\.outputs\.caddy-digest \}\}/u,
  );
  assert.match(
    source,
    /cosign sign --yes "\$\{CADDY_IMAGE\}@\$\{CADDY_DIGEST\}"/u,
  );
  assert.match(
    source,
    /verify_one "\$\(cat published\/caddy-image-ref\.txt\)"/u,
  );
  assert.match(source, /find production-images -type f \| wc -l\)" -eq 13/u);
});

test('Dependabot covers root and nested npm, actions, and all Dockerfiles', () => {
  const config = readYaml(path.join(root, '.github', 'dependabot.yml'));
  assert.equal(config.version, 2);
  const updates = config.updates ?? [];
  assert.equal(updates.length, 7);
  const actual = updates
    .map((entry) => `${entry['package-ecosystem']}:${entry.directory}`)
    .sort();
  assert.deepEqual(actual, [
    'docker:/',
    'docker:/infra/backup',
    'docker:/infra/caddy',
    'docker:/infra/migration',
    'github-actions:/',
    'npm:/',
    'npm:/infra/migration',
  ]);
  for (const entry of updates) {
    assert.deepEqual(entry.schedule, { day: 'monday', interval: 'weekly' });
    assert.equal(entry['target-branch'], 'main');
    assert.equal(entry['open-pull-requests-limit'], 5);
  }
});

test('browser acceptance starts the production standalone server', () => {
  const source = fs.readFileSync(
    path.join(root, 'playwright.config.ts'),
    'utf8',
  );

  assert.match(source, /\.next\/standalone\/server\.js/u);
  assert.match(source, /cp -R public \.next\/standalone\/public/u);
  assert.match(
    source,
    /cp -R \.next\/static \.next\/standalone\/\.next\/static/u,
  );
  assert.match(source, /HOSTNAME=127\.0\.0\.1 PORT=3000/u);
  assert.doesNotMatch(source, /yarn start/u);
});
