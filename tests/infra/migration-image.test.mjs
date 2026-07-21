import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertDockerignoreContract,
  assertExactFinalCopies,
  assertExecutableRegularFile,
  assertFixedRuntimeUserAndRootCopies,
  assertLiteralDigestBases,
  assertNoFinalCopyAll,
  assertNoSecretDockerMetadata,
  assertOciRevisionMetadata,
  assertOrdered,
  assertPosixScript,
  assertWholePublicTreeCopy,
  dockerStages,
  finalDockerStage,
  logicalDockerLines,
  parseDockerTransfer,
  readRequiredJson,
  readRequiredText,
} from './docker-contract-helpers.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const execFile = promisify(execFileCallback);
const literalFixtureDigest = '0123456789abcdef'.repeat(4);
const nodeTag = 'node:22.23.1-bookworm-slim';
const nodeReference =
  `${nodeTag}@sha256:` +
  '6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
const distrolessNodeTag = 'gcr.io/distroless/nodejs22-debian13:nonroot';
const distrolessNodeReference =
  `${distrolessNodeTag}@sha256:` +
  'a2723a2817c5b01b8e7b98d567bc8b5a6b0e713e25bfb0a82b6ade4b9db06f50';
const busyboxTag = 'busybox:1.37.0-musl';
const busyboxReference =
  `${busyboxTag}@sha256:` +
  '222ad6d973c0d198014546a65cd02c5fdedcc172123c5b4c2bf0af636550bd94';
const resticReference =
  'restic/restic:0.19.1@sha256:' +
  '136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510';
const golangReference =
  'golang:1.26.5-alpine@sha256:' +
  '0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2';
const mongoToolsUrl =
  'https://github.com/mongodb/mongo-tools/archive/refs/tags/100.17.0.tar.gz';
const mongoToolsSha256 =
  '27d00697a7715443912ce0c76f11e760cfec450a885ac18b499412d4097eeab2';
const mongoToolsGitCommit = 'b414a2d909375f76e2c36fef91d1e3804b6b2c02';

async function assertPosixSyntax(relativePath) {
  await execFile('/bin/sh', ['-n', path.join(repositoryRoot, relativePath)], {
    encoding: 'utf8',
  });
}

async function assertDispatcherExit(relativePath, args, expectedCode = 64) {
  const output = await execFile(
    '/bin/sh',
    [path.join(repositoryRoot, relativePath), ...args],
    {
      env: {
        ...process.env,
        MONGO_URI_FILE: 'TASK8_DISPATCH_SECRET_SENTINEL',
      },
    },
  ).catch((error) => error);
  assert.equal(output?.code, expectedCode, 'dispatcher must fail closed');
  assert.doesNotMatch(
    `${output?.stdout ?? ''}${output?.stderr ?? ''}`,
    /TASK8_DISPATCH_SECRET_SENTINEL/u,
    'dispatcher diagnostics must not print environment values',
  );
}

function fixtureDockerfile(...instructions) {
  return [
    `FROM ${nodeTag}@sha256:${literalFixtureDigest} AS runner`,
    ...instructions,
    'USER 1000:1000',
    '',
  ].join('\n');
}

function assertNoBroadOperatorOutputCopy(source) {
  const finalCopies = finalDockerStage(source).instructions.filter((line) =>
    /^COPY\s/iu.test(line),
  );
  for (const line of finalCopies) {
    if (!line.includes('/app/operator-dist')) continue;
    assert.match(
      line,
      /\/app\/operator-dist\/(?:migration(?:\/|\s)|scripts\/journal(?:\/|\s)|scripts\/migration(?:\/|\s)|server\/api\/serializers\.js(?:\s|$)|server\/db\/(?:client|config|database\.types)\.js(?:\s|$)|server\/journal(?:\/|\s))/u,
      `operator must copy only an allowlisted compiled subtree: ${line}`,
    );
  }
}

function assertRequiredOperatorCopy(copyLines, source, destination) {
  assert.ok(
    copyLines.some(
      (line) => line.includes(source) && line.endsWith(destination),
    ),
    `missing operator runtime copy ${source} -> ${destination}`,
  );
}

function assertNarrowOperatorBuilder(stage) {
  const expectedSources = [
    'package.json',
    'yarn.lock',
    'tsconfig.base.json',
    'tsconfig.migration-build.json',
    'migration',
    'scripts/journal',
    'scripts/migration',
    'server/api/serializers.ts',
    'server/db/client.ts',
    'server/db/config.ts',
    'server/db/database.types.ts',
    'server/journal',
    'server/repositories/contact-repository.ts',
    'types/DBTypes.ts',
    'public',
  ].sort();
  const copies = stage.instructions
    .filter((line) => /^COPY\s/iu.test(line))
    .map(parseDockerTransfer);
  assert.ok(copies.length > 0, 'operator builder must copy narrow sources');
  assert.equal(
    copies.some(({ from }) => from !== null),
    false,
    'operator builder must not import a broad prior-stage tree',
  );
  assert.deepEqual(
    copies.flatMap(({ sources }) => sources).sort(),
    expectedSources,
    'operator builder COPY sources must exactly equal the reviewed allowlist',
  );
}

function shellCaseArm(source, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const body = source.match(
    new RegExp(
      `^[ \\t]*${escaped}\\)[ \\t]*\\r?$([\\s\\S]*?)^[ \\t]*;;[ \\t]*\\r?$`,
      'mu',
    ),
  )?.[1];
  assert.ok(body, `dispatcher must define ${label} command`);
  return body;
}

function assertExactDispatcherLabels(source) {
  assert.equal(
    source.match(/^[ \t]*case\b/gmu)?.length ?? 0,
    1,
    'dispatcher must contain exactly one auditable case statement',
  );
  const block = source.match(
    /^[ \t]*case[ \t]+[^\r\n]+[ \t]+in[ \t]*\r?$([\s\S]*?)^[ \t]*esac[ \t]*\r?$/mu,
  )?.[1];
  assert.ok(block, 'dispatcher must contain a closed case block');
  const labels = [
    ...block.matchAll(/^[ \t]*([^ \t#()\r\n][^()\r\n]*)\)[ \t]*\r?$/gmu),
  ].map(([, label]) => label.trim());
  assert.deepEqual(
    labels.sort(),
    [
      'export',
      'rehearsal',
      'preload',
      'contacts',
      'journal-recover',
      'remove-synthetic',
      '*',
    ].sort(),
    'dispatcher case labels must exactly equal the reviewed command allowlist',
  );
}

function yarnLockStanzas(lock) {
  return [
    ...lock.matchAll(/^([^\s#][^\n]*):\n((?: {2,}[^\n]*(?:\n|$))*)/gmu),
  ].map(([, heading, body]) => ({ body, heading }));
}

function assertPinnedArchiveTool(source, { sha256, url }) {
  const addPrefix = `ADD --checksum=sha256:${sha256} ${url} `;
  const addLines = logicalDockerLines(source).filter((line) =>
    line.startsWith(addPrefix),
  );
  assert.equal(
    addLines.length,
    1,
    `operator must use one checksum-pinned BuildKit ADD for ${url}`,
  );
  const archivePath = addLines[0].slice(addPrefix.length);
  assert.match(
    archivePath,
    /^\/tmp\/[^\s/][^\s]*$/u,
    'tool archives must use a concrete file below /tmp',
  );
  const verificationLine = logicalDockerLines(source).find(
    (line) =>
      /^RUN\s/iu.test(line) &&
      line.includes(sha256) &&
      line.includes(archivePath) &&
      /sha256sum\s+-c/u.test(line),
  );
  assert.ok(
    verificationLine,
    `operator must verify ${url} with exact sha256 ${sha256}`,
  );
}

test('migration image contract rejects missing or legacy-cased operator public trees', () => {
  assert.throws(
    () =>
      assertExactDispatcherLabels(
        'case "${1-}" in\n' +
          '  export)\n    :\n    ;;\n' +
          '  rehearsal)\n    :\n    ;;\n' +
          '  preload)\n    :\n    ;;\n' +
          '  contacts)\n    :\n    ;;\n' +
          '  remove-synthetic)\n    :\n    ;;\n' +
          '  shell)\n    exec /bin/sh\n    ;;\n' +
          '  *)\n    :\n    ;;\n' +
          'esac\n',
      ),
    /exactly equal the reviewed command allowlist/iu,
  );
  assert.throws(
    () =>
      assertWholePublicTreeCopy(
        fixtureDockerfile(
          'COPY --chown=0:0 /app/operator-dist/migration ./migration',
        ),
      ),
    /complete normalized public tree/iu,
  );

  assert.throws(
    () =>
      assertWholePublicTreeCopy(
        fixtureDockerfile(
          'COPY --chown=0:0 public /app/public',
          'COPY --chown=0:0 public/Images/profilepicture.webp /app/public/images/profilepicture.webp',
        ),
      ),
    /legacy uppercase public paths/iu,
  );

  assert.throws(
    () =>
      assertWholePublicTreeCopy(
        fixtureDockerfile(
          'COPY --chown=0:0 public /app/public',
          'COPY --chown=0:0 public/images/Cases/mackmyra.webp /app/public/images/cases/mackmyra.webp',
        ),
      ),
    /legacy uppercase public paths/iu,
  );
});

test('migration operator uses immutable stages and packages only compiled ETL runtime', async () => {
  const source = await readRequiredText(
    repositoryRoot,
    'infra/migration/Dockerfile',
  );
  assert.equal(
    source.replaceAll('\r\n', '\n').split('\n')[0],
    '# syntax=docker/dockerfile:1.7',
    'operator image must pin the BuildKit frontend needed by ADD --checksum',
  );
  assertLiteralDigestBases(source, [
    nodeReference,
    nodeReference,
    golangReference,
    golangReference,
    resticReference,
    busyboxReference,
    distrolessNodeReference,
  ]);
  assert.deepEqual(
    dockerStages(source).map(({ name }) => name),
    [
      'production-dependencies',
      'builder',
      'mongodump-builder',
      'age-builder',
      'ca-certificates',
      'shell-tools',
      'runner',
    ],
  );
  assertNoSecretDockerMetadata(source);
  assertOciRevisionMetadata(source);
  assertFixedRuntimeUserAndRootCopies(source, '1000:1000');
  assertNoFinalCopyAll(source);
  assertNoBroadOperatorOutputCopy(source);
  assertWholePublicTreeCopy(source);
  assertExactFinalCopies(source, [
    {
      from: 'builder',
      source: '/app/operator-dist/migration',
      destination: './migration',
    },
    {
      from: 'builder',
      source: '/app/operator-dist/scripts/migration',
      destination: './scripts/migration',
    },
    {
      from: 'builder',
      source: '/app/operator-dist/scripts/journal',
      destination: './scripts/journal',
    },
    {
      from: 'builder',
      source: '/app/operator-dist/server/api/serializers.js',
      destination: './server/api/serializers.js',
    },
    ...['client.js', 'config.js', 'database.types.js'].map((filename) => ({
      from: 'builder',
      source: `/app/operator-dist/server/db/${filename}`,
      destination: `./server/db/${filename}`,
    })),
    {
      from: 'builder',
      source: '/app/operator-dist/server/journal',
      destination: './server/journal',
    },
    {
      from: 'builder',
      source: '/app/migration/asset-paths.mjs',
      destination: './migration/asset-paths.mjs',
    },
    {
      from: 'builder',
      source: '/app/scripts/migration/export-mongo.sh',
      destination: './scripts/migration/export-mongo.sh',
    },
    {
      from: 'production-dependencies',
      source: '/app/node_modules',
      destination: './node_modules',
    },
    {
      from: 'ca-certificates',
      source: '/ca-runtime/',
      destination: '/',
    },
    {
      from: 'shell-tools',
      source: '/shell-bin',
      destination: '/bin',
    },
    { from: 'builder', source: '/app/public', destination: './public' },
    {
      from: 'mongodump-builder',
      source: '/usr/local/bin/mongodump',
      destination: '/usr/local/bin/mongodump',
    },
    {
      from: 'age-builder',
      source: '/usr/local/bin/age',
      destination: '/usr/local/bin/age',
    },
    {
      source: 'infra/migration/entrypoint.sh',
      destination: '/usr/local/bin/mlp-migration',
    },
  ]);

  const [
    dependencies,
    builder,
    mongodumpBuilder,
    ageBuilder,
    caCertificates,
    shellTools,
  ] = dockerStages(source);
  assert.match(
    dependencies.instructions.join('\n'),
    /^RUN yarn install --frozen-lockfile --production=true --ignore-scripts --non-interactive$/mu,
    'operator runtime dependencies must be lockfile-only, production-only, and script-free',
  );
  assert.match(
    dependencies.instructions.join('\n'),
    /COPY infra\/migration\/package\.json infra\/migration\/yarn\.lock \.\//u,
    'operator dependencies must come from the dedicated runtime manifest',
  );
  assert.doesNotMatch(
    dependencies.instructions.join('\n'),
    /^COPY package\.json yarn\.lock/mu,
    'operator dependencies must not install the full application manifest',
  );
  assert.match(
    dependencies.instructions.join('\n'),
    /pg-connection-string\/README\.md/u,
    'operator dependencies must prune pg connection README credential fixtures',
  );
  assert.match(
    dependencies.instructions.join('\n'),
    /pg-pool\/README\.md/u,
    'operator dependencies must prune pg pool README credential fixtures',
  );
  assert.match(
    dependencies.instructions.join('\n'),
    /zod\/src\/v4\/classic\/tests/u,
    'operator dependencies must prune zod source tests with URI fixtures',
  );
  assert.match(
    dependencies.instructions.join('\n'),
    /mongodb\/lib\/client-side-encryption\/crypto_callbacks\.js/u,
    'operator dependencies must prune MongoDB private-key callback fixtures',
  );
  assert.match(
    dependencies.instructions.join('\n'),
    /mongodb\/src\/client-side-encryption\/crypto_callbacks\.ts/u,
    'operator dependencies must prune MongoDB TypeScript private-key fixtures',
  );
  assert.match(
    builder.instructions.join('\n'),
    /^RUN yarn build:migration$/mu,
    'operator builder must use the deterministic compiled build',
  );
  assert.match(
    builder.instructions.join('\n'),
    /^RUN yarn install --frozen-lockfile --ignore-scripts --non-interactive$/mu,
    'operator builder dependencies must be deterministic and script-free',
  );
  assertNarrowOperatorBuilder(builder);
  const mongodumpBuilderSource = mongodumpBuilder.instructions.join('\n');
  assert.match(
    mongodumpBuilderSource,
    /^ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=mod$/mu,
    'operator mongodump must be rebuilt as a static scanner-patched Go binary',
  );
  assert.match(
    mongodumpBuilderSource,
    /go version \| grep -Fx 'go version go1\.26\.5 linux\/amd64'/u,
    'operator mongodump builder must prove the scanner-fixed Go toolchain',
  );
  assert.match(
    mongodumpBuilderSource,
    /go mod edit -go=1\.26\.5/u,
    'operator mongodump build must pin module semantics to the patched Go release',
  );
  assert.match(
    mongodumpBuilderSource,
    /go get[\s\S]*golang\.org\/x\/crypto@v0\.52\.0[\s\S]*golang\.org\/x\/net@v0\.55\.0/u,
    'operator mongodump build must patch scanner-flagged Go module dependencies',
  );
  assert.match(
    mongodumpBuilderSource,
    new RegExp(
      String.raw`go build[\s\S]*-X main\.VersionStr=100\.17\.0[\s\S]*-X main\.GitCommit=${mongoToolsGitCommit}[\s\S]*\./mongodump/main/mongodump\.go`,
      'u',
    ),
    'operator mongodump build must compile the reviewed command from source with traceable version metadata',
  );
  assert.match(
    mongodumpBuilderSource,
    /mongodump --version \| grep -F 'mongodump version: 100\.17\.0'/u,
    'operator mongodump build must prove the expected tool version',
  );
  assert.match(
    mongodumpBuilderSource,
    /go version -m \/usr\/local\/bin\/mongodump[\s\S]*go1\.26\.5/u,
    'operator mongodump build must expose Go build metadata for scanner triage',
  );
  for (const [moduleName, version] of [
    ['golang.org/x/crypto', 'v0.52.0'],
    ['golang.org/x/net', 'v0.55.0'],
    ['golang.org/x/sys', 'v0.45.0'],
    ['golang.org/x/term', 'v0.43.0'],
    ['golang.org/x/text', 'v0.37.0'],
  ]) {
    assert.ok(
      mongodumpBuilderSource.includes(
        `go version -m /usr/local/bin/mongodump | grep -E 'dep[[:space:]]+${moduleName.replaceAll(
          '.',
          String.raw`\.`,
        )}[[:space:]]+${version.replaceAll('.', String.raw`\.`)}'`,
      ),
      `operator mongodump build must prove ${moduleName} ${version}`,
    );
  }
  assert.match(
    mongodumpBuilderSource,
    /install[^\n]*-o root -g root -m 0555[^\n]*\/usr\/local\/bin\/mongodump/u,
    'operator mongodump executable must be installed as root-owned 0555',
  );
  assert.match(
    ageBuilder.instructions.join('\n'),
    /go get filippo\.io\/age\/cmd\/age@v1\.3\.1 golang\.org\/x\/crypto@v0\.52\.0/u,
    'operator age must be rebuilt with scanner-fixed Go module dependencies',
  );
  assert.match(
    ageBuilder.instructions.join('\n'),
    /go install filippo\.io\/age\/cmd\/age/u,
    'operator age stage must build the reviewed age command from source',
  );
  assert.match(
    ageBuilder.instructions.join('\n'),
    /install[^\n]*-o root -g root -m 0555[^\n]*\/usr\/local\/bin\/age/u,
    'operator age executable must be installed as root-owned 0555',
  );
  assert.doesNotMatch(
    source,
    /(?:fastdl\.mongodb\.org\/tools\/db|mongodb-database-tools-debian12-x86_64-100\.17\.0\.tgz|mongodump-libraries|libgssapi_krb5)/u,
    'operator image must not ship the vulnerable prebuilt mongodump runtime closure',
  );
  assert.match(
    caCertificates.instructions.join('\n'),
    /\/ca-runtime\/etc\/ssl\/certs\/ca-certificates\.crt/u,
    'operator CA stage must expose the reviewed CA runtime tree',
  );
  const shellToolSource = shellTools.instructions.join('\n');
  assert.match(
    shellToolSource,
    /cp \/bin\/busybox \/shell-bin\/busybox/u,
    'operator shell-tools stage must copy only the BusyBox executable into the reviewed applet set',
  );
  for (const applet of [
    'cat',
    'chmod',
    'chown',
    'date',
    'find',
    'grep',
    'head',
    'id',
    'mkdir',
    'mktemp',
    'mv',
    'rm',
    'sed',
    'sh',
    'sha256sum',
    'stat',
    'true',
    'uname',
  ]) {
    assert.match(
      shellToolSource,
      new RegExp(`\\b${applet}\\b`, 'u'),
      `operator shell-tools stage must expose BusyBox ${applet}`,
    );
  }
  assert.equal(
    dockerStages(source)
      .filter(({ name }) => name !== 'mongodump-builder')
      .flatMap(({ instructions }) => instructions)
      .some((line) => /^ADD\s/iu.test(line)),
    false,
    'only the isolated mongodump builder may ADD checksum-pinned tool archives',
  );

  const architectureIndex = mongodumpBuilder.instructions.findIndex(
    (line) =>
      /^RUN\s/iu.test(line) &&
      line.includes('uname -m') &&
      line.includes('x86_64'),
  );
  const extractionIndex = mongodumpBuilder.instructions.findIndex(
    (line) => /^RUN\s/iu.test(line) && /\btar\b/u.test(line),
  );
  assert.ok(
    architectureIndex >= 0 && extractionIndex > architectureIndex,
    'operator mongodump builder must reject non-x86_64 before extracting amd64 tools',
  );
  const verificationIndex = mongodumpBuilder.instructions.findIndex(
    (line) =>
      /^RUN\s/iu.test(line) &&
      line.includes(mongoToolsSha256) &&
      /sha256sum\s+-c/u.test(line),
  );
  assert.ok(
    verificationIndex >= 0 && verificationIndex < extractionIndex,
    'the mongodump source archive checksum must be verified before extraction',
  );

  const final = finalDockerStage(source);
  const finalSource = final.instructions.join('\n');
  assert.doesNotMatch(
    finalSource,
    /\b(?:apt|apt-get|dpkg|purge_packages|corepack|npm|npx)\b/u,
    'operator runner must use the npm-free distroless runtime instead of fragile package-manager purges',
  );
  assert.match(
    finalSource,
    /ENV\s[^\n]*NODE_ENV=production[\s\S]*PATH=\/nodejs\/bin:\/usr\/local\/bin:\/bin/u,
    'operator runner PATH must expose distroless Node and the reviewed BusyBox applets',
  );
  assertOrdered(
    finalSource,
    ['COPY --from=shell-tools', 'USER 1000:1000'],
    'operator shell tools must be installed before dropping to the runtime user',
  );
  assertOrdered(
    finalSource,
    ['PATH=/nodejs/bin:/usr/local/bin:/bin', 'USER 1000:1000'],
    'operator PATH must expose distroless Node before dropping to the runtime user',
  );
  const copies = final.instructions.filter((line) => /^COPY\s/iu.test(line));
  assertRequiredOperatorCopy(
    copies,
    '/app/operator-dist/migration',
    './migration',
  );
  assertRequiredOperatorCopy(
    copies,
    '/app/operator-dist/scripts/migration',
    './scripts/migration',
  );
  assertRequiredOperatorCopy(
    copies,
    '/app/operator-dist/scripts/journal',
    './scripts/journal',
  );
  assertRequiredOperatorCopy(
    copies,
    '/app/operator-dist/server/api/serializers.js',
    './server/api/serializers.js',
  );
  for (const filename of ['client.js', 'config.js', 'database.types.js']) {
    assertRequiredOperatorCopy(
      copies,
      `/app/operator-dist/server/db/${filename}`,
      `./server/db/${filename}`,
    );
  }
  assertRequiredOperatorCopy(
    copies,
    '/app/operator-dist/server/journal',
    './server/journal',
  );
  assertRequiredOperatorCopy(
    copies,
    '/app/migration/asset-paths.mjs',
    './migration/asset-paths.mjs',
  );
  assertRequiredOperatorCopy(
    copies,
    '/app/scripts/migration/export-mongo.sh',
    './scripts/migration/export-mongo.sh',
  );
  const runtimeDependenciesCopy = copies.find(
    (line) =>
      line.includes('--from=production-dependencies') &&
      line.includes('/app/node_modules') &&
      line.endsWith('./node_modules'),
  );
  assert.ok(
    runtimeDependenciesCopy,
    'operator must copy only dedicated production-dependencies node_modules',
  );
  assertRequiredOperatorCopy(copies, '/app/public', './public');
  const caCopy = copies.find(
    (instruction) =>
      instruction.includes('--from=ca-certificates') &&
      instruction.includes('/ca-runtime/') &&
      instruction.endsWith('/'),
  );
  assert.ok(caCopy, 'operator must copy a digest-pinned CA runtime tree');
  assert.match(caCopy, /--chmod=0?555(?:\s|$)/u);
  assert.doesNotMatch(
    finalSource,
    /(?:\.next|\/app\/src(?:\/|\s)|\/app\/tests(?:\/|\s)|\/app\/dist(?:\/|\s)|scripts\/db|server\/db\/(?:migrator|migrations))/iu,
    'operator image must exclude app output, tests, schema migrator, and migrations',
  );
  assert.match(finalSource, /ENV\s[^\n]*NODE_ENV=production/u);
  assert.match(finalSource, /^WORKDIR \/app$/mu);
  assert.match(
    finalSource,
    /^ENTRYPOINT \["\/usr\/local\/bin\/mlp-migration"\]$/mu,
  );
  assert.doesNotMatch(
    finalSource,
    /^CMD\s/mu,
    'new exec-form ENTRYPOINT must reset inherited CMD to an effective empty value',
  );

  for (const [tool, destination] of [
    ['mongodump', '/usr/local/bin/mongodump'],
    ['age', '/usr/local/bin/age'],
  ]) {
    const line = copies.find(
      (instruction) =>
        instruction.includes(`/usr/local/bin/${tool}`) &&
        instruction.endsWith(destination),
    );
    assert.ok(line, `operator image must install ${tool}`);
    assert.match(line, /--chmod=0?555(?:\s|$)/u);
  }
  const finalInstructions = finalDockerStage(source).instructions;
  const userIndex = finalInstructions.indexOf('USER 1000:1000');
  const runtimeProof = finalInstructions
    .slice(userIndex + 1)
    .find((instruction) => /^RUN\s/iu.test(instruction));
  assert.ok(
    runtimeProof,
    'operator image must prove tools and CA as runtime UID 1000',
  );
  assert.match(runtimeProof, /mongodump --version[^\n]*100\.17\.0/u);
  assert.match(runtimeProof, /age --version[^\n]*1\.3\.1/u);
  assert.match(runtimeProof, /node --version[^\n]*v22\.23\.1/u);
  assertOrdered(
    runtimeProof,
    [
      'uname -m',
      'x86_64',
      'node --version',
      'mongodump --version',
      'age --version',
    ],
    'operator runtime architecture/tool proof',
  );
  assert.match(
    runtimeProof,
    /test -r \/etc\/ssl\/certs\/ca-certificates\.crt/u,
  );
  assert.match(
    runtimeProof,
    /test ! -w \/etc\/ssl\/certs\/ca-certificates\.crt/u,
  );
  assert.doesNotMatch(
    source,
    /(?:\bapt(?:-get)?\s+(?:update|install)|\b(?:curl|wget)\b)/iu,
    'operator image must not fetch tools through mutable package repositories or RUN downloads',
  );

  assert.doesNotMatch(
    source,
    /^ARG\s+(?:MONGODB?|MONGO|AGE)[A-Z0-9_]*(?:=|\s|$)/mu,
    'archive tool versions/checksums must be literal, not overridable',
  );
  assertPinnedArchiveTool(source, {
    sha256: mongoToolsSha256,
    url: mongoToolsUrl,
  });
  assert.doesNotMatch(source, /age-v1\.3\.1-linux-amd64\.tar\.gz/u);
});

test('POSIX migration export streams Mongo archives through age without Bash', async () => {
  const relativePath = 'scripts/migration/export-mongo.sh';
  const source = await readRequiredText(repositoryRoot, relativePath);
  assertPosixScript(source);
  await assertExecutableRegularFile(repositoryRoot, relativePath);
  await assertPosixSyntax(relativePath);
  assert.match(
    source,
    /mongodump_status_file="\$work\/mongodump\.status"/u,
    'export must capture the mongodump status outside the streaming pipeline',
  );
  assert.match(
    source,
    /age_status_file="\$work\/age\.status"/u,
    'export must capture the age status outside the streaming pipeline',
  );
  assert.match(
    source,
    /mongodump[\s\S]*\|[\s\S]*age --recipient "\$ARCHIVE_RECIPIENT" --output "\$encrypted_tmp"/u,
    'export must stream mongodump output directly into age',
  );
  assert.match(
    source,
    /dump_status="\$\(cat "\$mongodump_status_file"/u,
    'export must capture the mongodump exit status explicitly',
  );
  assert.match(
    source,
    /age_status="\$\(cat "\$age_status_file"/u,
    'export must capture the age exit status explicitly',
  );
});

test('POSIX migration entrypoint dispatches only six reviewed commands', async () => {
  const relativePath = 'infra/migration/entrypoint.sh';
  const source = await readRequiredText(repositoryRoot, relativePath);
  assertPosixScript(source);
  await assertExecutableRegularFile(repositoryRoot, relativePath);
  await assertPosixSyntax(relativePath);
  assert.match(source, /case ["']?\$\{1-\}["']? in/u);
  assertExactDispatcherLabels(source);
  assert.doesNotMatch(
    source,
    /(?:\beval\b|\bsh -c\b|exec ["']?\$@["']?)/u,
    'dispatcher must not execute arbitrary caller input',
  );

  const mappings = new Map([
    ['export', 'exec /app/scripts/migration/export-mongo.sh'],
    [
      'rehearsal',
      'exec /nodejs/bin/node /app/scripts/migration/run-rehearsal.js',
    ],
    [
      'preload',
      'exec /nodejs/bin/node /app/scripts/migration/preload-content.js',
    ],
    [
      'contacts',
      'exec /nodejs/bin/node /app/scripts/migration/finalize-contacts.js',
    ],
    [
      'journal-recover',
      'exec /nodejs/bin/node /app/scripts/journal/recover.js',
    ],
  ]);
  for (const [command, invocation] of mappings) {
    const arm = shellCaseArm(source, command);
    assert.ok(arm.includes(invocation), `${command} must map to ${invocation}`);
    assert.doesNotMatch(arm, /["']?\$[@*]["']?/u);
  }

  const removeArm = shellCaseArm(source, 'remove-synthetic');
  assertOrdered(
    removeArm,
    [
      'unset MONGO_URI_FILE MONGO_DATABASE',
      'exec /nodejs/bin/node /app/scripts/migration/remove-synthetic-contact.js "$2"',
    ],
    'remove-synthetic must discard Mongo settings before PostgreSQL cleanup',
  );
  assert.doesNotMatch(
    removeArm.replace('unset MONGO_URI_FILE MONGO_DATABASE', ''),
    /(?:MONGO_URI_FILE|MONGO_DATABASE|\b(?:cat|read)\b|<)/u,
    'remove-synthetic must not read Mongo settings or files',
  );
  const journalRecoverArm = shellCaseArm(source, 'journal-recover');
  assertOrdered(
    journalRecoverArm,
    [
      'unset MONGO_URI_FILE MONGO_DATABASE MONGODB_URI MONGO_URI',
      'exec /nodejs/bin/node /app/scripts/journal/recover.js',
    ],
    'journal-recover must discard Mongo settings before recovery',
  );
  assert.doesNotMatch(
    journalRecoverArm.replace(
      'unset MONGO_URI_FILE MONGO_DATABASE MONGODB_URI MONGO_URI',
      '',
    ),
    /(?:MONGO_URI_FILE|MONGO_DATABASE|MONGODB_URI|MONGO_URI|\b(?:cat|read)\b|<)/u,
    'journal-recover must not read Mongo settings or files',
  );
  assert.match(shellCaseArm(source, '*'), /\busage\b/u);
  const usage = source.match(/^usage\(\)\s*\{([\s\S]*?)^\}/mu)?.[1];
  assert.ok(usage, 'dispatcher must define usage()');
  assert.match(usage, /exit 64\b/u);

  await assertDispatcherExit(relativePath, []);
  await assertDispatcherExit(relativePath, ['unknown']);
  for (const command of mappings.keys()) {
    await assertDispatcherExit(relativePath, [command, 'unexpected']);
  }
  await assertDispatcherExit(relativePath, ['remove-synthetic']);
  await assertDispatcherExit(relativePath, [
    'remove-synthetic',
    '00000000-0000-4000-8000-000000000000',
    'unexpected',
  ]);
});

test('operator runtime manifest and lock contain only five exact direct dependencies', async () => {
  const manifest = await readRequiredJson(
    repositoryRoot,
    'infra/migration/package.json',
  );
  const expectedDependencies = {
    '@aws-sdk/client-s3': '3.1087.0',
    kysely: '0.29.3',
    mongodb: '6.21.0',
    pg: '8.22.0',
    zod: '4.4.3',
  };
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.dependencies, expectedDependencies);
  assert.deepEqual(manifest.scripts, {});
  assert.deepEqual(manifest.devDependencies ?? {}, {});
  assert.deepEqual(manifest.optionalDependencies ?? {}, {});
  assert.deepEqual(manifest.peerDependencies ?? {}, {});
  assert.deepEqual(manifest.bundledDependencies ?? [], []);

  const lock = await readRequiredText(
    repositoryRoot,
    'infra/migration/yarn.lock',
  );
  assert.match(lock, /^# yarn lockfile v1$/mu);
  assert.doesNotMatch(
    lock,
    /(?:git(?:\+ssh|\+https|:\/\/)|file:|link:|http:\/\/)/iu,
    'operator lock must not resolve from Git, local files, links, or plaintext HTTP',
  );
  const stanzas = yarnLockStanzas(lock);
  assert.ok(
    stanzas.length >= 4,
    'operator lock must contain dependency stanzas',
  );
  for (const { body, heading } of stanzas) {
    assert.match(
      body,
      /^  resolved "https:\/\/registry\.yarnpkg\.com\/[^"]+"$/mu,
      `${heading}: resolved artifact must use the Yarn HTTPS registry`,
    );
    assert.match(
      body,
      /^  integrity sha512-[A-Za-z0-9+/=]+$/mu,
      `${heading}: lock stanza must contain sha512 integrity`,
    );
  }
  for (const [dependency, version] of Object.entries(expectedDependencies)) {
    const escapedName = dependency.replace('/', '\\/');
    const escapedVersion = version.replaceAll('.', '\\.');
    const heading = dependency.startsWith('@')
      ? `"${escapedName}@${escapedVersion}":`
      : `${escapedName}@${escapedVersion}:`;
    assert.match(
      lock,
      new RegExp(`^${heading}\\n  version "${escapedVersion}"$`, 'mu'),
      `operator lock must pin ${dependency} exactly to ${version}`,
    );
  }
  assert.doesNotMatch(
    lock,
    /^(?:next|react|react-dom|sharp|@svgr\/webpack)@/mu,
    'operator lock must not include application-only runtime packages',
  );
});

test('migration operator has a dedicated secret-safe context that retains public', async () => {
  const source = await readRequiredText(
    repositoryRoot,
    'infra/migration/Dockerfile.dockerignore',
  );
  assertDockerignoreContract(source, {
    requiredPatterns: [
      '.git',
      '.github',
      '.next',
      '.superpowers',
      'node_modules',
      'dist',
      'operator-dist',
      'migration-artifacts',
      '.env*',
      '**/.env*',
      '**/secrets/**',
      '**/*.pem',
      '**/*.key',
      '**/*.age',
      '**/*.archive*',
      'infra/runtime.example/secrets',
      'docs',
      'tests',
      'src',
    ],
  });
});

test('compiled migration build has deterministic output and a narrow source boundary', async () => {
  const packageJson = await readRequiredJson(repositoryRoot, 'package.json');
  assert.equal(
    packageJson.scripts?.['build:migration'],
    'rm -rf operator-dist && tsc --project tsconfig.migration-build.json',
  );

  const config = await readRequiredJson(
    repositoryRoot,
    'tsconfig.migration-build.json',
  );
  assert.equal(config.extends, './tsconfig.base.json');
  assert.deepEqual(config.include, [
    'migration/**/*.ts',
    'scripts/journal/**/*.ts',
    'scripts/migration/**/*.ts',
    'server/api/serializers.ts',
    'server/db/client.ts',
    'server/db/config.ts',
    'server/db/database.types.ts',
    'server/journal/**/*.ts',
    'types/DBTypes.ts',
  ]);
  assert.equal(config.compilerOptions?.rootDir, '.');
  assert.equal(config.compilerOptions?.outDir, 'operator-dist');
  assert.equal(config.compilerOptions?.module, 'commonjs');
  assert.equal(config.compilerOptions?.target, 'ES2022');
  assert.equal(config.compilerOptions?.noEmit, false);
  assert.equal(config.compilerOptions?.noEmitOnError, true);
  assert.equal(config.compilerOptions?.incremental, false);
  assert.doesNotMatch(
    JSON.stringify(config),
    /(?:src\/|tests\/|scripts\/db|server\/db\/migrator|server\/db\/migrations)/u,
    'operator compiler must exclude app/tests/schema migrator/migrations',
  );
});

test('operator source boundary contains normalized public assets and no legacy path', async () => {
  const requiredFiles = [
    'public/sw.js',
    'public/sw-manifest.json',
    'public/manifest.json',
    'public/assets/man.mp4',
    'public/images/profilepicture.webp',
    'public/images/cases/mackmyra.webp',
  ];
  for (const relativePath of requiredFiles) {
    const status = await lstat(path.join(repositoryRoot, relativePath));
    assert.equal(
      status.isFile(),
      true,
      `${relativePath} must be a regular file`,
    );
  }

  const { stdout: legacyIndexPaths } = await execFile(
    'git',
    ['ls-files', '-z', 'public/Images/**', 'public/images/Cases/**'],
    { cwd: repositoryRoot, encoding: 'buffer' },
  );
  assert.equal(
    legacyIndexPaths.length,
    0,
    'legacy uppercase public paths must remain absent from the Git index',
  );

  const runtimeSource = await readRequiredText(
    repositoryRoot,
    'scripts/migration/operator-runtime.ts',
  );
  assert.match(
    runtimeSource,
    /path\.resolve\(cwd, ['"]public['"]\)/u,
    'Task 7 verification must continue resolving <operator workdir>/public',
  );
});
