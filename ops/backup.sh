#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
for variable in "${!DOCKER_@}"; do
  unset "$variable"
done
unset variable
unset BASH_ENV CDPATH ENV GLOBIGNORE PS4
# Xtrace is disabled before environment access. Do not unset BASH_XTRACEFD:
# Bash closes the referenced descriptor, which may be the inherited lock FD.
export HOME=/etc/mlp
export DOCKER_CONFIG=/etc/mlp/docker-client
export DOCKER_HOST=unix:///run/docker.sock

# shellcheck source=/dev/null
source /opt/mlp/ops/lib/operations.sh

readonly MLP_BACKUP_REPORT_DIRECTORY=/var/lib/mlp/backup-reports
readonly MLP_BACKUP_LAST_ATTEMPT=/var/lib/mlp/backup-reports/last-attempt.json
readonly MLP_BACKUP_LATEST_SUCCESS=/var/lib/mlp/backup-reports/latest-success.json
readonly MLP_BACKUP_HELPER_NAME=mlp-backup-helper
readonly MLP_BACKUP_HELPER_LABEL_KEY=com.mlp.operation
readonly MLP_BACKUP_HELPER_LABEL_VALUE=backup
readonly MLP_BACKUP_RECONCILE_POLLS=35
readonly MLP_BACKUP_FAST_OBSERVATIONS=3
readonly MLP_BACKUP_SETTLE_OBSERVATIONS=30
MLP_BACKUP_SNAPSHOT_ID=
MLP_BACKUP_HELPER_PRESENT=false
MLP_BACKUP_RECONCILE_REQUIRED=false
MLP_BACKUP_RECONCILE_MINIMUM=$MLP_BACKUP_SETTLE_OBSERVATIONS

mlp_backup_now() {
  /usr/bin/date -u +%Y-%m-%dT%H:%M:%SZ
}

mlp_backup_run_job() {
  /usr/bin/timeout --signal=TERM --kill-after=30s 45m \
    /usr/local/sbin/mlp-compose --profile jobs run --rm \
    --no-TTY --no-deps \
    --name mlp-backup-helper \
    --label com.mlp.operation=backup db-backup
}

mlp_backup_observe_helper() {
  local names

  names="$(
    /usr/bin/timeout --signal=TERM --kill-after=2s 15s \
      /usr/bin/docker container ls --all \
      --filter "name=^/${MLP_BACKUP_HELPER_NAME}$" \
      --format '{{.Names}}' 2>/dev/null
  )" || return $?
  case $names in
    '') MLP_BACKUP_HELPER_PRESENT=false ;;
    "$MLP_BACKUP_HELPER_NAME") MLP_BACKUP_HELPER_PRESENT=true ;;
    *) return 1 ;;
  esac
}

mlp_backup_read_helper_label() {
  /usr/bin/timeout --signal=TERM --kill-after=2s 15s \
    /usr/bin/docker container inspect \
    --format "{{ index .Config.Labels \"${MLP_BACKUP_HELPER_LABEL_KEY}\" }}" \
    "$MLP_BACKUP_HELPER_NAME" 2>/dev/null
}

mlp_backup_remove_helper() {
  /usr/bin/timeout --signal=TERM --kill-after=2s 15s \
    /usr/bin/docker container rm --force \
    "$MLP_BACKUP_HELPER_NAME" >/dev/null 2>&1
}

mlp_backup_pause() {
  /usr/bin/sleep 1
}

mlp_backup_reconcile_helper() {
  local minimum_observations=${1:-$MLP_BACKUP_RECONCILE_MINIMUM}
  local absence_count=0 attempt label

  ((minimum_observations >= MLP_BACKUP_FAST_OBSERVATIONS)) || return 1
  ((minimum_observations <= MLP_BACKUP_SETTLE_OBSERVATIONS)) || return 1
  for ((attempt = 1; attempt <= MLP_BACKUP_RECONCILE_POLLS; attempt += 1)); do
    mlp_backup_observe_helper || return $?
    if [[ $MLP_BACKUP_HELPER_PRESENT == false ]]; then
      ((absence_count += 1))
      if ((
        attempt >= minimum_observations &&
          absence_count >= MLP_BACKUP_FAST_OBSERVATIONS
      )); then
        return 0
      fi
    else
      absence_count=0
      if label="$(mlp_backup_read_helper_label)"; then
        [[ $label == "$MLP_BACKUP_HELPER_LABEL_VALUE" ]] || return 1
        mlp_backup_remove_helper || true
      fi
    fi
    if ((attempt < MLP_BACKUP_RECONCILE_POLLS)); then
      mlp_backup_pause || return $?
    fi
  done
  return 1
}

mlp_backup_extract_snapshot_id() {
  local job_output=$1

  /usr/bin/jq -ser '
    . as $events
    | [$events[] | select(
        type == "object" and .message_type == "summary"
      )] as $summaries
    | if ($events | length) >= 1
      and all($events[]; type == "object")
      and ($summaries | length) == 1
      and ($summaries[0].snapshot_id
        | type == "string" and test("^[0-9a-f]{64}$"))
    then $summaries[0].snapshot_id
    else error("backup summary rejected")
    end
  ' <<<"$job_output"
}

mlp_backup_exit_cleanup() {
  local status=${1:-1}

  trap - EXIT
  if [[ $MLP_BACKUP_RECONCILE_REQUIRED == true ]]; then
    if mlp_backup_reconcile_helper >/dev/null 2>&1; then
      MLP_BACKUP_RECONCILE_REQUIRED=false
    else
      status=1
    fi
  fi
  exit "$status"
}

mlp_backup_signal_exit() {
  local status=$1

  trap - HUP INT TERM
  exit "$status"
}

mlp_backup_make_report_file() {
  /usr/bin/mktemp "$MLP_BACKUP_REPORT_DIRECTORY/.report.XXXXXX"
}

mlp_backup_install_report() {
  local destination=$1
  local status=$2
  local started_at=$3
  local completed_at=$4
  local snapshot_id=${5:-}
  local report_file

  report_file="$(mlp_backup_make_report_file)" || return $?
  if [[ $status == passed ]]; then
    if ! /usr/bin/jq -n \
      --arg status "$status" \
      --arg snapshotId "$snapshot_id" \
      --arg startedAt "$started_at" \
      --arg completedAt "$completed_at" \
      '{status:$status,snapshotId:$snapshotId,startedAt:$startedAt,completedAt:$completedAt}' \
      >"$report_file"; then
      /bin/rm -f -- "$report_file"
      return 1
    fi
  else
    if ! /usr/bin/jq -n \
      --arg status failed \
      --arg startedAt "$started_at" \
      --arg completedAt "$completed_at" \
      '{status:$status,startedAt:$startedAt,completedAt:$completedAt}' \
      >"$report_file"; then
      /bin/rm -f -- "$report_file"
      return 1
    fi
  fi

  if ! mlp_atomic_install_json "$report_file" "$destination"; then
    /bin/rm -f -- "$report_file"
    return 1
  fi
  /bin/rm -f -- "$report_file"
}

mlp_backup_create_snapshot() {
  local cleanup_status job_output job_status snapshot_id

  MLP_BACKUP_SNAPSHOT_ID=
  MLP_BACKUP_RECONCILE_REQUIRED=true
  MLP_BACKUP_RECONCILE_MINIMUM=$MLP_BACKUP_SETTLE_OBSERVATIONS
  mlp_backup_reconcile_helper "$MLP_BACKUP_RECONCILE_MINIMUM" \
    >/dev/null 2>&1 || return $?
  if job_output="$(mlp_backup_run_job 2>/dev/null)"; then
    job_status=0
    MLP_BACKUP_RECONCILE_MINIMUM=$MLP_BACKUP_FAST_OBSERVATIONS
  else
    job_status=$?
    MLP_BACKUP_RECONCILE_MINIMUM=$MLP_BACKUP_SETTLE_OBSERVATIONS
  fi
  if mlp_backup_reconcile_helper "$MLP_BACKUP_RECONCILE_MINIMUM" \
    >/dev/null 2>&1; then
    cleanup_status=0
    MLP_BACKUP_RECONCILE_REQUIRED=false
  else
    cleanup_status=$?
  fi
  if ((job_status != 0)); then
    unset job_output
    return "$job_status"
  fi
  if ((cleanup_status != 0)); then
    unset job_output
    return "$cleanup_status"
  fi
  snapshot_id="$(mlp_backup_extract_snapshot_id "$job_output" 2>/dev/null)" || {
    unset job_output
    return 1
  }
  unset job_output
  [[ $snapshot_id =~ ^[0-9a-f]{64}$ ]] || return 1
  MLP_BACKUP_SNAPSHOT_ID=$snapshot_id
}

mlp_backup_main() {
  local started_at completed_at snapshot_id failure_status

  if (($# != 0)); then
    printf '%s\n' 'backup accepts no arguments' >&2
    return 64
  fi

  mlp_require_root
  mlp_acquire_operations_lock
  trap 'mlp_backup_exit_cleanup "$?"' EXIT
  trap 'mlp_backup_signal_exit 129' HUP
  trap 'mlp_backup_signal_exit 130' INT
  trap 'mlp_backup_signal_exit 143' TERM
  mlp_require_root_directory "/etc/mlp/docker-client" 0700
  mlp_require_root_directory "/var/lib/mlp/backup-reports" 0700

  started_at="$(mlp_backup_now)"
  if mlp_backup_create_snapshot && \
    [[ $MLP_BACKUP_SNAPSHOT_ID =~ ^[0-9a-f]{64}$ ]]; then
    snapshot_id=$MLP_BACKUP_SNAPSHOT_ID
    completed_at="$(mlp_backup_now)"
    mlp_backup_install_report \
      "$MLP_BACKUP_LATEST_SUCCESS" passed "$started_at" "$completed_at" \
      "$snapshot_id"
    mlp_backup_install_report \
      "$MLP_BACKUP_LAST_ATTEMPT" passed "$started_at" "$completed_at" \
      "$snapshot_id"
    printf '%s\n' 'backup completed'
    return 0
  else
    failure_status=$?
  fi

  completed_at="$(mlp_backup_now)"
  mlp_backup_install_report \
    "$MLP_BACKUP_LAST_ATTEMPT" failed "$started_at" "$completed_at"
  printf '%s\n' 'backup failed' >&2
  return "$failure_status"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  mlp_backup_main "$@"
fi
