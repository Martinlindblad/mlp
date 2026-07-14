#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C

fail() {
  local message=$1
  local status=${2:-78}
  printf '%s\n' "$message" >&2
  exit "$status"
}

validate_arguments() {
  local argument
  for argument in "$@"; do
    case "$argument" in
      -f | -f?* | -p | -p?* | \
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
  unset "${!APP_@}" "${!BACKUP_@}" "${!COMPOSE_@}" "${!DOCKER_@}" "${!MIGRATOR_@}" "${!MLP_@}"
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
      expected='APP_CONTACT_MODE APP_IMAGE APP_PGCONNECT_TIMEOUT_MS APP_PGDATABASE APP_PGHOST APP_PGPOOL_MAX APP_PGPORT APP_PGUSER'
      ;;
    /etc/mlp/env/migrator.env)
      expected='MIGRATOR_PGCONNECT_TIMEOUT_MS MIGRATOR_PGDATABASE MIGRATOR_PGHOST MIGRATOR_PGPOOL_MAX MIGRATOR_PGPORT MIGRATOR_PGUSER'
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

read_secret() {
  local path=$1
  local size
  local value

  validate_file "$path"
  size=$(/usr/bin/stat -c '%s' -- "$path")
  value=$(/bin/cat -- "$path")
  [[ -n "$value" ]] || fail 'empty runtime secret'
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || \
    fail 'multiline runtime secret'
  [[ ${#value} -eq $((size - 1)) ]] || fail 'runtime secret must end in one newline'
  printf '%s' "$value"
}

[[ ${EUID:-$(/usr/bin/id -u)} -eq 0 ]] || {
  printf '%s\n' 'mlp-compose requires root' >&2
  exit 77
}
validate_arguments "$@"
clear_caller_environment

validate_directory /etc/mlp
validate_directory /etc/mlp/env
validate_directory /etc/mlp/secrets
validate_environment_file /etc/mlp/env/app.env APP_
validate_environment_file /etc/mlp/env/migrator.env MIGRATOR_
validate_environment_file /etc/mlp/env/backup.env BACKUP_

validate_file /etc/mlp/secrets/postgres-bootstrap-password
validate_file /etc/mlp/secrets/postgres-migrator-password
validate_file /etc/mlp/secrets/postgres-app-password
validate_file /etc/mlp/secrets/postgres-backup-password
validate_file /etc/mlp/secrets/cloudflare-tunnel-token
validate_file /etc/mlp/secrets/restic-password
validate_file /etc/mlp/secrets/restic-s3-access-key-id
validate_file /etc/mlp/secrets/restic-s3-secret-access-key

MLP_POSTGRES_BOOTSTRAP_PASSWORD="$(read_secret /etc/mlp/secrets/postgres-bootstrap-password)"
MLP_POSTGRES_MIGRATOR_PASSWORD="$(read_secret /etc/mlp/secrets/postgres-migrator-password)"
MLP_POSTGRES_APP_PASSWORD="$(read_secret /etc/mlp/secrets/postgres-app-password)"
MLP_POSTGRES_BACKUP_PASSWORD="$(read_secret /etc/mlp/secrets/postgres-backup-password)"
MLP_CLOUDFLARE_TUNNEL_TOKEN="$(read_secret /etc/mlp/secrets/cloudflare-tunnel-token)"
MLP_RESTIC_PASSWORD="$(read_secret /etc/mlp/secrets/restic-password)"
MLP_RESTIC_S3_ACCESS_KEY_ID="$(read_secret /etc/mlp/secrets/restic-s3-access-key-id)"
MLP_RESTIC_S3_SECRET_ACCESS_KEY="$(read_secret /etc/mlp/secrets/restic-s3-secret-access-key)"
export MLP_POSTGRES_BOOTSTRAP_PASSWORD MLP_POSTGRES_MIGRATOR_PASSWORD MLP_POSTGRES_APP_PASSWORD MLP_POSTGRES_BACKUP_PASSWORD MLP_CLOUDFLARE_TUNNEL_TOKEN MLP_RESTIC_PASSWORD MLP_RESTIC_S3_ACCESS_KEY_ID MLP_RESTIC_S3_SECRET_ACCESS_KEY

exec /usr/bin/docker compose \
  --project-name mlp-prod \
  --project-directory /opt/mlp \
  --env-file /etc/mlp/env/app.env \
  --env-file /etc/mlp/env/migrator.env \
  --env-file /etc/mlp/env/backup.env \
  --file /opt/mlp/compose.production.yml \
  "$@"
