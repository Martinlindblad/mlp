FROM node:26.5.1-bookworm-slim@sha256:9e6f9357d371591e32ab6f2d8a26d63bdd0d17c29eee3f4f3e7e454d9634bf73 AS deps
WORKDIR /app
COPY package.json yarn.lock ./
COPY patches ./patches
RUN yarn install --frozen-lockfile --non-interactive

FROM node:26.5.1-bookworm-slim@sha256:9e6f9357d371591e32ab6f2d8a26d63bdd0d17c29eee3f4f3e7e454d9634bf73 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build:production

FROM golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS age-builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN test "$(uname -m)" = "x86_64" && \
  go version | grep -Fx 'go version go1.26.5 linux/amd64' && \
  mkdir /tmp/age-build && \
  cd /tmp/age-build && \
  go mod init mlp-age-build && \
  go get filippo.io/age/cmd/age@v1.3.1 golang.org/x/crypto@v0.52.0 && \
  go install filippo.io/age/cmd/age && \
  install -o root -g root -m 0555 /go/bin/age /usr/local/bin/age && \
  rm -rf /tmp/age-build /go/pkg/mod /root/.cache/go-build && \
  test "$(/usr/local/bin/age --version)" = "v1.3.1" && \
  test "$(stat -c '%U:%G %a' /usr/local/bin/age)" = "root:root 555"

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:a2723a2817c5b01b8e7b98d567bc8b5a6b0e713e25bfb0a82b6ade4b9db06f50 AS runner
ARG COMMIT_SHA
RUN ["/nodejs/bin/node", "-e", "const sha = process.env.COMMIT_SHA || \"\"; if (!/^[0-9a-f]{40}$/.test(sha)) process.exit(1);"]
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=0:0 --chmod=0555 /app/.next/standalone ./
COPY --from=builder --chown=0:0 --chmod=0555 /app/.next/static ./.next/static
COPY --from=builder --chown=0:0 --chmod=0555 /app/public ./public
COPY --from=builder --chown=0:0 --chmod=0555 /app/dist/scripts/db ./dist/scripts/db
COPY --from=builder --chown=0:0 --chmod=0555 /app/dist/server/db ./dist/server/db
COPY --from=builder --chown=0:0 --chmod=0555 /app/node_modules/kysely/dist/migration ./node_modules/kysely/dist/migration
COPY --from=age-builder --chown=0:0 --chmod=0555 /usr/local/bin/age /usr/local/bin/age
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["server.js"]
