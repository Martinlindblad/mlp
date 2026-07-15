# Hardened `mlp-prod` Proxmox VM

These files provision the single Debian 13 VM used by the portfolio. They do
not contact Cloudflare, deploy the application, alter DNS, or delete an
existing VM. Run them only from an authenticated Proxmox administrative shell
and then from the new guest over the existing private management path.

## 1. Proxmox inputs and provisioning

Confirm that the selected storage, private bridge, private address, and SSH key
have been approved. The bridge must not expose the guest directly to the public
Internet.

Set all values explicitly; the script deliberately has no network defaults:

```bash
export VM_ID=901
export PROXMOX_STORAGE=local-lvm
export PROXMOX_BRIDGE=vmbr-private
export SSH_PUBLIC_KEY_FILE=/root/mlp-admin.pub
export VM_IP_CONFIG='ip=10.23.0.21/24,gw=10.23.0.1'
export VM_DNS_SERVERS='1.1.1.1 1.0.0.1'
# DHCP is also accepted when a protected reservation exists:
# export VM_IP_CONFIG='ip=dhcp'

sudo --preserve-env=VM_ID,PROXMOX_STORAGE,PROXMOX_BRIDGE,SSH_PUBLIC_KEY_FILE,VM_IP_CONFIG,VM_DNS_SERVERS \
  infra/proxmox/provision-vm.sh
```

The reviewed source is Debian cloud build `20260712-2537`, file
`debian-13-genericcloud-amd64-20260712-2537.qcow2`, with this exact SHA-512 digest:

```text
7ae53e9dbee282bfc16f289dec483dde3a8598769c38a267948310f7a2a52c662620198603bc52c142627efba379863d16079698a10b34102d55bcedd40e8d32
```

That official cloud build publishes `SHA512SUMS` but no detached
`SHA512SUMS.sign`. The script therefore avoids the mutable `latest` path: it
downloads the versioned build and manifest, requires exactly one matching row
equal to the digest pinned above in reviewed code, and then verifies the image
bytes. A Debian image upgrade requires a reviewed code change that updates the
build identity and digest together; neither value has an operator or environment
override.

The script creates `mlp-prod` with 4 vCPU, 4096 MiB fixed RAM (`balloon: 0`), a
40 GiB discard-enabled VirtIO SCSI disk, QEMU Guest Agent support, startup order
30, and a VirtIO adapter on the provided private bridge. `VM_DNS_SERVERS` is
written into cloud-init so the static guest has reviewed DNS during its first
upgrade and before the repository/bootstrap resolver configuration exists.

A repeat run is non-mutating when the existing VM matches the reviewed
configuration, including block- and directory-backed canonical cloud-init
volumes, the reviewed DNS servers, agent serialization, and the single approved
SSH key in `qm cloudinit dump`. Custom cloud-init, password authentication, raw
QEMU arguments, or extra network interfaces are rejected as drift. A failure
before first boot leaves the VM in place and prints its ID for inspection; the
script never calls `qm destroy`.

## 2. Debian bootstrap

Clone the reviewed repository as a root-owned checkout at `/opt/mlp`, then run
the bootstrap from that checkout. The bootstrap runs
`cloud-init status --wait --long --format json` and validates the JSON with the
explicitly gated `/usr/bin/python3` from the pinned Debian image before it
touches apt or dpkg. A clean `done` result must have exit status 0, no errors,
and no recoverable errors. The pinned image's only accepted degraded result is
exit status 2, `degraded done`, no errors, and exactly this deprecation:

```text
'user' of type string is deprecated in 22.2 and scheduled to be removed in 27.2. Use 'users' list instead.
```

Any other exit status, malformed or incomplete JSON, real error, recoverable
category, or recoverable message fails closed before apt. This repeat gate is
needed because `ciupgrade=1` can still hold apt and dpkg locks after SSH becomes
available. Choose all four exact package versions during the reviewed deployment
change. Do not copy version examples from this runbook.

```bash
export MANAGEMENT_CIDR='10.23.0.0/24'
export DNS_RESOLVERS='1.1.1.1 2606:4700:4700::1111'
export DOCKER_CE_VERSION='<reviewed exact docker-ce version>'
export CONTAINERD_VERSION='<reviewed exact containerd.io version>'
export DOCKER_BUILDX_VERSION='<reviewed exact docker-buildx-plugin version>'
export DOCKER_COMPOSE_VERSION='<reviewed exact 5.3.1 package version>'

sudo --preserve-env=MANAGEMENT_CIDR,DNS_RESOLVERS,DOCKER_CE_VERSION,CONTAINERD_VERSION,DOCKER_BUILDX_VERSION,DOCKER_COMPOSE_VERSION \
  /opt/mlp/infra/proxmox/bootstrap-vm.sh
```

The bootstrap accepts Debian's canonical `/etc/os-release -> ../usr/lib/os-release` symlink, but rejects any other symlink target or
group/world-writable OS metadata. It rewrites the official Debian HTTP source
locations to HTTPS. All active APT sources must use HTTPS. It configures
`systemd-resolved` with exactly `DNS_RESOLVERS` before the nftables candidate is
staged.

The Docker repository key must contain exactly one primary key with the
official reviewed fingerprint
`9DC858229FC7DD38854AE2D88D81803C0EBFCD88`. All five Docker packages are
installed at exact reviewed versions and held. Docker may expose only the
root-owned mode `0660` Unix socket `/run/docker.sock`; the service unit, socket
unit, daemon configuration, runtime listeners, socket ACL, and a real negative
`mlp-admin` access probe are all checked. `mlp-admin` is never added to the
`docker` group.

The host also needs Node.js 22.23.1 because `/usr/local/sbin/mlp-deploy`
executes the production configuration verifier through `/usr/bin/node`. The
bootstrap downloads the versioned official Node archive and manifest, requires
the exact reviewed SHA-256
`9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578`,
and installs only the verified binary. Changing the Node version or digest
requires a reviewed code change; neither has an environment override.

`/etc/mlp`, its environment and secret directories, and `/var/lib/mlp` are
root-only mode `0700`. The tmpfiles contract creates the shared operation lock
and restores all required modes. The reviewed Compose 5.3.1 plugin is copied as
the root-owned standalone binary required by `/usr/local/sbin/mlp-compose`.
Debian security upgrades are explicitly configured and scheduled through both
`apt-daily.timer` and `apt-daily-upgrade.timer`.

Bootstrap deliberately does not populate Compose files, environment files,
secrets, or image references. The first deployment must use the verified
digest-qualified publication outputs: `APP_IMAGE` from `app-image-ref.txt`,
`BACKUP_IMAGE` from `backup-image-ref.txt`, the migration image from
`migration-image-ref.txt`, and `APP_CADDY_IMAGE` from `caddy-image-ref.txt`.
Never copy placeholder digests from `infra/runtime.example` into production.

The backup, restore-test, and five-minute platform-health systemd units are
installed, but their timers remain disabled during bootstrap. After the runtime
files, environment files, and secrets pass validation during the first
application deployment, activate the timers explicitly:

```bash
sudo /usr/local/sbin/mlp-compose config --quiet
sudo systemctl enable --now mlp-db-backup.timer mlp-db-restore-test.timer mlp-platform-health.timer
```

## 3. Activate the firewall with two protected sessions

The bootstrap only renders `/etc/nftables.conf.new`, runs `nft --check --file`
against it, and prints the exact diff. It intentionally does **not** activate
the rules. Read the candidate and confirm that SSH is limited to the approved
`MANAGEMENT_CIDR` and DNS is limited to `DNS_RESOLVERS`.

Keep the original protected SSH session open. In that first session, create a
fresh root-only rollback snapshot as one fail-closed root operation. The command
requires a non-empty current ruleset, prepends `flush ruleset`, validates the
complete restore batch, and publishes it with an atomic rename:

```bash
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
```

Do not apply the candidate unless that command exits successfully.

Open a second protected SSH session through the approved management path and
apply only the transient candidate:

```bash
sudo nft --file /etc/nftables.conf.new
```

Disconnect and reconnect the second session before closing the first. If the
second session cannot reconnect, use the still-open first session to restore
the complete previous ruleset and canonical configuration exactly:

```bash
sudo nft --file /root/mlp-firewall-rollback/ruleset.nft
if sudo test -e /root/mlp-firewall-rollback/nftables.conf.absent; then
  sudo rm -f /etc/nftables.conf
else
  sudo install -o root -g root -m 0644 \
    /root/mlp-firewall-rollback/nftables.conf /etc/nftables.conf
fi
```

Only after the second session reconnects successfully, persist and enable the
validated policy:

```bash
sudo install -o root -g root -m 0644 /etc/nftables.conf.new /etc/nftables.conf
sudo systemctl enable --now nftables
```

Never activate this policy from an unattended remote command.

## 4. Guest validation

On the Proxmox host:

```bash
qm config "$VM_ID"
qm guest cmd "$VM_ID" ping
qm guest cmd "$VM_ID" get-osinfo
```

On the VM:

```bash
cloud-init status --wait --long --format json
test "$(stat -c '%U:%G %a' /etc/mlp)" = 'root:root 700'
docker version
docker compose version --short
systemctl is-active qemu-guest-agent docker nftables
systemctl is-enabled unattended-upgrades.service apt-daily.timer apt-daily-upgrade.timer
resolvectl dns
stat -Lc '%F %U:%G %a' /run/docker.sock
getfacl --absolute-names --numeric --omit-header /run/docker.sock
ss -ltnup
sudo -u mlp-admin docker ps
```

The Docker socket must report `socket root:docker 660`, with only the base
owner/group/other ACL entries. The final command must fail with permission
denied. Only SSH on the protected management address may listen. There must be
no application, PostgreSQL, Caddy, Cloudflare inbound, or Docker API listener.

## 5. Additional VM-level recovery evidence

After validation, take one Proxmox-level VM backup to the existing approved
backup storage and inspect the completed task log:

```bash
: "${PROXMOX_BACKUP_STORAGE:?PROXMOX_BACKUP_STORAGE is required}"
vzdump "$VM_ID" --storage "$PROXMOX_BACKUP_STORAGE" --mode snapshot --compress zstd
```

Record the task ID, completion time, storage, and successful log result in the
migration evidence. This Proxmox-level VM backup is additional recovery
evidence only; it does not replace the off-VM PostgreSQL logical backup or the
isolated PostgreSQL restore gate.
