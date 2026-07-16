# syntax=docker/dockerfile:1.7
FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS production-dependencies
WORKDIR /app
COPY infra/migration/package.json infra/migration/yarn.lock ./
RUN yarn install --frozen-lockfile --production=true --ignore-scripts --non-interactive

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
ADD --checksum=sha256:15b3562b13ff9aac3baa2594c705ea0ac3597f4b85c7653f17efcd36e8588678 https://fastdl.mongodb.org/tools/db/mongodb-database-tools-debian12-x86_64-100.17.0.tgz /tmp/mongodb-tools.tgz
ADD --checksum=sha256:bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377 https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-amd64.tar.gz /tmp/age.tgz
RUN test "$(uname -m)" = x86_64
RUN printf '%s  %s\n' '15b3562b13ff9aac3baa2594c705ea0ac3597f4b85c7653f17efcd36e8588678' /tmp/mongodb-tools.tgz | sha256sum -c -
RUN printf '%s  %s\n' 'bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377' /tmp/age.tgz | sha256sum -c -
RUN mkdir -p /tmp/mongodb-tools /tmp/age-tools \
  && tar -xzf /tmp/mongodb-tools.tgz -C /tmp/mongodb-tools mongodb-database-tools-debian12-x86_64-100.17.0/bin/mongodump \
  && tar -xzf /tmp/age.tgz -C /tmp/age-tools age/age \
  && install -o 0 -g 0 -m 0555 /tmp/mongodb-tools/mongodb-database-tools-debian12-x86_64-100.17.0/bin/mongodump /usr/local/bin/mongodump \
  && install -o 0 -g 0 -m 0555 /tmp/age-tools/age/age /usr/local/bin/age \
  && rm -rf /tmp/mongodb-tools /tmp/age-tools /tmp/mongodb-tools.tgz /tmp/age.tgz
RUN yarn build:migration

FROM postgres:18.4-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296 AS mongodump-libraries
RUN set -eu; \
  for library in \
    /usr/lib/x86_64-linux-gnu/libgssapi_krb5.so.2 \
    /usr/lib/x86_64-linux-gnu/libkrb5.so.3 \
    /usr/lib/x86_64-linux-gnu/libk5crypto.so.3 \
    /usr/lib/x86_64-linux-gnu/libcom_err.so.2 \
    /usr/lib/x86_64-linux-gnu/libkrb5support.so.0 \
    /usr/lib/x86_64-linux-gnu/libkeyutils.so.1; \
  do \
    case "$library" in *libgnutls*) exit 1 ;; esac; \
    resolved="$(readlink -f "$library")"; \
    test -f "$resolved"; \
    test "${resolved%/*}" = "${library%/*}"; \
    target_directory="/mongodump-runtime${library%/*}"; \
    mkdir -p "$target_directory"; \
    cp -a "$library" "$target_directory/"; \
    if [ "$resolved" != "$library" ]; then cp -a "$resolved" "$target_directory/"; fi; \
  done

FROM restic/restic:0.18.1@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76 AS ca-certificates
RUN test -r /etc/ssl/certs/ca-certificates.crt

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runner
ARG COMMIT_SHA
RUN printf '%s\n' "$COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
WORKDIR /app
ENV NODE_ENV=production
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
COPY --from=mongodump-libraries --chown=0:0 --chmod=0555 /mongodump-runtime/ /
COPY --from=ca-certificates --chown=0:0 --chmod=0444 /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder --chown=0:0 --chmod=0555 /app/public ./public
COPY --from=builder --chown=0:0 --chmod=0555 /usr/local/bin/mongodump /usr/local/bin/mongodump
COPY --from=builder --chown=0:0 --chmod=0555 /usr/local/bin/age /usr/local/bin/age
COPY --chown=0:0 --chmod=0555 infra/migration/entrypoint.sh /usr/local/bin/mlp-migration
USER 1000:1000
RUN test "$(uname -m)" = x86_64 \
  && mongodump --version | grep -F 'mongodump version: 100.17.0' \
  && age --version | grep -Fx 'v1.3.1' \
  && test -r /etc/ssl/certs/ca-certificates.crt \
  && test ! -w /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["/usr/local/bin/mlp-migration"]
