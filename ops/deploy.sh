#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# shellcheck source=/dev/null
source /opt/mlp/ops/lib/operations.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
for variable in "${!DOCKER_@}" "${!GIT_@}" "${!NODE_@}" "${!XDG_@}"; do
  unset "$variable"
done
unset variable
HOME=/etc/mlp
DOCKER_CONFIG=/etc/mlp/docker-client
DOCKER_HOST=unix:///run/docker.sock
export DOCKER_CONFIG DOCKER_HOST HOME

readonly checkout_root=/opt/mlp
readonly app_environment=/etc/mlp/env/app.env
readonly backup_environment=/etc/mlp/env/backup.env
readonly backup_report=/var/lib/mlp/backup-reports/latest-success.json
readonly deployment_report_directory=/var/lib/mlp/deployment-reports
readonly deployment_report=/var/lib/mlp/deployment-reports/latest.json
readonly compose_command=/usr/local/sbin/mlp-compose
readonly backup_command=/usr/local/sbin/mlp-backup
readonly docker_command=/usr/bin/docker
readonly git_command=/usr/bin/git
readonly node_command=/usr/bin/node
readonly timeout_command=/usr/bin/timeout
readonly expected_source=https://github.com/martinlindblad/mlp
readonly migration_helper_name=mlp-deploy-migrator
readonly migration_operation=mlp-deploy-migration
readonly helper_absence_observation_count=6
readonly helper_settle_observation_count=30
readonly stable_observation_count=6

image=
commit=
previous_image=
backup_image=
candidate_image_id=
previous_image_id=
rollback_required=false
report_temporary=
migration_run_id=
migration_helper_tracked=false

fail() {
  local message=${1:-deployment failed}
  local status=${2:-1}
  printf '%s\n' "$message" >&2
  exit "$status"
}

run_bounded() {
  local seconds=$1
  shift
  "$timeout_command" --kill-after=5s "$seconds" "$@"
}

parse_arguments() {
  local saw_commit=false
  local saw_image=false

  while (($#)); do
    case "$1" in
      --image)
        [[ "$saw_image" == false && $# -ge 2 ]] || fail 'invalid deployment arguments' 64
        image=$2
        saw_image=true
        shift 2
        ;;
      --commit)
        [[ "$saw_commit" == false && $# -ge 2 ]] || fail 'invalid deployment arguments' 64
        commit=$2
        saw_commit=true
        shift 2
        ;;
      *) fail 'invalid deployment arguments' 64 ;;
    esac
  done

  [[ "$saw_image" == true && "$saw_commit" == true ]] || \
    fail 'invalid deployment arguments' 64
  [[ "$image" =~ ^ghcr\.io/martinlindblad/mlp@sha256:[0-9a-f]{64}$ ]] || \
    fail 'immutable application image required' 64
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid deployment commit' 64
}

read_environment_value() {
  local file=$1
  local key=$2
  local found=false
  local line
  local value=

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "$key="* ]]; then
      [[ "$found" == false ]] || return 1
      value=${line#*=}
      found=true
    fi
  done <"$file"
  [[ "$found" == true && -n "$value" ]] || return 1
  printf '%s' "$value"
}

validate_protected_inputs() {
  mlp_require_root_directory /opt/mlp 0755
  mlp_require_root_directory /opt/mlp/.git 0755
  mlp_require_root_directory /etc/mlp 0700
  mlp_require_root_directory /etc/mlp/docker-client 0700
  mlp_require_root_directory /etc/mlp/env 0700
  mlp_require_root_directory /var/lib/mlp/backup-reports 0700
  mlp_require_root_directory /var/lib/mlp/deployment-reports 0700
  mlp_require_root_file /opt/mlp/compose.production.yml 0644
  mlp_require_root_file /opt/mlp/.git/HEAD 0644
  mlp_require_root_file /opt/mlp/.git/config 0644
  mlp_require_root_file /opt/mlp/scripts/verify-production-config.mjs 0644
  mlp_require_root_file /etc/mlp/env/app.env 0600
  mlp_require_root_file /etc/mlp/env/migrator.env 0600
  mlp_require_root_file /etc/mlp/env/backup.env 0600
}

validate_checkout() {
  local dirty
  local head

  dirty=$(run_bounded 30 "$git_command" -C "$checkout_root" status --porcelain --untracked-files=all)
  [[ -z "$dirty" ]] || fail 'deployment checkout is not clean' 65
  head=$(run_bounded 15 "$git_command" -C "$checkout_root" rev-parse HEAD)
  [[ "$head" == "$commit" ]] || fail 'deployment checkout mismatch' 65
}

validate_current_references() {
  local configured_container_image
  local health
  local identifier
  local state
  local status

  previous_image=$(read_environment_value "$app_environment" APP_IMAGE) || \
    fail 'invalid current application reference' 78
  backup_image=$(read_environment_value "$backup_environment" BACKUP_IMAGE) || \
    fail 'invalid current backup reference' 78
  [[ "$previous_image" =~ ^ghcr\.io/martinlindblad/mlp@sha256:[0-9a-f]{64}$ ]] || \
    fail 'invalid current application reference' 78
  [[ "$backup_image" =~ ^ghcr\.io/martinlindblad/mlp-backup@sha256:[0-9a-f]{64}$ ]] || \
    fail 'invalid current backup reference' 78

  previous_image_id=$(image_identifier "$previous_image") || \
    fail 'invalid current application image' 65
  [[ "$previous_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || \
    fail 'invalid current application image' 65
  state=$(inspect_app_state) || fail 'running application unavailable' 65
  IFS='|' read -r status health configured_container_image identifier <<<"$state"
  [[ "$status" == running && "$health" == healthy && \
    "$configured_container_image" == "$previous_image" && \
    "$identifier" == "$previous_image_id" ]] || \
    fail 'running application reference mismatch' 65
}

verify_candidate_config() {
  run_bounded 45 "$node_command" /opt/mlp/scripts/verify-production-config.mjs \
    --candidate-app-image "$image" >/dev/null
}

image_identifier() {
  local reference=$1
  run_bounded 15 "$docker_command" image inspect --format '{{.Id}}' "$reference"
}

verify_candidate_image() {
  local identifier
  local metadata
  local platform
  local repo_digests
  local revision
  local source

  metadata=$(run_bounded 20 "$docker_command" image inspect --format \
    '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.source"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{json .RepoDigests}}' \
    "$image")
  IFS='|' read -r identifier platform source revision repo_digests <<<"$metadata"
  [[ "$identifier" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  [[ "$platform" == linux/amd64 ]] || return 1
  [[ "$source" == "$expected_source" ]] || return 1
  [[ "$revision" == "$commit" ]] || return 1
  # $image below is a jq variable, not a shell expansion.
  # shellcheck disable=SC2016
  run_bounded 10 /usr/bin/jq -e --arg image "$image" \
    'type == "array" and index($image) != null' <<<"$repo_digests" >/dev/null || return 1
  candidate_image_id=$identifier
}

list_migration_helper() {
  run_bounded 10 "$docker_command" ps --all --no-trunc \
    --filter "name=^/${migration_helper_name}$" --format '{{.ID}}'
}

inspect_migration_helper() {
  run_bounded 10 "$docker_command" inspect --type container --format \
    '{{.Id}}|{{index .Config.Labels "com.mlp.operation"}}|{{index .Config.Labels "com.mlp.run-id"}}|{{index .Config.Labels "com.mlp.candidate-image"}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}|{{.State.ExitCode}}' \
    "$migration_helper_name"
}

valid_migration_helper_metadata() {
  local expected_identifier=$1
  local expected_run_id=${2:-}
  local candidate_label
  local compose_project
  local compose_service
  local configured_image
  local container_identifier
  local exit_code
  local image_identifier_value
  local metadata
  local operation
  local run_id
  local status

  metadata=$(inspect_migration_helper) || return 1
  IFS='|' read -r container_identifier operation run_id candidate_label \
    compose_project compose_service configured_image image_identifier_value \
    status exit_code <<<"$metadata"

  [[ "$container_identifier" == "$expected_identifier" ]] || return 1
  [[ "$operation" == "$migration_operation" ]] || return 1
  [[ "$compose_project" == mlp-prod ]] || return 1
  [[ "$compose_service" == migrator ]] || return 1
  [[ "$run_id" =~ ^[0-9a-f]{40}-[1-9][0-9]*$ ]] || return 1
  [[ -z "$expected_run_id" || "$run_id" == "$expected_run_id" ]] || return 1
  [[ "$candidate_label" =~ ^ghcr\.io/martinlindblad/mlp@sha256:[0-9a-f]{64}$ ]] || \
    return 1
  [[ "$configured_image" == "$candidate_label" ]] || return 1
  [[ -z "$expected_run_id" || "$candidate_label" == "$image" ]] || return 1
  [[ "$image_identifier_value" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  [[ "$status" =~ ^(created|running|paused|restarting|removing|exited|dead)$ ]] || \
    return 1
  [[ "$exit_code" =~ ^[0-9]+$ ]] || return 1
}

verify_current_migration_helper() {
  local expected_identifier=$1
  local expected_status=${2:-}
  local candidate_label
  local compose_project
  local compose_service
  local configured_image
  local container_identifier
  local exit_code
  local image_identifier_value
  local metadata
  local operation
  local run_id
  local status

  metadata=$(inspect_migration_helper) || return 1
  IFS='|' read -r container_identifier operation run_id candidate_label \
    compose_project compose_service configured_image image_identifier_value \
    status exit_code <<<"$metadata"

  [[ "$container_identifier" == "$expected_identifier" ]] || return 1
  [[ "$operation" == "$migration_operation" ]] || return 1
  [[ "$compose_project" == mlp-prod ]] || return 1
  [[ "$compose_service" == migrator ]] || return 1
  [[ "$run_id" == "$migration_run_id" ]] || return 1
  [[ "$candidate_label" == "$image" ]] || return 1
  [[ "$configured_image" == "$image" ]] || return 1
  [[ "$image_identifier_value" == "$candidate_image_id" ]] || return 1
  [[ -z "$expected_status" || "$status" == "$expected_status" ]] || return 1
  [[ "$exit_code" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$exit_code"
}

remove_migration_helper_and_prove_absent() {
  local expected_run_id=${1:-}
  local required_observations=${2:-$helper_settle_observation_count}
  local absent_observations=0
  local helper_identifier
  local observation

  for observation in {1..90}; do
    helper_identifier=$(list_migration_helper) || return 1
    if [[ -z "$helper_identifier" ]]; then
      absent_observations=$((absent_observations + 1))
      if [[ "$absent_observations" -ge "$required_observations" ]]; then
        if [[ -n "$expected_run_id" ]]; then
          migration_helper_tracked=false
        fi
        return 0
      fi
    else
      [[ "$helper_identifier" =~ ^[0-9a-f]{64}$ ]] || return 1
      valid_migration_helper_metadata "$helper_identifier" "$expected_run_id" || \
        return 1
      run_bounded 20 "$docker_command" rm -f "$migration_helper_name" \
        >/dev/null 2>&1 || return 1
      absent_observations=0
    fi
    /bin/sleep 2
  done
  return 1
}

reconcile_stale_migration_helper() {
  remove_migration_helper_and_prove_absent
}

service_state() {
  local service=$1
  run_bounded 10 "$docker_command" inspect --type container \
    --format '{{.State.Status}}|{{.State.Health.Status}}' "mlp-prod-${service}-1"
}

wait_for_service_healthy() {
  local service=$1
  local attempt

  for attempt in {1..60}; do
    if [[ $(service_state "$service" 2>/dev/null || true) == 'running|healthy' ]]; then
      return 0
    fi
    [[ "$attempt" -lt 60 ]] || return 1
    /bin/sleep 2
  done
}

inspect_app_state() {
  run_bounded 10 "$docker_command" inspect --type container --format \
    '{{.State.Status}}|{{.State.Health.Status}}|{{.Config.Image}}|{{.Image}}' \
    mlp-prod-app-1
}

wait_for_app_image() {
  local expected_image=$1
  local expected_identifier=$2
  local attempt
  local configured
  local health
  local identifier
  local state
  local status

  for attempt in {1..60}; do
    state=$(inspect_app_state 2>/dev/null || true)
    IFS='|' read -r status health configured identifier <<<"$state"
    if [[ "$status" == running && "$health" == healthy && \
      "$configured" == "$expected_image" && \
      "$identifier" == "$expected_identifier" ]]; then
      return 0
    fi
    [[ "$attempt" -lt 60 ]] || return 1
    /bin/sleep 2
  done
}

wait_for_permanent_services() {
  local service
  for service in postgres app caddy cloudflared-a cloudflared-b; do
    wait_for_service_healthy "$service" || return 1
  done
}

healthy_same_digest() {
  local configured
  local health
  local identifier
  local service
  local state
  local status

  [[ "$image" == "$previous_image" ]] || return 1
  candidate_image_id=$(image_identifier "$image") || return 1
  state=$(inspect_app_state 2>/dev/null) || return 1
  IFS='|' read -r status health configured identifier <<<"$state"
  [[ "$status" == running && "$health" == healthy && \
    "$configured" == "$image" && \
    "$identifier" == "$candidate_image_id" ]] || return 1
  for service in postgres caddy cloudflared-a cloudflared-b; do
    [[ $(service_state "$service" 2>/dev/null) == 'running|healthy' ]] || return 1
  done
}

take_fresh_backup() {
  local backup_started
  local previous_snapshot

  mlp_require_root_file /var/lib/mlp/backup-reports/latest-success.json 0600
  previous_snapshot=$(run_bounded 10 /usr/bin/jq -er '
    select(
      keys == ["completedAt", "snapshotId", "startedAt", "status"] and
      .status == "passed" and
      (.snapshotId | type == "string" and test("^[0-9a-f]{64}$")) and
      (.startedAt | type == "string") and
      (.completedAt | type == "string")
    ) | .snapshotId
  ' "$backup_report")
  backup_started=$(/bin/date -u +%s)
  "$backup_command" >/dev/null 2>&1
  mlp_require_root_file /var/lib/mlp/backup-reports/latest-success.json 0600
  # jq variables below are intentionally single-quoted.
  # shellcheck disable=SC2016
  run_bounded 10 /usr/bin/jq -e \
    --arg previousSnapshot "$previous_snapshot" \
    --argjson backupStarted "$backup_started" '
    keys == ["completedAt", "snapshotId", "startedAt", "status"] and
    .status == "passed" and
    (.snapshotId | type == "string" and test("^[0-9a-f]{64}$")) and
    (.startedAt | type == "string") and
    (.completedAt | type == "string") and
    .snapshotId != $previousSnapshot and
    ((.startedAt | fromdateiso8601) >= $backupStarted) and
    ((.completedAt | fromdateiso8601) >= (.startedAt | fromdateiso8601))
  ' "$backup_report" >/dev/null
}

pull_candidate_image() {
  run_bounded 600 "$compose_command" --candidate-app-image "$image" \
    pull --policy always app migrator
}

require_postgres_healthy() {
  [[ $(service_state postgres) == 'running|healthy' ]]
}

run_candidate_migrator() {
  local cleanup_observations=$helper_settle_observation_count
  local exit_code=
  local helper_identifier=
  local result=0
  local waited_exit_code=

  migration_run_id="${commit}-$$"
  migration_helper_tracked=true
  if ! run_bounded 120 "$compose_command" \
    --candidate-app-image "$image" run -d --no-deps --no-TTY \
    --name "$migration_helper_name" \
    --label "com.mlp.operation=mlp-deploy-migration" \
    --label "com.mlp.run-id=$migration_run_id" \
    --label "com.mlp.candidate-image=$image" migrator >/dev/null 2>&1; then
    result=1
  fi

  if [[ "$result" -eq 0 ]]; then
    helper_identifier=$(list_migration_helper) || result=1
  fi
  if [[ "$result" -eq 0 ]]; then
    [[ "$helper_identifier" =~ ^[0-9a-f]{64}$ ]] || result=1
  fi
  if [[ "$result" -eq 0 ]]; then
    verify_current_migration_helper "$helper_identifier" >/dev/null || result=1
  fi
  if [[ "$result" -eq 0 ]]; then
    if waited_exit_code=$(run_bounded 600 "$docker_command" wait \
      "$migration_helper_name" 2>/dev/null); then
      [[ "$waited_exit_code" =~ ^[0-9]+$ ]] || result=1
    else
      result=1
    fi
  fi
  if [[ "$result" -eq 0 ]]; then
    exit_code=$(verify_current_migration_helper "$helper_identifier" exited) || \
      result=1
  fi
  if [[ "$result" -eq 0 ]]; then
    [[ "$waited_exit_code" == 0 && "$exit_code" == 0 ]] || result=1
  fi
  if [[ "$result" -eq 0 ]]; then
    cleanup_observations=$helper_absence_observation_count
  fi

  remove_migration_helper_and_prove_absent \
    "$migration_run_id" "$cleanup_observations" || result=1
  [[ "$result" -eq 0 ]]
}

replace_candidate_app() {
  run_bounded 300 "$compose_command" --candidate-app-image "$image" \
    up -d --no-deps --force-recreate app
}

reconcile_persisted_config() {
  local configured

  run_bounded 45 "$node_command" /opt/mlp/scripts/verify-production-config.mjs >/dev/null
  configured=$(read_environment_value "$app_environment" APP_IMAGE)
  [[ "$configured" == "$image" ]]
  wait_for_app_image "$image" "$candidate_image_id"
  wait_for_permanent_services
}

platform_matches_expected_state() {
  local expected_image=$1
  local expected_identifier=$2
  local configured
  local health
  local identifier
  local service
  local state
  local status

  configured=$(read_environment_value "$app_environment" APP_IMAGE) || return 1
  [[ "$configured" == "$expected_image" ]] || return 1
  state=$(inspect_app_state 2>/dev/null) || return 1
  IFS='|' read -r status health configured identifier <<<"$state"
  [[ "$status" == running && "$health" == healthy && \
    "$configured" == "$expected_image" && \
    "$identifier" == "$expected_identifier" ]] || return 1
  for service in postgres app caddy cloudflared-a cloudflared-b; do
    [[ $(service_state "$service" 2>/dev/null) == 'running|healthy' ]] || \
      return 1
  done
}

verify_stable_platform() {
  local expected_image=$1
  local expected_identifier=$2
  local observation

  for ((observation = 1; observation <= stable_observation_count; observation++)); do
    platform_matches_expected_state "$expected_image" "$expected_identifier" || \
      return 1
    if [[ "$observation" -lt "$stable_observation_count" ]]; then
      /bin/sleep 2
    fi
  done
}

app_state_allows_restore_retry() {
  local allow_healthy_previous=${1:-false}
  local configured
  local health
  local identifier
  local listed_identifier
  local state
  local status

  listed_identifier=$(run_bounded 10 "$docker_command" ps --all --no-trunc \
    --filter 'name=^/mlp-prod-app-1$' --format '{{.ID}}') || return 1
  if [[ -z "$listed_identifier" ]]; then
    return 0
  fi
  [[ "$listed_identifier" =~ ^[0-9a-f]{64}$ ]] || return 1
  state=$(inspect_app_state 2>/dev/null) || return 1
  IFS='|' read -r status health configured identifier <<<"$state"
  if [[ "$configured" == "$image" && "$identifier" == "$candidate_image_id" ]]; then
    return 0
  fi
  if [[ "$configured" == "$previous_image" && \
    "$identifier" == "$previous_image_id" && \
    ("$allow_healthy_previous" == true || "$status" != running || \
      "$health" != healthy) ]]; then
    return 0
  fi
  return 1
}

write_deployment_report() {
  local status=$1
  local completed_at

  completed_at=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
  report_temporary=$(/usr/bin/mktemp \
    "${deployment_report_directory}/.deployment-report.XXXXXX")
  # Report fields below are jq variables, not shell expansions.
  # shellcheck disable=SC2016
  run_bounded 10 /usr/bin/jq -n \
    --arg candidateCommit "$commit" \
    --arg candidateImage "$image" \
    --arg completedAt "$completed_at" \
    --arg previousImage "$previous_image" \
    --arg status "$status" \
    '{candidateCommit:$candidateCommit,candidateImage:$candidateImage,completedAt:$completedAt,previousImage:$previousImage,status:$status}' \
    >"$report_temporary"
  (mlp_atomic_install_json "$report_temporary" "$deployment_report")
  /bin/rm -f -- "$report_temporary"
  report_temporary=
}

rollback_deployment() {
  local configured=
  local current_previous_image_id=
  local restore_attempt

  configured=$(read_environment_value "$app_environment" APP_IMAGE) || return 1
  if [[ "$configured" != "$previous_image" ]]; then
    (mlp_atomic_replace_env "$app_environment" APP_IMAGE "$previous_image") || \
      return 1
  fi
  current_previous_image_id=$(image_identifier "$previous_image") || return 1
  [[ "$current_previous_image_id" == "$previous_image_id" ]] || return 1

  for restore_attempt in {1..3}; do
    if ! run_bounded 300 "$compose_command" \
      --candidate-app-image "$previous_image" \
      up -d --no-deps --force-recreate app; then
      app_state_allows_restore_retry true || return 1
      [[ "$restore_attempt" -lt 3 ]] || return 1
      continue
    fi
    if ! wait_for_app_image "$previous_image" "$previous_image_id"; then
      app_state_allows_restore_retry true || return 1
      [[ "$restore_attempt" -lt 3 ]] || return 1
      continue
    fi
    if ! wait_for_permanent_services; then
      app_state_allows_restore_retry || return 1
      [[ "$restore_attempt" -lt 3 ]] || return 1
      continue
    fi
    configured=$(read_environment_value "$app_environment" APP_IMAGE) || return 1
    [[ "$configured" == "$previous_image" ]] || return 1
    run_bounded 45 "$node_command" /opt/mlp/scripts/verify-production-config.mjs \
      >/dev/null || return 1
    if verify_stable_platform "$previous_image" "$previous_image_id"; then
      return 0
    fi
    app_state_allows_restore_retry || return 1
    [[ "$restore_attempt" -lt 3 ]] || return 1
  done
  return 1
}

cleanup_report_temporary() {
  if [[ -n "$report_temporary" ]]; then
    /bin/rm -f -- "$report_temporary"
    report_temporary=
  fi
}

deployment_failed() {
  local status=${1:-1}
  local migration_cleanup_status=0
  local rollback_status=0

  trap - ERR HUP INT TERM
  set +e
  cleanup_report_temporary
  if [[ "$migration_helper_tracked" == true ]]; then
    remove_migration_helper_and_prove_absent "$migration_run_id"
    migration_cleanup_status=$?
  fi
  if [[ "$rollback_required" == true ]]; then
    rollback_deployment
    rollback_status=$?
    if [[ "$migration_cleanup_status" -ne 0 ]]; then
      rollback_status=1
    fi
    if [[ "$rollback_status" -eq 0 ]]; then
      write_deployment_report rolled-back >/dev/null 2>&1 || true
      printf '%s\n' 'deployment failed; previous application restored; schema retained' >&2
    else
      printf '%s\n' 'deployment and verified application rollback failed; schema retained' >&2
    fi
  elif [[ "$migration_cleanup_status" -ne 0 ]]; then
    printf '%s\n' 'deployment failed; migration helper cleanup unverified' >&2
  else
    printf '%s\n' 'deployment failed before application replacement' >&2
  fi
  [[ "$status" -ne 0 ]] || status=1
  exit "$status"
}

deploy_candidate() {
  verify_candidate_config
  reconcile_stale_migration_helper

  if healthy_same_digest; then
    verify_candidate_image
    write_deployment_report no-op
    printf '%s\n' 'application already deployed and healthy'
    return 0
  fi

  take_fresh_backup
  pull_candidate_image
  verify_candidate_image
  require_postgres_healthy
  run_candidate_migrator
  rollback_required=true
  replace_candidate_app
  wait_for_app_image "$image" "$candidate_image_id"
  wait_for_permanent_services
  (mlp_atomic_replace_env "$app_environment" APP_IMAGE "$image")
  reconcile_persisted_config
  write_deployment_report deployed
  rollback_required=false
  printf '%s\n' 'application deployment completed'
}

main() {
  mlp_require_root
  parse_arguments "$@"
  mlp_acquire_operations_lock
  validate_protected_inputs
  validate_checkout
  validate_current_references

  trap 'deployment_failed $?' ERR
  trap 'deployment_failed 129' HUP
  trap 'deployment_failed 130' INT
  trap 'deployment_failed 143' TERM
  deploy_candidate
  trap - ERR HUP INT TERM
}

main "$@"
