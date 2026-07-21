import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const dockerfilePath = path.join(
  repositoryRoot,
  'infra',
  'caddy',
  'Dockerfile',
);
const caddyBase =
  'caddy:2.11.4-alpine@sha256:' +
  '5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648';

test('Caddy image removes only its unnecessary privileged-port file capability', async () => {
  const source = await readFile(dockerfilePath, 'utf8');

  assert.equal(
    source.match(new RegExp(caddyBase.replaceAll('.', '\\.')), 'gu')?.length,
    1,
    'Caddy must derive from exactly one literal digest-pinned official base',
  );
  assert.doesNotMatch(source, /^ARG\s+(?:CADDY|BASE).*IMAGE/imu);
  assert.match(
    source,
    /getcap\s+\/usr\/bin\/caddy[^\n]*cap_net_bind_service=ep/u,
    'the build must prove the official base has the expected capability before changing it',
  );
  assert.match(source, /setcap\s+-r\s+\/usr\/bin\/caddy/u);
  assert.match(
    source,
    /test\s+-z\s+"\$\(getcap\s+\/usr\/bin\/caddy\)"/u,
    'the build must fail unless no Caddy file capability remains',
  );
  assert.doesNotMatch(source, /\b(?:apk|apt-get|apt)\s+(?:add|install)\b/iu);
  assert.doesNotMatch(source, /^(?:ADD|COPY)\s/imu);
});

test('Caddy image is revision-labelled and defaults to the production numeric user', async () => {
  const source = await readFile(dockerfilePath, 'utf8');

  assert.match(source, /^ARG COMMIT_SHA$/mu);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(
    source,
    /^LABEL org\.opencontainers\.image\.source="https:\/\/github\.com\/martinlindblad\/mlp" org\.opencontainers\.image\.revision="\$COMMIT_SHA"$/mu,
  );
  assert.equal(source.match(/^USER 0:0$/gmu)?.length, 1);
  assert.equal(source.match(/^USER 65532:65532$/gmu)?.length, 1);
  assert.ok(
    source.lastIndexOf('USER 65532:65532') > source.lastIndexOf('USER 0:0'),
    'the final image user must be the fixed Caddy runtime UID',
  );
  assert.match(source, /caddy version[^\n]*v2\.11\.4/u);
});
