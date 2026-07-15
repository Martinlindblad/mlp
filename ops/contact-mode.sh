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
for variable in "${!DOCKER_@}"; do
  unset "$variable"
done
unset variable
HOME=/etc/mlp
DOCKER_CONFIG=/etc/mlp/docker-client
DOCKER_HOST=unix:///run/docker.sock
export DOCKER_CONFIG DOCKER_HOST HOME

readonly app_environment=/etc/mlp/env/app.env
readonly compose_command=/usr/local/sbin/mlp-compose
readonly docker_command=/usr/bin/docker
readonly timeout_command=/usr/bin/timeout
readonly rollback_reconcile_attempts=3
readonly stable_observation_count=6

target_mode=
prior_mode=
rollback_required=false

fail() {
  local message=${1:-contact mode operation failed}
  local status=${2:-1}
  printf '%s\n' "$message" >&2
  exit "$status"
}

run_bounded() {
  local seconds=$1
  shift
  "$timeout_command" --kill-after=5s "$seconds" "$@"
}

parse_mode() {
  [[ $# -eq 1 ]] || fail 'invalid contact mode operation' 64
  case "$1" in
    enabled) target_mode=contact-enabled ;;
    maintenance) target_mode=contact-maintenance ;;
    *) fail 'invalid contact mode operation' 64 ;;
  esac
}

read_contact_mode() {
  local found=false
  local line
  local value=

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == APP_CONTACT_MODE=* ]]; then
      [[ "$found" == false ]] || return 1
      value=${line#APP_CONTACT_MODE=}
      found=true
    fi
  done <"$app_environment"
  [[ "$found" == true ]] || return 1
  case "$value" in
    contact-enabled | contact-maintenance) printf '%s' "$value" ;;
    *) return 1 ;;
  esac
}

container_state() {
  local service=$1
  run_bounded 10 "$docker_command" inspect --type container \
    --format '{{.State.Status}}|{{.State.Health.Status}}' "mlp-prod-${service}-1"
}

inspect_caddy_mode() {
  local environment
  local found=false
  local line
  local value=

  environment=$(run_bounded 10 "$docker_command" inspect --type container \
    --format '{{range .Config.Env}}{{println .}}{{end}}' mlp-prod-caddy-1)
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == CONTACT_MODE=* ]]; then
      [[ "$found" == false ]] || return 1
      value=${line#CONTACT_MODE=}
      found=true
    fi
  done <<<"$environment"
  [[ "$found" == true ]] || return 1
  case "$value" in
    contact-enabled | contact-maintenance) printf '%s' "$value" ;;
    *) return 1 ;;
  esac
}

require_app_ready() {
  [[ $(container_state app) == 'running|healthy' ]]
}

require_caddy_state() {
  local expected=$1
  [[ $(container_state caddy) == 'running|healthy' ]]
  [[ $(inspect_caddy_mode) == "$expected" ]]
}

wait_for_caddy() {
  local expected=$1
  local attempt

  for attempt in {1..30}; do
    if require_caddy_state "$expected" 2>/dev/null; then
      return 0
    fi
    [[ "$attempt" -lt 30 ]] || return 1
    /bin/sleep 2
  done
}

probe_contact_mode() {
  local expected=$1
  local probe

  read -r -d '' probe <<'JS' || true
  import http from 'node:http';

  const [hostname, portText, expected] = process.argv.slice(1);
  const port = Number(portText);
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    process.exit(1);
  }

  const fail = () => {
    process.exitCode = 1;
  };
  const request = http.request({
    hostname,
    port,
    path: '/api/contact/route',
    method: 'POST',
    headers: {
      Host: 'martin-lindblad.com',
      'CF-Connecting-IP': '127.0.0.1',
      'Content-Type': 'application/json',
      'Content-Length': '2',
    },
  }, (response) => {
    let valid = false;
    if (expected === 'contact-maintenance') {
      valid = response.statusCode === 503 && response.headers['retry-after'] === '300';
    } else if (expected === 'contact-enabled') {
      valid = response.statusCode === 400;
    }
    response.on('error', fail);
    response.resume();
    response.on('end', () => {
      if (!valid) fail();
    });
  });
  request.setTimeout(5000, () => request.destroy(new Error('timeout')));
  request.on('error', fail);
  request.end('{}');
JS
  run_bounded 15 "$docker_command" exec mlp-prod-app-1 \
    node --input-type=module -e "$probe" caddy 8080 "$expected" >/dev/null
}

recreate_caddy() {
  local expected=$1
  run_bounded 180 "$compose_command" up -d --no-deps --force-recreate caddy
  wait_for_caddy "$expected"
}

verify_contact_mode_once() {
  local expected=$1
  local configured

  configured=$(read_contact_mode) || return 1
  [[ "$configured" == "$expected" ]] || return 1
  require_caddy_state "$expected" || return 1
  probe_contact_mode "$expected"
}

verify_stable_contact_mode() {
  local expected=$1
  local observation

  for ((observation = 1; observation <= stable_observation_count; observation++)); do
    verify_contact_mode_once "$expected" || return 1
    [[ "$observation" -eq "$stable_observation_count" ]] || /bin/sleep 2
  done
}

rollback_contact_mode() {
  local attempt

  (mlp_atomic_replace_env "$app_environment" APP_CONTACT_MODE "$prior_mode") || return 1
  for ((attempt = 1; attempt <= rollback_reconcile_attempts; attempt++)); do
    if recreate_caddy "$prior_mode" && verify_stable_contact_mode "$prior_mode"; then
      return 0
    fi
  done
  return 1
}

contact_mode_failed() {
  local status=${1:-1}
  local rollback_status=0

  trap - ERR HUP INT TERM
  set +e
  if [[ "$rollback_required" == true ]]; then
    rollback_contact_mode
    rollback_status=$?
    if [[ "$rollback_status" -eq 0 ]]; then
      printf '%s\n' 'contact mode change failed; prior mode restored' >&2
    else
      printf '%s\n' 'contact mode change and verified restoration failed' >&2
    fi
  else
    printf '%s\n' 'contact mode operation failed before mode change' >&2
  fi
  [[ "$status" -ne 0 ]] || status=1
  exit "$status"
}

switch_contact_mode() {
  if [[ "$target_mode" == contact-enabled ]]; then
    require_app_ready
  fi
  verify_stable_contact_mode "$prior_mode"

  if [[ "$target_mode" == "$prior_mode" ]]; then
    printf '%s\n' 'contact mode already active and verified'
    return 0
  fi

  rollback_required=true
  (mlp_atomic_replace_env "$app_environment" APP_CONTACT_MODE "$target_mode")
  recreate_caddy "$target_mode"
  verify_stable_contact_mode "$target_mode"
  rollback_required=false
  printf '%s\n' 'contact mode change completed'
}

main() {
  mlp_require_root
  parse_mode "$@"
  mlp_acquire_operations_lock
  mlp_require_root_directory /etc/mlp 0700
  mlp_require_root_directory /etc/mlp/docker-client 0700
  mlp_require_root_directory /etc/mlp/env 0700
  mlp_require_root_file /etc/mlp/env/app.env 0600
  prior_mode=$(read_contact_mode) || fail 'invalid current contact mode' 78

  trap 'contact_mode_failed $?' ERR
  trap 'contact_mode_failed 129' HUP
  trap 'contact_mode_failed 130' INT
  trap 'contact_mode_failed 143' TERM
  switch_contact_mode
  trap - ERR HUP INT TERM
}

main "$@"
