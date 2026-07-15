#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
LC_ALL=C
export PATH LC_ALL

# shellcheck source=/dev/null
source /opt/mlp/ops/lib/operations.sh

set_fixed_environment() {
  DOCKER_CONFIG=/etc/mlp/docker-client
  DOCKER_HOST=unix:///run/docker.sock
  HOME=/etc/mlp
  PATH=/usr/sbin:/usr/bin:/sbin:/bin
  LC_ALL=C
  export DOCKER_CONFIG DOCKER_HOST HOME PATH LC_ALL
  unset DOCKER_CONTEXT
  unset XDG_CACHE_HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_RUNTIME_DIR
}

OPERATION=
SYNTHETIC_UUID=
CONFIG_MIGRATION_ARCHIVE_RECIPIENT=
CONFIG_MIGRATION_IMAGE=
CONFIG_MIGRATION_MONGO_DATABASE=
CONFIG_MIGRATION_PGCONNECT_TIMEOUT_MS=
CONFIG_MIGRATION_PGDATABASE=
CONFIG_MIGRATION_PGHOST=
CONFIG_MIGRATION_PGPOOL_MAX=
CONFIG_MIGRATION_PGPORT=
CONFIG_MIGRATION_PGUSER=
EXPECTED_MIGRATION_IMAGE_ID=
STAGED_SECRET_TEMP=
STAGED_MONGO_SECRET_OWNED=no
STAGED_POSTGRES_SECRET_OWNED=no
PLANNED_HELPER_NAME=
PLANNED_RUN_ID=
PLANNED_SERVICE=
ACTIVE_HELPER_NAME=
ACTIVE_HELPER_OPERATION=
ACTIVE_HELPER_RUN_ID=
ACTIVE_HELPER_SERVICE=
ACTIVE_HELPER_SETTLE_MIN=30
INSPECTED_HELPER_NAME=
INSPECTED_HELPER_OPERATION=
INSPECTED_HELPER_RUN_ID=
INSPECTED_HELPER_SERVICE=
INSPECTED_HELPER_STATE=
INSPECTED_HELPER_EXIT_CODE=

usage() {
  printf '%s\n' 'usage: mlp-migration {export|rehearsal|preload|contacts|remove-synthetic UUID}' >&2
  return 64
}

parse_arguments() {
  case "${1-}" in
    export)
      [[ $# -eq 1 ]] || return 64
      OPERATION='export'
      ;;
    rehearsal)
      [[ $# -eq 1 ]] || return 64
      OPERATION=rehearsal
      ;;
    preload)
      [[ $# -eq 1 ]] || return 64
      OPERATION=preload
      ;;
    contacts)
      [[ $# -eq 1 ]] || return 64
      OPERATION=contacts
      ;;
    remove-synthetic)
      [[ $# -eq 2 ]] || return 64
      [[ "$2" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || return 64
      OPERATION=remove-synthetic
      SYNTHETIC_UUID=$2
      ;;
    *)
      return 64
      ;;
  esac
}

clear_operator_environment() {
  unset "${!ARCHIVE_@}" "${!ARTIFACT_@}" "${!COMPOSE_@}" "${!CONTACT_@}"
  unset "${!DOCKER_@}" "${!MIGRATION_@}" "${!MLP_@}" "${!MONGO_@}" "${!PG@}"
}

validate_migration_environment() {
  local count=0
  local expected
  local key
  local line
  local value
  local seen=' '

  expected='MIGRATION_ARCHIVE_RECIPIENT MIGRATION_IMAGE MIGRATION_MONGO_DATABASE MIGRATION_PGCONNECT_TIMEOUT_MS MIGRATION_PGDATABASE MIGRATION_PGHOST MIGRATION_PGPOOL_MAX MIGRATION_PGPORT MIGRATION_PGUSER'
  mlp_require_root_file /etc/mlp/env/migration.env 0600
  while IFS= read -r line || [[ -n "$line" ]]; do
    ((count += 1))
    [[ "$line" != *$'\r'* && "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] || return 78
    key=${line%%=*}
    value=${line#*=}
    [[ " $expected " == *" $key "* ]] || return 78
    [[ "$seen" != *" $key "* ]] || return 78
    [[ -n "$value" && "$value" != *'$'* && "$value" != *'`'* ]] || return 78
    [[ "$value" != *[[:space:]]* ]] || return 78
    seen+="$key "
    printf -v "CONFIG_$key" '%s' "$value"
  done < /etc/mlp/env/migration.env

  for key in $expected; do
    [[ "$seen" == *" $key "* ]] || return 78
  done
  [[ $count -eq 9 ]] || return 78
  [[ $CONFIG_MIGRATION_IMAGE =~ ^ghcr\.io/martinlindblad/mlp-migration@sha256:[0-9a-f]{64}$ ]] || return 78
  [[ $CONFIG_MIGRATION_ARCHIVE_RECIPIENT =~ ^age1[0-9a-z]{58}$ ]] || return 78
  [[ $CONFIG_MIGRATION_MONGO_DATABASE == portfolio ]] || return 78
  [[ $CONFIG_MIGRATION_PGHOST == postgres ]] || return 78
  [[ $CONFIG_MIGRATION_PGPORT == 5432 ]] || return 78
  [[ $CONFIG_MIGRATION_PGDATABASE =~ ^portfolio(_rehearsal)?$ ]] || return 78
  [[ $CONFIG_MIGRATION_PGUSER == portfolio_migrator ]] || return 78
  [[ $CONFIG_MIGRATION_PGPOOL_MAX == 2 ]] || return 78
  [[ $CONFIG_MIGRATION_PGCONNECT_TIMEOUT_MS == 5000 ]] || return 78
}

require_operation_database() {
  case "$OPERATION" in
    rehearsal)
      [[ "$CONFIG_MIGRATION_PGDATABASE" == portfolio_rehearsal ]]
      ;;
    export | preload | contacts | remove-synthetic)
      [[ "$CONFIG_MIGRATION_PGDATABASE" == portfolio ]]
      ;;
  esac || {
    printf '%s\n' 'migration database target invalid' >&2
    return 78
  }
}

require_operator_artifact_directory() {
  local metadata
  [[ -d /var/lib/mlp/migration-artifacts/operator && ! -L /var/lib/mlp/migration-artifacts/operator ]] || return 78
  metadata=$(/usr/bin/stat -c '%u:%g:%a' -- /var/lib/mlp/migration-artifacts/operator 2>/dev/null || /usr/bin/stat -f '%u:%g:%Lp' -- /var/lib/mlp/migration-artifacts/operator)
  [[ "$metadata" == 1000:1000:700 ]] || return 78
}

validate_secret_payload() {
  local path=$1
  local size
  local value=

  mlp_require_root_file "$path" 0600
  size=$(/usr/bin/stat -c '%s' -- "$path" 2>/dev/null || /usr/bin/stat -f '%z' -- "$path")
  IFS= read -r value < "$path" || [[ -n "$value" ]]
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 78
  [[ ${#value} -eq $((size - 1)) ]] || return 78
  unset value
}

validate_staged_migration_secret() {
  local path=$1
  local metadata
  [[ -f "$path" && ! -L "$path" && -s "$path" ]] || return 78
  metadata=$(/usr/bin/stat -c '%u:%g:%a:%h' -- "$path" 2>/dev/null || /usr/bin/stat -f '%u:%g:%Lp:%l' -- "$path") || return 78
  [[ "$metadata" == 1000:1000:400:1 ]]
}

stage_migration_secret() {
  local source=$1
  local name=$2
  local destination=/etc/mlp/compose-secrets/$name
  local size

  validate_secret_payload "$source" || return $?
  size=$(/usr/bin/stat -c '%s' -- "$source" 2>/dev/null || /usr/bin/stat -f '%z' -- "$source") || return 70
  STAGED_SECRET_TEMP=$(/usr/bin/mktemp /etc/mlp/compose-secrets/.migration-stage.XXXXXXXXXX) || return 70
  /usr/bin/head -c "$((size - 1))" -- "$source" > "$STAGED_SECRET_TEMP" || return 70
  /bin/chown 1000:1000 -- "$STAGED_SECRET_TEMP" || return 70
  /bin/chmod 0400 -- "$STAGED_SECRET_TEMP" || return 70
  validate_staged_migration_secret "$STAGED_SECRET_TEMP" || return $?
  [[ ! -e "$destination" && ! -L "$destination" ]] || return 78
  /bin/ln -- "$STAGED_SECRET_TEMP" "$destination" || return 70
  case "$name" in
    mongo-uri-migration-operator) STAGED_MONGO_SECRET_OWNED=yes ;;
    postgres-migrator-password-migration-operator)
      STAGED_POSTGRES_SECRET_OWNED=yes
      ;;
    *) return 70 ;;
  esac
  /bin/rm -f -- "$STAGED_SECRET_TEMP" || return 70
  STAGED_SECRET_TEMP=
  validate_staged_migration_secret "$destination" || return $?
}

cleanup_migration_secrets() {
  [[ -z "$ACTIVE_HELPER_NAME" ]] || return 70
  if [[ -n "$STAGED_SECRET_TEMP" ]]; then
    /bin/rm -f -- "$STAGED_SECRET_TEMP" || return 70
    STAGED_SECRET_TEMP=
  fi
  if [[ "$STAGED_MONGO_SECRET_OWNED" == yes ]]; then
    /bin/rm -f -- \
      /etc/mlp/compose-secrets/mongo-uri-migration-operator || return 70
    STAGED_MONGO_SECRET_OWNED=no
  fi
  if [[ "$STAGED_POSTGRES_SECRET_OWNED" == yes ]]; then
    /bin/rm -f -- \
      /etc/mlp/compose-secrets/postgres-migrator-password-migration-operator || return 70
    STAGED_POSTGRES_SECRET_OWNED=no
  fi
}

reconcile_migration_secrets() {
  [[ -z "$ACTIVE_HELPER_NAME" ]] || return 70
  [[ "$STAGED_MONGO_SECRET_OWNED" == no ]] || return 70
  [[ "$STAGED_POSTGRES_SECRET_OWNED" == no ]] || return 70
  /bin/rm -f -- \
    /etc/mlp/compose-secrets/mongo-uri-migration-operator \
    /etc/mlp/compose-secrets/postgres-migrator-password-migration-operator
}

resolve_expected_migration_image() {
  local image_id
  if ! image_id=$(/usr/bin/timeout --foreground --signal=TERM --kill-after=5s 30s \
    /usr/bin/docker image inspect --format '{{.Id}}' "$CONFIG_MIGRATION_IMAGE" 2>/dev/null); then
    return 70
  fi
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 70
  EXPECTED_MIGRATION_IMAGE_ID=$image_id
}

validate_compose_binary_version() {
  local version
  version=$(/usr/local/libexec/mlp/docker-compose version --short 2>/dev/null) || return 70
  [[ "$version" == 5.3.1 || "$version" == v5.3.1 ]]
}

require_contact_maintenance() {
  local count=0
  local line
  local mode=
  local status=0

  mlp_require_root_file /etc/mlp/env/app.env 0600
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      APP_CONTACT_MODE=contact-maintenance)
        ((count += 1))
        mode=contact-maintenance
        ;;
      APP_CONTACT_MODE=*)
        ((count += 1))
        mode=invalid
        ;;
    esac
  done < /etc/mlp/env/app.env
  [[ $count -eq 1 && "$mode" == contact-maintenance ]] || {
    printf '%s\n' 'contact maintenance is required' >&2
    return 78
  }
  /usr/local/sbin/mlp-contact-mode maintenance >/dev/null 2>&1 || status=$?
  if [[ $status -ne 0 ]]; then
    printf '%s\n' 'contact maintenance verification failed' >&2
    return "$status"
  fi
}

expected_service_for_operation() {
  local destination=$1
  local operation=$2
  local service
  case "$operation" in
    export) service=migration-export ;;
    rehearsal) service=migration-rehearsal ;;
    preload) service=migration-preload ;;
    contacts) service=migration-contacts ;;
    remove-synthetic) service=migration-remove-synthetic ;;
    *) return 78 ;;
  esac
  printf -v "$destination" '%s' "$service"
}

new_run_id() {
  local destination=$1
  local run_id
  run_id=$(/usr/bin/od -An -N16 -tx1 /dev/urandom | /usr/bin/tr -d ' \n')
  [[ "$run_id" =~ ^[0-9a-f]{32}$ ]] || return 70
  printf -v "$destination" '%s' "$run_id"
}

list_helper_ids() {
  local destination=$1
  local name_filter=$2
  local output
  local id
  local seen=' '
  if ! output=$(/usr/bin/timeout --foreground --signal=TERM --kill-after=5s 30s \
    /usr/bin/docker container ls --all --quiet --no-trunc --filter "$name_filter" 2>/dev/null); then
    return 70
  fi
  if [[ -n "$output" ]]; then
    while IFS= read -r id; do
      [[ "$id" =~ ^[0-9a-f]{64}$ && "$seen" != *" $id "* ]] || return 70
      seen+="$id "
    done <<< "$output"
  fi
  printf -v "$destination" '%s' "$output"
}

inspect_expected_helper() {
  local id=$1
  local expected_name=${2-}
  local expected_operation=${3-}
  local expected_run_id=${4-}
  local expected_service=${5-}
  local record
  local mapped_service
  local -a fields
  if ! record=$(/usr/bin/timeout --foreground --signal=TERM --kill-after=5s 30s \
    /usr/bin/docker container inspect --format '{{.Id}}|{{.Name}}|{{index .Config.Labels "com.mlp.operation"}}|{{index .Config.Labels "com.mlp.migration.operation"}}|{{index .Config.Labels "com.mlp.migration.run-id"}}|{{index .Config.Labels "com.mlp.migration.service"}}|{{index .Config.Labels "com.mlp.migration.image"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project"}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}|{{.State.ExitCode}}' \
    "$id" 2>/dev/null); then
    return 70
  fi
  IFS='|' read -r -a fields <<< "$record"
  [[ ${#fields[@]} -eq 13 ]] || return 70
  [[ "${fields[0]}" == "$id" && "${fields[0]}" =~ ^[0-9a-f]{64}$ ]] || return 70
  [[ "${fields[2]}" == migration ]] || return 78
  [[ "${fields[3]}" =~ ^(export|rehearsal|preload|contacts|remove-synthetic)$ ]] || return 78
  [[ "${fields[4]}" =~ ^[0-9a-f]{32}$ ]] || return 78
  expected_service_for_operation mapped_service "${fields[3]}" || return 78
  [[ "${fields[5]}" == "$mapped_service" && "${fields[7]}" == "$mapped_service" ]] || return 78
  [[ "${fields[6]}" == "$CONFIG_MIGRATION_IMAGE" ]] || return 78
  [[ "${fields[8]}" == mlp-migration ]] || return 78
  [[ "${fields[9]}" == "$CONFIG_MIGRATION_IMAGE" ]] || return 78
  [[ "${fields[10]}" == "$EXPECTED_MIGRATION_IMAGE_ID" ]] || return 78
  [[ "${fields[1]}" == "/mlp-migration-job-${fields[3]}-${fields[4]}" ]] || return 78
  [[ "${fields[11]}" =~ ^(created|running|paused|restarting|removing|exited|dead)$ ]] || return 70
  [[ "${fields[12]}" =~ ^[0-9]+$ && ${fields[12]} -le 255 ]] || return 70
  [[ -z "$expected_name" || "${fields[1]}" == "/$expected_name" ]] || return 78
  [[ -z "$expected_operation" || "${fields[3]}" == "$expected_operation" ]] || return 78
  [[ -z "$expected_run_id" || "${fields[4]}" == "$expected_run_id" ]] || return 78
  [[ -z "$expected_service" || "${fields[5]}" == "$expected_service" ]] || return 78
  INSPECTED_HELPER_NAME=${fields[1]#/}
  INSPECTED_HELPER_OPERATION=${fields[3]}
  INSPECTED_HELPER_RUN_ID=${fields[4]}
  INSPECTED_HELPER_SERVICE=${fields[5]}
  INSPECTED_HELPER_STATE=${fields[11]}
  INSPECTED_HELPER_EXIT_CODE=${fields[12]}
}

cleanup_expected_helper() {
  local helper_name=$1
  local operation=$2
  local run_id=$3
  local service=$4
  local minimum_checks=$5
  local maximum_checks=$6
  local check
  local id
  local ids
  local stable_absence=0
  for ((check = 1; check <= maximum_checks; check += 1)); do
    list_helper_ids ids "name=^/${helper_name}$" || return 70
    if [[ -n "$ids" ]]; then
      stable_absence=0
      [[ "$ids" != *$'\n'* ]] || return 70
      id=$ids
      inspect_expected_helper "$id" "$helper_name" "$operation" "$run_id" "$service" || return $?
      /usr/bin/timeout --foreground --signal=TERM --kill-after=5s 30s \
        /usr/bin/docker container rm --force "$id" >/dev/null 2>&1 || return 70
    else
      ((stable_absence += 1))
    fi
    if [[ $check -ge $minimum_checks && $stable_absence -ge 3 ]]; then
      return 0
    fi
    /usr/bin/sleep 1
  done
  return 70
}

cleanup_active_helper() {
  [[ -n "$ACTIVE_HELPER_NAME" ]] || return 0
  cleanup_expected_helper "$ACTIVE_HELPER_NAME" "$ACTIVE_HELPER_OPERATION" \
    "$ACTIVE_HELPER_RUN_ID" "$ACTIVE_HELPER_SERVICE" "$ACTIVE_HELPER_SETTLE_MIN" 35 || return $?
  ACTIVE_HELPER_NAME=
  ACTIVE_HELPER_OPERATION=
  ACTIVE_HELPER_RUN_ID=
  ACTIVE_HELPER_SERVICE=
  ACTIVE_HELPER_SETTLE_MIN=30
}

reconcile_stale_helpers() {
  local check
  local id
  local ids
  local stable_absence=0
  for ((check = 1; check <= 35; check += 1)); do
    list_helper_ids ids 'name=^/mlp-migration-job-' || return 70
    if [[ -n "$ids" ]]; then
      stable_absence=0
      while IFS= read -r id; do
        inspect_expected_helper "$id" || return $?
        ACTIVE_HELPER_NAME=$INSPECTED_HELPER_NAME
        ACTIVE_HELPER_OPERATION=$INSPECTED_HELPER_OPERATION
        ACTIVE_HELPER_RUN_ID=$INSPECTED_HELPER_RUN_ID
        ACTIVE_HELPER_SERVICE=$INSPECTED_HELPER_SERVICE
        ACTIVE_HELPER_SETTLE_MIN=3
        cleanup_active_helper || return $?
      done <<< "$ids"
    else
      ((stable_absence += 1))
    fi
    if [[ $check -ge 30 && $stable_absence -ge 3 ]]; then
      return 0
    fi
    /usr/bin/sleep 1
  done
  return 70
}

prepare_operator() {
  local ids
  reconcile_stale_helpers || {
    printf '%s\n' 'migration helper reconciliation failed' >&2
    return 70
  }
  expected_service_for_operation PLANNED_SERVICE "$OPERATION" || return 78
  new_run_id PLANNED_RUN_ID || return 70
  PLANNED_HELPER_NAME="mlp-migration-job-${OPERATION}-${PLANNED_RUN_ID}"
  list_helper_ids ids "name=^/${PLANNED_HELPER_NAME}$" || return 70
  [[ -z "$ids" ]] || {
    printf '%s\n' 'migration helper name is unavailable' >&2
    return 70
  }
}

wait_for_helper_appearance() {
  local expected_id=$1
  local attempt
  local ids
  for ((attempt = 1; attempt <= 10; attempt += 1)); do
    list_helper_ids ids "name=^/${ACTIVE_HELPER_NAME}$" || return 70
    if [[ -n "$ids" ]]; then
      [[ "$ids" != *$'\n'* && "$ids" == "$expected_id" ]] || return 70
      inspect_expected_helper "$ids" "$ACTIVE_HELPER_NAME" "$ACTIVE_HELPER_OPERATION" \
        "$ACTIVE_HELPER_RUN_ID" "$ACTIVE_HELPER_SERVICE" || return $?
      return 0
    fi
    /usr/bin/sleep 1
  done
  return 70
}

run_operator() {
  local profile=$1
  local service=$2
  shift 2
  local helper_name=$PLANNED_HELPER_NAME
  local launch_id=
  local launch_output=
  local launch_status=0
  local run_id=$PLANNED_RUN_ID
  local wait_output=
  local wait_status=0
  local job_status
  local -a compose=(/usr/local/libexec/mlp/docker-compose --ansi never --project-name mlp-migration --project-directory /opt/mlp --env-file /etc/mlp/env/migration.env --file /opt/mlp/compose.migration.yml)
  [[ "$profile" == "$OPERATION" && "$service" == "$PLANNED_SERVICE" ]] || return 78
  ACTIVE_HELPER_NAME=$PLANNED_HELPER_NAME
  ACTIVE_HELPER_OPERATION=$OPERATION
  ACTIVE_HELPER_RUN_ID=$PLANNED_RUN_ID
  ACTIVE_HELPER_SERVICE=$service
  ACTIVE_HELPER_SETTLE_MIN=30
  launch_output=$(/usr/bin/timeout --signal=TERM --kill-after=30s 5m \
    "${compose[@]}" --profile "$profile" run --detach --no-TTY --no-deps \
    --name "$helper_name" --label com.mlp.operation=migration \
    --label "com.mlp.migration.operation=$OPERATION" \
    --label "com.mlp.migration.run-id=$run_id" \
    --label "com.mlp.migration.service=$service" \
    --label "com.mlp.migration.image=$CONFIG_MIGRATION_IMAGE" \
    "$service" "$@" 2>/dev/null) || launch_status=$?
  if [[ $launch_status -ne 0 ]]; then
    cleanup_active_helper || {
      printf '%s\n' 'migration helper cleanup failed' >&2
      return 70
    }
    printf '%s\n' 'migration operator launch failed' >&2
    return "$launch_status"
  fi
  [[ "$launch_output" =~ ^[0-9a-f]{64}$ ]] || {
    cleanup_active_helper || true
    printf '%s\n' 'migration operator launch failed' >&2
    return 70
  }
  launch_id=$launch_output
  wait_for_helper_appearance "$launch_id" || {
    cleanup_active_helper || true
    printf '%s\n' 'migration operator tracking failed' >&2
    return 70
  }
  ACTIVE_HELPER_SETTLE_MIN=3
  wait_output=$(/usr/bin/timeout --foreground --signal=TERM --kill-after=30s 2h \
    /usr/bin/docker container wait "$launch_id" 2>/dev/null) || wait_status=$?
  if [[ $wait_status -ne 0 || ! "$wait_output" =~ ^[0-9]+$ || $wait_output -gt 255 ]]; then
    cleanup_active_helper || true
    printf '%s\n' 'migration operator wait failed' >&2
    [[ $wait_status -ne 0 ]] && return "$wait_status"
    return 70
  fi
  job_status=$wait_output
  if ! inspect_expected_helper "$launch_id" "$ACTIVE_HELPER_NAME" "$ACTIVE_HELPER_OPERATION" \
    "$ACTIVE_HELPER_RUN_ID" "$ACTIVE_HELPER_SERVICE" || \
    [[ "$INSPECTED_HELPER_STATE" != exited || "$INSPECTED_HELPER_EXIT_CODE" != "$job_status" ]]; then
    cleanup_active_helper || true
    printf '%s\n' 'migration operator result verification failed' >&2
    return 70
  fi
  cleanup_active_helper || {
    printf '%s\n' 'migration helper cleanup failed' >&2
    return 70
  }
  if [[ $job_status -ne 0 ]]; then
    printf '%s\n' 'migration operator failed' >&2
  fi
  return "$job_status"
}

on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  if ! cleanup_active_helper; then
    printf '%s\n' 'migration helper cleanup failed' >&2
    status=70
  elif ! cleanup_migration_secrets; then
    printf '%s\n' 'migration secret cleanup failed' >&2
    status=70
  fi
  exit "$status"
}

main() {
  mlp_require_root
  parse_arguments "$@" || {
    usage
    return 64
  }
  clear_operator_environment
  set_fixed_environment
  mlp_acquire_operations_lock
  trap on_exit EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  mlp_require_root_directory /opt/mlp 0755
  mlp_require_root_file /opt/mlp/compose.migration.yml 0644
  mlp_require_root_directory /etc/mlp 0700
  mlp_require_root_directory /etc/mlp/compose-secrets 0700
  mlp_require_root_directory /etc/mlp/docker-client 0700
  mlp_require_root_directory /etc/mlp/env 0700
  mlp_require_root_directory /etc/mlp/secrets 0700
  mlp_require_root_file /usr/local/libexec/mlp/docker-compose 0755
  validate_compose_binary_version || {
    printf '%s\n' 'migration Compose version invalid' >&2
    return 70
  }
  validate_migration_environment
  require_operation_database
  resolve_expected_migration_image || {
    printf '%s\n' 'migration image verification failed' >&2
    return 70
  }

  if [[ "$OPERATION" != remove-synthetic ]]; then
    mlp_require_root_directory /var/lib/mlp/migration-artifacts 0700
    require_operator_artifact_directory
  fi
  prepare_operator
  reconcile_migration_secrets || {
    printf '%s\n' 'migration secret reconciliation failed' >&2
    return 70
  }
  if [[ "$OPERATION" == contacts ]]; then
    require_contact_maintenance
  fi
  if [[ "$OPERATION" != export ]]; then
    /usr/local/sbin/mlp-backup
  fi
  case "$OPERATION" in
    export)
      stage_migration_secret /etc/mlp/secrets/mongo-readonly-uri mongo-uri-migration-operator || {
        printf '%s\n' 'migration secret staging failed' >&2
        return 78
      }
      run_operator export migration-export
      ;;
    rehearsal)
      stage_migration_secret /etc/mlp/secrets/mongo-readonly-uri mongo-uri-migration-operator || {
        printf '%s\n' 'migration secret staging failed' >&2
        return 78
      }
      stage_migration_secret /etc/mlp/secrets/postgres-migrator-password postgres-migrator-password-migration-operator || {
        printf '%s\n' 'migration secret staging failed' >&2
        return 78
      }
      run_operator rehearsal migration-rehearsal
      ;;
    preload)
      stage_migration_secret /etc/mlp/secrets/mongo-readonly-uri mongo-uri-migration-operator || {
        printf '%s\n' 'migration secret staging failed' >&2
        return 78
      }
      stage_migration_secret /etc/mlp/secrets/postgres-migrator-password postgres-migrator-password-migration-operator || {
        printf '%s\n' 'migration secret staging failed' >&2
        return 78
      }
      run_operator preload migration-preload
      ;;
    contacts)
      stage_migration_secret /etc/mlp/secrets/mongo-readonly-uri mongo-uri-migration-operator || {
        printf '%s\n' 'migration secret staging failed' >&2
        return 78
      }
      stage_migration_secret /etc/mlp/secrets/postgres-migrator-password postgres-migrator-password-migration-operator || {
        printf '%s\n' 'migration secret staging failed' >&2
        return 78
      }
      run_operator contacts migration-contacts
      ;;
    remove-synthetic)
      stage_migration_secret /etc/mlp/secrets/postgres-migrator-password postgres-migrator-password-migration-operator || {
        printf '%s\n' 'migration secret staging failed' >&2
        return 78
      }
      run_operator remove-synthetic migration-remove-synthetic remove-synthetic "$SYNTHETIC_UUID"
      ;;
  esac
}

main "$@"
