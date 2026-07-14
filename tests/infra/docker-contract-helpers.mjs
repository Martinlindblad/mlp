import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const literalFromPattern =
  /^FROM ([a-z0-9][a-z0-9./_-]*:[A-Za-z0-9][A-Za-z0-9._-]*)@sha256:([0-9a-f]{64})(?: AS ([a-z0-9][a-z0-9_-]*))?$/u;
const secretNamePattern =
  /(?:PASSWORD|PASSWD|SECRET|TOKEN|MONGO(?:DB)?_URI|DATABASE_URL|AWS_ACCESS_KEY|AWS_SECRET|PRIVATE_KEY|CREDENTIAL)/iu;

export async function readRequiredText(repositoryRoot, relativePath) {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail(`${relativePath}: required Task 8 artifact is missing`);
    }
    throw error;
  }
}

export async function readRequiredJson(repositoryRoot, relativePath) {
  const source = await readRequiredText(repositoryRoot, relativePath);
  try {
    return JSON.parse(source);
  } catch {
    assert.fail(`${relativePath}: expected valid JSON`);
  }
}

export function logicalDockerLines(source) {
  const result = [];
  let continued = '';

  for (const rawLine of source.replaceAll('\r\n', '\n').split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const fragment =
      continued.length === 0 ? trimmed : `${continued} ${trimmed}`;
    if (fragment.endsWith('\\')) {
      continued = fragment.slice(0, -1).trimEnd();
    } else {
      result.push(fragment.replace(/\s+/gu, ' '));
      continued = '';
    }
  }

  assert.equal(continued, '', 'Dockerfile has an unterminated continuation');
  return result;
}

export function logicalShellLines(source) {
  const result = [];
  let continued = '';

  for (const rawLine of source.replaceAll('\r\n', '\n').split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const fragment =
      continued.length === 0 ? trimmed : `${continued} ${trimmed}`;
    if (fragment.endsWith('\\')) {
      continued = fragment.slice(0, -1).trimEnd();
    } else {
      result.push(fragment.replace(/\s+/gu, ' '));
      continued = '';
    }
  }

  assert.equal(continued, '', 'shell script has an unterminated continuation');
  return result;
}

export function parseDockerTransfer(instruction) {
  const operation = instruction.match(/^(ADD|COPY)\s/iu)?.[1]?.toUpperCase();
  assert.ok(operation, `expected ADD or COPY instruction: ${instruction}`);
  let body = instruction.replace(/^(?:ADD|COPY)\s+/iu, '');
  const flags = [];
  while (body.startsWith('--')) {
    const flag = body.match(/^(--[^\s]+)\s+/u);
    assert.ok(flag, `invalid transfer flag syntax: ${instruction}`);
    flags.push(flag[1]);
    body = body.slice(flag[0].length);
  }

  let paths;
  if (body.startsWith('[')) {
    try {
      paths = JSON.parse(body);
    } catch {
      assert.fail(`invalid JSON-form Docker instruction: ${instruction}`);
    }
    assert.ok(
      Array.isArray(paths) &&
        paths.length >= 2 &&
        paths.every((value) => typeof value === 'string'),
      `invalid JSON-form Docker instruction: ${instruction}`,
    );
  } else {
    paths = (body.match(/(?:"[^"]*"|'[^']*'|\S+)/gu) ?? []).map((value) =>
      value.replace(/^(?:"([^"]*)"|'([^']*)')$/u, '$1$2'),
    );
    assert.ok(paths.length >= 2, `invalid Docker instruction: ${instruction}`);
  }

  const fromFlags = flags.filter((flag) => flag.startsWith('--from='));
  assert.ok(fromFlags.length <= 1, `duplicate --from flag: ${instruction}`);
  return {
    destination: paths.at(-1),
    flags,
    from: fromFlags[0]?.slice('--from='.length) ?? null,
    operation,
    sources: paths.slice(0, -1),
  };
}

export function dockerStages(source) {
  const stages = [];
  for (const instruction of logicalDockerLines(source)) {
    if (/^FROM\s/iu.test(instruction)) {
      const match = instruction.match(/\sAS\s([a-z0-9][a-z0-9_-]*)$/iu);
      stages.push({
        from: instruction,
        instructions: [],
        name: match?.[1]?.toLowerCase() ?? `stage-${stages.length + 1}`,
      });
    } else if (stages.length > 0) {
      stages.at(-1).instructions.push(instruction);
    }
  }
  assert.ok(stages.length > 0, 'Dockerfile must contain at least one FROM');
  return stages;
}

export function finalDockerStage(source) {
  return dockerStages(source).at(-1);
}

export function assertLiteralDigestBases(source, expectedReferences) {
  const lines = logicalDockerLines(source);
  const fromLines = lines.filter((line) => /^FROM\s/iu.test(line));
  assert.equal(
    fromLines.length,
    expectedReferences.length,
    'Dockerfile must use exactly the expected image stages',
  );

  fromLines.forEach((line, index) => {
    assert.doesNotMatch(
      line,
      /\$/u,
      'FROM must not use an overridable build argument',
    );
    const match = line.match(literalFromPattern);
    assert.ok(
      match,
      `FROM must contain a literal reviewed tag and lower-case sha256 digest: ${line}`,
    );
    assert.equal(
      `${match[1]}@sha256:${match[2]}`,
      expectedReferences[index],
      'base image must use the exact reviewed index digest',
    );
    assert.doesNotMatch(
      match[2],
      /^([0-9a-f])\1{63}$/u,
      'base digest must not be an obvious placeholder',
    );
  });

  for (const line of lines.filter((value) => /^ARG\s/iu.test(value))) {
    const name = line.slice(4).split('=', 1)[0].trim();
    assert.doesNotMatch(
      name,
      /(?:BASE|IMAGE)/iu,
      'base image references must not be overridable ARG values',
    );
  }
}

export function assertNoSecretDockerMetadata(source) {
  assert.doesNotMatch(
    source,
    /--mount=type=secret/iu,
    'Task 8 images must not consume build-time secrets',
  );

  for (const line of logicalDockerLines(source)) {
    if (/^(?:ARG|ENV|LABEL|RUN)\s/iu.test(line)) {
      assert.doesNotMatch(
        line,
        secretNamePattern,
        `secret-related metadata/history is forbidden: ${line}`,
      );
    }
    if (/^(?:ADD|COPY)\s/iu.test(line)) {
      assert.doesNotMatch(
        line,
        /(?:\.env|secrets?(?:\/|\s)|migration-artifacts|\.archive|\.age(?:\s|$))/iu,
        `secret or migration artifacts must not enter an image layer: ${line}`,
      );
    }
  }
}

export function assertOciRevisionMetadata(source) {
  const final = finalDockerStage(source);
  const argIndexes = final.instructions
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => /^ARG\s+COMMIT_SHA(?:\s*)$/u.test(line));
  assert.equal(
    argIndexes.length,
    1,
    'final stage must declare required ARG COMMIT_SHA without a default',
  );

  const canonicalValidation =
    `RUN printf '%s\\n' "$COMMIT_SHA" | ` + `grep -Eq '^[0-9a-f]{40}$'`;
  const validationIndex = final.instructions.indexOf(canonicalValidation);
  assert.ok(
    validationIndex > argIndexes[0].index,
    'final stage must use the canonical fail-closed COMMIT_SHA validation',
  );
  assert.doesNotMatch(
    final.instructions.join('\n'),
    /^ENV\s[^\n]*\bCOMMIT_SHA\b/mu,
    'COMMIT_SHA must not be replaced by final-stage ENV metadata',
  );

  const labels = final.instructions
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => /^LABEL\s/iu.test(line));
  assert.equal(
    labels.length,
    1,
    'final stage must have exactly one canonical LABEL instruction',
  );
  const [{ index: labelIndex, line: label }] = labels;
  assert.ok(
    labelIndex > validationIndex,
    'OCI labels must follow SHA validation',
  );
  assert.equal(
    label,
    'LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"',
    'OCI source/revision must use the single canonical non-overridable label',
  );
}

export function assertFixedRuntimeUserAndRootCopies(source, expectedUser) {
  const final = finalDockerStage(source);
  const userLines = final.instructions.filter((line) => /^USER\s/iu.test(line));
  assert.deepEqual(
    userLines,
    [`USER ${expectedUser}`],
    `final stage must use fixed non-root USER ${expectedUser}`,
  );

  const copyLines = final.instructions.filter((line) => /^COPY\s/iu.test(line));
  assert.ok(copyLines.length > 0, 'final stage must copy runtime artifacts');
  for (const line of copyLines) {
    assert.match(
      line,
      /--chown=(?:0:0|root:root)(?:\s|$)/u,
      `runtime artifacts must be explicitly root-owned: ${line}`,
    );
    const mode = line.match(/--chmod=0?([0-7]{3})(?:\s|$)/u)?.[1];
    assert.ok(
      mode === '444' || mode === '555',
      `runtime COPY must explicitly use read-only mode 0444 or 0555: ${line}`,
    );
  }

  assert.doesNotMatch(
    final.instructions.join('\n'),
    /(?:chown|--chown=)[^\n]*(?:node|1000|10001)(?::|\s|$)/iu,
    'runtime application/tool files must not be owned by the runtime user',
  );
}

export function assertNoFinalCopyAll(source) {
  const final = finalDockerStage(source);
  for (const line of final.instructions.filter((value) =>
    /^(?:ADD|COPY)\s/iu.test(value),
  )) {
    const { sources } = parseDockerTransfer(line);
    assert.equal(
      sources.some((value) =>
        ['.', './', '/', '/app'].includes(path.posix.normalize(value)),
      ),
      false,
      `final stage must not copy or add the broad context/stage root: ${line}`,
    );
  }
}

export function assertExactFinalCopies(source, expectedCopies) {
  const final = finalDockerStage(source);
  const transfers = final.instructions
    .filter((line) => /^(?:ADD|COPY)\s/iu.test(line))
    .map(parseDockerTransfer);
  assert.equal(
    transfers.some(({ operation }) => operation === 'ADD'),
    false,
    'final runtime stage must not contain ADD',
  );
  for (const transfer of transfers) {
    assert.equal(
      transfer.sources.length,
      1,
      'every final COPY must have one allowlisted source',
    );
  }

  const canonical = ({ destination, from = null, source }) =>
    JSON.stringify({ destination, from, source });
  const actual = transfers
    .map(({ destination, from, sources }) =>
      canonical({ destination, from, source: sources[0] }),
    )
    .sort();
  const expected = expectedCopies.map(canonical).sort();
  assert.deepEqual(
    actual,
    expected,
    'final COPY instructions must exactly equal the reviewed runtime allowlist',
  );
  assert.doesNotMatch(
    final.instructions.filter((line) => /^RUN\s/iu.test(line)).join('\n'),
    /\b(?:chmod|chown)\b/iu,
    'final RUN must not widen ownership or modes after reviewed COPY instructions',
  );
}

export function assertNoBroadDistCopy(source) {
  const final = finalDockerStage(source);
  for (const line of final.instructions.filter((value) =>
    /^COPY\s/iu.test(value),
  )) {
    if (line.includes('/app/dist')) {
      assert.match(
        line,
        /\/app\/dist\/(?:scripts\/db|server\/db)(?:\s|\/)/u,
        `broad application dist copy is forbidden: ${line}`,
      );
    }
    assert.doesNotMatch(
      line,
      /\s(?:\.\/)?dist\/?\s+(?:\.\/)?dist\/?$/u,
      `broad application dist copy is forbidden: ${line}`,
    );
  }
}

export function assertWholePublicTreeCopy(source) {
  const finalCopies = finalDockerStage(source).instructions.filter((line) =>
    /^COPY\s/iu.test(line),
  );
  const fullPublicCopy = finalCopies.find((line) =>
    /\s(?:\/app\/public|public)\s+(?:\.\/public|\/app\/public)$/u.test(line),
  );
  assert.ok(
    fullPublicCopy,
    'final image must copy the complete normalized public tree to /app/public',
  );
  assert.doesNotMatch(
    finalCopies.join('\n'),
    /public\/(?:Images|images\/Cases)(?:\/|\s)/u,
    'legacy uppercase public paths are forbidden',
  );
}

export function assertDockerignoreContract(
  source,
  { allowPublic = true, requiredPatterns },
) {
  const patterns = source
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  for (const required of requiredPatterns) {
    assert.ok(
      patterns.includes(required),
      `dockerignore must contain exact pattern ${required}`,
    );
  }
  assert.equal(
    patterns.some((line) => line.startsWith('!')),
    false,
    'dockerignore negations are forbidden because later last-match rules can re-include secrets',
  );
  if (allowPublic) {
    assert.equal(
      patterns.some((line) => /^(?:\/?public|\/?public\/\*\*)\/?$/u.test(line)),
      false,
      'the normalized public tree must remain in the build context',
    );
  }
}

export function assertPosixScript(source) {
  assert.equal(
    source.replaceAll('\r\n', '\n').split('\n')[0],
    '#!/bin/sh',
    'shell helpers must use the POSIX /bin/sh shebang',
  );
  assert.match(source, /^set -eu$/mu, 'POSIX helpers must enable set -eu');
  assert.match(source, /^umask 077$/mu, 'POSIX helpers must use umask 077');
  assert.doesNotMatch(
    source,
    /(?:\[\[|\]\]|pipefail|\bfunction\b|\b(?:source|mapfile|readarray)\b|<\(|>\(|\$'|\$\{[^}]*\/\/)/u,
    'shell helpers must not use Bash-only syntax',
  );
}

export function assertPreservesDumpOwnershipAndAcls(source) {
  assert.match(source, /\bpg_dump\b/u, 'backup must run pg_dump');
  assert.doesNotMatch(
    source,
    /(?:^|[\s\\])(?:--no-owner|--no-acl|-O|-x)(?:[=\s\\]|$)/mu,
    'pg_dump must preserve PostgreSQL owners and ACLs',
  );
}

export function assertPgPasswordLifecycle(source) {
  const dumpIndex = source.indexOf('pg_dump');
  assert.ok(dumpIndex >= 0, 'backup must run pg_dump');
  const unsetIndex = source.indexOf('unset PGPASSWORD', dumpIndex);
  const relativeVerifyIndex = source
    .slice(dumpIndex)
    .search(/pg_restore[\s\\]+--list/u);
  const verifyIndex =
    relativeVerifyIndex === -1 ? -1 : dumpIndex + relativeVerifyIndex;
  const resticIndex = source.indexOf('/usr/local/bin/mlp-restic', dumpIndex);
  assert.ok(
    unsetIndex > dumpIndex,
    'backup must unset PGPASSWORD immediately after pg_dump',
  );
  assert.ok(
    verifyIndex > unsetIndex,
    'PGPASSWORD must be unset before dump verification continues',
  );
  assert.ok(
    resticIndex > unsetIndex,
    'PGPASSWORD must be unset before any Restic helper process',
  );
}

export function assertFailSafeCleanupTraps(
  source,
  { graceSeconds = 1, requiredCleanupFragments = [] } = {},
) {
  assert.ok(
    Number.isSafeInteger(graceSeconds) && graceSeconds >= 1,
    'signal grace must be a positive whole number of seconds',
  );
  const functionBody = (name) =>
    source.match(
      new RegExp(`^${name}\\(\\)\\s*\\{([\\s\\S]*?)^\\}`, 'mu'),
    )?.[1];
  const cleanup = functionBody('cleanup');
  assert.ok(cleanup, 'script must define cleanup()');
  assert.match(
    cleanup,
    /^\s*set \+e$/mu,
    'cleanup must disable errexit before best-effort secret and file cleanup',
  );
  assert.match(
    cleanup,
    /status=["']?\$\{?1\}?["']?/u,
    'cleanup must capture the status passed by each trap',
  );
  assert.match(
    cleanup,
    /trap - 0 HUP INT TERM/u,
    'cleanup must unregister condition 0 and signal traps before exiting',
  );
  for (const fragment of requiredCleanupFragments) {
    assert.ok(cleanup.includes(fragment), `cleanup must contain ${fragment}`);
  }
  assert.match(
    cleanup,
    /exit ["']?\$\{?status\}?["']?/u,
    'cleanup must preserve the original exit status',
  );

  assert.match(
    source,
    /trap ["']cleanup \$\?["'] 0/u,
    'script needs a separate POSIX condition-0 trap that passes the original status',
  );
  assert.match(
    source,
    /^child_pid=$/mu,
    'script must initialize an active child PID slot',
  );

  const runChild = functionBody('run_child');
  assert.ok(runChild, 'script must define run_child()');
  assert.match(runChild, /["']?\$@["']?\s*&/u);
  assert.match(runChild, /child_pid=\$!/u);
  assert.match(runChild, /^\s*set \+e$/mu);
  assert.match(runChild, /wait ["']?\$\{?child_pid\}?["']?/u);
  assert.match(runChild, /status=\$\?/u);
  assert.match(runChild, /^\s*child_pid=$/mu);
  assert.match(runChild, /^\s*set -e$/mu);
  assert.match(runChild, /return ["']?\$\{?status\}?["']?/u);

  const forwardSignal = functionBody('forward_signal');
  assert.ok(forwardSignal, 'script must define forward_signal()');
  assert.match(forwardSignal, /^\s*set \+e$/mu);
  assert.match(forwardSignal, /signal=["']?\$\{?1\}?["']?/u);
  assert.match(forwardSignal, /status=["']?\$\{?2\}?["']?/u);
  assert.match(forwardSignal, /trap - HUP INT TERM/u);
  assert.match(
    forwardSignal,
    /\[ -n ["']?\$\{?child_pid\}?["']? \]/u,
    'signal forwarding must be conditional on an active child',
  );
  assert.match(
    forwardSignal,
    /kill -TERM ["']?\$\{?child_pid\}?["']?/u,
    'signal forwarding must terminate the active async child with TERM',
  );
  assertOrdered(
    forwardSignal,
    [
      'kill -TERM "$child_pid"',
      `sleep ${graceSeconds}`,
      'kill -KILL "$child_pid"',
      'wait "$child_pid"',
      'child_pid=',
      'cleanup "$status"',
    ],
    'signal forwarding must TERM, wait without reaping, KILL, reap, and clean up',
  );
  assert.ok(
    forwardSignal.indexOf('wait ') > forwardSignal.indexOf('kill -KILL'),
    'signal forwarding must not reap before the fixed KILL fallback',
  );
  assert.match(forwardSignal, /^\s*child_pid=$/mu);
  assert.match(forwardSignal, /cleanup ["']?\$\{?status\}?["']?/u);

  for (const [signal, status] of [
    ['HUP', 129],
    ['INT', 130],
    ['TERM', 143],
  ]) {
    assert.match(
      source,
      new RegExp(
        `trap ["']forward_signal ${signal} ${status}["'] ${signal}`,
        'u',
      ),
      `${signal} trap must forward to the active child and exit ${status}`,
    );
  }
}

export async function assertExecutableRegularFile(
  repositoryRoot,
  relativePath,
) {
  const status = await lstat(path.join(repositoryRoot, relativePath));
  assert.equal(
    status.isSymbolicLink(),
    false,
    `${relativePath} must not be a symlink`,
  );
  assert.equal(status.isFile(), true, `${relativePath} must be a regular file`);
  assert.notEqual(status.mode & 0o111, 0, `${relativePath} must be executable`);
  assert.equal(
    status.mode & 0o022,
    0,
    `${relativePath} must not be group/world writable`,
  );
}

export function assertOrdered(source, orderedFragments, message) {
  let previous = -1;
  for (const fragment of orderedFragments) {
    const index = source.indexOf(fragment, previous + 1);
    assert.ok(index > previous, `${message}: missing/out-of-order ${fragment}`);
    previous = index;
  }
}
