# syntax=docker/dockerfile:1.7

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
USER 0:0
RUN set -eu; \
    test "$(getcap /usr/bin/caddy)" = '/usr/bin/caddy cap_net_bind_service=ep'; \
    setcap -r /usr/bin/caddy; \
    test -z "$(getcap /usr/bin/caddy)"; \
    caddy version | grep -F 'v2.11.4'
ARG COMMIT_SHA
RUN printf '%s\n' "$COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
USER 65532:65532
