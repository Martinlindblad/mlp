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
  'caddy:2.10.2-alpine@sha256:' +
  '4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d';
const golangBase =
  'golang:1.26.5-alpine@sha256:' +
  '0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2';
const alpineBase =
  'alpine:3.24.1@sha256:' +
  '28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';

test('Caddy image builds a scanner-fixed binary on a minimal runtime', async () => {
  const source = await readFile(dockerfilePath, 'utf8');

  assert.equal(
    source.match(new RegExp(golangBase.replaceAll('.', '\\.')), 'gu')?.length,
    1,
    'Caddy builder must use the exact reviewed Go base',
  );
  assert.equal(
    source.match(new RegExp(alpineBase.replaceAll('.', '\\.')), 'gu')?.length,
    1,
    'Caddy runtime must use the exact reviewed Alpine base',
  );
  assert.doesNotMatch(source, new RegExp(caddyBase.replaceAll('.', '\\.'), 'u'));
  assert.doesNotMatch(source, /^ARG\s+(?:CADDY|BASE).*IMAGE/imu);
  assert.match(source, /go version go1\.26\.5 linux\/amd64/u);
  assert.match(source, /\bGOMAXPROCS=1\b/u);
  assert.match(source, /\bGOFLAGS=-p=1\b/u);
  assert.match(
    source,
    /go get github\.com\/caddyserver\/caddy\/v2\/cmd\/caddy@v2\.11\.4/u,
  );
  for (const patchedModule of [
    'github.com/caddyserver/caddy/v2@v2.11.4',
    'go.opentelemetry.io/otel@v1.43.0',
    'go.opentelemetry.io/otel/sdk@v1.43.0',
    'golang.org/x/crypto@v0.52.0',
    'golang.org/x/net@v0.55.0',
    'github.com/go-jose/go-jose/v3@v3.0.5',
    'github.com/go-jose/go-jose/v4@v4.1.4',
    'github.com/quic-go/quic-go@v0.59.1',
    'github.com/slackhq/nebula@v1.10.3',
    'github.com/smallstep/certificates@v0.30.2',
    'google.golang.org/grpc@v1.81.0',
  ]) {
    assert.match(source, new RegExp(patchedModule.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(
    source,
    /^COPY --from=caddy-builder --chown=0:0 --chmod=0555 \/usr\/local\/bin\/caddy \/usr\/bin\/caddy$/mu,
  );
  assert.match(source, /go build -trimpath -ldflags/u);
  assert.doesNotMatch(source, /\bgo install\b/u);
  assert.match(
    source,
    /apk add --no-cache curl=8\.21\.0-r0 libcap-utils=2\.78-r0/u,
  );
  assert.doesNotMatch(source, /\b(?:apt-get|apt)\s+install\b/iu);
  assert.doesNotMatch(source, /\b(?:getcap|setcap)\b/u);
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
  assert.match(source, /^ENTRYPOINT \["\/usr\/bin\/caddy"\]$/mu);
  assert.match(
    source,
    /^CMD \["run", "--config", "\/etc\/caddy\/Caddyfile", "--adapter", "caddyfile"\]$/mu,
  );
});
