# syntax=docker/dockerfile:1.7
FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS production-dependencies
WORKDIR /app
COPY infra/migration/package.json infra/migration/yarn.lock ./
RUN yarn install --frozen-lockfile --production=true --ignore-scripts --non-interactive
RUN rm -f \
    node_modules/mongodb/lib/client-side-encryption/crypto_callbacks.js \
    node_modules/mongodb/src/client-side-encryption/crypto_callbacks.ts \
    node_modules/pg-connection-string/README.md \
    node_modules/pg-pool/README.md \
  && rm -rf node_modules/zod/src/v4/classic/tests

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS builder
WORKDIR /app
COPY package.json yarn.lock ./
COPY tsconfig.base.json tsconfig.migration-build.json ./
COPY migration ./migration
COPY scripts/journal ./scripts/journal
COPY scripts/migration ./scripts/migration
COPY server/api/serializers.ts ./server/api/serializers.ts
COPY server/db/client.ts server/db/config.ts server/db/database.types.ts ./server/db/
COPY server/journal ./server/journal
COPY server/repositories/contact-repository.ts ./server/repositories/contact-repository.ts
COPY types/DBTypes.ts ./types/DBTypes.ts
COPY public ./public
RUN yarn install --frozen-lockfile --ignore-scripts --non-interactive
RUN yarn build:migration

FROM golang:1.27.1-alpine@sha256:cf6fca6641884b8433441b2b0652976f975e1d0fdd26d177eaaf8596087f3125 AS mongodump-builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=mod
RUN test "$(uname -m)" = x86_64 \
  && go version | grep -Fx 'go version go1.26.5 linux/amd64'
ADD --checksum=sha256:27d00697a7715443912ce0c76f11e760cfec450a885ac18b499412d4097eeab2 https://github.com/mongodb/mongo-tools/archive/refs/tags/100.17.0.tar.gz /tmp/mongo-tools.tgz
RUN printf '%s  %s\n' '27d00697a7715443912ce0c76f11e760cfec450a885ac18b499412d4097eeab2' /tmp/mongo-tools.tgz | sha256sum -c -
RUN mkdir -p /tmp/mongo-tools \
  && tar -xzf /tmp/mongo-tools.tgz -C /tmp/mongo-tools --strip-components=1 \
  && cd /tmp/mongo-tools \
  && go mod edit -go=1.26.5 \
  && go get \
    golang.org/x/crypto@v0.52.0 \
    golang.org/x/net@v0.55.0 \
    golang.org/x/sys@v0.45.0 \
    golang.org/x/term@v0.43.0 \
    golang.org/x/text@v0.37.0 \
  && go mod tidy \
  && go build -trimpath -ldflags "-s -w -X main.VersionStr=100.17.0 -X main.GitCommit=b414a2d909375f76e2c36fef91d1e3804b6b2c02" -o /tmp/mongodump ./mongodump/main/mongodump.go \
  && install -o root -g root -m 0555 /tmp/mongodump /usr/local/bin/mongodump \
  && /usr/local/bin/mongodump --version | grep -F 'mongodump version: 100.17.0' \
  && go version -m /usr/local/bin/mongodump \
  && go version -m /usr/local/bin/mongodump | grep -F 'go1.26.5' \
  && go version -m /usr/local/bin/mongodump | grep -E 'dep[[:space:]]+golang\.org/x/crypto[[:space:]]+v0\.52\.0' \
  && go version -m /usr/local/bin/mongodump | grep -E 'dep[[:space:]]+golang\.org/x/net[[:space:]]+v0\.55\.0' \
  && go version -m /usr/local/bin/mongodump | grep -E 'dep[[:space:]]+golang\.org/x/sys[[:space:]]+v0\.45\.0' \
  && go version -m /usr/local/bin/mongodump | grep -E 'dep[[:space:]]+golang\.org/x/term[[:space:]]+v0\.43\.0' \
  && go version -m /usr/local/bin/mongodump | grep -E 'dep[[:space:]]+golang\.org/x/text[[:space:]]+v0\.37\.0' \
  && test "$(stat -c '%U:%G %a' /usr/local/bin/mongodump)" = 'root:root 555' \
  && rm -rf /tmp/mongo-tools /tmp/mongo-tools.tgz /tmp/mongodump /go/pkg/mod /root/.cache/go-build

FROM golang:1.27.1-alpine@sha256:cf6fca6641884b8433441b2b0652976f975e1d0fdd26d177eaaf8596087f3125 AS age-builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN test "$(uname -m)" = x86_64 \
  && go version | grep -Fx 'go version go1.26.5 linux/amd64' \
  && mkdir /tmp/age-build \
  && cd /tmp/age-build \
  && go mod init mlp-age-build \
  && go get filippo.io/age/cmd/age@v1.3.1 golang.org/x/crypto@v0.52.0 \
  && go install filippo.io/age/cmd/age \
  && install -o root -g root -m 0555 /go/bin/age /usr/local/bin/age \
  && rm -rf /tmp/age-build /go/pkg/mod /root/.cache/go-build \
  && test "$(/usr/local/bin/age --version)" = v1.3.1 \
  && test "$(stat -c '%U:%G %a' /usr/local/bin/age)" = 'root:root 555'

FROM restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510 AS ca-certificates
RUN test -r /etc/ssl/certs/ca-certificates.crt \
  && mkdir -p /ca-runtime/etc/ssl/certs \
  && cp -a /etc/ssl/certs/ca-certificates.crt /ca-runtime/etc/ssl/certs/ca-certificates.crt

FROM busybox:1.37.0-musl@sha256:222ad6d973c0d198014546a65cd02c5fdedcc172123c5b4c2bf0af636550bd94 AS shell-tools
RUN set -eu; \
  mkdir -p /shell-bin; \
  cp /bin/busybox /shell-bin/busybox; \
  for applet in cat chmod chown date find grep head id mkdir mktemp mv rm sed sh sha256sum stat true uname; do \
    /bin/busybox --list | grep -Fx "$applet" >/dev/null; \
    ln /shell-bin/busybox "/shell-bin/$applet"; \
  done; \
  for applet in busybox cat chmod chown date find grep head id mkdir mktemp mv rm sed sh sha256sum stat true uname; do \
    test "$(stat -c '%U:%G %a' "/shell-bin/$applet")" = 'root:root 755'; \
  done

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:a2723a2817c5b01b8e7b98d567bc8b5a6b0e713e25bfb0a82b6ade4b9db06f50 AS runner
ARG COMMIT_SHA
RUN ["/nodejs/bin/node", "-e", "const sha = process.env.COMMIT_SHA || \"\"; if (!/^[0-9a-f]{40}$/.test(sha)) process.exit(1);"]
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
WORKDIR /app
ENV NODE_ENV=production PATH=/nodejs/bin:/usr/local/bin:/bin
COPY --from=builder --chown=0:0 --chmod=0555 /app/operator-dist/migration ./migration
COPY --from=builder --chown=0:0 --chmod=0555 /app/operator-dist/scripts/journal ./scripts/journal
COPY --from=builder --chown=0:0 --chmod=0555 /app/operator-dist/scripts/migration ./scripts/migration
COPY --from=builder --chown=0:0 --chmod=0555 /app/operator-dist/server/api/serializers.js ./server/api/serializers.js
COPY --from=builder --chown=0:0 --chmod=0555 /app/operator-dist/server/db/client.js ./server/db/client.js
COPY --from=builder --chown=0:0 --chmod=0555 /app/operator-dist/server/db/config.js ./server/db/config.js
COPY --from=builder --chown=0:0 --chmod=0555 /app/operator-dist/server/db/database.types.js ./server/db/database.types.js
COPY --from=builder --chown=0:0 --chmod=0555 /app/operator-dist/server/journal ./server/journal
COPY --from=builder --chown=0:0 --chmod=0555 /app/migration/asset-paths.mjs ./migration/asset-paths.mjs
COPY --from=builder --chown=0:0 --chmod=0555 /app/scripts/migration/export-mongo.sh ./scripts/migration/export-mongo.sh
COPY --from=production-dependencies --chown=0:0 --chmod=0555 /app/node_modules ./node_modules
COPY --from=ca-certificates --chown=0:0 --chmod=0555 /ca-runtime/ /
COPY --from=shell-tools --chown=0:0 --chmod=0555 /shell-bin /bin
COPY --from=builder --chown=0:0 --chmod=0555 /app/public ./public
COPY --from=mongodump-builder --chown=0:0 --chmod=0555 /usr/local/bin/mongodump /usr/local/bin/mongodump
COPY --from=age-builder --chown=0:0 --chmod=0555 /usr/local/bin/age /usr/local/bin/age
COPY --chown=0:0 --chmod=0555 infra/migration/entrypoint.sh /usr/local/bin/mlp-migration
USER 1000:1000
RUN test "$(uname -m)" = x86_64 \
  && test "$(node --version)" = v22.23.1 \
  && test "$(command -v node)" = /nodejs/bin/node \
  && mongodump --version | grep -F 'mongodump version: 100.17.0' \
  && age --version | grep -Fx 'v1.3.1' \
  && test -r /etc/ssl/certs/ca-certificates.crt \
  && test ! -w /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["/usr/local/bin/mlp-migration"]
