#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C

# shellcheck source=/dev/null
source /opt/mlp/ops/lib/operations.sh
unset "${!DOCKER_@}"
HOME=/etc/mlp
DOCKER_CONFIG=/etc/mlp/docker-client
DOCKER_HOST=unix:///run/docker.sock
export DOCKER_CONFIG DOCKER_HOST HOME

readonly backup_report=/var/lib/mlp/backup-reports/latest-success.json
readonly backup_attempt=/var/lib/mlp/backup-reports/last-attempt.json
readonly restore_report=/var/lib/mlp/restore-reports/latest-success.json
readonly status_directory=/var/lib/mlp/status
readonly status_report=/var/lib/mlp/status/latest.json
readonly -a permanent_services=(app caddy cloudflared-a cloudflared-b postgres)

status_now_epoch() {
  /usr/bin/timeout --signal=TERM --kill-after=2s 5s /bin/date --utc +%s
}

status_now_iso() {
  /usr/bin/timeout --signal=TERM --kill-after=2s 5s /bin/date --utc +%FT%TZ
}

status_inspect_service() {
  local service=$1
  /usr/bin/timeout --signal=TERM --kill-after=5s 15s \
    /usr/bin/docker inspect \
    --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}} {{.RestartCount}}' \
    "mlp-prod-${service}-1"
}

status_snapshot_epoch() {
  local report=$1
  local metadata
  local completed_at

  [[ -f "$report" && ! -L "$report" && -s "$report" ]] || return 1
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$report")
  [[ "$metadata" == 0:0:600 ]] || return 1
  completed_at=$(
    /usr/bin/timeout --signal=TERM --kill-after=2s 5s \
      /usr/bin/jq -er '
        select(
          .status == "passed" and
          (.snapshotId | type == "string" and test("^[0-9a-f]{64}$")) and
          (.completedAt | type == "string")
        ) | .completedAt
      ' "$report" 2>/dev/null
  ) || return 1
  /usr/bin/timeout --signal=TERM --kill-after=2s 5s \
    /bin/date --date="$completed_at" +%s 2>/dev/null
}

status_last_backup_attempt_passed() {
  local metadata

  [[ -f "$backup_attempt" && ! -L "$backup_attempt" && -s "$backup_attempt" ]] || \
    return 1
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$backup_attempt")
  [[ "$metadata" == 0:0:600 ]] || return 1
  /usr/bin/timeout --signal=TERM --kill-after=2s 5s \
    /usr/bin/jq -e '
      .status == "passed" and
      (.snapshotId | type == "string" and test("^[0-9a-f]{64}$")) and
      (.completedAt | type == "string")
    ' "$backup_attempt" >/dev/null 2>&1
}

status_disk_used_percent() {
  /usr/bin/timeout --signal=TERM --kill-after=2s 5s \
    /bin/df --portability /var/lib/docker 2>/dev/null | \
    /usr/bin/awk 'NR == 2 { value = $5; gsub(/%/, "", value); print value }'
}

status_memory_available_percent() {
  # shellcheck disable=SC2016
  /usr/bin/timeout --signal=TERM --kill-after=2s 5s \
    /usr/bin/awk '
      $1 == "MemTotal:" { total = $2 }
      $1 == "MemAvailable:" { available = $2 }
      END {
        if (total > 0 && available >= 0) {
          printf "%d\n", (available * 100) / total
        } else {
          exit 1
        }
      }
    ' /proc/meminfo
}

status_publish_report() {
  local report=$1
  mlp_atomic_install_json "$report" "$status_report"
}

status_new_report() {
  /usr/bin/mktemp "${status_directory}/.status.XXXXXX"
}

status_build_report() {
  local report=$1
  local checked_at=$2
  local result=$3
  local permanent_count=$4
  local unhealthy_count=$5
  local restart_count=$6
  local backup_age=$7
  local restore_age=$8
  local disk_used=$9
  local memory_available=${10}
  local last_backup_passed=${11}

  # shellcheck disable=SC2016
  /usr/bin/timeout --signal=TERM --kill-after=2s 5s \
    /usr/bin/jq -n \
    --arg checkedAt "$checked_at" \
    --arg status "$result" \
    --argjson permanentServices "$permanent_count" \
    --argjson unhealthyServices "$unhealthy_count" \
    --argjson restartCount "$restart_count" \
    --argjson backupAgeSeconds "$backup_age" \
    --argjson restoreAgeSeconds "$restore_age" \
    --argjson diskUsedPercent "$disk_used" \
    --argjson memoryAvailablePercent "$memory_available" \
    --argjson lastBackupAttemptPassed "$last_backup_passed" \
    '{
      checkedAt: $checkedAt,
      status: $status,
      checks: {
        permanentServices: $permanentServices,
        unhealthyServices: $unhealthyServices,
        restartCount: $restartCount,
        backupAgeSeconds: $backupAgeSeconds,
        restoreAgeSeconds: $restoreAgeSeconds,
        diskUsedPercent: $diskUsedPercent,
        memoryAvailablePercent: $memoryAvailablePercent,
        lastBackupAttemptPassed: $lastBackupAttemptPassed
      }
    }' >"$report"
}

main() {
  local service
  local inspection
  local state
  local health
  local restarts
  local now_epoch
  local checked_at
  local snapshot_epoch
  local backup_age=-1
  local restore_age=-1
  local disk_used_percent=-1
  local memory_available_percent=-1
  local unhealthy_services=0
  local restart_total=0
  local last_backup_attempt_passed=true
  local failures=0
  local result=passed
  local report

  [[ $# -eq 0 ]] || mlp_fail 'status accepts no arguments' 64
  mlp_require_root
  mlp_acquire_operations_lock
  mlp_require_root_directory /etc/mlp/docker-client 0700
  mlp_require_root_directory "$status_directory" 0700

  now_epoch=$(status_now_epoch) || mlp_fail 'platform status unavailable'
  checked_at=$(status_now_iso) || mlp_fail 'platform status unavailable'

  for service in "${permanent_services[@]}"; do
    if inspection=$(status_inspect_service "$service" 2>/dev/null); then
      read -r state health restarts <<<"$inspection"
    else
      state=unknown
      health=unknown
      restarts=-1
    fi
    if [[ "$state" != running || "$health" != healthy || ! "$restarts" =~ ^[0-9]+$ ]]; then
      unhealthy_services=$((unhealthy_services + 1))
      failures=$((failures + 1))
      continue
    fi
    restart_total=$((restart_total + restarts))
    if ((restarts > 3)); then
      failures=$((failures + 1))
    fi
  done

  if snapshot_epoch=$(status_snapshot_epoch "$backup_report"); then
    if ((snapshot_epoch <= now_epoch)); then
      backup_age=$((now_epoch - snapshot_epoch))
    fi
  fi
  if ((backup_age < 0 || backup_age > 129600)); then
    failures=$((failures + 1))
  fi
  if ! status_last_backup_attempt_passed; then
    last_backup_attempt_passed=false
    failures=$((failures + 1))
  fi

  if snapshot_epoch=$(status_snapshot_epoch "$restore_report"); then
    if ((snapshot_epoch <= now_epoch)); then
      restore_age=$((now_epoch - snapshot_epoch))
    fi
  fi
  if ((restore_age < 0 || restore_age > 2851200)); then
    failures=$((failures + 1))
  fi

  if disk_used_percent=$(status_disk_used_percent) && \
    [[ "$disk_used_percent" =~ ^[0-9]+$ ]] && \
    ((disk_used_percent < 85)); then
    :
  else
    disk_used_percent=-1
    failures=$((failures + 1))
  fi

  if memory_available_percent=$(status_memory_available_percent) && \
    [[ "$memory_available_percent" =~ ^[0-9]+$ ]] && \
    ((memory_available_percent >= 10)); then
    :
  else
    memory_available_percent=-1
    failures=$((failures + 1))
  fi

  if ((failures > 0)); then
    result=failed
  fi

  report=$(status_new_report)
  trap '/bin/rm -f -- "$report"' EXIT HUP INT TERM
  status_build_report \
    "$report" \
    "$checked_at" \
    "$result" \
    "${#permanent_services[@]}" \
    "$unhealthy_services" \
    "$restart_total" \
    "$backup_age" \
    "$restore_age" \
    "$disk_used_percent" \
    "$memory_available_percent" \
    "$last_backup_attempt_passed"
  status_publish_report "$report"
  trap - EXIT HUP INT TERM
  /bin/rm -f -- "$report"

  if [[ "$result" == passed ]]; then
    printf '%s\n' 'platform status passed'
    return 0
  fi
  printf '%s\n' 'platform status failed' >&2
  return 1
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
