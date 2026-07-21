#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C

STAGING_TEMP=

fail() {
  local message=$1
  local status=${2:-78}
  printf '%s\n' "$message" >&2
  exit "$status"
}

run_python3() {
  if [[ -x /usr/bin/python3 ]]; then
    /usr/bin/python3 "$@"
  elif [[ -x /usr/local/bin/python3 ]]; then
    /usr/local/bin/python3 "$@"
  else
    fail 'trusted Python runtime is unavailable'
  fi
}

validate_arguments() {
  local argument
  for argument in "$@"; do
    case "$argument" in
      -f | -f?* | -p | -p?* | \
        --candidate-app-image | --candidate-app-image=* | \
        --env-file | --env-file=* | \
        --file | --file=* | \
        --project-directory | --project-directory=* | \
        --project-name | --project-name=* | \
        --environment | --environment=*)
        printf '%s\n' 'unsupported Compose override or environment disclosure' >&2
        exit 64
        ;;
    esac
  done
}

clear_caller_environment() {
  unset "${!APP_@}" "${!AWS_@}" "${!BACKUP_@}" "${!COMPOSE_@}" "${!DOCKER_@}" "${!JOURNAL_@}" "${!MIGRATOR_@}" "${!MLP_@}"
}

validate_directory() {
  local path=$1
  local metadata
  [[ -d "$path" && ! -L "$path" ]] || fail 'invalid runtime directory'
  metadata=$(/usr/bin/stat -c '%u:%g:%a' -- "$path")
  [[ "$metadata" == 0:0:700 ]] || fail 'unsafe runtime directory ownership or mode'
}

validate_file() {
  local path=$1
  local metadata
  [[ -f "$path" && ! -L "$path" && -s "$path" ]] || fail 'invalid runtime file'
  metadata=$(/usr/bin/stat -c '%u:%g:%a' -- "$path")
  [[ "$metadata" == 0:0:600 ]] || fail 'unsafe runtime file ownership or mode'
  run_python3 - "$path" <<'PY' || fail 'unsafe runtime file ownership or mode'
import os
import stat
import sys

path = sys.argv[1]
try:
    before = os.lstat(path)
    fd = os.open(
        path,
        os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise SystemExit(1)
        for entry in (before, after):
            if not stat.S_ISREG(entry.st_mode):
                raise SystemExit(1)
            if entry.st_uid != 0 or entry.st_gid != 0:
                raise SystemExit(1)
            if stat.S_IMODE(entry.st_mode) != 0o600:
                raise SystemExit(1)
            if entry.st_nlink != 1:
                raise SystemExit(1)
        if after.st_size <= 0:
            raise SystemExit(1)
    finally:
        os.close(fd)
except OSError:
    raise SystemExit(1)
PY
}

validate_compose_binary() {
  local metadata
  local version
  [[ -f /usr/local/libexec/mlp/docker-compose && \
    ! -L /usr/local/libexec/mlp/docker-compose && \
    -x /usr/local/libexec/mlp/docker-compose ]] || fail 'invalid Compose binary'
  metadata=$(/usr/bin/stat -c '%u:%g:%a' -- /usr/local/libexec/mlp/docker-compose)
  [[ "$metadata" == 0:0:755 ]] || fail 'unsafe Compose binary ownership or mode'
  version=$(/usr/local/libexec/mlp/docker-compose version --short 2>/dev/null) || \
    fail 'invalid Compose binary version'
  [[ "$version" == 5.3.1 || "$version" == v5.3.1 ]] || \
    fail 'invalid Compose binary version'
}

validate_environment_file() {
  local path=$1
  local prefix=$2
  local expected
  local key
  local line
  local value
  local count=0
  declare -A seen=()

  validate_file "$path"
  case "$path" in
    /etc/mlp/env/app.env)
      expected='APP_CADDY_IMAGE APP_CONTACT_MODE APP_IMAGE APP_JOURNAL_ACTIVE_KEY_ID APP_JOURNAL_AGE_RECIPIENT APP_JOURNAL_R2_BUCKET APP_JOURNAL_R2_ENDPOINT APP_PGCONNECT_TIMEOUT_MS APP_PGDATABASE APP_PGHOST APP_PGPOOL_MAX APP_PGPORT APP_PGSTATEMENT_TIMEOUT_MS APP_PGUSER'
      ;;
    /etc/mlp/env/migrator.env)
      expected='MIGRATOR_PGCONNECT_TIMEOUT_MS MIGRATOR_PGDATABASE MIGRATOR_PGHOST MIGRATOR_PGPOOL_MAX MIGRATOR_PGPORT MIGRATOR_PGSTATEMENT_TIMEOUT_MS MIGRATOR_PGUSER'
      ;;
    /etc/mlp/env/backup.env)
      expected='BACKUP_IMAGE BACKUP_PGDATABASE BACKUP_PGHOST BACKUP_PGPORT BACKUP_PGUSER BACKUP_RESTIC_REPOSITORY'
      ;;
    *)
      fail 'unknown runtime environment file'
      ;;
  esac

  while IFS= read -r line || [[ -n "$line" ]]; do
    ((count += 1))
    [[ "$line" != *$'\r'* && "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] || \
      fail 'invalid runtime environment record'
    key=${line%%=*}
    value=${line#*=}
    [[ "$key" == "$prefix"* ]] || fail 'invalid runtime environment prefix'
    [[ " $expected " == *" $key "* ]] || fail 'unknown runtime environment key'
    [[ -z ${seen[$key]+present} ]] || fail 'duplicate runtime environment key'
    [[ -n "$value" && "$value" != *'$'* && "$value" != *'`'* ]] || \
      fail 'invalid runtime environment value'
    [[ "$value" != *[[:space:]]* ]] || fail 'invalid runtime environment value'
    seen["$key"]=1
  done < "$path"

  for key in $expected; do
    [[ -n ${seen[$key]+present} ]] || fail 'missing runtime environment key'
  done
  [[ "$count" -gt 0 ]] || fail 'empty runtime environment file'
}

validate_secret_file() {
  local path=$1
  local size
  local value=

  validate_file "$path"
  size=$(/usr/bin/stat -c '%s' -- "$path")
  value=$(read_validated_secret_payload "$path") || fail 'invalid runtime secret'
  [[ -n "$value" ]] || fail 'empty runtime secret'
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || \
    fail 'multiline runtime secret'
  [[ ${#value} -eq $((size - 1)) ]] || fail 'runtime secret must end in one newline'
  unset value
}

read_validated_secret_payload() {
  local path=$1
  run_python3 - "$path" <<'PY'
import os
import stat
import sys

path = sys.argv[1]
try:
    before = os.lstat(path)
    fd = os.open(
        path,
        os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise SystemExit(1)
        for entry in (before, after):
            if not stat.S_ISREG(entry.st_mode):
                raise SystemExit(1)
            if entry.st_uid != 0 or entry.st_gid != 0:
                raise SystemExit(1)
            if stat.S_IMODE(entry.st_mode) != 0o600:
                raise SystemExit(1)
            if entry.st_nlink != 1:
                raise SystemExit(1)
        data = b""
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            data += chunk
            if len(data) > 65536:
                raise SystemExit(1)
        if len(data) <= 1 or not data.endswith(b"\n"):
            raise SystemExit(1)
        payload = data[:-1]
        if b"\n" in payload or b"\r" in payload:
            raise SystemExit(1)
        sys.stdout.buffer.write(payload)
    finally:
        os.close(fd)
except OSError:
    raise SystemExit(1)
PY
}

validate_staged_secret() {
  local path=$1
  local uid=$2
  local gid=$3
  local metadata
  [[ -f "$path" && ! -L "$path" && -s "$path" ]] || return 78
  metadata=$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$path") || return 78
  [[ "$metadata" == "$uid:$gid:400:1" ]]
}

stage_secret() {
  local source=$1
  local name=$2
  local uid=$3
  local gid=$4
  local destination=/etc/mlp/compose-secrets/$name
  local destination_inode=
  local prior_inode=
  local source_inode

  source_inode=$(/usr/bin/stat -c '%d:%i' -- "$source") || return 78
  STAGING_TEMP=$(/usr/bin/mktemp /etc/mlp/compose-secrets/.stage.XXXXXXXXXX) || return 70
  read_validated_secret_payload "$source" > "$STAGING_TEMP" || return 70
  /bin/chown "$uid:$gid" -- "$STAGING_TEMP" || return 70
  /bin/chmod 0400 -- "$STAGING_TEMP" || return 70
  validate_staged_secret "$STAGING_TEMP" "$uid" "$gid" || return 78

  if [[ -e "$destination" || -L "$destination" ]]; then
    validate_staged_secret "$destination" "$uid" "$gid" || return 78
    prior_inode=$(/usr/bin/stat -c '%d:%i' -- "$destination") || return 78
    [[ "$prior_inode" != "$source_inode" ]] || return 78
    /usr/bin/cmp --silent -- "$STAGING_TEMP" "$destination" || return 78
  elif ! /bin/ln -- "$STAGING_TEMP" "$destination"; then
    validate_staged_secret "$destination" "$uid" "$gid" || return 78
    /usr/bin/cmp --silent -- "$STAGING_TEMP" "$destination" || return 78
  fi
  destination_inode=$(/usr/bin/stat -c '%d:%i' -- "$destination") || return 78
  [[ "$destination_inode" != "$source_inode" ]] || return 78

  /bin/rm -f -- "$STAGING_TEMP" || return 70
  STAGING_TEMP=
  validate_staged_secret "$destination" "$uid" "$gid"
}

cleanup_staging_temp() {
  [[ -n "$STAGING_TEMP" ]] || return 0
  /bin/rm -f -- "$STAGING_TEMP" || return 70
  STAGING_TEMP=
}

on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  cleanup_staging_temp || status=70
  exit "$status"
}

[[ ${EUID:-$(/usr/bin/id -u)} -eq 0 ]] || {
  printf '%s\n' 'mlp-compose requires root' >&2
  exit 77
}

candidate_app_image=
if [[ ${1:-} == --candidate-app-image ]]; then
  [[ $# -ge 2 ]] || fail 'immutable candidate app image required' 64
  candidate_app_image=$2
  shift 2
  [[ "$candidate_app_image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || \
    fail 'immutable candidate app image required' 64
fi
validate_arguments "$@"
clear_caller_environment
unset XDG_CACHE_HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_RUNTIME_DIR
HOME=/etc/mlp
DOCKER_CONFIG=/etc/mlp/docker-client
DOCKER_HOST=unix:///run/docker.sock
export DOCKER_CONFIG DOCKER_HOST HOME

validate_directory /etc/mlp
validate_directory /etc/mlp/compose-secrets
validate_directory /etc/mlp/docker-client
validate_directory /etc/mlp/env
validate_directory /etc/mlp/secrets
validate_compose_binary
validate_environment_file /etc/mlp/env/app.env APP_
validate_environment_file /etc/mlp/env/migrator.env MIGRATOR_
validate_environment_file /etc/mlp/env/backup.env BACKUP_

validate_file /etc/mlp/secrets/postgres-bootstrap-password
validate_file /etc/mlp/secrets/postgres-migrator-password
validate_file /etc/mlp/secrets/postgres-app-password
validate_file /etc/mlp/secrets/postgres-backup-password
validate_file /etc/mlp/secrets/cloudflare-tunnel-token
validate_file /etc/mlp/secrets/journal-r2-access-key-id
validate_file /etc/mlp/secrets/journal-r2-secret-access-key
validate_file /etc/mlp/secrets/journal-mac-keyring
validate_file /etc/mlp/secrets/restic-password
validate_file /etc/mlp/secrets/restic-s3-access-key-id
validate_file /etc/mlp/secrets/restic-s3-secret-access-key

validate_secret_file /etc/mlp/secrets/postgres-bootstrap-password
validate_secret_file /etc/mlp/secrets/postgres-migrator-password
validate_secret_file /etc/mlp/secrets/postgres-app-password
validate_secret_file /etc/mlp/secrets/postgres-backup-password
validate_secret_file /etc/mlp/secrets/cloudflare-tunnel-token
validate_secret_file /etc/mlp/secrets/journal-r2-access-key-id
validate_secret_file /etc/mlp/secrets/journal-r2-secret-access-key
validate_secret_file /etc/mlp/secrets/journal-mac-keyring
validate_secret_file /etc/mlp/secrets/restic-password
validate_secret_file /etc/mlp/secrets/restic-s3-access-key-id
validate_secret_file /etc/mlp/secrets/restic-s3-secret-access-key

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

stage_secret /etc/mlp/secrets/cloudflare-tunnel-token cloudflare-tunnel-token-cloudflared-a 65532 65532 || fail 'runtime secret staging requires reviewed rotation: cloudflare-tunnel-token-cloudflared-a'
stage_secret /etc/mlp/secrets/cloudflare-tunnel-token cloudflare-tunnel-token-cloudflared-b 65532 65532 || fail 'runtime secret staging requires reviewed rotation: cloudflare-tunnel-token-cloudflared-b'
stage_secret /etc/mlp/secrets/journal-r2-access-key-id journal-r2-access-key-id-app 1000 1000 || fail 'runtime secret staging requires reviewed rotation: journal-r2-access-key-id-app'
stage_secret /etc/mlp/secrets/journal-r2-secret-access-key journal-r2-secret-access-key-app 1000 1000 || fail 'runtime secret staging requires reviewed rotation: journal-r2-secret-access-key-app'
stage_secret /etc/mlp/secrets/journal-mac-keyring journal-mac-keyring-app 1000 1000 || fail 'runtime secret staging requires reviewed rotation: journal-mac-keyring-app'
stage_secret /etc/mlp/secrets/postgres-app-password postgres-app-password-app 1000 1000 || fail 'runtime secret staging requires reviewed rotation: postgres-app-password-app'
stage_secret /etc/mlp/secrets/postgres-app-password postgres-app-password-postgres 70 70 || fail 'runtime secret staging requires reviewed rotation: postgres-app-password-postgres'
stage_secret /etc/mlp/secrets/postgres-backup-password postgres-backup-password-db-backup 10001 10001 || fail 'runtime secret staging requires reviewed rotation: postgres-backup-password-db-backup'
stage_secret /etc/mlp/secrets/postgres-backup-password postgres-backup-password-postgres 70 70 || fail 'runtime secret staging requires reviewed rotation: postgres-backup-password-postgres'
stage_secret /etc/mlp/secrets/postgres-bootstrap-password postgres-bootstrap-password-postgres 70 70 || fail 'runtime secret staging requires reviewed rotation: postgres-bootstrap-password-postgres'
stage_secret /etc/mlp/secrets/postgres-migrator-password postgres-migrator-password-migrator 1000 1000 || fail 'runtime secret staging requires reviewed rotation: postgres-migrator-password-migrator'
stage_secret /etc/mlp/secrets/postgres-migrator-password postgres-migrator-password-postgres 70 70 || fail 'runtime secret staging requires reviewed rotation: postgres-migrator-password-postgres'
stage_secret /etc/mlp/secrets/restic-password restic-password-db-backup 10001 10001 || fail 'runtime secret staging requires reviewed rotation: restic-password-db-backup'
stage_secret /etc/mlp/secrets/restic-s3-access-key-id restic-s3-access-key-id-db-backup 10001 10001 || fail 'runtime secret staging requires reviewed rotation: restic-s3-access-key-id-db-backup'
stage_secret /etc/mlp/secrets/restic-s3-secret-access-key restic-s3-secret-access-key-db-backup 10001 10001 || fail 'runtime secret staging requires reviewed rotation: restic-s3-secret-access-key-db-backup'

if [[ -n "$candidate_app_image" ]]; then
  export APP_IMAGE="$candidate_app_image"
fi

exec /usr/local/libexec/mlp/docker-compose \
  --project-name mlp-prod \
  --project-directory /opt/mlp \
  --env-file /etc/mlp/env/app.env \
  --env-file /etc/mlp/env/migrator.env \
  --env-file /etc/mlp/env/backup.env \
  --file /opt/mlp/compose.production.yml \
  "$@"
