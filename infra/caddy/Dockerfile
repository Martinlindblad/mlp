# syntax=docker/dockerfile:1.7

FROM golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS caddy-builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-p=1 GOMAXPROCS=1
RUN test "$(uname -m)" = x86_64 \
  && go version | grep -Fx 'go version go1.26.5 linux/amd64' \
  && mkdir /tmp/caddy-build \
  && cd /tmp/caddy-build \
  && go mod init mlp-caddy-build \
  && go get github.com/caddyserver/caddy/v2/cmd/caddy@v2.11.4 \
  && go get github.com/caddyserver/caddy/v2@v2.11.4 go.opentelemetry.io/otel@v1.43.0 go.opentelemetry.io/otel/sdk@v1.43.0 golang.org/x/crypto@v0.52.0 golang.org/x/net@v0.55.0 github.com/go-jose/go-jose/v3@v3.0.5 github.com/go-jose/go-jose/v4@v4.1.4 github.com/quic-go/quic-go@v0.59.1 github.com/slackhq/nebula@v1.10.3 github.com/smallstep/certificates@v0.30.2 google.golang.org/grpc@v1.81.0 \
  && go build -trimpath -ldflags "-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=v2.11.4" -o /usr/local/bin/caddy github.com/caddyserver/caddy/v2/cmd/caddy \
  && chmod 0555 /usr/local/bin/caddy \
  && rm -rf /tmp/caddy-build /go/pkg/mod /root/.cache/go-build \
  && /usr/local/bin/caddy version | grep -F 'v2.11.4'

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
USER 0:0
RUN apk add --no-cache curl=8.21.0-r0 libcap-utils=2.78-r0 \
  && rm -rf /var/cache/apk/*
COPY --from=caddy-builder --chown=0:0 --chmod=0555 /usr/local/bin/caddy /usr/bin/caddy
ARG COMMIT_SHA
RUN printf '%s\n' "$COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
RUN /usr/bin/caddy version | grep -F 'v2.11.4' \
  && curl --version >/dev/null
USER 65532:65532
ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
