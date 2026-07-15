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
readonly state_file=/var/lib/mlp/cloudflare-authority-start

temporary_state=
inventory_digest=
canonical_origin_expectations=
baseline_fingerprint=
state_epoch=
state_fingerprint=

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
  local canonical_lines
  local expected_lines

  /usr/bin/awk -F '\t' -v zone="$zone." '
    BEGIN {
      hosts[1] = zone
      hosts[2] = "www." zone
      types[1] = "A"
      types[2] = "AAAA"
      types[3] = "CNAME"
    }
    function invalid() { failed = 1 }
    {
      if (NF != 3 || $1 == "" || $2 == "" || $3 == "") {
        invalid()
        next
      }
      hostname = $1
      record_type = $2
      target = $3
      if (hostname != tolower(hostname) || hostname !~ /[.]$/ ||
          (hostname != hosts[1] && hostname != hosts[2]) ||
          (record_type != "A" && record_type != "AAAA" &&
           record_type != "CNAME") || target ~ /[[:space:]]/) {
        invalid()
        next
      }
      if (target != "-") {
        if ((record_type == "A" &&
             target !~ /^([0-9][0-9]*[.]){3}[0-9][0-9]*$/) ||
            (record_type == "AAAA" &&
             (target != tolower(target) || target !~ /^[0-9a-f:]+$/)) ||
            (record_type == "CNAME" &&
             (target != tolower(target) || target !~ /[.]$/ ||
              target !~ /^([a-z0-9_-]+[.])+$/))) {
          invalid()
          next
        }
      }
      key = hostname SUBSEP record_type
      total[key] += 1
      if (target == "-") absent[key] += 1
      else present[key] += 1
    }
    END {
      for (host = 1; host <= 2; host += 1) {
        for (type = 1; type <= 3; type += 1) {
          key = hosts[host] SUBSEP types[type]
          if (total[key] < 1 ||
              (absent[key] > 0 &&
               (absent[key] != 1 || present[key] != 0))) invalid()
        }
        cname = hosts[host] SUBSEP "CNAME"
        address = hosts[host] SUBSEP "A"
        address6 = hosts[host] SUBSEP "AAAA"
        if (present[cname] > 0 &&
            (absent[address] != 1 || absent[address6] != 1)) invalid()
      }
      exit failed
    }
  ' "$origin_expectations_file" || fail 'invalid Vercel origin expectation' 78

  canonical_origin_expectations=$(/usr/bin/sort --unique "$origin_expectations_file") || \
    fail 'invalid Vercel origin expectation' 78
  expected_lines=$(/usr/bin/awk 'END { print NR + 0 }' "$origin_expectations_file")
  canonical_lines=$(printf '%s\n' "$canonical_origin_expectations" | \
    /usr/bin/awk 'END { print NR + 0 }')
  [[ "$expected_lines" == "$canonical_lines" ]] || \
    fail 'duplicate Vercel origin expectation' 78
}

validate_inventory_report() {
  local matched_digest
  local matched_json
  local source_digest
  local source_json

  /usr/bin/jq -e '
    def canonical_record:
      (type == "string") and
      (split("\t") as $fields |
        ($fields | length == 5) and
        ($fields[0] | test("^([a-z0-9_*_-]+[.])+$")) and
        ($fields[1] | test("^[A-Z][A-Z0-9]*$") and . != "NS") and
        ($fields[2] | test("^(0|[1-9][0-9]*)$")) and
        ($fields[3] | test("^(-|0|[1-9][0-9]*)$")) and
        ($fields[4] | length > 0 and (test("[\\t\\r\\n]") | not)));
    type == "object" and
    ((keys | sort) == ([
      "matchedNonNsCount",
      "matchedNonNsDigest",
      "matchedNonNsRecords",
      "missingMailOrVerificationRecords",
      "missingNonNsRecords",
      "sourceNonNsCount",
      "sourceNonNsDigest",
      "sourceNonNsRecords",
      "status"
    ] | sort)) and
    .status == "matched" and
    (.sourceNonNsCount | type == "number" and . > 0 and floor == .) and
    (.matchedNonNsCount | type == "number" and . > 0 and floor == .) and
    .matchedNonNsCount == .sourceNonNsCount and
    (.sourceNonNsRecords | type == "array" and length > 0 and
      all(.[]; canonical_record)) and
    (.matchedNonNsRecords | type == "array" and length > 0 and
      all(.[]; canonical_record)) and
    .sourceNonNsCount == (.sourceNonNsRecords | length) and
    .matchedNonNsCount == (.matchedNonNsRecords | length) and
    .sourceNonNsRecords == (.sourceNonNsRecords | sort | unique) and
    .matchedNonNsRecords == (.matchedNonNsRecords | sort | unique) and
    .matchedNonNsRecords == .sourceNonNsRecords and
    (.sourceNonNsDigest | type == "string" and test("^[0-9a-f]{64}$")) and
    (.matchedNonNsDigest | type == "string" and test("^[0-9a-f]{64}$")) and
    (.missingNonNsRecords == []) and
    (.missingMailOrVerificationRecords == [])
  ' "$inventory_report_file" >/dev/null 2>&1 || gate_failure

  source_json=$(/usr/bin/jq -c '.sourceNonNsRecords' "$inventory_report_file") || \
    gate_failure
  matched_json=$(/usr/bin/jq -c '.matchedNonNsRecords' "$inventory_report_file") || \
    gate_failure
  source_digest=$(printf '%s' "$source_json" | /usr/bin/sha256sum) || gate_failure
  matched_digest=$(printf '%s' "$matched_json" | /usr/bin/sha256sum) || gate_failure
  source_digest=${source_digest%%[[:space:]]*}
  matched_digest=${matched_digest%%[[:space:]]*}
  [[ "$source_digest" == "$matched_digest" ]] || gate_failure
  [[ "$source_digest" == $(/usr/bin/jq -r '.sourceNonNsDigest' "$inventory_report_file") ]] || \
    gate_failure
  [[ "$matched_digest" == $(/usr/bin/jq -r '.matchedNonNsDigest' "$inventory_report_file") ]] || \
    gate_failure
  inventory_digest=$source_digest
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

  for hostname in "$zone." "www.$zone."; do
    for record_type in A AAAA CNAME; do
      expected=$(
        /usr/bin/awk -F '\t' -v hostname="$hostname" -v record_type="$record_type" \
          '$1 == hostname && $2 == record_type && $3 != "-" { print $3 }' \
          "$origin_expectations_file" | normalize_origin_answers "$record_type"
      ) || return 1
      for resolver in "${public_resolvers[@]}"; do
        actual=$(query_dns "$resolver" "$hostname" "$record_type" | \
          normalize_origin_answers "$record_type") || return 1
        [[ "$actual" == "$expected" ]] || return 1
      done
    done
  done
}

compute_baseline_fingerprint() {
  local digest
  local line

  digest=$(
    {
      printf '%s\n' 'cloudflare-authority-baseline-v1'
      printf 'zone:%s\n' "$zone"
      printf 'nameserver:%s\n' "${expected_nameservers[@]}"
      while IFS= read -r line; do
        printf 'origin:%s\n' "$line"
      done <<<"$canonical_origin_expectations"
      printf 'inventory-sha256:%s\n' "$inventory_digest"
    } | /usr/bin/sha256sum
  ) || fail 'DNS authority baseline could not be fingerprinted' 70
  baseline_fingerprint=${digest%%[[:space:]]*}
  [[ "$baseline_fingerprint" =~ ^[0-9a-f]{64}$ ]] || \
    fail 'invalid DNS authority baseline fingerprint' 70
}

read_state() {
  local first_line=
  local line_count
  local extra
  require_root_file "$state_file"
  IFS= read -r first_line <"$state_file" || true
  line_count=$(/usr/bin/awk 'END { print NR + 0 }' "$state_file")
  IFS=$'\t' read -r state_epoch state_fingerprint extra <<<"$first_line"
  [[ "$line_count" == 1 && -n "$first_line" && -z "$extra" && \
    "$state_epoch" =~ ^[0-9]+$ && "$state_fingerprint" =~ ^[0-9a-f]{64}$ ]] || \
    fail 'invalid DNS authority evidence' 78
}

create_state_atomically() {
  local now=$1
  local fingerprint=$2
  local state_directory=${state_file%/*}
  local state_basename=${state_file##*/}

  temporary_state=$(/usr/bin/mktemp "${state_directory}/.${state_basename}.XXXXXX") || \
    fail 'DNS authority evidence could not be created' 70
  printf '%s\t%s\n' "$now" "$fingerprint" >"$temporary_state"
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

  [[ -z ${STATE_FILE+x} ]] || fail 'DNS authority state override is forbidden' 78
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
  compute_baseline_fingerprint
  verify_nameservers_and_soa || gate_failure
  verify_vercel_origin || gate_failure

  now=$(/bin/date --utc +%s) || fail 'DNS authority clock unavailable' 70
  [[ "$now" =~ ^[0-9]+$ ]] || fail 'invalid DNS authority clock' 70

  if [[ ! -e "$state_file" ]]; then
    create_state_atomically "$now" "$baseline_fingerprint"
    printf 'authority hold started at %s; remaining %s seconds\n' "$now" "$hold_seconds"
    exit 75
  fi

  read_state
  if [[ "$state_fingerprint" != "$baseline_fingerprint" ]]; then
    create_state_atomically "$now" "$baseline_fingerprint"
    printf 'authority baseline changed; hold restarted at %s; remaining %s seconds\n' \
      "$now" "$hold_seconds"
    exit 75
  fi
  started=$state_epoch
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
