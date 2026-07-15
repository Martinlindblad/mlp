# syntax=docker/dockerfile:1.7

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
USER 0:0
RUN set -eu; \
    test "$(getcap /usr/bin/caddy)" = '/usr/bin/caddy cap_net_bind_service=ep'; \
    setcap -r /usr/bin/caddy; \
    test -z "$(getcap /usr/bin/caddy)"; \
    caddy version | grep -F 'v2.10.2'
ARG COMMIT_SHA
RUN printf '%s\n' "$COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
USER 65532:65532
