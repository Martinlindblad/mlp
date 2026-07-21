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
const golangBase =
  'golang:1.26.5-alpine@sha256:' +
  '0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2';
const alpineBase =
  'alpine:3.24.1@sha256:' +
  '28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';

test('Caddy image builds Caddy with the fixed Go toolchain into a minimal runtime', async () => {
  const source = await readFile(dockerfilePath, 'utf8');

  assert.equal(
    source.match(new RegExp(golangBase.replaceAll('.', '\\.')), 'gu')?.length,
    1,
    'Caddy must use exactly one literal digest-pinned Go builder base',
  );
  assert.equal(
    source.match(new RegExp(alpineBase.replaceAll('.', '\\.')), 'gu')?.length,
    1,
    'Caddy must use exactly one literal digest-pinned Alpine runtime base',
  );
  assert.doesNotMatch(source, /^ARG\s+(?:CADDY|BASE).*IMAGE/imu);
  assert.match(
    source,
    /go version \| grep -Fx 'go version go1\.26\.5 linux\/amd64'/u,
    'the build must prove the fixed Go toolchain',
  );
  assert.match(
    source,
    /go install github\.com\/caddyserver\/caddy\/v2\/cmd\/caddy@v2\.11\.4/u,
    'the build must install the reviewed Caddy release version',
  );
  assert.match(
    source,
    /go version -m \/usr\/bin\/caddy \| grep -E '\^\[\[:space:\]\]\*mod\[\[:space:\]\]\+github\\\.com\/caddyserver\/caddy\/v2\[\[:space:\]\]\+v2\\\.11\\\.4/u,
    'the build must prove the Caddy module version through Go build metadata',
  );
  assert.match(
    source,
    /install -o root -g root -m 0555 \/go\/bin\/caddy \/usr\/bin\/caddy/u,
    'the build must install a root-owned read-only Caddy binary',
  );
  assert.match(
    source,
    /COPY --from=caddy-builder --chown=0:0 --chmod=0555 \/usr\/bin\/caddy \/usr\/bin\/caddy/u,
  );
  assert.match(
    source,
    /COPY --from=caddy-builder --chown=0:0 --chmod=0444 \/etc\/ssl\/certs\/ca-certificates\.crt \/etc\/ssl\/certs\/ca-certificates\.crt/u,
  );
  assert.doesNotMatch(source, /\b(?:apk|apt-get|apt)\s+(?:add|install)\b/iu);
  assert.doesNotMatch(source, /\b(?:getcap|setcap)\b/u);
  assert.doesNotMatch(source, /^VOLUME\s/imu);
});

test('Caddy image is revision-labelled and defaults to the production numeric user', async () => {
  const source = await readFile(dockerfilePath, 'utf8');

  assert.match(source, /^ARG COMMIT_SHA$/mu);
  assert.match(source, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(
    source,
    /^LABEL org\.opencontainers\.image\.source="https:\/\/github\.com\/martinlindblad\/mlp" org\.opencontainers\.image\.revision="\$COMMIT_SHA"$/mu,
  );
  assert.equal(source.match(/^USER 0:0$/gmu)?.length ?? 0, 0);
  assert.equal(source.match(/^USER 65532:65532$/gmu)?.length, 1);
  assert.ok(
    source.lastIndexOf('USER 65532:65532') > source.lastIndexOf('ARG COMMIT_SHA'),
    'the final image user must be the fixed Caddy runtime UID',
  );
  assert.match(source, /caddy version/u);
  assert.match(source, /^ENTRYPOINT \["\/usr\/bin\/caddy"\]$/mu);
  assert.match(
    source,
    /^CMD \["run", "--config", "\/etc\/caddy\/Caddyfile", "--adapter", "caddyfile"\]$/mu,
  );
});
