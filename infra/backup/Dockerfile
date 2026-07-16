# syntax=docker/dockerfile:1.7

FROM golang:1.26.5-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS restic
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
RUN test "$(uname -m)" = x86_64 \
  && go version | grep -Fx 'go version go1.26.5 linux/amd64' \
  && mkdir /tmp/restic-build \
  && cd /tmp/restic-build \
  && go mod init mlp-restic-build \
  && go get github.com/restic/restic/cmd/restic@v0.18.1 \
  && go get go.opentelemetry.io/otel@v1.43.0 go.opentelemetry.io/otel/sdk@v1.43.0 golang.org/x/crypto@v0.52.0 golang.org/x/net@v0.55.0 github.com/go-jose/go-jose/v4@v4.1.4 google.golang.org/grpc@v1.79.3 \
  && go install github.com/restic/restic/cmd/restic \
  && install -o root -g root -m 0555 /go/bin/restic /usr/local/bin/restic \
  && rm -rf /tmp/restic-build /go/pkg/mod /root/.cache/go-build \
  && /usr/local/bin/restic version | grep -F '0.18.1' \
  && set +e; ldd_output="$(ldd /usr/local/bin/restic 2>&1)"; ldd_status=$?; set -e; test "$ldd_status" -ne 0; case "$ldd_output" in *": /usr/local/bin/restic: Not a valid dynamic program") : ;; *) exit 1 ;; esac

FROM postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15 AS postgres-tools
RUN set -eu; \
    pg_dump --version | grep -F '18.4'; \
    pg_restore --version | grep -F '18.4'; \
    ldd /usr/local/bin/pg_dump > /tmp/pg-dump.ldd; \
    ldd /usr/local/bin/pg_restore > /tmp/pg-restore.ldd; \
    cat /tmp/pg-dump.ldd /tmp/pg-restore.ldd > /tmp/pg-tools.ldd; \
    awk '$2 == "=>" && $3 ~ /^\/(lib|usr\/lib|usr\/local\/lib)\// && $3 !~ /\/ld-musl-.*\.so\.1$/ { print $3 }' /tmp/pg-tools.ldd | sort -u > /tmp/pg-libraries; \
    for soname in \
      libpq.so \
      libzstd.so \
      liblz4.so \
      libcrypto.so \
      libz.so \
      libssl.so \
      libgssapi_krb5.so \
      libldap.so \
      libkrb5.so \
      libk5crypto.so \
      libcom_err.so \
      libkrb5support.so \
      liblber.so \
      libsasl2.so \
      libkeyutils.so; \
    do \
      grep -F "/$soname" /tmp/pg-libraries > /dev/null; \
    done; \
    mkdir -p /pg-runtime/usr/local/bin; \
    cp -a /usr/local/bin/pg_dump /usr/local/bin/pg_restore /pg-runtime/usr/local/bin/; \
    while IFS= read -r library; do \
      case "${library##*/}" in \
        libpq.so*|libzstd.so*|liblz4.so*|libcrypto.so*|libz.so*|libssl.so*|libgssapi_krb5.so*|libldap.so*|libkrb5.so*|libk5crypto.so*|libcom_err.so*|libkrb5support.so*|liblber.so*|libsasl2.so*|libkeyutils.so*) ;; \
        *) exit 1 ;; \
      esac; \
      case "$library" in \
        /lib/*|/usr/lib/*|/usr/local/lib/*) ;; \
        *) exit 1 ;; \
      esac; \
      resolved="$(readlink -f "$library")"; \
      test -f "$resolved"; \
      test "${resolved%/*}" = "${library%/*}"; \
      target_directory="/pg-runtime${library%/*}"; \
      mkdir -p "$target_directory"; \
      cp -a "$library" "$target_directory/"; \
      if [ "$resolved" != "$library" ]; then cp -a "$resolved" "$target_directory/"; fi; \
    done < /tmp/pg-libraries

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS backup
RUN addgroup -S -g 10001 backup && adduser -S -D -H -u 10001 -G backup backup
COPY --from=postgres-tools --chown=0:0 --chmod=0555 /pg-runtime/ /
COPY --from=restic --chown=0:0 --chmod=0555 /usr/local/bin/restic /usr/local/bin/restic
COPY --from=restic --chown=0:0 --chmod=0444 /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chown=0:0 --chmod=0555 infra/backup/backup.sh /usr/local/bin/mlp-backup
COPY --chown=0:0 --chmod=0555 infra/backup/restic.sh /usr/local/bin/mlp-restic
ARG COMMIT_SHA
RUN printf '%s\n' "$COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$'
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" org.opencontainers.image.revision="$COMMIT_SHA"
USER 10001:10001
RUN pg_dump --version | grep -F '18.4' && pg_restore --version | grep -F '18.4' && restic version | grep -F '0.18.1' && test -r /etc/ssl/certs/ca-certificates.crt && test ! -w /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["/usr/local/bin/mlp-backup"]
