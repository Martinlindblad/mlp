#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

readonly hold_seconds=172800
readonly -a public_resolvers=(1.1.1.1 8.8.8.8 9.9.9.9)
readonly expected_ns_file=${EXPECTED_NS_FILE:-/etc/mlp/cloudflare-nameservers}
readonly origin_expectations_file=${ORIGIN_EXPECTATIONS_FILE:-/etc/mlp/vercel-origin-records.tsv}
readonly inventory_report_file=${INVENTORY_REPORT_FILE:-/var/lib/mlp/dns-inventory-comparison.json}
readonly state_file=${STATE_FILE:-/var/lib/mlp/cloudflare-authority-start}

temporary_state=

fail() {
  local message=$1
  local status=${2:-1}
  printf '%s\n' "$message" >&2
  exit "$status"
}

cleanup() {
  if [[ -n "$temporary_state" ]]; then
    /bin/rm -f -- "$temporary_state"
    temporary_state=
  fi
}

on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  cleanup || status=70
  exit "$status"
}

require_root() {
  [[ $(/usr/bin/id -u) == 0 ]] || fail 'DNS authority gate requires root' 77
}

require_safe_absolute_path() {
  local candidate=$1
  [[ "$candidate" == /* && "$candidate" != *$'\n'* && "$candidate" != *$'\r'* ]] || \
    fail 'invalid DNS authority gate path' 78
}

require_root_directory() {
  local directory=$1
  local metadata
  [[ -d "$directory" && ! -L "$directory" ]] || \
    fail 'invalid DNS authority gate directory' 78
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$directory") || \
    fail 'DNS authority gate metadata unavailable' 78
  [[ "$metadata" == 0:0:700 ]] || \
    fail 'unsafe DNS authority gate directory ownership or mode' 78
}

require_root_file() {
  local file=$1
  local metadata
  [[ -f "$file" && ! -L "$file" && -s "$file" ]] || \
    fail 'invalid DNS authority gate input' 78
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$file") || \
    fail 'DNS authority gate metadata unavailable' 78
  [[ "$metadata" == 0:0:600 ]] || \
    fail 'unsafe DNS authority gate input ownership or mode' 78
}

invalidate_state() {
  if [[ -f "$state_file" && ! -L "$state_file" ]]; then
    /bin/rm -f -- "$state_file" || \
      fail 'DNS authority evidence could not be invalidated' 70
  fi
}

gate_failure() {
  invalidate_state
  fail 'DNS authority gate failed; the 48-hour hold must restart'
}

normalize_fqdn_lines() {
  /usr/bin/awk '
    NF != 1 { invalid = 1; next }
    {
      value = tolower($1)
      if (value !~ /[.]$/) value = value "."
      print value
    }
    END { exit invalid }
  ' | /usr/bin/sort --unique
}

validate_nameserver_file() {
  local nameserver
  /usr/bin/awk '
    NF != 1 { invalid = 1 }
    END { exit invalid || NR != 2 }
  ' "$expected_ns_file" || fail 'invalid Cloudflare nameserver expectation' 78
  expected_nameservers=()
  while IFS= read -r nameserver; do
    expected_nameservers+=("$nameserver")
  done < <(normalize_fqdn_lines <"$expected_ns_file")
  [[ ${#expected_nameservers[@]} -eq 2 ]] || \
    fail 'expected exactly two Cloudflare nameservers' 78
  for nameserver in "${expected_nameservers[@]}"; do
    [[ "$nameserver" =~ ^[a-z0-9-]+[.]ns[.]cloudflare[.]com[.]$ ]] || \
      fail 'invalid Cloudflare nameserver expectation' 78
  done
}

validate_origin_expectations() {
  local hostname
  local record_type
  local target
  local extra
  local apex_records=0
  local www_records=0
  local lines=0
  local lowercase_hostname

  while IFS=$'\t' read -r hostname record_type target extra || [[ -n "$hostname$record_type$target$extra" ]]; do
    [[ -n "$hostname" && -n "$record_type" && -n "$target" && -z "$extra" ]] || \
      fail 'invalid Vercel origin expectation' 78
    lowercase_hostname=$(printf '%s' "$hostname" | /usr/bin/tr '[:upper:]' '[:lower:]')
    [[ "$hostname" == "$lowercase_hostname" && "$hostname" == *. ]] || \
      fail 'invalid Vercel origin hostname' 78
    [[ "$record_type" =~ ^(A|AAAA|CNAME)$ ]] || \
      fail 'invalid Vercel origin record type' 78
    [[ "$target" != *$'\r'* && "$target" != *[[:space:]]* ]] || \
      fail 'invalid Vercel origin target' 78
    case "$hostname" in
      "$zone.") apex_records=$((apex_records + 1)) ;;
      "www.$zone.") www_records=$((www_records + 1)) ;;
      *) fail 'unexpected Vercel origin hostname' 78 ;;
    esac
    lines=$((lines + 1))
  done <"$origin_expectations_file"

  [[ $lines -gt 0 && $apex_records -gt 0 && $www_records -gt 0 ]] || \
    fail 'incomplete Vercel origin expectations' 78
}

validate_inventory_report() {
  /usr/bin/jq -e '
    type == "object" and
    .status == "matched" and
    (.sourceNonNsCount | type == "number" and . >= 0 and floor == .) and
    (.matchedNonNsCount | type == "number" and . >= 0 and floor == .) and
    .matchedNonNsCount == .sourceNonNsCount and
    (.missingNonNsRecords | type == "array" and length == 0) and
    (.missingMailOrVerificationRecords | type == "array" and length == 0)
  ' "$inventory_report_file" >/dev/null 2>&1 || gate_failure
}

query_dns() {
  local resolver=$1
  local hostname=$2
  local record_type=$3
  /usr/bin/dig -r +time=5 +tries=1 +short "@$resolver" "$hostname" "$record_type"
}

verify_nameservers_and_soa() {
  local resolver
  local actual_nameservers
  local expected_nameservers_text
  local soa
  local soa_primary

  expected_nameservers_text=$(printf '%s\n' "${expected_nameservers[@]}")
  for resolver in "${public_resolvers[@]}"; do
    actual_nameservers=$(query_dns "$resolver" "$zone." NS | normalize_fqdn_lines) || \
      return 1
    [[ "$actual_nameservers" == "$expected_nameservers_text" ]] || return 1

    soa=$(query_dns "$resolver" "$zone." SOA) || return 1
    [[ $(printf '%s\n' "$soa" | /usr/bin/awk '
      NF { count += 1; if (NF != 7) invalid = 1 }
      END { print ((!invalid && count == 1) ? 1 : 0) }
    ') == 1 ]] || \
      return 1
    soa_primary=${soa%%[[:space:]]*}
    soa_primary=$(printf '%s' "$soa_primary" | /usr/bin/tr '[:upper:]' '[:lower:]')
    [[ "$soa_primary" == *.ns.cloudflare.com. ]] || return 1
  done
}

normalize_origin_answers() {
  local record_type=$1
  if [[ "$record_type" == CNAME ]]; then
    normalize_fqdn_lines
  else
    /usr/bin/awk '
      NF != 1 { invalid = 1; next }
      { print $1 }
      END { exit invalid }
    ' | /usr/bin/sort --unique
  fi
}

verify_vercel_origin() {
  local resolver
  local hostname
  local record_type
  local expected
  local actual
  local keys

  keys=$(/usr/bin/awk -F '\t' '{ print $1 "\t" $2 }' "$origin_expectations_file" | \
    /usr/bin/sort --unique) || return 1
  while IFS=$'\t' read -r hostname record_type; do
    [[ -n "$hostname" && -n "$record_type" ]] || return 1
    expected=$(
      /usr/bin/awk -F '\t' -v hostname="$hostname" -v record_type="$record_type" \
        '$1 == hostname && $2 == record_type { print $3 }' "$origin_expectations_file" | \
        normalize_origin_answers "$record_type"
    ) || return 1
    [[ -n "$expected" ]] || return 1
    for resolver in "${public_resolvers[@]}"; do
      actual=$(query_dns "$resolver" "$hostname" "$record_type" | \
        normalize_origin_answers "$record_type") || return 1
      [[ "$actual" == "$expected" ]] || return 1
    done
  done <<<"$keys"
}

read_state_epoch() {
  local first_line=
  local line_count
  require_root_file "$state_file"
  IFS= read -r first_line <"$state_file" || true
  line_count=$(/usr/bin/awk 'END { print NR + 0 }' "$state_file")
  [[ "$line_count" == 1 && -n "$first_line" && "$first_line" =~ ^[0-9]+$ ]] || \
    fail 'invalid DNS authority evidence' 78
  printf '%s\n' "$first_line"
}

create_state_atomically() {
  local now=$1
  local state_directory=${state_file%/*}
  local state_basename=${state_file##*/}

  temporary_state=$(/usr/bin/mktemp "${state_directory}/.${state_basename}.XXXXXX") || \
    fail 'DNS authority evidence could not be created' 70
  printf '%s\n' "$now" >"$temporary_state"
  /bin/chmod 0600 "$temporary_state"
  /bin/mv -f -- "$temporary_state" "$state_file"
  temporary_state=
  require_root_file "$state_file"
}

main() {
  local now
  local started
  local elapsed
  local remaining
  local state_directory

  [[ $# -eq 1 ]] || fail 'usage: dns-authority.sh <zone>' 64
  zone=${1%.}
  zone=$(printf '%s' "$zone" | /usr/bin/tr '[:upper:]' '[:lower:]')
  [[ "$zone" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ && "$zone" == *.* && "$zone" != *..* ]] || \
    fail 'invalid DNS zone' 64

  require_root
  for input_path in "$expected_ns_file" "$origin_expectations_file" "$inventory_report_file" "$state_file"; do
    require_safe_absolute_path "$input_path"
  done
  state_directory=${state_file%/*}
  require_root_directory "$state_directory"
  require_root_directory "${expected_ns_file%/*}"
  require_root_directory "${origin_expectations_file%/*}"
  require_root_directory "${inventory_report_file%/*}"
  require_root_file "$expected_ns_file"
  require_root_file "$origin_expectations_file"
  require_root_file "$inventory_report_file"
  if [[ -e "$state_file" || -L "$state_file" ]]; then
    [[ -f "$state_file" && ! -L "$state_file" ]] || \
      fail 'unsafe DNS authority evidence path' 78
  fi

  validate_nameserver_file
  validate_origin_expectations
  validate_inventory_report
  verify_nameservers_and_soa || gate_failure
  verify_vercel_origin || gate_failure

  now=$(/bin/date --utc +%s) || fail 'DNS authority clock unavailable' 70
  [[ "$now" =~ ^[0-9]+$ ]] || fail 'invalid DNS authority clock' 70

  if [[ ! -e "$state_file" ]]; then
    create_state_atomically "$now"
    printf 'authority hold started at %s; remaining %s seconds\n' "$now" "$hold_seconds"
    exit 75
  fi

  started=$(read_state_epoch)
  ((now >= started)) || fail 'DNS authority evidence is from the future' 78
  elapsed=$((now - started))
  if ((elapsed < hold_seconds)); then
    remaining=$((hold_seconds - elapsed))
    printf 'authority verified; elapsed %s seconds; remaining %s seconds\n' \
      "$elapsed" "$remaining"
    exit 75
  fi

  printf 'authority stable for at least 172800 seconds; elapsed %s seconds\n' "$elapsed"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
main "$@"
