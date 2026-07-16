FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS deps
WORKDIR /app
COPY package.json yarn.lock ./
COPY patches ./patches
RUN yarn install --frozen-lockfile --non-interactive

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build:production

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS age
ADD --checksum=sha256:bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377 \
  https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-amd64.tar.gz \
  /tmp/age.tgz
RUN test "$(uname -m)" = "x86_64" && \
  printf '%s  %s\n' 'bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377' '/tmp/age.tgz' | sha256sum -c - && \
  mkdir /tmp/age-extract && \
  tar -xzf /tmp/age.tgz -C /tmp/age-extract age/age && \
  install -o root -g root -m 0555 /tmp/age-extract/age/age /usr/local/bin/age && \
  rm -rf /tmp/age.tgz /tmp/age-extract && \
  test "$(/usr/local/bin/age --version)" = "v1.3.1" && \
  test "$(stat -c '%U:%G %a' /usr/local/bin/age)" = "root:root 555"

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runner
RUN apt-get purge -y --allow-remove-essential \
    apt \
    libgnutls30 \
    adduser \
    bsdutils \
    debian-archive-keyring \
    gzip \
    gpgv \
    libapt-pkg6.0 \
    libacl1 \
    libblkid1 \
    libffi8 \
    libhogweed6 \
    libnettle8 \
    libp11-kit0 \
    libseccomp2 \
    libtasn1-6 \
    libtinfo6 \
    libuuid1 \
    libxxhash0 \
    ncurses-base \
    perl-base \
    util-linux && \
  rm -rf \
    /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /var/lib/apt/lists/* \
    /var/cache/apt/* \
    /var/log/apt/* && \
  node --version >/dev/null && \
  ! ldd /usr/local/bin/node | grep -q 'not found' && \
  test ! -e /usr/lib/x86_64-linux-gnu/libgnutls.so.30.34.3 && \
  test ! -e /usr/bin/apt-get && \
  test ! -e /usr/local/lib/node_modules/npm && \
  test ! -e /usr/local/bin/npm && \
  test ! -e /usr/local/bin/npx
ARG COMMIT_SHA
RUN printf '%s\n' "$COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=0:0 --chmod=0555 /app/.next/standalone ./
COPY --from=builder --chown=0:0 --chmod=0555 /app/.next/static ./.next/static
COPY --from=builder --chown=0:0 --chmod=0555 /app/public ./public
COPY --from=builder --chown=0:0 --chmod=0555 /app/dist/scripts/db ./dist/scripts/db
COPY --from=builder --chown=0:0 --chmod=0555 /app/dist/server/db ./dist/server/db
COPY --from=builder --chown=0:0 --chmod=0555 /app/node_modules/kysely/dist/migration ./node_modules/kysely/dist/migration
COPY --from=age --chown=0:0 --chmod=0555 /usr/local/bin/age /usr/local/bin/age
USER 1000:1000
RUN test "$(age --version)" = "v1.3.1" && test ! -w /usr/local/bin/age
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
