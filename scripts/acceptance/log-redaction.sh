#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
unset BASH_ENV CDPATH ENV GLOBIGNORE PS4

readonly compose_command=/usr/local/sbin/mlp-compose
readonly -a services=(
  app
  postgres
  migrator
  caddy
  cloudflared-a
  cloudflared-b
  db-backup
)
readonly sensitive_pattern='([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,})|("(fullName|email|subject|message)"[[:space:]]*:)|([[:alpha:]][[:alnum:]+.-]*://[^[:space:]/:@]+:[^[:space:]@/]+@)|(NEXT_ATLAS(_URI|_DATABASE)?|PGPASSWORD|CLOUDFLARE_TUNNEL_TOKEN|TUNNEL_TOKEN|cloudflare-tunnel-token)|(eyJ[A-Za-z0-9_-]{40,})|((^|[|[:space:]])at[[:space:]]+[^[:cntrl:]]*:[0-9]+:[0-9]+\)?([[:space:]]|$))'

log_file=
since=1h

usage() {
  printf '%s\n' 'usage: log-redaction.sh [--since DURATION]' >&2
  return 64
}

require_root() {
  [[ ${EUID:-$(/usr/bin/id -u)} -eq 0 ]] || {
    printf '%s\n' 'log redaction requires root' >&2
    return 77
  }
}

parse_arguments() {
  case $# in
    0) ;;
    2)
      [[ "$1" == --since ]] || return 64
      since=$2
      ;;
    *) return 64 ;;
  esac

  [[ "$since" =~ ^([1-9][0-9]{0,5})([smh])$ ]] || return 64
  local amount=${BASH_REMATCH[1]}
  local unit=${BASH_REMATCH[2]}
  local seconds
  case "$unit" in
    s) seconds=$amount ;;
    m) seconds=$((amount * 60)) ;;
    h) seconds=$((amount * 3600)) ;;
    *) return 64 ;;
  esac
  ((seconds >= 1 && seconds <= 86400)) || return 64
}

cleanup() {
  if [[ -n "$log_file" ]]; then
    /bin/rm -f -- "$log_file"
    log_file=
  fi
}

print_service_counts() {
  local service count
  for service in "${services[@]}"; do
    count="$(
      /usr/bin/awk -v target="$service" '
        {
          prefix = $0
          sub(/[[:space:]]+\|.*/, "", prefix)
          sub(/^mlp-prod-/, "", prefix)
          sub(/-[0-9]+$/, "", prefix)
          if (prefix == target) count += 1
        }
        END { print count + 0 }
      ' "$log_file"
    )"
    printf '%s log_lines=%s\n' "$service" "$count"
  done
}

sensitive_match_status() {
  local status=0
  /usr/bin/grep -Eaiq -- "$sensitive_pattern" "$log_file" || status=$?
  case "$status" in
    0) return 0 ;;
    1) return 1 ;;
    *) return 2 ;;
  esac
}

main() {
  local compose_status=0
  local scan_status=0

  parse_arguments "$@" || {
    usage
    return 64
  }
  require_root
  [[ -x "$compose_command" ]] || {
    printf '%s\n' 'log inspection unavailable' >&2
    return 69
  }

  log_file="$(/usr/bin/mktemp /tmp/mlp-log-redaction.XXXXXXXXXX)"
  trap cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  "$compose_command" logs --since "$since" --no-color --timestamps \
    "${services[@]}" >"$log_file" 2>&1 || compose_status=$?
  if [[ $compose_status -ne 0 ]]; then
    printf '%s\n' 'log inspection failed' >&2
    return "$compose_status"
  fi

  print_service_counts
  sensitive_match_status || scan_status=$?
  case "$scan_status" in
    0)
      printf '%s\n' 'log redaction failed' >&2
      return 1
      ;;
    1)
      printf '%s\n' 'log redaction passed'
      ;;
    *)
      printf '%s\n' 'log inspection failed' >&2
      return 1
      ;;
  esac
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
