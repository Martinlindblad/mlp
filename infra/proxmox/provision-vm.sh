#!/bin/bash
set -Eeuo pipefail
umask 077
export LC_ALL=C

: "${VM_ID:?VM_ID is required}"
: "${PROXMOX_STORAGE:?PROXMOX_STORAGE is required}"
: "${PROXMOX_BRIDGE:?PROXMOX_BRIDGE is required}"
: "${SSH_PUBLIC_KEY_FILE:?SSH_PUBLIC_KEY_FILE is required}"
: "${VM_IP_CONFIG:?VM_IP_CONFIG is required; use ip=dhcp or ip=CIDR,gw=ADDRESS}"
: "${VM_DNS_SERVERS:?VM_DNS_SERVERS is required}"

readonly image_build=20260712-2537
readonly image_base_url="https://cloud.debian.org/images/cloud/trixie/$image_build"
readonly image_name="debian-13-genericcloud-amd64-$image_build.qcow2"
readonly image_sha512=7ae53e9dbee282bfc16f289dec483dde3a8598769c38a267948310f7a2a52c662620198603bc52c142627efba379863d16079698a10b34102d55bcedd40e8d32

work_directory=
first_boot_complete=false

fail() {
  local message=$1
  local status=${2:-1}
  printf '%s\n' "$message" >&2
  exit "$status"
}

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "$work_directory" ]]; then
    rm -rf -- "$work_directory" || status=1
  fi
  if ((status != 0)) && [[ "$first_boot_complete" == false ]]; then
    printf 'Provisioning stopped before first boot; inspect VM %s and retry after correcting the failure.\n' \
      "$VM_ID" >&2
  fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ "$VM_ID" =~ ^[1-9][0-9]{2,8}$ ]] || fail 'VM_ID must be a numeric Proxmox VM ID' 64
[[ "$PROXMOX_STORAGE" =~ ^[A-Za-z0-9_.-]+$ ]] || fail 'invalid PROXMOX_STORAGE' 64
[[ "$PROXMOX_BRIDGE" =~ ^[A-Za-z0-9_.-]+$ ]] || fail 'invalid PROXMOX_BRIDGE' 64
[[ -f "$SSH_PUBLIC_KEY_FILE" && ! -L "$SSH_PUBLIC_KEY_FILE" && \
  -r "$SSH_PUBLIC_KEY_FILE" && -s "$SSH_PUBLIC_KEY_FILE" ]] || \
  fail 'SSH_PUBLIC_KEY_FILE must be a readable non-empty regular file' 66
[[ $(wc -l <"$SSH_PUBLIC_KEY_FILE") -eq 1 ]] || \
  fail 'SSH_PUBLIC_KEY_FILE must contain exactly one public key' 64
grep -Eq '^(ssh-ed25519|sk-ssh-ed25519@openssh.com|ecdsa-sha2-nistp(256|384|521)|sk-ecdsa-sha2-nistp256@openssh.com) [A-Za-z0-9+/]+={0,3}( [^[:cntrl:]]*)?$' \
  "$SSH_PUBLIC_KEY_FILE" || fail 'SSH_PUBLIC_KEY_FILE is not an approved public key' 64
ssh_public_key=$(<"$SSH_PUBLIC_KEY_FILE")
readonly ssh_public_key

case "$VM_IP_CONFIG" in
  ip=dhcp) ;;
  ip=*,gw=*)
    [[ "$VM_IP_CONFIG" =~ ^ip=[0-9A-Fa-f:.]+/[0-9]{1,3},gw=[0-9A-Fa-f:.]+$ ]] || \
      fail 'invalid VM_IP_CONFIG' 64
    ;;
  *) fail 'invalid VM_IP_CONFIG' 64 ;;
esac

vm_dns_values=()
read -r -a vm_dns_values <<<"${VM_DNS_SERVERS//,/ }"
(( ${#vm_dns_values[@]} > 0 && ${#vm_dns_values[@]} <= 3 )) || \
  fail 'VM_DNS_SERVERS must contain one to three resolver addresses' 64
for vm_dns_address in "${vm_dns_values[@]}"; do
  if [[ "$vm_dns_address" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] && \
    ((BASH_REMATCH[1] <= 255 && BASH_REMATCH[2] <= 255 && \
      BASH_REMATCH[3] <= 255 && BASH_REMATCH[4] <= 255)); then
    continue
  fi
  [[ "$vm_dns_address" =~ ^[0-9A-Fa-f:]+$ && "$vm_dns_address" == *:* ]] || \
    fail 'VM_DNS_SERVERS contains an invalid resolver address' 64
done
normalized_vm_dns_servers="${vm_dns_values[*]}"
readonly normalized_vm_dns_servers

pvesm status --storage "$PROXMOX_STORAGE" >/dev/null
ip link show dev "$PROXMOX_BRIDGE" >/dev/null

config_value() {
  local config=$1
  local key=$2
  sed -n "s/^${key}: //p" <<<"$config"
}

contains_option() {
  local value=$1
  local option=$2
  [[ ",$value," == *",$option,"* ]]
}

existing_vm_matches() {
  local config=$1
  local cloudinit_user=$2
  local agent authorized_key='' authorized_key_count=0 authorized_key_value
  local cloudinit cloudinit_volume net scsi

  [[ $(config_value "$config" name) == mlp-prod ]] || return 1
  [[ $(config_value "$config" ostype) == l26 ]] || return 1
  [[ $(config_value "$config" machine) == q35 ]] || return 1
  [[ $(config_value "$config" cpu) == host ]] || return 1
  [[ $(config_value "$config" cores) == 4 ]] || return 1
  [[ $(config_value "$config" sockets) == 1 ]] || return 1
  [[ $(config_value "$config" memory) == 4096 ]] || return 1
  [[ $(config_value "$config" balloon) == 0 ]] || return 1
  [[ $(config_value "$config" onboot) == 1 ]] || return 1
  [[ $(config_value "$config" startup) == order=30,up=60 ]] || return 1
  [[ $(config_value "$config" scsihw) == virtio-scsi-single ]] || return 1
  [[ $(config_value "$config" serial0) == socket ]] || return 1
  [[ $(config_value "$config" vga) == serial0 ]] || return 1
  [[ $(config_value "$config" boot) == order=scsi0 ]] || return 1
  [[ $(config_value "$config" ipconfig0) == "$VM_IP_CONFIG" ]] || return 1
  [[ $(config_value "$config" nameserver) == "$normalized_vm_dns_servers" ]] || \
    return 1
  [[ $(config_value "$config" ciuser) == mlp-admin ]] || return 1
  [[ $(config_value "$config" ciupgrade) == 1 ]] || return 1
  if grep -Eq '^(cicustom|cipassword|args|net[1-9][0-9]*):' <<<"$config"; then
    return 1
  fi

  agent=$(config_value "$config" agent)
  if ! contains_option "$agent" 1 && ! contains_option "$agent" enabled=1; then
    return 1
  fi
  contains_option "$agent" fstrim_cloned_disks=1 || return 1

  cloudinit=$(config_value "$config" ide2)
  cloudinit_volume=${cloudinit%%,*}
  [[ "$cloudinit_volume" == "${PROXMOX_STORAGE}:vm-${VM_ID}-cloudinit" || \
    "$cloudinit_volume" == "${PROXMOX_STORAGE}:${VM_ID}/vm-${VM_ID}-cloudinit.qcow2" ]] || \
    return 1
  contains_option "$cloudinit" media=cdrom || return 1

  scsi=$(config_value "$config" scsi0)
  [[ "$scsi" == "$PROXMOX_STORAGE:"* ]] || return 1
  contains_option "$scsi" discard=on || return 1
  contains_option "$scsi" iothread=1 || return 1
  contains_option "$scsi" ssd=1 || return 1
  contains_option "$scsi" size=40G || return 1

  net=$(config_value "$config" net0)
  [[ "$net" == virtio=* ]] || return 1
  contains_option "$net" "bridge=$PROXMOX_BRIDGE" || return 1
  contains_option "$net" firewall=1 || return 1

  while IFS= read -r authorized_key_value; do
    ((authorized_key_count += 1))
    authorized_key=$authorized_key_value
  done < <(
    awk '
      /^ssh_authorized_keys:[[:space:]]*$/ { in_keys = 1; next }
      in_keys && /^[^[:space:]#][^:]*:/ { in_keys = 0 }
      in_keys && /^[[:space:]]*-[[:space:]]+/ {
        sub(/^[[:space:]]*-[[:space:]]+/, "")
        print
      }
    ' <<<"$cloudinit_user"
  )
  [[ $authorized_key_count -eq 1 && \
    $authorized_key == "$ssh_public_key" ]] || return 1
}

if vm_status=$(qm status "$VM_ID" 2>/dev/null); then
  existing_config=$(qm config "$VM_ID")
  existing_cloudinit_user=$(qm cloudinit dump "$VM_ID" user) || \
    fail "unable to inspect cloud-init SSH keys for VM $VM_ID; refusing mutation" 69
  existing_vm_matches "$existing_config" "$existing_cloudinit_user" || \
    fail "existing VM configuration drift for VM $VM_ID; refusing mutation" 78
  if [[ "$vm_status" != 'status: running' ]]; then
    qm start "$VM_ID"
  fi
  first_boot_complete=true
  printf 'VM %s already matches the reviewed mlp-prod contract.\n' "$VM_ID"
  exit 0
fi
if ! vm_list=$(qm list); then
  fail "unable to prove VM $VM_ID is absent; refusing creation" 69
fi
if awk -v vm_id="$VM_ID" 'NR > 1 && $1 == vm_id { found = 1 } END { exit !found }' \
  <<<"$vm_list"; then
  fail "unable to inspect existing VM $VM_ID after qm status failed; refusing mutation" 69
fi

work_directory=$(mktemp -d "${TMPDIR:-/tmp}/mlp-debian-cloud.XXXXXXXXXX")
readonly image_path="$work_directory/$image_name"
readonly checksum_path="$work_directory/SHA512SUMS"

download() {
  local destination=$1
  local url=$2
  curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location \
    --output "$destination" "$url"
}

download "$checksum_path" "$image_base_url/SHA512SUMS"
download "$image_path" "$image_base_url/$image_name"

checksum_count=$(awk -v image="$image_name" '$2 == image { count += 1 } END { print count + 0 }' "$checksum_path")
[[ "$checksum_count" == 1 ]] || \
  fail "Debian metadata must contain exactly one SHA-512 entry for $image_name" 65
checksum_line=$(awk -v image="$image_name" '$2 == image { print }' "$checksum_path")
[[ $checksum_line =~ ^[0-9A-Fa-f]{128}[[:space:]][[:space:]]${image_name//./\.}$ ]] || \
  fail 'invalid Debian SHA-512 metadata entry' 65
[[ "$checksum_line" == "$image_sha512  $image_name" ]] || \
  fail 'Debian SHA-512 metadata does not match the reviewed image pin' 65
(
  cd "$work_directory"
  printf '%s\n' "$checksum_line" | sha512sum --check --strict -
)

qm create "$VM_ID" --name mlp-prod --ostype l26 --machine q35 \
  --cpu host --cores 4 --sockets 1 --memory 4096 --balloon 0 \
  --agent enabled=1,fstrim_cloned_disks=1 --onboot 1 --startup order=30,up=60 \
  --scsihw virtio-scsi-single --serial0 socket --vga serial0
qm importdisk "$VM_ID" "$image_path" "$PROXMOX_STORAGE"
unused_volume=$(
  qm config "$VM_ID" |
    sed -n 's/^unused[0-9][0-9]*: //p' |
    tail -n 1
)
[[ -n "$unused_volume" ]] || fail 'imported disk not found' 65
qm set "$VM_ID" --scsi0 "$unused_volume,discard=on,iothread=1,ssd=1"
qm resize "$VM_ID" scsi0 40G
qm set "$VM_ID" --ide2 "$PROXMOX_STORAGE:cloudinit" --boot order=scsi0
qm set "$VM_ID" --net0 "virtio,bridge=$PROXMOX_BRIDGE,firewall=1"
qm set "$VM_ID" --ipconfig0 "$VM_IP_CONFIG" \
  --nameserver "$normalized_vm_dns_servers" --ciuser mlp-admin \
  --sshkeys "$SSH_PUBLIC_KEY_FILE"
qm set "$VM_ID" --ciupgrade 1
qm start "$VM_ID"
first_boot_complete=true
printf 'VM %s started from a verified Debian 13 genericcloud image.\n' "$VM_ID"
