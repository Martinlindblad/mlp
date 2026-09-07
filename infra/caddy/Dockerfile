# syntax=docker/dockerfile:1.7

FROM golang:1.27.1-alpine@sha256:cf6fca6641884b8433441b2b0652976f975e1d0fdd26d177eaaf8596087f3125 AS caddy-builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN test "$(uname -m)" = "x86_64" && \
    go version | grep -Fx 'go version go1.26.5 linux/amd64'
RUN go install github.com/caddyserver/caddy/v2/cmd/caddy@v2.11.4
RUN test -x /go/bin/caddy && \
    install -o root -g root -m 0555 /go/bin/caddy /usr/bin/caddy && \
    rm -rf /go/pkg/mod /root/.cache/go-build
RUN /usr/bin/caddy version && \
    go version -m /usr/bin/caddy | grep -E '^[[:space:]]*mod[[:space:]]+github\.com/caddyserver/caddy/v2[[:space:]]+v2\.11\.4[[:space:]]' && \
    test "$(stat -c '%U:%G %a' /usr/bin/caddy)" = "root:root 555" && \
    test -r /etc/ssl/certs/ca-certificates.crt

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS caddy
COPY --from=caddy-builder --chown=0:0 --chmod=0555 /usr/bin/caddy /usr/bin/caddy
COPY --from=caddy-builder --chown=0:0 --chmod=0444 /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ARG COMMIT_SHA
RUN printf '%s\n' "$COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
USER 65532:65532
RUN test "$(uname -m)" = "x86_64" && \
    caddy version && \
    test -r /etc/ssl/certs/ca-certificates.crt && \
    test ! -w /etc/ssl/certs/ca-certificates.crt
CMD ["/usr/bin/caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
