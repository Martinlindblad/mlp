#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

readonly migration_url=https://migration.martin-lindblad.com/api/health/ready
readonly cloudflare_api=https://api.cloudflare.com/client/v4
readonly account_id_file=${CLOUDFLARE_ACCOUNT_ID_FILE:-/etc/mlp/cloudflare-account-id}
readonly tunnel_id_file=${CLOUDFLARE_TUNNEL_ID_FILE:-/etc/mlp/cloudflare-tunnel-id}
readonly api_token_file=${CLOUDFLARE_API_TOKEN_FILE:-/etc/mlp/secrets/cloudflare-api-read-token}
readonly access_client_id_file=${CF_ACCESS_CLIENT_ID_FILE:-/etc/mlp/secrets/cloudflare-access-client-id}
readonly access_client_secret_file=${CF_ACCESS_CLIENT_SECRET_FILE:-/etc/mlp/secrets/cloudflare-access-client-secret}
readonly -a connector_services=(cloudflared-a cloudflared-b)
readonly -a origin_containers=(mlp-prod-app-1 mlp-prod-caddy-1 mlp-prod-postgres-1)

work_directory=

fail() {
  local message=$1
  local status=${2:-1}
  printf '%s\n' "$message" >&2
  exit "$status"
}

cleanup() {
  if [[ -n "$work_directory" && -d "$work_directory" && ! -L "$work_directory" ]]; then
    /bin/rm -rf -- "$work_directory"
    work_directory=
  fi
}

on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  cleanup || status=70
  exit "$status"
}

require_root() {
  [[ $(/usr/bin/id -u) == 0 ]] || fail 'tunnel health gate requires root' 77
}

require_root_directory() {
  local directory=$1
  local metadata
  [[ "$directory" == /* && -d "$directory" && ! -L "$directory" ]] || \
    fail 'invalid tunnel health directory' 78
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$directory") || \
    fail 'tunnel health metadata unavailable' 78
  [[ "$metadata" == 0:0:700 ]] || \
    fail 'unsafe tunnel health directory ownership or mode' 78
}

require_root_file() {
  local file=$1
  local metadata
  [[ "$file" == /* && "$file" != *$'\n'* && "$file" != *$'\r'* ]] || \
    fail 'invalid tunnel health input path' 78
  [[ -f "$file" && ! -L "$file" && -s "$file" ]] || \
    fail 'invalid tunnel health input' 78
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$file") || \
    fail 'tunnel health metadata unavailable' 78
  [[ "$metadata" == 0:0:600 ]] || \
    fail 'unsafe tunnel health input ownership or mode' 78
}

read_single_line() {
  local file=$1
  local value=
  local line_count
  IFS= read -r value <"$file" || true
  line_count=$(/usr/bin/awk 'END { print NR + 0 }' "$file")
  [[ "$line_count" == 1 && -n "$value" ]] || \
    fail 'invalid tunnel health input' 78
  [[ "$value" != *$'\r'* && "$value" != *$'\n'* ]] || \
    fail 'invalid tunnel health input' 78
  printf '%s' "$value"
}

curl_json() {
  local header_file=$1
  local url=$2
  /usr/bin/curl -q \
    --fail \
    --silent \
    --show-error \
    --proto '=https' \
    --tlsv1.2 \
    --connect-timeout 5 \
    --max-time 15 \
    --header "@$header_file" \
    "$url"
}

verify_local_connectors() {
  local listing
  local expected
  local connector
  local inspection

  listing=$(
    /usr/bin/docker container ls --all \
      --filter label=com.docker.compose.project=mlp-prod \
      --format '{{.Label "com.docker.compose.service"}}\t{{.Names}}' | \
      /usr/bin/awk -F '\t' '$1 ~ /^cloudflared-/ { print }' | \
      /usr/bin/sort
  ) || return 1
  expected=$'cloudflared-a\tmlp-prod-cloudflared-a-1\ncloudflared-b\tmlp-prod-cloudflared-b-1'
  [[ "$listing" == "$expected" ]] || return 1

  for connector in "${connector_services[@]}"; do
    inspection=$(
      /usr/bin/docker inspect --format \
        '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
        "mlp-prod-${connector}-1"
    ) || return 1
    [[ "$inspection" == 'running healthy' ]] || return 1
  done
}

verify_no_origin_ports() {
  local container
  local published
  for container in "${origin_containers[@]}"; do
    published=$(/usr/bin/docker port "$container") || return 1
    [[ -z "$published" ]] || return 1
  done
}

verify_remote_tunnel() {
  local api_headers=$1
  local base_url=$2
  local tunnel
  local configuration
  local connections

  tunnel=$(curl_json "$api_headers" "$base_url") || return 1
  /usr/bin/jq -e '
    .success == true and
    .result.name == "mlp-prod" and
    .result.config_src == "cloudflare" and
    .result.status == "healthy"
  ' <<<"$tunnel" >/dev/null 2>&1 || return 1

  configuration=$(curl_json "$api_headers" "$base_url/configurations") || return 1
  /usr/bin/jq -e '
    .success == true and
    .result.source == "cloudflare" and
    (.result.config.ingress | type == "array" and length == 4) and
    .result.config.ingress[0].hostname == "migration.martin-lindblad.com" and
    .result.config.ingress[0].service == "http://caddy:8080" and
    (.result.config.ingress[0] | has("path") | not) and
    .result.config.ingress[1].hostname == "martin-lindblad.com" and
    .result.config.ingress[1].service == "http://caddy:8080" and
    (.result.config.ingress[1] | has("path") | not) and
    .result.config.ingress[2].hostname == "www.martin-lindblad.com" and
    .result.config.ingress[2].service == "http://caddy:8080" and
    (.result.config.ingress[2] | has("path") | not) and
    (.result.config.ingress[3] | has("hostname") | not) and
    (.result.config.ingress[3] | has("path") | not) and
    .result.config.ingress[3].service == "http_status:404"
  ' <<<"$configuration" >/dev/null 2>&1 || return 1

  connections=$(curl_json "$api_headers" "$base_url/connections") || return 1
  /usr/bin/jq -e '
    .success == true and
    (.result | type == "array" and length == 2) and
    ([.result[].id] | unique | length == 2) and
    all(.result[];
      (.id | type == "string" and length > 0) and
      (.conns | type == "array" and
        any(.[]; .is_pending_reconnect == false)))
  ' <<<"$connections" >/dev/null 2>&1 || return 1
}

verify_public_access() {
  local access_headers=$1
  local unauthenticated
  local authenticated

  unauthenticated=$(
    /usr/bin/curl -q \
      --silent \
      --show-error \
      --proto '=https' \
      --tlsv1.2 \
      --connect-timeout 5 \
      --max-time 15 \
      --output /dev/null \
      --write-out '%{http_code} %{redirect_url}' \
      "$migration_url"
  ) || return 1
  [[ "$unauthenticated" =~ ^302[[:space:]]https://[A-Za-z0-9.-]+[.]cloudflareaccess[.]com/ ]] || \
    return 1

  authenticated=$(
    /usr/bin/curl -q \
      --silent \
      --show-error \
      --proto '=https' \
      --tlsv1.2 \
      --connect-timeout 5 \
      --max-time 15 \
      --header "@$access_headers" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "$migration_url"
  ) || return 1
  [[ "$authenticated" == 200 ]]
}

main() {
  local account_id
  local tunnel_id
  local api_token
  local access_client_id
  local access_client_secret
  local api_headers
  local access_headers
  local tunnel_url
  local input_directory

  [[ $# -eq 0 ]] || fail 'tunnel-health.sh accepts no arguments' 64
  require_root
  require_root_directory /etc/mlp
  require_root_directory /etc/mlp/docker-client

  for input_file in \
    "$account_id_file" \
    "$tunnel_id_file" \
    "$api_token_file" \
    "$access_client_id_file" \
    "$access_client_secret_file"; do
    input_directory=${input_file%/*}
    require_root_directory "$input_directory"
    require_root_file "$input_file"
  done

  account_id=$(read_single_line "$account_id_file")
  tunnel_id=$(read_single_line "$tunnel_id_file")
  api_token=$(read_single_line "$api_token_file")
  access_client_id=$(read_single_line "$access_client_id_file")
  access_client_secret=$(read_single_line "$access_client_secret_file")
  [[ "$account_id" =~ ^[0-9a-f]{32}$ ]] || fail 'invalid Cloudflare account ID' 78
  [[ "$tunnel_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || \
    fail 'invalid Cloudflare tunnel ID' 78
  if [[ ! "$api_token" =~ ^[A-Za-z0-9._~-]+$ ]] || \
    ((${#api_token} < 16 || ${#api_token} > 512)); then
    fail 'invalid Cloudflare API credential' 78
  fi
  if [[ ! "$access_client_id" =~ ^[A-Za-z0-9._~-]+$ ]] || \
    ((${#access_client_id} < 16 || ${#access_client_id} > 512)); then
    fail 'invalid Cloudflare Access credential' 78
  fi
  if [[ ! "$access_client_secret" =~ ^[A-Za-z0-9._~-]+$ ]] || \
    ((${#access_client_secret} < 16 || ${#access_client_secret} > 512)); then
    fail 'invalid Cloudflare Access credential' 78
  fi

  unset "${!DOCKER_@}"
  unset ALL_PROXY all_proxy FTP_PROXY ftp_proxy HTTP_PROXY http_proxy \
    HTTPS_PROXY https_proxy NO_PROXY no_proxy CURL_CA_BUNDLE CURL_HOME \
    SSL_CERT_DIR SSL_CERT_FILE XDG_CONFIG_HOME
  HOME=/etc/mlp
  DOCKER_CONFIG=/etc/mlp/docker-client
  DOCKER_HOST=unix:///run/docker.sock
  export DOCKER_CONFIG DOCKER_HOST HOME

  work_directory=$(/usr/bin/mktemp -d /tmp/mlp-tunnel-health.XXXXXX) || \
    fail 'tunnel health workspace unavailable' 70
  api_headers=$work_directory/api.headers
  access_headers=$work_directory/access.headers
  printf 'Authorization: Bearer %s\n' "$api_token" >"$api_headers"
  printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' \
    "$access_client_id" "$access_client_secret" >"$access_headers"
  /bin/chmod 0600 "$api_headers" "$access_headers"
  unset api_token access_client_id access_client_secret

  tunnel_url="$cloudflare_api/accounts/$account_id/cfd_tunnel/$tunnel_id"
  verify_local_connectors || fail 'tunnel connector health gate failed'
  verify_no_origin_ports || fail 'public origin port gate failed'
  verify_remote_tunnel "$api_headers" "$tunnel_url" || \
    fail 'remote tunnel configuration gate failed'
  verify_public_access "$access_headers" || fail 'Cloudflare Access gate failed'

  printf '%s\n' 'tunnel health passed'
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
main "$@"
