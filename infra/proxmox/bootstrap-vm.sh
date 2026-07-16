#!/bin/bash
set -Eeuo pipefail
umask 077
export LC_ALL=C

: "${MANAGEMENT_CIDR:?MANAGEMENT_CIDR is required}"
: "${DNS_RESOLVERS:?DNS_RESOLVERS is required}"
: "${DOCKER_CE_VERSION:?DOCKER_CE_VERSION is required}"
: "${CONTAINERD_VERSION:?CONTAINERD_VERSION is required}"
: "${DOCKER_BUILDX_VERSION:?DOCKER_BUILDX_VERSION is required}"
: "${DOCKER_COMPOSE_VERSION:?DOCKER_COMPOSE_VERSION is required}"

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
readonly script_directory
repository_root=$(cd "$script_directory/../.." && pwd -P)
readonly repository_root
readonly required_compose_version=5.3.1
readonly docker_primary_fingerprint=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
readonly node_version=22.23.1
readonly node_archive="node-v${node_version}-linux-x64.tar.xz"
readonly node_sha256=9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578
readonly node_base_url="https://nodejs.org/dist/v${node_version}"
readonly nftables_candidate=/etc/nftables.conf.new
nftables_temporary=
work_directory=

fail() {
  local message=$1
  local status=${2:-1}
  printf '%s\n' "$message" >&2
  exit "$status"
}

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "$nftables_temporary" ]]; then
    rm -f -- "$nftables_temporary" || status=1
  fi
  if [[ -n "$work_directory" ]]; then
    rm -rf -- "$work_directory" || status=1
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ $(id -u) -eq 0 ]] || fail 'bootstrap-vm.sh requires root' 77

for package_version in \
  "$DOCKER_CE_VERSION" "$CONTAINERD_VERSION" \
  "$DOCKER_BUILDX_VERSION" "$DOCKER_COMPOSE_VERSION"; do
  [[ "$package_version" =~ ^[0-9A-Za-z][0-9A-Za-z.+:~_-]*$ ]] || \
    fail 'Docker package versions must be exact apt version strings' 64
done
unset package_version

compose_semver=${DOCKER_COMPOSE_VERSION#*:}
compose_semver=${compose_semver%%[-+~]*}
IFS=. read -r compose_major compose_minor compose_patch compose_extra \
  <<<"$compose_semver"
[[ -z ${compose_extra:-} && "$compose_major" =~ ^[0-9]+$ && \
  "$compose_minor" =~ ^[0-9]+$ && "$compose_patch" =~ ^[0-9]+$ ]] || \
  fail 'DOCKER_COMPOSE_VERSION must contain an exact semantic version' 64
if ((compose_major < 2 || \
  (compose_major == 2 && compose_minor < 33) || \
  (compose_major == 2 && compose_minor == 33 && compose_patch < 1))); then
  fail 'Docker Compose 2.33.1 or newer required' 64
fi
[[ "$compose_semver" == "$required_compose_version" ]] || \
  fail "repository requires Docker Compose $required_compose_version" 64

[[ -f /etc/os-release ]] || fail 'Debian 13 required' 65
if [[ -L /etc/os-release ]]; then
  [[ $(readlink /etc/os-release) == ../usr/lib/os-release ]] || \
    fail 'Debian 13 required' 65
fi
read -r os_owner os_mode < <(stat -Lc '%U:%G %a' /etc/os-release)
[[ "$os_owner" == root:root && "$os_mode" =~ ^[0-7]{3,4}$ ]] || \
  fail 'Debian 13 requires trusted root-owned OS metadata' 65
(( (8#$os_mode & 8#022) == 0 )) || \
  fail 'Debian 13 requires trusted root-owned OS metadata' 65
# shellcheck source=/dev/null
. /etc/os-release
[[ ${ID:-} == debian && ${VERSION_ID:-} == 13 ]] || {
  printf 'Debian 13 required\n' >&2
  exit 65
}
[[ $(id -u mlp-admin) == 1000 && $(id -g mlp-admin) == 1000 ]] || \
  fail 'mlp-admin must have UID and GID 1000 for the reviewed tmpfiles contract' 78

if [[ "$MANAGEMENT_CIDR" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/([0-9]|[12][0-9]|3[0-2])$ ]] && \
  ((BASH_REMATCH[1] <= 223 && BASH_REMATCH[1] != 0 && \
    BASH_REMATCH[1] != 127 && BASH_REMATCH[2] <= 255 && \
    BASH_REMATCH[3] <= 255 && BASH_REMATCH[4] <= 255 && \
    BASH_REMATCH[5] >= 24)); then
  ssh_rule="ip saddr $MANAGEMENT_CIDR tcp dport 22 accept"
elif [[ "$MANAGEMENT_CIDR" =~ ^([0-9A-Fa-f:]+)/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$ ]] && \
  [[ ${BASH_REMATCH[1]} != :: && ${BASH_REMATCH[1]} != [Ff][Ff]* ]] && \
  ((BASH_REMATCH[2] >= 64)); then
  ssh_rule="ip6 saddr $MANAGEMENT_CIDR tcp dport 22 accept"
else
  fail 'MANAGEMENT_CIDR must be one narrow protected management CIDR' 64
fi

dns_ipv4=()
dns_ipv6=()
read -r -a resolver_values <<<"${DNS_RESOLVERS//,/ }"
((${#resolver_values[@]} > 0)) || fail 'DNS_RESOLVERS must not be empty' 64
for resolver in "${resolver_values[@]}"; do
  if [[ "$resolver" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] && \
    ((BASH_REMATCH[1] <= 255 && BASH_REMATCH[2] <= 255 && \
      BASH_REMATCH[3] <= 255 && BASH_REMATCH[4] <= 255)); then
    dns_ipv4+=("$resolver")
  elif [[ "$resolver" =~ ^[0-9A-Fa-f:]+$ && "$resolver" == *:* ]]; then
    dns_ipv6+=("$resolver")
  else
    fail 'DNS_RESOLVERS contains an invalid address' 64
  fi
done
readonly normalized_resolvers="${resolver_values[*]}"

join_addresses() {
  local joined=
  local address
  for address in "$@"; do
    if [[ -n "$joined" ]]; then
      joined+=', '
    fi
    joined+="$address"
  done
  printf '%s' "$joined"
}

dns_ipv4_rule=
dns_ipv6_rule=
if ((${#dns_ipv4[@]} > 0)); then
  dns_ipv4_rule="ip daddr { $(join_addresses "${dns_ipv4[@]}") } meta l4proto { tcp, udp } th dport 53 accept"
fi
if ((${#dns_ipv6[@]} > 0)); then
  dns_ipv6_rule="ip6 daddr { $(join_addresses "${dns_ipv6[@]}") } meta l4proto { tcp, udp } th dport 53 accept"
fi

cloud_init_status_json=
cloud_init_status_code=
if cloud_init_status_json=$(cloud-init status --wait --long --format json); then
  cloud_init_status_code=0
else
  cloud_init_status_code=$?
fi
[[ -x /usr/bin/python3 ]] || \
  fail 'trusted /usr/bin/python3 cloud-init status JSON parser is unavailable' 69
if ! printf '%s' "$cloud_init_status_json" | /usr/bin/python3 -c '
import json
import sys

reviewed_deprecation = (
    "\u0027user\u0027 of type string is deprecated in 22.2 and scheduled to be "
    "removed in 27.2. Use \u0027users\u0027 list instead."
)
reviewed_stage_recoverable_errors = {"DEPRECATED": [reviewed_deprecation]}
reviewed_aggregate_recoverable_errors = {
    "DEPRECATED": [reviewed_deprecation, reviewed_deprecation]
}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"non-standard JSON constant: {value}")


def errors_are_empty(value):
    if isinstance(value, dict):
        if "errors" in value and value["errors"] != []:
            return False
        return all(errors_are_empty(item) for item in value.values())
    if isinstance(value, list):
        return all(errors_are_empty(item) for item in value)
    return True


def recoverable_errors_by_path(value, path=()):
    found = {}
    if isinstance(value, dict):
        if "recoverable_errors" in value:
            found[path] = value["recoverable_errors"]
        for key, item in value.items():
            found.update(recoverable_errors_by_path(item, path + (key,)))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.update(recoverable_errors_by_path(item, path + (index,)))
    return found


try:
    command_status = int(sys.argv[1])
    payload = json.load(
        sys.stdin,
        object_pairs_hook=unique_object,
        parse_constant=reject_constant,
    )
except (TypeError, ValueError, UnicodeError):
    raise SystemExit(1)

missing = object()
if (
    not isinstance(payload, dict)
    or payload.get("status", missing) != "done"
    or payload.get("stage", missing) is not None
    or payload.get("errors", missing) != []
):
    raise SystemExit(1)

extended_status = payload.get("extended_status", missing)
recoverable_errors = payload.get("recoverable_errors", missing)
clean_done = (
    command_status == 0
    and extended_status == "done"
    and recoverable_errors == {}
)
reviewed_degraded_done = (
    command_status == 2
    and extended_status == "degraded done"
    and recoverable_errors == reviewed_aggregate_recoverable_errors
)
if not (clean_done or reviewed_degraded_done) or not errors_are_empty(payload):
    raise SystemExit(1)
recoverable_outcomes = recoverable_errors_by_path(payload)
if clean_done:
    if any(outcome != {} for outcome in recoverable_outcomes.values()):
        raise SystemExit(1)
else:
    reviewed_degraded_outcomes = {
        (): reviewed_aggregate_recoverable_errors,
        ("init",): reviewed_stage_recoverable_errors,
        ("init-local",): {},
        ("modules-config",): reviewed_stage_recoverable_errors,
        ("modules-final",): {},
    }
    if recoverable_outcomes != reviewed_degraded_outcomes:
        raise SystemExit(1)
' "$cloud_init_status_code"; then
  fail 'cloud-init first boot did not complete with a reviewed status' 69
fi
unset cloud_init_status_json cloud_init_status_code

DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --yes \
  qemu-guest-agent ca-certificates curl gnupg unattended-upgrades nftables git jq \
  xz-utils acl systemd-resolved

validate_apt_mirror_file() {
  local mirror_file=$1
  local mirror_metadata
  local mirror_mode
  local mirror_name
  local mirror_owner
  local mirror_metadata_extra

  [[ "$mirror_file" == /etc/apt/mirrors/* ]] || \
    fail 'APT mirror+file URI must use an absolute path in /etc/apt/mirrors' 78
  mirror_name=${mirror_file#/etc/apt/mirrors/}
  [[ "$mirror_name" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || \
    fail 'APT mirror+file URI must name one reviewed mirror file' 78
  [[ -e "$mirror_file" && -f "$mirror_file" && ! -L "$mirror_file" ]] || \
    fail 'APT mirror file must be an existing regular non-symlink file' 78
  mirror_metadata=$(stat -Lc '%U:%G %a' -- "$mirror_file") || \
    fail 'unable to inspect APT mirror file metadata' 78
  read -r mirror_owner mirror_mode mirror_metadata_extra <<<"$mirror_metadata"
  [[ -z ${mirror_metadata_extra:-} && "$mirror_owner" == root:root && \
    "$mirror_mode" =~ ^[0-7]{3,4}$ ]] || \
    fail 'APT mirror file must be trusted root-owned metadata' 78
  (( (8#$mirror_mode & 8#022) == 0 )) || \
    fail 'APT mirror file must not be group or world writable' 78
  awk '
    /^[[:space:]]*(#|$)/ { next }
    NF != 1 { bad = 1; next }
    $1 !~ /^https:\/\/[^[:space:]]+$/ { bad = 1; next }
    { found = 1 }
    END {
      if (bad || !found) exit 1
    }
  ' "$mirror_file" || \
    fail 'APT mirror file entries must each be exactly one HTTPS URL' 78
}

secure_apt_sources() {
  local apt_source_status
  local apt_source_uri
  local apt_source_uris
  local found_https=false
  local mirror_file
  local source_file
  local -a source_files

  shopt -s nullglob
  source_files=(
    /etc/apt/sources.list
    /etc/apt/sources.list.d/*.list
    /etc/apt/sources.list.d/*.sources
  )
  for source_file in "${source_files[@]}"; do
    [[ -e "$source_file" ]] || continue
    [[ -f "$source_file" && ! -L "$source_file" && -O "$source_file" ]] || \
      fail 'APT source files must be regular root-managed files' 78
    sed -i.mlp-bootstrap \
      -e 's|http://deb.debian.org/|https://deb.debian.org/|g' \
      -e 's|http://security.debian.org/|https://security.debian.org/|g' \
      "$source_file"
    rm -f -- "$source_file.mlp-bootstrap"
    if apt_source_uris=$(awk '
      /^[[:space:]]*(#|$)/ { next }
      $1 == "deb" || $1 == "deb-src" {
        uri = ""
        for (field = 2; field <= NF; field += 1) {
          if ($field ~ /^[A-Za-z][A-Za-z0-9+.-]*:/) {
            uri = $field
            break
          }
        }
        found = 1
        if (uri == "") bad = 1
        else print uri
      }
      tolower($1) == "uris:" {
        if (NF < 2) bad = 1
        for (field = 2; field <= NF; field += 1) {
          found = 1
          print $field
        }
      }
      END {
        if (bad) exit 1
        if (found) exit 0
        exit 3
      }
    ' "$source_file"); then
      while IFS= read -r apt_source_uri; do
        case "$apt_source_uri" in
          https://*) found_https=true ;;
          mirror+file://*)
            mirror_file=${apt_source_uri#mirror+file://}
            validate_apt_mirror_file "$mirror_file"
            found_https=true
            ;;
          *)
            fail 'all active APT sources must use HTTPS or reviewed APT mirror files' 78
            ;;
        esac
      done <<<"$apt_source_uris"
    else
      apt_source_status=$?
      [[ $apt_source_status -eq 3 ]] || \
        fail 'all active APT sources must use HTTPS or reviewed APT mirror files' 78
    fi
  done
  [[ "$found_https" == true ]] || fail 'no active HTTPS APT source found' 78
}

secure_apt_sources

work_directory=$(mktemp -d "${TMPDIR:-/tmp}/mlp-bootstrap.XXXXXXXXXX")
readonly docker_key_ascii="$work_directory/docker.asc"
readonly docker_keyring="$work_directory/docker.gpg"
readonly gpg_home="$work_directory/gnupg"
install -d -o root -g root -m 0700 "$gpg_home"

download() {
  local destination=$1
  local url=$2
  curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location \
    --output "$destination" "$url"
}

download "$docker_key_ascii" https://download.docker.com/linux/debian/gpg
docker_primary_fingerprint_count=0
downloaded_docker_primary_fingerprint=
while IFS= read -r primary_fingerprint; do
  ((docker_primary_fingerprint_count += 1))
  downloaded_docker_primary_fingerprint=$primary_fingerprint
done < <(
  gpg --batch --homedir "$gpg_home" --show-keys --with-colons --fingerprint \
    "$docker_key_ascii" |
    awk -F: '
      $1 == "pub" { awaiting_primary = 1; next }
      awaiting_primary && $1 == "fpr" {
        print toupper($10)
        awaiting_primary = 0
      }
    '
)
[[ $docker_primary_fingerprint_count -eq 1 && \
  $downloaded_docker_primary_fingerprint == "$docker_primary_fingerprint" ]] || \
  fail 'Docker signing key fingerprint does not match the reviewed primary key' 65
gpg --batch --homedir "$gpg_home" --yes --dearmor \
  --output "$docker_keyring" "$docker_key_ascii"

install -d -o root -g root -m 0755 /etc/apt/keyrings /etc/apt/sources.list.d
install -o root -g root -m 0644 "$docker_keyring" /etc/apt/keyrings/docker.gpg
architecture=$(dpkg --print-architecture)
[[ "$architecture" == amd64 ]] || fail 'mlp-prod requires Debian amd64' 65
readonly docker_source="$work_directory/docker.list"
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian %s stable\n' \
  "$architecture" "$VERSION_CODENAME" >"$docker_source"
[[ ! -L /etc/apt/sources.list.d/docker.list ]] || \
  fail 'Docker APT source must not be a symlink' 78
install -o root -g root -m 0644 \
  "$docker_source" /etc/apt/sources.list.d/docker.list
secure_apt_sources

DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --yes \
  "docker-ce=$DOCKER_CE_VERSION" \
  "docker-ce-cli=$DOCKER_CE_VERSION" \
  "containerd.io=$CONTAINERD_VERSION" \
  "docker-buildx-plugin=$DOCKER_BUILDX_VERSION" \
  "docker-compose-plugin=$DOCKER_COMPOSE_VERSION"
apt-mark hold docker-ce docker-ce-cli containerd.io docker-buildx-plugin \
  docker-compose-plugin

docker_packages=(
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
)
docker_versions=(
  "$DOCKER_CE_VERSION" "$DOCKER_CE_VERSION" "$CONTAINERD_VERSION"
  "$DOCKER_BUILDX_VERSION" "$DOCKER_COMPOSE_VERSION"
)
for package_index in "${!docker_packages[@]}"; do
  installed_package_version=$(dpkg-query -W -f='${Version}' \
    "${docker_packages[$package_index]}")
  [[ "$installed_package_version" == "${docker_versions[$package_index]}" ]] || \
    fail "installed ${docker_packages[$package_index]} version does not match reviewed input" 78
done

readonly node_manifest="$work_directory/SHASUMS256.txt"
readonly node_archive_path="$work_directory/$node_archive"
download "$node_manifest" "$node_base_url/SHASUMS256.txt"
download "$node_archive_path" "$node_base_url/$node_archive"
node_checksum_count=$(awk -v archive="$node_archive" \
  '$2 == archive { count += 1 } END { print count + 0 }' "$node_manifest")
[[ "$node_checksum_count" == 1 ]] || \
  fail "Node metadata must contain exactly one SHA-256 entry for $node_archive" 65
node_checksum_line=$(awk -v archive="$node_archive" \
  '$2 == archive { print }' "$node_manifest")
[[ "$node_checksum_line" == "$node_sha256  $node_archive" ]] || \
  fail 'Node SHA-256 metadata does not match the reviewed runtime pin' 65
(
  cd "$work_directory"
  printf '%s\n' "$node_checksum_line" | sha256sum --check --strict -
)
tar -xJf "$node_archive_path" -C "$work_directory"
readonly node_binary="$work_directory/node-v${node_version}-linux-x64/bin/node"
[[ -x "$node_binary" && $("$node_binary" --version) == "v$node_version" ]] || \
  fail 'verified Node archive does not contain the reviewed runtime' 65
install -o root -g root -m 0755 "$node_binary" /usr/bin/node

install -d -o root -g root -m 0755 /usr/local/libexec/mlp
install -o root -g root -m 0755 \
  /usr/libexec/docker/cli-plugins/docker-compose \
  /usr/local/libexec/mlp/docker-compose

docker_unit=$(systemctl cat docker.service) || \
  fail 'Docker service unit is unavailable' 69
if grep -Eiq 'tcp://|(^|[[:space:]])-H[=[:space:]]*tcp' <<<"$docker_unit"; then
  fail 'Docker systemd unit must not expose a TCP listener' 78
fi
docker_socket_unit=$(systemctl cat docker.socket) || \
  fail 'Docker socket unit is unavailable' 69
docker_unix_listener_count=0
while IFS= read -r docker_socket_listener; do
  docker_socket_directive=${docker_socket_listener%%=*}
  docker_socket_value=${docker_socket_listener#*=}
  docker_socket_value=${docker_socket_value//[[:space:]]/}
  [[ -z "$docker_socket_value" ]] && continue
  [[ "$docker_socket_directive" == ListenStream && \
    "$docker_socket_value" == /run/docker.sock ]] || \
    fail 'Docker socket unit must expose only /run/docker.sock' 78
  ((docker_unix_listener_count += 1))
done < <(
  sed -nE \
    's/^[[:space:]]*(Listen(Stream|Datagram|SequentialPacket))[[:space:]]*=[[:space:]]*(.*)$/\1=\3/p' \
    <<<"$docker_socket_unit"
)
((docker_unix_listener_count > 0)) || \
  fail 'Docker socket unit must expose /run/docker.sock' 78
if [[ -e /etc/docker/daemon.json || -L /etc/docker/daemon.json ]]; then
  [[ -f /etc/docker/daemon.json && ! -L /etc/docker/daemon.json ]] || \
    fail 'Docker daemon.json must be a regular file' 78
  if grep -Eiq 'tcp://|"hosts"[[:space:]]*:' /etc/docker/daemon.json; then
    fail 'Docker daemon.json must not configure a listener override' 78
  fi
fi

if id -nG mlp-admin | tr ' ' '\n' | grep -Fxq docker; then
  fail 'mlp-admin must not belong to the docker group' 78
fi

install -d -o root -g root -m 0755 /opt/mlp
install -d -o root -g root -m 0700 \
  /etc/mlp /etc/mlp/env /etc/mlp/secrets \
  /var/lib/mlp /var/lib/mlp/restore-reports
install -d -o root -g root -m 0700 \
  /etc/mlp/compose-secrets /etc/mlp/docker-client \
  /var/lib/mlp/backup-reports /var/lib/mlp/restore-work \
  /var/lib/mlp/deployment-reports /var/lib/mlp/status
for secret_name in \
  journal-r2-access-key-id \
  journal-r2-secret-access-key \
  journal-mac-keyring; do
  if [[ ! -e "/etc/mlp/secrets/${secret_name}" ]]; then
    install -o root -g root -m 0600 /dev/null "/etc/mlp/secrets/${secret_name}"
  fi
done
unset secret_name

install -o root -g root -m 0755 \
  "$repository_root/ops/compose.sh" /usr/local/sbin/mlp-compose
install -o root -g root -m 0755 \
  "$repository_root/ops/backup.sh" /usr/local/sbin/mlp-backup
install -o root -g root -m 0755 \
  "$repository_root/ops/restore-test.sh" /usr/local/sbin/mlp-restore-test
install -o root -g root -m 0755 \
  "$repository_root/ops/deploy.sh" /usr/local/sbin/mlp-deploy
install -o root -g root -m 0755 \
  "$repository_root/ops/contact-mode.sh" /usr/local/sbin/mlp-contact-mode
install -o root -g root -m 0755 \
  "$repository_root/ops/status.sh" /usr/local/sbin/mlp-status
install -o root -g root -m 0755 \
  "$repository_root/ops/migration.sh" /usr/local/sbin/mlp-migration

install -d -o root -g root -m 0755 /etc/tmpfiles.d
install -o root -g root -m 0644 \
  "$repository_root/infra/tmpfiles.d/mlp.conf" /etc/tmpfiles.d/mlp.conf
systemd-tmpfiles --create /etc/tmpfiles.d/mlp.conf

for unit in \
  mlp-db-backup.service mlp-db-backup.timer \
  mlp-db-restore-test.service mlp-db-restore-test.timer \
  mlp-platform-health.service mlp-platform-health.timer; do
  install -o root -g root -m 0644 \
    "$repository_root/infra/systemd/$unit" "/etc/systemd/system/$unit"
done

readonly resolved_configuration="$work_directory/resolved.conf"
cat >"$resolved_configuration" <<EOF
[Resolve]
DNS=$normalized_resolvers
FallbackDNS=
Domains=~.
EOF
install -d -o root -g root -m 0755 /etc/systemd/resolved.conf.d
install -o root -g root -m 0644 \
  "$resolved_configuration" /etc/systemd/resolved.conf.d/mlp.conf
ln -sfn /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf

readonly automatic_upgrade_configuration="$work_directory/20auto-upgrades"
cat >"$automatic_upgrade_configuration" <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
readonly unattended_origin_configuration="$work_directory/51mlp-unattended-upgrades"
cat >"$unattended_origin_configuration" <<'EOF'
Unattended-Upgrade::Origins-Pattern {
  "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};
EOF
install -d -o root -g root -m 0755 /etc/apt/apt.conf.d
install -o root -g root -m 0644 \
  "$automatic_upgrade_configuration" /etc/apt/apt.conf.d/20auto-upgrades
install -o root -g root -m 0644 \
  "$unattended_origin_configuration" \
  /etc/apt/apt.conf.d/51mlp-unattended-upgrades

systemctl daemon-reload
systemctl enable --now \
  qemu-guest-agent.service docker.service systemd-resolved.service \
  unattended-upgrades.service apt-daily.timer apt-daily-upgrade.timer
systemctl restart systemd-resolved.service

docker version >/dev/null
installed_compose=$(docker compose version --short)
installed_compose=${installed_compose#v}
[[ "$installed_compose" == "$compose_semver" ]] || \
  fail 'installed Docker Compose version does not match reviewed package' 78

for service in qemu-guest-agent docker systemd-resolved; do
  [[ $(systemctl is-active "$service") == active ]] || \
    fail "$service is not active" 69
done
[[ $(systemctl is-enabled unattended-upgrades.service) == enabled ]] || \
  fail 'unattended-upgrades.service is not enabled' 69
for upgrade_timer in apt-daily.timer apt-daily-upgrade.timer; do
  [[ $(systemctl is-enabled "$upgrade_timer") == enabled ]] || \
    fail "APT upgrade timer $upgrade_timer is not enabled" 69
done

unattended_configuration=$(apt-config dump)
grep -Fxq 'APT::Periodic::Update-Package-Lists "1";' \
  <<<"$unattended_configuration" || \
  fail 'unattended-upgrades configuration is incomplete' 78
grep -Fxq 'APT::Periodic::Unattended-Upgrade "1";' \
  <<<"$unattended_configuration" || \
  fail 'unattended-upgrades configuration is incomplete' 78
# apt expands ${distro_codename}; the shell must keep it literal here.
# shellcheck disable=SC2016
grep -Fq 'codename=${distro_codename}-security,label=Debian-Security' \
  <<<"$unattended_configuration" || \
  fail 'unattended-upgrades configuration lacks Debian security origins' 78

[[ -L /etc/resolv.conf && \
  $(readlink /etc/resolv.conf) == /run/systemd/resolve/stub-resolv.conf ]] || \
  fail 'systemd-resolved stub resolver is not active' 78
resolved_dns=$(resolvectl dns)
[[ $(grep -c '^Global:' <<<"$resolved_dns") -eq 1 ]] || \
  fail 'unable to verify approved DNS resolvers' 78
resolved_global_dns=$(sed -n 's/^Global:[[:space:]]*//p' <<<"$resolved_dns")
[[ "$resolved_global_dns" == "$normalized_resolvers" ]] || \
  fail 'systemd-resolved does not use the approved DNS resolvers' 78

docker_socket_metadata=$(stat -Lc '%F %U:%G %a' /run/docker.sock)
[[ "$docker_socket_metadata" == 'socket root:docker 660' ]] || \
  fail 'Docker socket ownership or mode is unsafe' 78
docker_socket_acl=$(getfacl --absolute-names --numeric --omit-header \
  /run/docker.sock)
[[ "$docker_socket_acl" == $'user::rw-\ngroup::rw-\nother::---' ]] || \
  fail 'Docker socket ACL grants unexpected access' 78
if runuser --user mlp-admin -- /usr/bin/docker \
  --host unix:///run/docker.sock ps >/dev/null 2>&1; then
  fail 'mlp-admin must not be able to access Docker' 78
fi

listeners=$(ss -ltnup)
if grep -Eiq 'dockerd' <<<"$listeners"; then
  fail 'Docker TCP listener detected' 78
fi

secure_apt_sources

nftables_temporary=$(mktemp /etc/nftables.conf.new.XXXXXXXXXX)
sed \
  -e "s|@SSH_RULE@|$ssh_rule|" \
  -e "s|@DNS_IPV4_RULE@|$dns_ipv4_rule|" \
  -e "s|@DNS_IPV6_RULE@|$dns_ipv6_rule|" \
  "$script_directory/nftables.conf.template" >"$nftables_temporary"
nft --check --file "$nftables_temporary"
install -o root -g root -m 0600 \
  "$nftables_temporary" "$nftables_candidate"
if [[ -e /etc/nftables.conf ]]; then
  diff -u /etc/nftables.conf "$nftables_candidate" || true
else
  diff -u /dev/null "$nftables_candidate" || true
fi

cat <<'INSTRUCTIONS'
Firewall candidate validated and staged at /etc/nftables.conf.new.
Review the diff above. In the still-open first protected SSH session, snapshot
the current rules and canonical file before applying anything. This operation
must exit successfully:
  sudo bash -ceu '
  umask 077
  rollback_directory=/root/mlp-firewall-rollback
  ruleset_dump=
  rollback_candidate=
  cleanup() {
    [[ -z ${ruleset_dump:-} ]] || rm -f -- "$ruleset_dump"
    [[ -z ${rollback_candidate:-} ]] || rm -f -- "$rollback_candidate"
  }
  trap cleanup EXIT
  install -d -o root -g root -m 0700 "$rollback_directory"
  rm -f -- "$rollback_directory/nftables.conf" \
    "$rollback_directory/nftables.conf.absent" \
    "$rollback_directory/ruleset.nft"
  if [[ -e /etc/nftables.conf ]]; then
    install -o root -g root -m 0600 /etc/nftables.conf \
      "$rollback_directory/nftables.conf"
  else
    install -o root -g root -m 0600 /dev/null \
      "$rollback_directory/nftables.conf.absent"
  fi
  ruleset_dump=$(mktemp "$rollback_directory/ruleset.dump.XXXXXXXXXX")
  rollback_candidate=$(mktemp "$rollback_directory/ruleset.nft.XXXXXXXXXX")
  nft list ruleset >"$ruleset_dump"
  [[ -s "$ruleset_dump" ]]
  printf "%s\n" "flush ruleset" >"$rollback_candidate"
  cat "$ruleset_dump" >>"$rollback_candidate"
  nft --check --file "$rollback_candidate"
  chown root:root "$rollback_candidate"
  chmod 0600 "$rollback_candidate"
  mv -f -- "$rollback_candidate" "$rollback_directory/ruleset.nft"
  rollback_candidate=
  rm -f -- "$ruleset_dump"
  ruleset_dump=
  trap - EXIT
  '
From a second protected SSH session, apply only the transient candidate:
  sudo nft --file /etc/nftables.conf.new
Disconnect and reconnect that second session. Reconnect successfully before persisting.
Only after the reconnect succeeds, run from the second session:
  sudo install -o root -g root -m 0644 /etc/nftables.conf.new /etc/nftables.conf
  sudo systemctl enable --now nftables
If reconnect fails, use the still-open first session to roll back exactly:
  sudo nft --file /root/mlp-firewall-rollback/ruleset.nft
  if sudo test -e /root/mlp-firewall-rollback/nftables.conf.absent; then
    sudo rm -f /etc/nftables.conf
  else
    sudo install -o root -g root -m 0644 /root/mlp-firewall-rollback/nftables.conf /etc/nftables.conf
  fi
INSTRUCTIONS
