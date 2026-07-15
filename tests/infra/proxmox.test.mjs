import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const provisionScript = path.join(
  repositoryRoot,
  'infra/proxmox/provision-vm.sh',
);
const bootstrapScript = path.join(
  repositoryRoot,
  'infra/proxmox/bootstrap-vm.sh',
);
const firewallTemplate = path.join(
  repositoryRoot,
  'infra/proxmox/nftables.conf.template',
);
const readmePath = path.join(repositoryRoot, 'infra/proxmox/README.md');
const imageBuild = '20260712-2537';
const imageName = `debian-13-genericcloud-amd64-${imageBuild}.qcow2`;
const imageSha512 =
  '7ae53e9dbee282bfc16f289dec483dde3a8598769c38a267948310f7a2a52c662620198603bc52c142627efba379863d16079698a10b34102d55bcedd40e8d32';
const composeRuntimeVersion = '5.3.1';
const containerdVersion = '1.7.27-1';
const buildxVersion = '0.30.1-1~debian.13~trixie';
const dockerPrimaryFingerprint = '9DC858229FC7DD38854AE2D88D81803C0EBFCD88';
const nodeVersion = '22.23.1';
const nodeArchive = `node-v${nodeVersion}-linux-x64.tar.xz`;
const nodeSha256 =
  '9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578';
const reviewedCloudInitDeprecation =
  "'user' of type string is deprecated in 22.2 and scheduled to be removed in 27.2. Use 'users' list instead.";

function cloudInitStatus(overrides = {}) {
  return JSON.stringify({
    errors: [],
    extended_status: 'done',
    recoverable_errors: {},
    stage: null,
    status: 'done',
    ...overrides,
  });
}

function liveDegradedCloudInitPayload() {
  const reviewedStageDeprecation = () => ({
    DEPRECATED: [reviewedCloudInitDeprecation],
  });
  const completedStage = (recoverableErrors) => ({
    errors: [],
    finished: 1,
    recoverable_errors: recoverableErrors,
    start: 0,
  });

  return {
    boot_status_code: 'enabled-by-generator',
    datasource: 'nocloud',
    detail: 'DataSourceNoCloud',
    errors: [],
    extended_status: 'degraded done',
    init: completedStage(reviewedStageDeprecation()),
    'init-local': completedStage({}),
    last_update: 'Thu, 16 Jul 2026 00:00:00 +0000',
    'modules-config': completedStage(reviewedStageDeprecation()),
    'modules-final': completedStage({}),
    recoverable_errors: {
      DEPRECATED: [reviewedCloudInitDeprecation, reviewedCloudInitDeprecation],
    },
    stage: null,
    status: 'done',
  };
}

async function writeExecutable(file, source) {
  await writeFile(file, source, { mode: 0o755 });
  await chmod(file, 0o755);
}

function run(file, { args = [], cwd = repositoryRoot, env = {} } = {}) {
  return spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
}

async function command(binDirectory, name, body) {
  await writeExecutable(
    path.join(binDirectory, name),
    `#!/bin/sh\nset -eu\n${body}\n`,
  );
}

function traceLines(source) {
  return source.trim().length === 0 ? [] : source.trim().split('\n');
}

function lineIndex(lines, expected) {
  const index = lines.indexOf(expected);
  assert.notEqual(index, -1, `missing trace line: ${expected}`);
  return index;
}

async function makeProvisionHarness(t) {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-proxmox-provision-'),
  );
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const binDirectory = path.join(temporaryDirectory, 'bin');
  const trace = path.join(temporaryDirectory, 'trace');
  const sshKey = path.join(temporaryDirectory, 'id_ed25519.pub');
  await mkdir(binDirectory);
  await writeFile(trace, '');
  await writeFile(
    sshKey,
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnlyKey mlp-admin\n',
    { mode: 0o600 },
  );

  const log = String.raw`printf '%s' "$(basename "$0")" >>"$FAKE_TRACE"
for argument in "$@"; do printf '\t%s' "$argument" >>"$FAKE_TRACE"; done
printf '\n' >>"$FAKE_TRACE"`;

  await command(
    binDirectory,
    'pvesm',
    `${log}
[ "$1" = status ] && [ "$2" = --storage ] && [ "$3" = "$PROXMOX_STORAGE" ]`,
  );
  await command(
    binDirectory,
    'ip',
    `${log}
[ "$1" = link ] && [ "$2" = show ] && [ "$3" = dev ] && [ "$4" = "$PROXMOX_BRIDGE" ]`,
  );
  await command(
    binDirectory,
    'curl',
    `${log}
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
[ -n "$output" ] && [ -n "$url" ]
case "$url" in
  */SHA512SUMS.sign) printf '%s\n' signed-checksums >"$output" ;;
  */SHA512SUMS)
    printf '%s  %s\n' "$FAKE_MANIFEST_SHA512" "$FAKE_IMAGE_NAME" >"$output"
    if [ "$FAKE_DUPLICATE_CHECKSUM" = yes ]; then
      printf '%s  %s\n' "$FAKE_MANIFEST_SHA512" "$FAKE_IMAGE_NAME" >>"$output"
    fi
    ;;
  */"$FAKE_IMAGE_NAME") printf '%s\n' fake-qcow2 >"$output" ;;
  *) exit 64 ;;
esac`,
  );
  await command(
    binDirectory,
    'sha512sum',
    `${log}
payload=$(cat)
printf 'checksum-input\t%s\n' "$payload" >>"$FAKE_TRACE"
[ "$payload" = "$FAKE_IMAGE_SHA512  $FAKE_IMAGE_NAME" ]
[ "$FAKE_PROVISION_FAILURE" != checksum ]
printf '%s: OK\n' "$FAKE_IMAGE_NAME"`,
  );
  await command(
    binDirectory,
    'qm',
    `${log}
case "$1" in
  status)
    case "$FAKE_PROVISION_MODE" in
      create) exit 1 ;;
      exists | directory-storage | drift | missing-ciupgrade | missing-ssh | wrong-dns | cicustom | cipassword | blank-cipassword | extra-net | raw-args) printf '%s\n' 'status: running'; exit 0 ;;
      preflight-error) exit 70 ;;
      *) exit 64 ;;
    esac
    ;;
  list)
    [ "$FAKE_PROVISION_MODE" != preflight-error ] || exit 70
    printf '%s\n' ' VMID NAME STATUS'
    if [ "$FAKE_PROVISION_MODE" != create ]; then
      printf '%s\n' " $VM_ID mlp-prod running"
    fi
    ;;
  config)
    if [ "$FAKE_PROVISION_MODE" = create ]; then
      printf 'unused0: %s:vm-%s-disk-0\n' "$PROXMOX_STORAGE" "$VM_ID"
    elif [ "$FAKE_PROVISION_MODE" = drift ]; then
      printf '%s\n' 'name: mlp-prod' 'memory: 2048'
    else
      cat <<EOF
name: mlp-prod
ostype: l26
machine: q35
cpu: host
cores: 4
sockets: 1
memory: 4096
balloon: 0
agent: 1,fstrim_cloned_disks=1
onboot: 1
startup: order=30,up=60
scsihw: virtio-scsi-single
serial0: socket
vga: serial0
scsi0: $PROXMOX_STORAGE:vm-$VM_ID-disk-0,discard=on,iothread=1,size=40G,ssd=1
boot: order=scsi0
net0: virtio=AA:BB:CC:DD:EE:FF,bridge=$PROXMOX_BRIDGE,firewall=1
ipconfig0: $VM_IP_CONFIG
ciuser: mlp-admin
EOF
      if [ "$FAKE_PROVISION_MODE" = directory-storage ]; then
        printf 'ide2: %s:%s/vm-%s-cloudinit.qcow2,media=cdrom\n' "$PROXMOX_STORAGE" "$VM_ID" "$VM_ID"
      else
        printf 'ide2: %s:vm-%s-cloudinit,media=cdrom\n' "$PROXMOX_STORAGE" "$VM_ID"
      fi
      if [ "$FAKE_PROVISION_MODE" = wrong-dns ]; then
        printf '%s\n' 'nameserver: 9.9.9.9'
      else
        printf 'nameserver: %s\n' "$VM_DNS_SERVERS"
      fi
      case "$FAKE_PROVISION_MODE" in
        cicustom) printf '%s\n' 'cicustom: user=local:snippets/attacker.yml' ;;
        cipassword) printf '%s\n' 'cipassword: **********' ;;
        blank-cipassword) printf '%s\n' 'cipassword:' ;;
        extra-net) printf '%s\n' 'net1: virtio=11:22:33:44:55:66,bridge=vmbr0' ;;
        raw-args) printf '%s\n' 'args: -serial tcp:0.0.0.0:4444,server,nowait' ;;
      esac
      if [ "$FAKE_PROVISION_MODE" != missing-ciupgrade ]; then
        printf '%s\n' 'ciupgrade: 1'
      fi
    fi
    ;;
  cloudinit)
    [ "$2" = dump ] && [ "$3" = "$VM_ID" ] && [ "$4" = user ]
    cat <<EOF
#cloud-config
user: mlp-admin
ssh_authorized_keys:
EOF
    if [ "$FAKE_PROVISION_MODE" = missing-ssh ]; then
      printf '%s\n' '  - ssh-ed25519 AAAAC3NzaWrongKey attacker'
    else
      printf '  - %s\n' "$FAKE_SSH_PUBLIC_KEY"
    fi
    ;;
  importdisk)
    [ "$FAKE_PROVISION_FAILURE" != import ]
    ;;
esac`,
  );

  return {
    env: {
      FAKE_IMAGE_NAME: imageName,
      FAKE_IMAGE_SHA512: imageSha512,
      FAKE_MANIFEST_SHA512: imageSha512,
      FAKE_DUPLICATE_CHECKSUM: 'no',
      FAKE_PROVISION_FAILURE: '',
      FAKE_PROVISION_MODE: 'create',
      FAKE_SSH_PUBLIC_KEY:
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnlyKey mlp-admin',
      FAKE_TRACE: trace,
      PATH: `${binDirectory}:${process.env.PATH}`,
      PROXMOX_BRIDGE: 'vmbr9',
      PROXMOX_STORAGE: 'local-zfs',
      SSH_PUBLIC_KEY_FILE: sshKey,
      VM_ID: '901',
      VM_DNS_SERVERS: '1.1.1.1 1.0.0.1',
      VM_IP_CONFIG: 'ip=10.23.0.21/24,gw=10.23.0.1',
    },
    readTrace: () => readFile(trace, 'utf8'),
  };
}

async function makeBootstrapHarness(t, options = {}) {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'mlp-proxmox-bootstrap-'),
  );
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const binDirectory = path.join(temporaryDirectory, 'bin');
  const trace = path.join(temporaryDirectory, 'trace');
  const guestRoot = path.join(temporaryDirectory, 'guest');
  const guestEtc = path.join(guestRoot, 'etc');
  const guestUsrLib = path.join(guestRoot, 'usr/lib');
  const osRelease = path.join(guestEtc, 'os-release');
  const trustedOsRelease = path.join(guestUsrLib, 'os-release');
  const aptSourceList = path.join(guestEtc, 'apt/sources.list');
  const aptSourcesDirectory = path.join(guestEtc, 'apt/sources.list.d');
  const debianSource = path.join(aptSourcesDirectory, 'debian.sources');
  const dockerDaemon = path.join(guestEtc, 'docker/daemon.json');
  const resolvConf = path.join(guestEtc, 'resolv.conf');
  const nftCapture = path.join(temporaryDirectory, 'nftables.rendered');
  const nftTemporary = path.join(temporaryDirectory, 'nftables.candidate');
  const nodeTemporary = path.join(temporaryDirectory, 'node-runtime');
  const bootstrapUnderTest = path.join(
    path.dirname(bootstrapScript),
    `.bootstrap-vm.test-${path.basename(temporaryDirectory)}.sh`,
  );
  t.after(() => rm(bootstrapUnderTest, { force: true }));
  await mkdir(binDirectory);
  await mkdir(guestUsrLib, { recursive: true });
  await mkdir(aptSourcesDirectory, { recursive: true });
  await mkdir(path.dirname(dockerDaemon), { recursive: true });
  await writeFile(trace, '');
  await writeFile(
    trustedOsRelease,
    `ID=${options.osId ?? 'debian'}\nVERSION_ID=${
      options.osVersion ?? '13'
    }\nVERSION_CODENAME=trixie\n`,
  );
  await symlink(
    options.hostileOsRelease === true
      ? '../../untrusted-os-release'
      : '../usr/lib/os-release',
    osRelease,
  );
  if (options.hostileOsRelease === true) {
    await writeFile(
      path.join(guestRoot, 'untrusted-os-release'),
      'ID=debian\nVERSION_ID=13\nVERSION_CODENAME=trixie\n',
    );
  }
  await writeFile(aptSourceList, '');
  await writeFile(
    debianSource,
    options.insecureAptSource === true
      ? 'Types: deb\nURIs: http://packages.example.invalid/debian\nSuites: trixie\nComponents: main\n'
      : 'Types: deb\nURIs: http://deb.debian.org/debian\nSuites: trixie trixie-updates\nComponents: main\n',
  );
  if (options.additionalAptSource) {
    await writeFile(
      path.join(aptSourcesDirectory, 'unreviewed.list'),
      `${options.additionalAptSource}\n`,
    );
  }
  const productionBootstrap = await readFile(bootstrapScript, 'utf8');
  const fixedOsRelease = '. /etc/os-release';
  assert.equal(
    productionBootstrap.split(fixedOsRelease).length - 1,
    1,
    'production bootstrap must source the fixed OS release path exactly once',
  );
  assert.doesNotMatch(osRelease, /[\s']/u);
  await writeExecutable(
    bootstrapUnderTest,
    productionBootstrap
      .replaceAll('/etc/apt/sources.list.d', '__MLP_APT_SOURCES_DIRECTORY__')
      .replaceAll('/etc/apt/sources.list', aptSourceList)
      .replaceAll('__MLP_APT_SOURCES_DIRECTORY__', aptSourcesDirectory)
      .replaceAll('/etc/docker/daemon.json', dockerDaemon)
      .replaceAll('/etc/resolv.conf', resolvConf)
      .replaceAll('/etc/os-release', osRelease),
  );

  const log = String.raw`printf '%s' "$(basename "$0")" >>"$FAKE_TRACE"
for argument in "$@"; do printf '\t%s' "$argument" >>"$FAKE_TRACE"; done
printf '\n' >>"$FAKE_TRACE"`;
  const logOnly = [
    'apt-get',
    'apt-mark',
    'diff',
    'install',
    'systemd-tmpfiles',
  ];
  await Promise.all(logOnly.map((name) => command(binDirectory, name, log)));
  await command(
    binDirectory,
    'cloud-init',
    `${log}
[ "$1" = status ] && [ "$2" = --wait ]
if [ "$#" -ne 2 ]; then
  [ "$#" -eq 5 ] && [ "$3" = --long ] && [ "$4" = --format ] && [ "$5" = json ]
fi
printf '%s\n' "$FAKE_CLOUD_INIT_STATUS_JSON"
exit "$FAKE_CLOUD_INIT_EXIT"`,
  );
  await command(
    binDirectory,
    'id',
    `${log}
case "$1" in
  -u)
    if [ "$#" -eq 2 ] && [ "$2" = mlp-admin ]; then
      printf '%s\n' "$FAKE_MLP_ADMIN_UID"
    else
      printf '%s\n' "$FAKE_UID"
    fi
    ;;
  -g)
    [ "$#" -eq 2 ] && [ "$2" = mlp-admin ]
    printf '%s\n' "$FAKE_MLP_ADMIN_GID"
    ;;
  -nG)
    if [ "$FAKE_DOCKER_GROUP" = yes ]; then
      printf '%s\n' 'mlp-admin sudo docker'
    else
      printf '%s\n' 'mlp-admin sudo'
    fi
    ;;
  *) exit 64 ;;
esac`,
  );
  await command(
    binDirectory,
    'curl',
    `${log}
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
[ -n "$output" ] && [ -n "$url" ]
filename=$(basename "$url")
if [ "$url" = https://download.docker.com/linux/debian/gpg ]; then
  printf '%s\n' fake-docker-signing-key >"$output"
elif [ "$filename" = SHASUMS256.txt ]; then
  printf '%s  %s\n' "$FAKE_NODE_SHA256" "$FAKE_NODE_ARCHIVE" >"$output"
elif [ "$filename" = "$FAKE_NODE_ARCHIVE" ]; then
  printf '%s\n' fake-node-archive >"$output"
else
  exit 64
fi`,
  );
  await command(
    binDirectory,
    'gpg',
    `${log}
case " $* " in
  *' --show-keys '*)
    printf 'docker-fingerprint\t%s\n' "$FAKE_DOCKER_FINGERPRINT" >>"$FAKE_TRACE"
    printf '%s\n' 'pub:-:4096:1:8D81803C0EBFCD88:0:0::-:::' \
      "fpr:::::::::$FAKE_DOCKER_FINGERPRINT:" \
      'sub:-:4096:1:7EA0A9C3F273FCD8:0:0::::::' \
      'fpr:::::::::D3306A018370199E527AE7997EA0A9C3F273FCD8:'
    ;;
  *' --dearmor '*)
    output=
    source=
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --output) output=$2; shift 2 ;;
        --*) shift ;;
        *) source=$1; shift ;;
      esac
    done
    [ -n "$output" ] && [ -f "$source" ]
    printf '%s\n' fake-dearmored-key >"$output"
    ;;
  *) exit 64 ;;
esac`,
  );
  await command(
    binDirectory,
    'sha256sum',
    `${log}
payload=$(cat)
printf 'node-checksum-input\t%s\n' "$payload" >>"$FAKE_TRACE"
[ "$payload" = "$FAKE_NODE_SHA256  $FAKE_NODE_ARCHIVE" ]
printf '%s: OK\n' "$FAKE_NODE_ARCHIVE"`,
  );
  await command(
    binDirectory,
    'tar',
    `${log}
destination=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -C) destination=$2; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$destination" ]
mkdir -p "$destination/node-v$FAKE_NODE_VERSION-linux-x64/bin"
node_binary="$destination/node-v$FAKE_NODE_VERSION-linux-x64/bin/node"
printf '#!/bin/sh\nprintf "%%s\\n" "v%s"\n' "$FAKE_NODE_VERSION" >"$node_binary"
chmod 0755 "$node_binary"`,
  );
  await command(
    binDirectory,
    'dpkg',
    `${log}
[ "$1" = --print-architecture ]
printf '%s\n' amd64`,
  );
  await command(
    binDirectory,
    'dpkg-query',
    `${log}
package=
for argument in "$@"; do package=$argument; done
case "$package" in
  docker-ce | docker-ce-cli) printf '%s\n' "$DOCKER_CE_VERSION" ;;
  containerd.io) printf '%s\n' "$CONTAINERD_VERSION" ;;
  docker-buildx-plugin) printf '%s\n' "$DOCKER_BUILDX_VERSION" ;;
  docker-compose-plugin) printf '%s\n' "$DOCKER_COMPOSE_VERSION" ;;
  *) exit 64 ;;
esac`,
  );
  await command(
    binDirectory,
    'apt-config',
    `${log}
[ "$1" = dump ]
if [ "$FAKE_UNATTENDED_CONFIG" = yes ]; then
  printf '%s\n' \
    'APT::Periodic::Update-Package-Lists "1";' \
    'APT::Periodic::Unattended-Upgrade "1";' \
    'Unattended-Upgrade::Origins-Pattern:: "origin=Debian,codename=\${distro_codename}-security,label=Debian-Security";'
fi`,
  );
  await command(
    binDirectory,
    'resolvectl',
    `${log}
[ "$1" = dns ]
printf 'Global: %s\n' "$FAKE_RESOLVED_DNS"`,
  );
  await command(
    binDirectory,
    'stat',
    `${log}
target=
for argument in "$@"; do target=$argument; done
if [ "$target" = "$FAKE_OS_RELEASE" ]; then
  printf '%s\n' "$FAKE_OS_RELEASE_METADATA"
elif [ "$target" = "$FAKE_DOCKER_SOCKET" ]; then
  printf '%s\n' "$FAKE_DOCKER_SOCKET_METADATA"
else
  exit 64
fi`,
  );
  await command(
    binDirectory,
    'getfacl',
    `${log}
printf '%s\n' "$FAKE_DOCKER_SOCKET_ACL"`,
  );
  await command(
    binDirectory,
    'runuser',
    `${log}
[ "$FAKE_DOCKER_USER_ACCESS" = yes ]`,
  );
  await command(
    binDirectory,
    'tee',
    `${log}
cat >/dev/null`,
  );
  await command(
    binDirectory,
    'mktemp',
    `${log}
if [ "$1" = -d ]; then
  rm -rf "$FAKE_NODE_TEMPORARY"
  mkdir -p "$FAKE_NODE_TEMPORARY"
  printf '%s\n' "$FAKE_NODE_TEMPORARY"
else
  : >"$FAKE_NFT_TEMPORARY"
  printf '%s\n' "$FAKE_NFT_TEMPORARY"
fi`,
  );
  await command(
    binDirectory,
    'systemctl',
    `${log}
if [ "$1" = cat ] && [ "$2" = docker.service ]; then
  if [ "$FAKE_DOCKER_TCP_UNIT" = yes ]; then
    printf '%s\n' '[Service]' 'ExecStart=/usr/bin/dockerd -H tcp://0.0.0.0:2375'
  else
    printf '%s\n' '[Service]' 'ExecStart=/usr/bin/dockerd -H fd://'
  fi
elif [ "$1" = cat ] && [ "$2" = docker.socket ]; then
  printf '%s\n' '[Socket]' 'ListenStream=/run/docker.sock' 'SocketMode=0660' \
    'SocketUser=root' 'SocketGroup=docker'
  if [ "$FAKE_DOCKER_TCP_SOCKET" = yes ]; then
    printf '%s\n' 'ListenStream=0.0.0.0:4242'
  fi
elif [ "$1" = is-active ]; then
  printf '%s\n' active
elif [ "$1" = is-enabled ]; then
  if [ "$FAKE_UNATTENDED_TIMERS" != yes ] && \
    { [ "$2" = apt-daily.timer ] || [ "$2" = apt-daily-upgrade.timer ]; }; then
    printf '%s\n' disabled
  else
    printf '%s\n' enabled
  fi
fi`,
  );
  await command(
    binDirectory,
    'docker',
    `${log}
if [ "$1" = compose ] && [ "$2" = version ] && [ "$3" = --short ]; then
  printf 'v%s\n' "$FAKE_COMPOSE_RUNTIME_VERSION"
elif [ "$1" = version ]; then
  printf '%s\n' 'Client: Docker Engine' 'Server: Docker Engine'
else
  exit 64
fi`,
  );
  await command(
    binDirectory,
    'ss',
    `${log}
if [ "$FAKE_DOCKER_TCP_LISTENER" = yes ]; then
  printf '%s\n' 'LISTEN 0 4096 0.0.0.0:4242 users:(("dockerd",pid=7,fd=3))'
fi`,
  );
  await command(
    binDirectory,
    'nft',
    `${log}
file=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --file) file=$2; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$file" ]
cp "$file" "$FAKE_NFT_CAPTURE"
[ "$FAKE_NFT_FAILURE" != yes ]`,
  );

  return {
    env: {
      DNS_RESOLVERS: '1.1.1.1 2606:4700:4700::1111',
      CONTAINERD_VERSION: containerdVersion,
      DOCKER_CE_VERSION: '5:28.5.1-1~debian.13~trixie',
      DOCKER_BUILDX_VERSION: buildxVersion,
      DOCKER_COMPOSE_VERSION:
        options.composeVersion ?? `${composeRuntimeVersion}-1~debian.13~trixie`,
      FAKE_COMPOSE_RUNTIME_VERSION: composeRuntimeVersion,
      FAKE_CLOUD_INIT_EXIT: '0',
      FAKE_CLOUD_INIT_STATUS_JSON: cloudInitStatus(),
      FAKE_DOCKER_GROUP: 'no',
      FAKE_DOCKER_FINGERPRINT: dockerPrimaryFingerprint,
      FAKE_DOCKER_SOCKET: '/run/docker.sock',
      FAKE_DOCKER_SOCKET_ACL: 'user::rw-\ngroup::rw-\nother::---',
      FAKE_DOCKER_SOCKET_METADATA: 'socket root:docker 660',
      FAKE_DOCKER_TCP_SOCKET: 'no',
      FAKE_DOCKER_TCP_LISTENER: 'no',
      FAKE_DOCKER_TCP_UNIT: 'no',
      FAKE_DOCKER_USER_ACCESS: 'no',
      FAKE_NFT_CAPTURE: nftCapture,
      FAKE_NFT_FAILURE: 'no',
      FAKE_NFT_TEMPORARY: nftTemporary,
      FAKE_NODE_ARCHIVE: nodeArchive,
      FAKE_NODE_SHA256: nodeSha256,
      FAKE_NODE_TEMPORARY: nodeTemporary,
      FAKE_NODE_VERSION: nodeVersion,
      FAKE_MLP_ADMIN_GID: '1000',
      FAKE_MLP_ADMIN_UID: '1000',
      FAKE_OS_RELEASE: osRelease,
      FAKE_OS_RELEASE_METADATA: 'root:root 644',
      FAKE_RESOLVED_DNS: '1.1.1.1 2606:4700:4700::1111',
      FAKE_TRACE: trace,
      FAKE_UID: '0',
      FAKE_UNATTENDED_CONFIG: 'yes',
      FAKE_UNATTENDED_TIMERS: 'yes',
      MANAGEMENT_CIDR: '10.23.0.0/24',
      PATH: `${binDirectory}:${process.env.PATH}`,
    },
    script: bootstrapUnderTest,
    debianSource,
    nftCapture,
    readTrace: () => readFile(trace, 'utf8'),
  };
}

test('Task 12 artifacts exist and shell entrypoints are executable', async () => {
  for (const file of [
    provisionScript,
    bootstrapScript,
    firewallTemplate,
    readmePath,
  ]) {
    await access(file);
  }
  for (const file of [provisionScript, bootstrapScript]) {
    const metadata = await stat(file);
    assert.notEqual(metadata.mode & 0o111, 0, `${file} must be executable`);
  }
});

test('provisioning refuses missing operator-owned inputs before preflight', async (t) => {
  const harness = await makeProvisionHarness(t);
  const env = { ...harness.env };
  delete env.VM_ID;
  let result = run(provisionScript, { env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VM_ID is required/u);
  assert.equal(await harness.readTrace(), '');

  const missingDns = await makeProvisionHarness(t);
  const missingDnsEnvironment = { ...missingDns.env };
  delete missingDnsEnvironment.VM_DNS_SERVERS;
  result = run(provisionScript, { env: missingDnsEnvironment });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VM_DNS_SERVERS is required/u);
  assert.equal(await missingDns.readTrace(), '');
});

test('provisioning verifies Debian 13 metadata and creates the exact VM', async (t) => {
  const harness = await makeProvisionHarness(t);
  const result = run(provisionScript, { env: harness.env });

  assert.equal(result.status, 0, result.stderr);
  const trace = await harness.readTrace();
  const lines = traceLines(trace);
  assert.equal(lines[0], 'pvesm\tstatus\t--storage\tlocal-zfs');
  assert.equal(lines[1], 'ip\tlink\tshow\tdev\tvmbr9');
  lineIndex(lines, 'qm\tstatus\t901');
  lineIndex(
    lines,
    'curl\t--proto\t=https\t--tlsv1.2\t--fail\t--show-error\t--silent\t--location\t--output\t' +
      lines
        .find((line) => line.includes('/SHA512SUMS'))
        ?.split('\t')
        .at(-2) +
      `\thttps://cloud.debian.org/images/cloud/trixie/${imageBuild}/SHA512SUMS`,
  );
  assert.ok(
    lines.some((line) =>
      line.endsWith(
        `\thttps://cloud.debian.org/images/cloud/trixie/${imageBuild}/${imageName}`,
      ),
    ),
    'missing exact build-qualified Debian image download URL',
  );
  assert.doesNotMatch(trace, /SHA512SUMS\.sign|gpgv/u);
  assert.match(
    trace,
    new RegExp(`checksum-input\\t${imageSha512}  ${imageName}`, 'u'),
  );
  lineIndex(
    lines,
    'qm\tcreate\t901\t--name\tmlp-prod\t--ostype\tl26\t--machine\tq35\t--cpu\thost\t--cores\t4\t--sockets\t1\t--memory\t4096\t--balloon\t0\t--agent\tenabled=1,fstrim_cloned_disks=1\t--onboot\t1\t--startup\torder=30,up=60\t--scsihw\tvirtio-scsi-single\t--serial0\tsocket\t--vga\tserial0',
  );
  assert.match(
    trace,
    new RegExp(
      `qm\\timportdisk\\t901\\t.*${imageName.replaceAll('.', '\\.')}` +
        '\\tlocal-zfs',
      'u',
    ),
  );
  lineIndex(
    lines,
    'qm\tset\t901\t--scsi0\tlocal-zfs:vm-901-disk-0,discard=on,iothread=1,ssd=1',
  );
  lineIndex(lines, 'qm\tresize\t901\tscsi0\t40G');
  lineIndex(
    lines,
    'qm\tset\t901\t--ide2\tlocal-zfs:cloudinit\t--boot\torder=scsi0',
  );
  lineIndex(lines, 'qm\tset\t901\t--net0\tvirtio,bridge=vmbr9,firewall=1');
  lineIndex(
    lines,
    'qm\tset\t901\t--ipconfig0\tip=10.23.0.21/24,gw=10.23.0.1\t--nameserver\t1.1.1.1 1.0.0.1\t--ciuser\tmlp-admin\t--sshkeys\t' +
      harness.env.SSH_PUBLIC_KEY_FILE,
  );
  lineIndex(lines, 'qm\tset\t901\t--ciupgrade\t1');
  lineIndex(lines, 'qm\tstart\t901');
  assert.doesNotMatch(trace, /qm\tdestroy/u);
});

test('provisioning fails closed before VM creation on manifest or checksum failure', async (t) => {
  for (const failure of ['manifest', 'checksum']) {
    await t.test(failure, async (subtest) => {
      const harness = await makeProvisionHarness(subtest);
      const failureEnvironment =
        failure === 'manifest'
          ? { FAKE_MANIFEST_SHA512: 'b'.repeat(128) }
          : { FAKE_PROVISION_FAILURE: failure };
      const result = run(provisionScript, {
        env: { ...harness.env, ...failureEnvironment },
      });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(await harness.readTrace(), /qm\tcreate/u);
    });
  }
});

test('provisioning rejects ambiguous checksum metadata', async (t) => {
  const harness = await makeProvisionHarness(t);
  const result = run(provisionScript, {
    env: { ...harness.env, FAKE_DUPLICATE_CHECKSUM: 'yes' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one SHA-512 entry/u);
  assert.doesNotMatch(await harness.readTrace(), /qm\tcreate/u);
});

test('provisioning is idempotent only when the existing VM matches', async (t) => {
  for (const mode of ['exists', 'directory-storage']) {
    const existing = await makeProvisionHarness(t);
    const result = run(provisionScript, {
      env: { ...existing.env, FAKE_PROVISION_MODE: mode },
    });
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
    const existingTrace = await existing.readTrace();
    assert.doesNotMatch(existingTrace, /(?:curl|qm\tcreate|qm\timportdisk)/u);
    assert.match(existingTrace, /qm\tcloudinit\tdump\t901\tuser/u);
  }

  const drifted = await makeProvisionHarness(t);
  const driftResult = run(provisionScript, {
    env: { ...drifted.env, FAKE_PROVISION_MODE: 'drift' },
  });
  assert.notEqual(driftResult.status, 0);
  assert.match(driftResult.stderr, /existing VM configuration drift/u);
  assert.doesNotMatch(
    await drifted.readTrace(),
    /(?:curl|qm\tset|qm\tresize|qm\tstart)/u,
  );

  const missingCiUpgrade = await makeProvisionHarness(t);
  const missingCiUpgradeResult = run(provisionScript, {
    env: {
      ...missingCiUpgrade.env,
      FAKE_PROVISION_MODE: 'missing-ciupgrade',
    },
  });
  assert.notEqual(missingCiUpgradeResult.status, 0);
  assert.match(
    missingCiUpgradeResult.stderr,
    /existing VM configuration drift/u,
  );
  assert.doesNotMatch(
    await missingCiUpgrade.readTrace(),
    /(?:curl|qm\tset|qm\tresize|qm\tstart)/u,
  );

  const missingSsh = await makeProvisionHarness(t);
  const missingSshResult = run(provisionScript, {
    env: { ...missingSsh.env, FAKE_PROVISION_MODE: 'missing-ssh' },
  });
  assert.notEqual(missingSshResult.status, 0);
  assert.match(missingSshResult.stderr, /existing VM configuration drift/u);
  assert.doesNotMatch(
    await missingSsh.readTrace(),
    /(?:curl|qm\tset|qm\tresize|qm\tstart)/u,
  );

  for (const mode of [
    'wrong-dns',
    'cicustom',
    'cipassword',
    'blank-cipassword',
    'extra-net',
    'raw-args',
  ]) {
    const unsafe = await makeProvisionHarness(t);
    const unsafeResult = run(provisionScript, {
      env: { ...unsafe.env, FAKE_PROVISION_MODE: mode },
    });
    assert.notEqual(unsafeResult.status, 0, mode);
    assert.match(unsafeResult.stderr, /existing VM configuration drift/u, mode);
    assert.doesNotMatch(
      await unsafe.readTrace(),
      /(?:curl|qm\tset|qm\tresize|qm\tstart)/u,
      mode,
    );
  }
});

test('provisioning fails closed when qm cannot prove the VM ID is absent', async (t) => {
  const harness = await makeProvisionHarness(t);
  const result = run(provisionScript, {
    env: { ...harness.env, FAKE_PROVISION_MODE: 'preflight-error' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unable to prove VM 901 is absent/u);
  assert.match(await harness.readTrace(), /qm\tstatus\t901[\s\S]*qm\tlist/u);
  assert.doesNotMatch(await harness.readTrace(), /(?:curl|qm\tcreate)/u);
});

test('provisioning preserves a failed first-boot VM for inspection', async (t) => {
  const harness = await makeProvisionHarness(t);
  const result = run(provisionScript, {
    env: { ...harness.env, FAKE_PROVISION_FAILURE: 'import' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VM 901/u);
  assert.doesNotMatch(await harness.readTrace(), /qm\tdestroy/u);
});

test('bootstrap rejects a non-root caller, non-Debian 13, and old Compose', async (t) => {
  const nonRoot = await makeBootstrapHarness(t);
  let result = run(nonRoot.script, {
    env: { ...nonRoot.env, FAKE_UID: '1000' },
  });
  assert.equal(result.status, 77);
  assert.match(result.stderr, /root/u);

  const wrongOs = await makeBootstrapHarness(t, { osVersion: '12' });
  result = run(wrongOs.script, { env: wrongOs.env });
  assert.equal(result.status, 65);
  assert.match(result.stderr, /Debian 13 required/u);
  assert.doesNotMatch(await wrongOs.readTrace(), /apt-get/u);

  const hostileOsLink = await makeBootstrapHarness(t, {
    hostileOsRelease: true,
  });
  result = run(hostileOsLink.script, { env: hostileOsLink.env });
  assert.equal(result.status, 65);
  assert.match(result.stderr, /Debian 13 required/u);
  assert.doesNotMatch(await hostileOsLink.readTrace(), /apt-get/u);

  const broadManagement = await makeBootstrapHarness(t);
  result = run(broadManagement.script, {
    env: { ...broadManagement.env, MANAGEMENT_CIDR: '0.0.0.0/0' },
  });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /protected management CIDR/u);
  assert.doesNotMatch(await broadManagement.readTrace(), /apt-get/u);

  const broadManagementV6 = await makeBootstrapHarness(t);
  result = run(broadManagementV6.script, {
    env: { ...broadManagementV6.env, MANAGEMENT_CIDR: '::/0' },
  });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /protected management CIDR/u);
  assert.doesNotMatch(await broadManagementV6.readTrace(), /apt-get/u);

  const missingContainerd = await makeBootstrapHarness(t);
  const missingContainerdEnv = { ...missingContainerd.env };
  delete missingContainerdEnv.CONTAINERD_VERSION;
  result = run(missingContainerd.script, { env: missingContainerdEnv });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CONTAINERD_VERSION is required/u);
  assert.doesNotMatch(await missingContainerd.readTrace(), /apt-get/u);

  const oldCompose = await makeBootstrapHarness(t, {
    composeVersion: '2.32.4-1~debian.13~trixie',
  });
  result = run(oldCompose.script, { env: oldCompose.env });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /Docker Compose 2\.33\.1 or newer required/u);
  assert.doesNotMatch(await oldCompose.readTrace(), /apt-get/u);

  const incompatibleCompose = await makeBootstrapHarness(t, {
    composeVersion: '2.40.0-1~debian.13~trixie',
  });
  result = run(incompatibleCompose.script, { env: incompatibleCompose.env });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /repository requires Docker Compose 5\.3\.1/u);
  assert.doesNotMatch(await incompatibleCompose.readTrace(), /apt-get/u);
});

test('bootstrap installs pinned root-owned runtime and stages a checked firewall', async (t) => {
  const harness = await makeBootstrapHarness(t);
  const result = run(harness.script, { env: harness.env });

  assert.equal(result.status, 0, result.stderr);
  const trace = await harness.readTrace();
  const lines = traceLines(trace);
  assert.match(
    trace,
    /apt-get\tinstall\t--yes\tqemu-guest-agent\tca-certificates\tcurl\tgnupg\tunattended-upgrades\tnftables\tgit\tjq\txz-utils\tacl\tsystemd-resolved/u,
  );
  assert.ok(
    lineIndex(lines, 'cloud-init\tstatus\t--wait\t--long\t--format\tjson') <
      lines.findIndex((line) => line === 'apt-get\tupdate'),
    'bootstrap must wait for cloud-init before touching apt or dpkg',
  );
  lineIndex(lines, 'id\t-u\tmlp-admin');
  lineIndex(lines, 'id\t-g\tmlp-admin');
  assert.match(
    trace,
    new RegExp(
      `apt-get\\tinstall\\t--yes\\tdocker-ce=5:28\\.5\\.1-1~debian\\.13~trixie\\tdocker-ce-cli=5:28\\.5\\.1-1~debian\\.13~trixie\\tcontainerd\\.io=${containerdVersion.replaceAll(
        '.',
        '\\.',
      )}\\tdocker-buildx-plugin=${buildxVersion.replaceAll(
        '.',
        '\\.',
      )}\\tdocker-compose-plugin=5\\.3\\.1-1~debian\\.13~trixie`,
      'u',
    ),
  );
  lineIndex(
    lines,
    'apt-mark\thold\tdocker-ce\tdocker-ce-cli\tcontainerd.io\tdocker-buildx-plugin\tdocker-compose-plugin',
  );
  for (const packageName of [
    'docker-ce',
    'docker-ce-cli',
    'containerd.io',
    'docker-buildx-plugin',
    'docker-compose-plugin',
  ]) {
    lineIndex(lines, `dpkg-query\t-W\t-f=\${Version}\t${packageName}`);
  }
  assert.match(trace, new RegExp(dockerPrimaryFingerprint, 'u'));
  assert.match(
    trace,
    /gpg\t--batch\t--homedir\t[^\n]+\t--show-keys\t--with-colons\t--fingerprint\t[^\n]+\/docker\.asc/u,
  );
  assert.match(
    trace,
    new RegExp(
      `curl\\t--proto\\t=https\\t--tlsv1.2\\t--fail\\t--show-error\\t--silent\\t--location\\t--output\\t[^\\n]+\\thttps://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`,
      'u',
    ),
  );
  assert.match(
    trace,
    new RegExp(`node-checksum-input\\t${nodeSha256}  ${nodeArchive}`, 'u'),
  );
  assert.match(
    trace,
    new RegExp(
      `install\\t-o\\troot\\t-g\\troot\\t-m\\t0755\\t[^\\n]*/node-v${nodeVersion}-linux-x64/bin/node\\t/usr/bin/node`,
      'u',
    ),
  );
  lineIndex(
    lines,
    'install\t-d\t-o\troot\t-g\troot\t-m\t0755\t/usr/local/libexec/mlp',
  );
  lineIndex(
    lines,
    'install\t-o\troot\t-g\troot\t-m\t0755\t/usr/libexec/docker/cli-plugins/docker-compose\t/usr/local/libexec/mlp/docker-compose',
  );
  lineIndex(lines, 'install\t-d\t-o\troot\t-g\troot\t-m\t0755\t/opt/mlp');
  lineIndex(
    lines,
    'install\t-d\t-o\troot\t-g\troot\t-m\t0700\t/etc/mlp\t/etc/mlp/env\t/etc/mlp/secrets\t/var/lib/mlp\t/var/lib/mlp/restore-reports',
  );
  for (const [source, destination] of [
    ['ops/compose.sh', '/usr/local/sbin/mlp-compose'],
    ['ops/backup.sh', '/usr/local/sbin/mlp-backup'],
    ['ops/restore-test.sh', '/usr/local/sbin/mlp-restore-test'],
    ['ops/deploy.sh', '/usr/local/sbin/mlp-deploy'],
    ['ops/contact-mode.sh', '/usr/local/sbin/mlp-contact-mode'],
    ['ops/status.sh', '/usr/local/sbin/mlp-status'],
  ]) {
    assert.match(
      trace,
      new RegExp(
        `install\\t-o\\troot\\t-g\\troot\\t-m\\t0755\\t.*${source.replaceAll(
          '/',
          '\\/',
        )}\\t${destination.replaceAll('/', '\\/')}`,
        'u',
      ),
    );
  }
  lineIndex(
    lines,
    'install\t-o\troot\t-g\troot\t-m\t0644\t' +
      path.join(repositoryRoot, 'infra/tmpfiles.d/mlp.conf') +
      '\t/etc/tmpfiles.d/mlp.conf',
  );
  lineIndex(lines, 'systemd-tmpfiles\t--create\t/etc/tmpfiles.d/mlp.conf');
  for (const unit of [
    'mlp-platform-health.service',
    'mlp-platform-health.timer',
  ]) {
    assert.match(
      trace,
      new RegExp(
        `install\\t-o\\troot\\t-g\\troot\\t-m\\t0644\\t.*infra/systemd/${unit.replaceAll(
          '.',
          '\\.',
        )}\\t/etc/systemd/system/${unit.replaceAll('.', '\\.')}`,
        'u',
      ),
    );
  }
  const firstEnable = lines.findIndex((line) =>
    line.startsWith('systemctl\tenable'),
  );
  assert.notEqual(firstEnable, -1);
  assert.ok(
    lineIndex(lines, 'systemctl\tdaemon-reload') < firstEnable,
    'runtime files and unit files must be installed before service enablement',
  );
  assert.match(
    trace,
    /systemctl\tenable\t--now\tqemu-guest-agent\.service\tdocker\.service\tsystemd-resolved\.service\tunattended-upgrades\.service\tapt-daily\.timer\tapt-daily-upgrade\.timer/u,
  );
  assert.doesNotMatch(
    trace,
    /systemctl\tenable[^\n]*mlp-(?:db-(?:backup|restore-test)|platform-health)\.timer/u,
  );
  assert.doesNotMatch(trace, /systemctl\tenable\t--now\tnftables/u);
  lineIndex(lines, 'systemctl\tcat\tdocker.service');
  lineIndex(lines, 'systemctl\tcat\tdocker.socket');
  lineIndex(lines, 'docker\tversion');
  lineIndex(lines, 'docker\tcompose\tversion\t--short');
  lineIndex(lines, 'ss\t-ltnup');
  assert.match(trace, /stat\t-Lc\t%F %U:%G %a\t\/run\/docker\.sock/u);
  assert.match(
    trace,
    /getfacl\t--absolute-names\t--numeric\t--omit-header\t\/run\/docker\.sock/u,
  );
  assert.match(
    trace,
    /runuser\t--user\tmlp-admin\t--\t\/usr\/bin\/docker\t--host\tunix:\/\/\/run\/docker\.sock\tps/u,
  );
  lineIndex(lines, 'resolvectl\tdns');
  assert.equal(
    await readlink(
      path.join(path.dirname(harness.debianSource), '../../resolv.conf'),
    ),
    '/run/systemd/resolve/stub-resolv.conf',
  );
  assert.match(
    trace,
    /install\t-o\troot\t-g\troot\t-m\t0644\t[^\n]+\/resolved\.conf\t\/etc\/systemd\/resolved\.conf\.d\/mlp\.conf/u,
  );
  assert.match(
    trace,
    /install\t-o\troot\t-g\troot\t-m\t0644\t[^\n]+\/20auto-upgrades\t\/etc\/apt\/apt\.conf\.d\/20auto-upgrades/u,
  );
  lineIndex(lines, 'apt-config\tdump');
  lineIndex(lines, 'systemctl\tis-enabled\tapt-daily.timer');
  lineIndex(lines, 'systemctl\tis-enabled\tapt-daily-upgrade.timer');

  const checkIndex = lines.findIndex((line) =>
    line.startsWith('nft\t--check\t--file\t'),
  );
  const candidateInstallIndex = lines.findIndex(
    (line) =>
      line.startsWith('install\t-o\troot\t-g\troot\t-m\t0600\t') &&
      line.endsWith('\t/etc/nftables.conf.new'),
  );
  assert.ok(checkIndex >= 0 && candidateInstallIndex > checkIndex);
  assert.ok(
    lineIndex(lines, 'resolvectl\tdns') < checkIndex,
    'approved upstream resolvers must be configured and verified before nft staging',
  );

  assert.doesNotMatch(
    await readFile(harness.debianSource, 'utf8'),
    /http:\/\//u,
  );

  const rendered = await readFile(harness.nftCapture, 'utf8');
  assert.match(rendered, /policy drop/u);
  assert.match(rendered, /ip saddr 10\.23\.0\.0\/24 tcp dport 22 accept/u);
  assert.match(
    rendered,
    /ip daddr \{ 1\.1\.1\.1 \} meta l4proto \{ tcp, udp \} th dport 53 accept/u,
  );
  assert.match(
    rendered,
    /ip6 daddr \{ 2606:4700:4700::1111 \} meta l4proto \{ tcp, udp \} th dport 53 accept/u,
  );
  assert.match(rendered, /tcp dport 443 accept/u);
  assert.match(rendered, /meta l4proto \{ tcp, udp \} th dport 7844 accept/u);
  assert.match(
    rendered,
    /chain output \{[\s\S]*icmpv6 type \{[\s\S]*nd-router-solicit,[\s\S]*nd-neighbor-solicit,[\s\S]*nd-neighbor-advert[\s\S]*\} accept/u,
  );
  assert.match(rendered, /reject with icmpx type admin-prohibited/u);
  assert.match(
    rendered,
    /chain forward \{[^}]*policy accept;/su,
    'Docker-managed forwarding chains must remain authoritative',
  );
  const inputChain = rendered.match(/chain input \{(?<body>.*?)\n  \}/su)
    ?.groups?.body;
  assert.ok(inputChain);
  assert.doesNotMatch(
    inputChain,
    /dport (?:80|443|3000|5432|8080|2375|2376|7844)\b/u,
  );
  assert.doesNotMatch(rendered, /@[A-Z0-9_]+@/u);
  assert.match(result.stdout, /nft --file \/etc\/nftables\.conf\.new/u);
  assert.match(result.stdout, /second protected SSH session/u);
  assert.match(result.stdout, /nft list ruleset/u);
  assert.match(result.stdout, /printf[^\n]*flush ruleset/u);
  assert.doesNotMatch(result.stdout, /sudo nft flush ruleset/u);
  assert.match(result.stdout, /Reconnect successfully before persisting/u);
});

test('bootstrap refuses Docker TCP exposure and docker-group membership', async (t) => {
  for (const [name, override] of [
    ['unit', { FAKE_DOCKER_TCP_UNIT: 'yes' }],
    ['socket-unit', { FAKE_DOCKER_TCP_SOCKET: 'yes' }],
    ['listener', { FAKE_DOCKER_TCP_LISTENER: 'yes' }],
    ['group', { FAKE_DOCKER_GROUP: 'yes' }],
    ['socket-mode', { FAKE_DOCKER_SOCKET_METADATA: 'socket root:docker 666' }],
    [
      'socket-acl',
      {
        FAKE_DOCKER_SOCKET_ACL:
          'user::rw-\nuser:1000:rw-\ngroup::rw-\nmask::rw-\nother::---',
      },
    ],
    ['user-access', { FAKE_DOCKER_USER_ACCESS: 'yes' }],
  ]) {
    await t.test(name, async (subtest) => {
      const harness = await makeBootstrapHarness(subtest);
      const result = run(harness.script, {
        env: { ...harness.env, ...override },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Docker|docker/u);
      assert.doesNotMatch(
        await harness.readTrace(),
        /systemctl\tenable\t--now\tnftables/u,
      );
    });
  }
});

test('bootstrap fails closed on unreviewed supply chain or network state', async (t) => {
  for (const [name, options, override, expected] of [
    [
      'cloud-init',
      {},
      { FAKE_CLOUD_INIT_EXIT: '1' },
      /cloud-init first boot did not complete/u,
    ],
    [
      'os-release-mode',
      {},
      { FAKE_OS_RELEASE_METADATA: 'root:root 666' },
      /trusted root-owned OS metadata/u,
    ],
    [
      'mlp-admin-id',
      {},
      { FAKE_MLP_ADMIN_UID: '1001' },
      /mlp-admin must have UID and GID 1000/u,
    ],
    [
      'docker-key',
      {},
      { FAKE_DOCKER_FINGERPRINT: 'A'.repeat(40) },
      /Docker signing key fingerprint/u,
    ],
    [
      'apt-http',
      { insecureAptSource: true },
      {},
      /active APT sources must use HTTPS/u,
    ],
    [
      'apt-non-https-scheme',
      { additionalAptSource: 'deb file:/srv/packages trixie main' },
      {},
      /active APT sources must use HTTPS/u,
    ],
    [
      'resolver',
      {},
      { FAKE_RESOLVED_DNS: '9.9.9.9' },
      /approved DNS resolvers/u,
    ],
    [
      'upgrade-config',
      {},
      { FAKE_UNATTENDED_CONFIG: 'no' },
      /unattended-upgrades configuration/u,
    ],
    [
      'upgrade-timers',
      {},
      { FAKE_UNATTENDED_TIMERS: 'no' },
      /APT upgrade timer/u,
    ],
  ]) {
    await t.test(name, async (subtest) => {
      const harness = await makeBootstrapHarness(subtest, options);
      const result = run(harness.script, {
        env: { ...harness.env, ...override },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
      assert.doesNotMatch(
        await harness.readTrace(),
        /systemctl\tenable\t--now\tnftables/u,
      );
    });
  }
});

test('bootstrap accepts the exact reviewed cloud-init deprecation', async (t) => {
  const harness = await makeBootstrapHarness(t);
  const result = run(harness.script, {
    env: {
      ...harness.env,
      FAKE_CLOUD_INIT_EXIT: '2',
      FAKE_CLOUD_INIT_STATUS_JSON: JSON.stringify(
        liveDegradedCloudInitPayload(),
      ),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const lines = traceLines(await harness.readTrace());
  assert.ok(
    lineIndex(lines, 'cloud-init\tstatus\t--wait\t--long\t--format\tjson') <
      lines.findIndex((line) => line === 'apt-get\tupdate'),
    'bootstrap must validate cloud-init JSON before touching apt or dpkg',
  );
});

test('bootstrap explicitly gates the pinned cloud-init JSON parser', async () => {
  const bootstrap = await readFile(bootstrapScript, 'utf8');

  assert.match(
    bootstrap,
    /\[\[ -x \/usr\/bin\/python3 \]\].*cloud-init status JSON parser/su,
  );
  assert.match(bootstrap, /\/usr\/bin\/python3/u);
});

test('bootstrap rejects malformed or unreviewed cloud-init status before apt', async (t) => {
  const exactDeprecation = {
    DEPRECATED: [reviewedCloudInitDeprecation],
  };
  const extraAggregateCopy = liveDegradedCloudInitPayload();
  extraAggregateCopy.recoverable_errors.DEPRECATED.push(
    reviewedCloudInitDeprecation,
  );
  const reviewedCopyInWrongStage = liveDegradedCloudInitPayload();
  reviewedCopyInWrongStage['modules-config'].recoverable_errors = {};
  reviewedCopyInWrongStage['modules-final'].recoverable_errors = {
    DEPRECATED: [reviewedCloudInitDeprecation],
  };
  for (const [name, exitCode, statusJson] of [
    ['malformed-json', '0', '{'],
    ['real-error', '0', cloudInitStatus({ errors: ['modules-final failed'] })],
    [
      'incomplete',
      '0',
      cloudInitStatus({
        extended_status: 'running',
        stage: 'modules-final',
        status: 'running',
      }),
    ],
    [
      'unknown-category',
      '0',
      cloudInitStatus({
        recoverable_errors: { WARNING: ['unreviewed warning'] },
      }),
    ],
    [
      'unknown-message',
      '2',
      cloudInitStatus({
        extended_status: 'degraded done',
        recoverable_errors: { DEPRECATED: ['different deprecation'] },
      }),
    ],
    [
      'nested-unknown-message',
      '2',
      cloudInitStatus({
        extended_status: 'degraded done',
        'modules-config': {
          errors: [],
          recoverable_errors: { WARNING: ['unreviewed warning'] },
        },
        recoverable_errors: exactDeprecation,
      }),
    ],
    [
      'unreported-nested-deprecation',
      '0',
      cloudInitStatus({
        'modules-config': {
          errors: [],
          recoverable_errors: exactDeprecation,
        },
      }),
    ],
    ['extra-reviewed-aggregate-copy', '2', JSON.stringify(extraAggregateCopy)],
    [
      'reviewed-copy-in-wrong-stage',
      '2',
      JSON.stringify(reviewedCopyInWrongStage),
    ],
    ['clean-json-wrong-exit', '2', cloudInitStatus()],
    [
      'degraded-json-wrong-exit',
      '0',
      cloudInitStatus({
        extended_status: 'degraded done',
        recoverable_errors: exactDeprecation,
      }),
    ],
  ]) {
    await t.test(name, async (subtest) => {
      const harness = await makeBootstrapHarness(subtest);
      const result = run(harness.script, {
        env: {
          ...harness.env,
          FAKE_CLOUD_INIT_EXIT: exitCode,
          FAKE_CLOUD_INIT_STATUS_JSON: statusJson,
        },
      });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /cloud-init first boot did not complete/u);
      assert.doesNotMatch(await harness.readTrace(), /apt-get/u);
    });
  }
});

test('bootstrap never installs an unchecked firewall candidate', async (t) => {
  const harness = await makeBootstrapHarness(t);
  const result = run(harness.script, {
    env: { ...harness.env, FAKE_NFT_FAILURE: 'yes' },
  });

  assert.notEqual(result.status, 0);
  const lines = traceLines(await harness.readTrace());
  assert.ok(lines.some((line) => line.startsWith('nft\t--check\t--file\t')));
  assert.ok(
    !lines.some(
      (line) =>
        line.startsWith('install\t-o\troot\t-g\troot\t-m\t0600\t') &&
        line.endsWith('\t/etc/nftables.conf.new'),
    ),
  );
});

test('firewall template and runbook preserve private staged activation', async () => {
  const [template, readme, bootstrap, provision] = await Promise.all([
    readFile(firewallTemplate, 'utf8'),
    readFile(readmePath, 'utf8'),
    readFile(bootstrapScript, 'utf8'),
    readFile(provisionScript, 'utf8'),
  ]);

  assert.match(template, /ct state established,related accept/u);
  assert.match(template, /iifname "lo" accept/u);
  assert.match(template, /icmp type/u);
  assert.match(template, /icmpv6 type/u);
  assert.match(template, /@SSH_RULE@/u);
  assert.match(template, /@DNS_IPV4_RULE@/u);
  assert.match(template, /@DNS_IPV6_RULE@/u);
  assert.match(template, /policy drop/u);
  assert.match(template, /chain forward/u);
  assert.match(template, /policy accept/u);

  for (const value of [
    'VM_ID',
    'PROXMOX_STORAGE',
    'PROXMOX_BRIDGE',
    'SSH_PUBLIC_KEY_FILE',
    'VM_IP_CONFIG',
    'VM_DNS_SERVERS',
    'MANAGEMENT_CIDR',
    'DNS_RESOLVERS',
    'DOCKER_CE_VERSION',
    'CONTAINERD_VERSION',
    'DOCKER_BUILDX_VERSION',
    'DOCKER_COMPOSE_VERSION',
  ]) {
    assert.match(readme, new RegExp(`\\b${value}\\b`, 'u'));
  }
  assert.match(readme, /Debian 13/u);
  assert.match(readme, new RegExp(imageBuild, 'u'));
  assert.match(readme, new RegExp(imageName.replaceAll('.', '\\.'), 'u'));
  assert.match(readme, new RegExp(imageSha512, 'u'));
  assert.match(readme, /reviewed code change/iu);
  assert.match(readme, new RegExp(`Node(?:\.js)? ${nodeVersion}`, 'iu'));
  assert.match(readme, new RegExp(nodeSha256, 'u'));
  assert.match(readme, /mlp-deploy[\s\S]*\/usr\/bin\/node/u);
  assert.match(readme, new RegExp(dockerPrimaryFingerprint, 'u'));
  assert.match(readme, /active APT sources.*HTTPS/iu);
  assert.match(readme, /systemd-resolved/iu);
  assert.match(readme, /cloud-init status --wait --long --format json/u);
  assert.ok(readme.includes(reviewedCloudInitDeprecation));
  assert.match(readme, /exit (?:code|status) 2/iu);
  assert.match(readme, /two identical top-level copies/iu);
  assert.match(readme, /`init` and `modules-config`/u);
  assert.match(readme, /apt-daily-upgrade\.timer/u);
  assert.match(readme, /APP_CADDY_IMAGE/u);
  assert.match(readme, /caddy-image-ref\.txt/u);
  assert.match(readme, /private (?:bridge|management)/iu);
  assert.match(readme, /second protected SSH session/iu);
  const snapshotIndex = readme.indexOf('nft list ruleset');
  const applyCandidateIndex = readme.indexOf(
    'sudo nft --file /etc/nftables.conf.new',
  );
  const reconnectIndex = readme.indexOf(
    'Disconnect and reconnect the second session',
  );
  const installCanonicalIndex = readme.indexOf(
    'sudo install -o root -g root -m 0644 /etc/nftables.conf.new /etc/nftables.conf',
  );
  const enableNftablesIndex = readme.indexOf(
    'sudo systemctl enable --now nftables',
  );
  assert.ok(
    snapshotIndex >= 0 &&
      snapshotIndex < applyCandidateIndex &&
      applyCandidateIndex < reconnectIndex &&
      reconnectIndex < installCanonicalIndex &&
      installCanonicalIndex < enableNftablesIndex,
    'firewall must be snapshotted, tested with a reconnect, and only then persisted',
  );
  assert.match(readme, /printf[^\n]*flush ruleset/u);
  assert.match(readme, /nft --check --file "\$rollback_candidate"/u);
  assert.match(readme, /mv -f -- "\$rollback_candidate"/u);
  assert.doesNotMatch(readme, /nft list ruleset\s*\|\s*(?:sudo\s+)?tee/u);
  assert.doesNotMatch(readme, /sudo nft flush ruleset/u);
  for (const instructions of [readme, bootstrap]) {
    assert.match(instructions, /\[\[ -s "\$ruleset_dump" \]\]/u);
    assert.match(instructions, /printf[^\n]*flush ruleset/u);
    assert.match(instructions, /nft --check --file "\$rollback_candidate"/u);
    assert.match(instructions, /mv -f -- "\$rollback_candidate"/u);
    assert.doesNotMatch(
      instructions,
      /nft list ruleset\s*\|\s*(?:sudo\s+)?tee/u,
    );
    assert.doesNotMatch(instructions, /sudo nft flush ruleset/u);
  }
  assert.match(
    readme,
    /sudo nft --file \/root\/mlp-firewall-rollback\/ruleset\.nft/u,
  );
  assert.match(readme, /nftables\.conf\.absent/u);
  assert.match(
    readme,
    /after\s+the\s+runtime\s+files,\s+environment\s+files,\s+and\s+secrets\s+pass\s+validation/iu,
  );
  assert.match(
    readme,
    /sudo systemctl enable --now mlp-db-backup\.timer mlp-db-restore-test\.timer mlp-platform-health\.timer/u,
  );
  assert.match(readme, /still-open first session/iu);
  assert.match(readme, /qm guest cmd "?\$VM_ID"? ping/u);
  assert.match(readme, /qm guest cmd "?\$VM_ID"? get-osinfo/u);
  assert.match(readme, /sudo -u mlp-admin docker ps/u);
  assert.match(readme, /Proxmox-level VM backup/iu);
  assert.match(readme, /does not replace.*PostgreSQL/isu);

  assert.doesNotMatch(
    bootstrap,
    /^systemctl\s+enable\s+--now\s+nftables(?:\s|$)/mu,
    'unattended bootstrap must only stage the firewall candidate',
  );
  assert.doesNotMatch(
    bootstrap,
    /^systemctl\s+enable[^\n]*mlp-(?:db-(?:backup|restore-test)|platform-health)\.timer/mu,
    'bootstrap must not activate jobs before runtime configuration exists',
  );
  assert.match(bootstrap, /^\. \/etc\/os-release$/mu);
  assert.doesNotMatch(bootstrap, /MLP_OS_RELEASE|OS_RELEASE_FILE/u);
  assert.match(bootstrap, /\.\.\/usr\/lib\/os-release/u);
  assert.match(bootstrap, /\/usr\/local\/libexec\/mlp\/docker-compose/u);
  assert.match(bootstrap, new RegExp(nodeVersion, 'u'));
  assert.match(bootstrap, new RegExp(nodeSha256, 'u'));
  assert.doesNotMatch(bootstrap, /NODE_(?:VERSION|SHA256)/u);
  assert.match(bootstrap, new RegExp(dockerPrimaryFingerprint, 'u'));
  assert.match(bootstrap, /systemctl cat docker\.service/u);
  assert.match(bootstrap, /systemctl cat docker\.socket/u);
  assert.match(bootstrap, /runuser --user mlp-admin/u);
  assert.match(bootstrap, /systemd-tmpfiles --create/u);
  assert.match(bootstrap, /mlp-platform-health\.timer/u);
  assert.match(bootstrap, /apt-daily-upgrade\.timer/u);
  assert.match(bootstrap, /resolvectl dns/u);
  assert.match(bootstrap, /containerd\.io=\$CONTAINERD_VERSION/u);
  assert.match(bootstrap, /docker-buildx-plugin=\$DOCKER_BUILDX_VERSION/u);
  assert.match(provision, new RegExp(imageBuild, 'u'));
  assert.match(provision, new RegExp(imageSha512, 'u'));
  assert.match(provision, /--nameserver "\$normalized_vm_dns_servers"/u);
  assert.match(provision, /\(cicustom\|cipassword\|args\|net/u);
  assert.doesNotMatch(provision, /IMAGE_SHA512|IMAGE_BUILD/u);
});
