#!/bin/sh
set -eu

umask 077

[ "$#" -eq 0 ] || {
  printf '%s\n' 'usage: verify-images.sh' >&2
  exit 64
}

case ${COMMIT_SHA-} in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    printf '%s\n' \
      'COMMIT_SHA must be exactly 40 lowercase hexadecimal characters' >&2
    exit 64
    ;;
esac

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY PGPASSWORD MONGO_URI MONGODB_URI DATABASE_URL || :

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ "${DOCKER_HOST+x}" = x ]; then
  fail 'Docker endpoint override is not allowed: DOCKER_HOST'
fi
if [ "${DOCKER_CONTEXT+x}" = x ]; then
  fail 'Docker endpoint override is not allowed: DOCKER_CONTEXT'
fi
if [ "${DOCKER_TLS+x}" = x ]; then
  fail 'Docker endpoint override is not allowed: DOCKER_TLS'
fi
if [ "${DOCKER_TLS_VERIFY+x}" = x ]; then
  fail 'Docker endpoint override is not allowed: DOCKER_TLS_VERIFY'
fi
if [ "${DOCKER_CERT_PATH+x}" = x ]; then
  fail 'Docker endpoint override is not allowed: DOCKER_CERT_PATH'
fi
if [ "${BUILDX_BUILDER+x}" = x ]; then
  fail 'Docker builder override is not allowed: BUILDX_BUILDER'
fi
if [ "${BUILDKIT_HOST+x}" = x ]; then
  fail 'Docker builder endpoint override is not allowed: BUILDKIT_HOST'
fi

DOCKER_CLI=$(command -v docker 2>/dev/null) || fail 'Docker daemon is required'
docker() {
  "$DOCKER_CLI" --host unix:///var/run/docker.sock "$@"
}

if ! docker info >/dev/null 2>&1; then
  fail 'Docker daemon is required'
fi

for required_command in awk cat chmod cmp curl find flock grep jq mktemp mkdir openssl python3 rm sed sha256sum sleep sort ssh-keygen tar tr wc; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    fail "required host command is unavailable: $required_command"
  fi
done

SCRIPT_DIRECTORY=$(CDPATH='' cd -- "${0%/*}" && pwd)
REPOSITORY_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIRECTORY/../.." && pwd)
WORK_DIRECTORY=$(mktemp -d "${TMPDIR:-/tmp}/mlp-image-gates.XXXXXX")

early_cleanup() {
  status=$?
  trap ':' HUP INT TERM
  trap - 0
  if [ -e "$WORK_DIRECTORY" ] && ! chmod -R u+rwX "$WORK_DIRECTORY"; then
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  if ! rm -rf "$WORK_DIRECTORY" || [ -e "$WORK_DIRECTORY" ]; then
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  exit "$status"
}

trap early_cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

POSTGRES_IMAGE='postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'
RUN_RANDOM_SUFFIX=${WORK_DIRECTORY##*.}
case $RUN_RANDOM_SUFFIX in
  '' | *[!A-Za-z0-9]*) fail 'image gate random suffix is invalid' ;;
esac
RUN_ID="mlp-image-gate-$COMMIT_SHA-$RUN_RANDOM_SUFFIX"
NETWORK_NAME="$RUN_ID-network"
SOURCE_DATABASE_VOLUME="$RUN_ID-source-database"
TARGET_DATABASE_VOLUME="$RUN_ID-target-database"
RESTIC_VOLUME="$RUN_ID-restic"
RESTORE_VOLUME="$RUN_ID-restore"
SOURCE_DATABASE_CONTAINER="$RUN_ID-source-postgres"
TARGET_DATABASE_CONTAINER="$RUN_ID-target-postgres"
APP_CONTAINER="$RUN_ID-app"
CADDY_CONTAINER="$RUN_ID-caddy"
CADDY_CAPABILITY_CONTAINER="$RUN_ID-caddy-capability"
STAGING_IMAGE_SUFFIX="staging-$COMMIT_SHA-$RUN_RANDOM_SUFFIX"
APP_CANONICAL_IMAGE="mlp-image-gate-app:$COMMIT_SHA"
BACKUP_CANONICAL_IMAGE="mlp-image-gate-backup:$COMMIT_SHA"
CADDY_CANONICAL_IMAGE="mlp-image-gate-caddy:$COMMIT_SHA"
MIGRATION_CANONICAL_IMAGE="mlp-image-gate-migration:$COMMIT_SHA"
APP_IMAGE="mlp-image-gate-app:$STAGING_IMAGE_SUFFIX"
BACKUP_IMAGE="mlp-image-gate-backup:$STAGING_IMAGE_SUFFIX"
CADDY_IMAGE="mlp-image-gate-caddy:$STAGING_IMAGE_SUFFIX"
MIGRATION_IMAGE="mlp-image-gate-migration:$STAGING_IMAGE_SUFFIX"
POSTGRES_PASSWORD_FILE="$WORK_DIRECTORY/postgres-password"
MIGRATOR_PASSWORD_FILE="$WORK_DIRECTORY/postgres-migrator-password"
APP_PASSWORD_FILE="$WORK_DIRECTORY/postgres-app-password"
BACKUP_PASSWORD_FILE="$WORK_DIRECTORY/postgres-backup-password"
RESTIC_PASSWORD_FILE="$WORK_DIRECTORY/restic-password"
RESTIC_S3_ACCESS_KEY_ID_FILE="$WORK_DIRECTORY/restic-s3-access-key-id"
RESTIC_S3_SECRET_ACCESS_KEY_FILE="$WORK_DIRECTORY/restic-s3-secret-access-key"
PROMOTION_LOCK_FILE="/tmp/mlp-image-gate-promotion-$COMMIT_SHA.lock"
PROMOTION_LOCK_HELD=0
MLP_IMAGE_GATE_SECRET_SENTINEL="mlp-image-gate-secret-$COMMIT_SHA-$RUN_RANDOM_SUFFIX"
export MLP_IMAGE_GATE_SECRET_SENTINEL
printf '%s\n' "$MLP_IMAGE_GATE_SECRET_SENTINEL-postgres" >"$POSTGRES_PASSWORD_FILE"
printf '%s\n' "$MLP_IMAGE_GATE_SECRET_SENTINEL-migrator" >"$MIGRATOR_PASSWORD_FILE"
printf '%s\n' "$MLP_IMAGE_GATE_SECRET_SENTINEL-app" >"$APP_PASSWORD_FILE"
printf '%s\n' "$MLP_IMAGE_GATE_SECRET_SENTINEL-backup" >"$BACKUP_PASSWORD_FILE"
printf '%s\n' "$MLP_IMAGE_GATE_SECRET_SENTINEL-restic" >"$RESTIC_PASSWORD_FILE"
printf '%s\n' "$MLP_IMAGE_GATE_SECRET_SENTINEL-access" >"$RESTIC_S3_ACCESS_KEY_ID_FILE"
printf '%s\n' "$MLP_IMAGE_GATE_SECRET_SENTINEL-access-secret" >"$RESTIC_S3_SECRET_ACCESS_KEY_FILE"
chmod 0444 \
  "$POSTGRES_PASSWORD_FILE" \
  "$MIGRATOR_PASSWORD_FILE" \
  "$APP_PASSWORD_FILE" \
  "$BACKUP_PASSWORD_FILE" \
  "$RESTIC_PASSWORD_FILE" \
  "$RESTIC_S3_ACCESS_KEY_ID_FILE" \
  "$RESTIC_S3_SECRET_ACCESS_KEY_FILE"
SUCCESS=0
TRACKED_CONTAINERS=
TRACKED_IMAGES=
TRACKED_NETWORKS=
TRACKED_VOLUMES=

labeled_resource_state() {
  resource_kind=$1
  resource_name=$2

  case $resource_kind in
    container)
      label_format='{{index .Config.Labels "mlp.image-gate.run"}}'
      ;;
    network | volume)
      label_format='{{index .Labels "mlp.image-gate.run"}}'
      ;;
    *)
      printf '%s\n' unknown
      return 0
      ;;
  esac

  if resource_label=$(docker "$resource_kind" inspect \
    --format "$label_format" "$resource_name" 2>/dev/null); then
    if [ "$resource_label" = "$RUN_ID" ]; then
      printf '%s\n' owned
    else
      printf '%s\n' foreign
    fi
    return 0
  fi

  if [ "$resource_kind" = container ]; then
    resource_ids=$(docker container ls --all --quiet \
      --filter "name=^/$resource_name\$" 2>/dev/null) || {
      printf '%s\n' unknown
      return 0
    }
  else
    resource_ids=$(docker "$resource_kind" ls --quiet \
      --filter "name=^$resource_name\$" 2>/dev/null) || {
      printf '%s\n' unknown
      return 0
    }
  fi

  if [ -z "$resource_ids" ]; then
    printf '%s\n' absent
  else
    printf '%s\n' unknown
  fi
}

remove_labeled_resource() {
  resource_kind=$1
  resource_name=$2

  case $resource_kind in
    container) docker container rm --force --volumes "$resource_name" >/dev/null 2>&1 ;;
    network) docker network rm "$resource_name" >/dev/null 2>&1 ;;
    volume) docker volume rm --force "$resource_name" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

cleanup_labeled_resource() {
  resource_kind=$1
  resource_name=$2
  cleanup_attempt=1

  while [ "$cleanup_attempt" -le 3 ]; do
    resource_state=$(labeled_resource_state "$resource_kind" "$resource_name")
    case $resource_state in
      absent) return 0 ;;
      foreign | unknown) return 1 ;;
      owned)
        if remove_labeled_resource "$resource_kind" "$resource_name"; then
          :
        fi
        ;;
      *) return 1 ;;
    esac
    cleanup_attempt=$((cleanup_attempt + 1))
    if [ "$cleanup_attempt" -le 3 ]; then
      sleep 1
    fi
  done

  [ "$(labeled_resource_state "$resource_kind" "$resource_name")" = absent ]
}

image_reference_state() {
  image_reference=$1
  expected_image_id=$2

  if actual_image_id=$(docker image inspect --format '{{.Id}}' \
    "$image_reference" 2>/dev/null); then
    if [ "$expected_image_id" = PENDING ]; then
      image_revision=$(docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$image_reference" 2>/dev/null) || {
        printf '%s\n' unknown
        return 0
      }
      case $image_reference in
        *:"$STAGING_IMAGE_SUFFIX")
          if [ "$image_revision" = "$COMMIT_SHA" ]; then
            printf '%s\n' owned
          else
            printf '%s\n' foreign
          fi
          ;;
        *) printf '%s\n' foreign ;;
      esac
    elif [ "$actual_image_id" = "$expected_image_id" ]; then
      printf '%s\n' owned
    else
      printf '%s\n' foreign
    fi
    return 0
  fi

  if image_ids=$(docker image ls --all --quiet --no-trunc \
    "$image_reference" 2>/dev/null); then
    if [ -z "$image_ids" ]; then
      printf '%s\n' absent
    else
      printf '%s\n' unknown
    fi
  else
    printf '%s\n' unknown
  fi
}

cleanup_image_reference() {
  image_reference=$1
  expected_image_id=$2
  cleanup_attempt=1

  while [ "$cleanup_attempt" -le 3 ]; do
    image_state=$(image_reference_state "$image_reference" "$expected_image_id")
    case $image_state in
      absent) return 0 ;;
      foreign | unknown) return 1 ;;
      owned)
        if docker image rm --force "$image_reference" >/dev/null 2>&1; then
          :
        fi
        ;;
      *) return 1 ;;
    esac
    cleanup_attempt=$((cleanup_attempt + 1))
    if [ "$cleanup_attempt" -le 3 ]; then
      sleep 1
    fi
  done

  [ "$(image_reference_state "$image_reference" "$expected_image_id")" = absent ]
}

cleanup_failure_images() {
  failure_cleanup_failed=0
  failure_cleanup_ifs=$IFS
  IFS='
'
  for image_record in $TRACKED_IMAGES; do
    [ -n "$image_record" ] || continue
    IFS='|'
    # shellcheck disable=SC2086
    set -- $image_record
    IFS='
'
    if [ "$3" = failure ]; then
      cleanup_image_reference "$1" "$2" || failure_cleanup_failed=1
    fi
  done
  IFS=$failure_cleanup_ifs
  [ "$failure_cleanup_failed" -eq 0 ]
}

cleanup() {
  status=$?
  cleanup_failed=0
  trap ':' HUP INT TERM
  trap - 0
  set -f
  cleanup_ifs=$IFS
  IFS='
'

  for container_name in $TRACKED_CONTAINERS; do
    [ -z "$container_name" ] ||
      cleanup_labeled_resource container "$container_name" || cleanup_failed=1
  done
  for network_name in $TRACKED_NETWORKS; do
    [ -z "$network_name" ] ||
      cleanup_labeled_resource network "$network_name" || cleanup_failed=1
  done
  for volume_name in $TRACKED_VOLUMES; do
    [ -z "$volume_name" ] ||
      cleanup_labeled_resource volume "$volume_name" || cleanup_failed=1
  done
  for image_record in $TRACKED_IMAGES; do
    [ -n "$image_record" ] || continue
    IFS='|'
    # shellcheck disable=SC2086
    set -- $image_record
    IFS='
'
    image_reference=$1
    expected_image_id=$2
    image_retention=$3
    if [ "$image_retention" = always ]; then
      cleanup_image_reference "$image_reference" "$expected_image_id" || cleanup_failed=1
    fi
  done
  IFS=$cleanup_ifs

  if [ -e "$WORK_DIRECTORY" ] && ! chmod -R u+rwX "$WORK_DIRECTORY"; then
    cleanup_failed=1
  fi
  if ! rm -rf "$WORK_DIRECTORY" || [ -e "$WORK_DIRECTORY" ]; then
    cleanup_failed=1
  fi
  if [ "$SUCCESS" -ne 1 ] || [ "$status" -ne 0 ] || [ "$cleanup_failed" -ne 0 ]; then
    if ! cleanup_failure_images; then
      cleanup_failed=1
    fi
  fi
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY PGPASSWORD
  unset MLP_IMAGE_GATE_SECRET_SENTINEL || :

  if [ "$status" -eq 0 ] && [ "$cleanup_failed" -ne 0 ]; then
    status=1
  fi
  if [ "$PROMOTION_LOCK_HELD" -eq 1 ]; then
    PROMOTION_LOCK_HELD=0
    exec 9>&-
  fi
  exit "$status"
}

install_cleanup_traps() {
  trap cleanup 0
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

install_cleanup_traps

verify_local_builder_endpoint() {
  builder_inspect_file=$1
  builder_endpoint_count=$(awk '
    $1 == "Endpoint:" { count += 1; endpoint = $2 }
    END { print count + 0 }
  ' "$builder_inspect_file") || fail 'Docker Buildx endpoint inspection failed'
  [ "$builder_endpoint_count" -eq 1 ] ||
    fail 'Docker Buildx must use exactly one local builder node'
  builder_endpoint=$(awk '$1 == "Endpoint:" { print $2 }' \
    "$builder_inspect_file") || fail 'Docker Buildx endpoint inspection failed'
  [ "$builder_endpoint" = unix:///var/run/docker.sock ] ||
    fail 'Docker Buildx builder endpoint must use the local Docker socket'
}

if ! docker buildx inspect >"$WORK_DIRECTORY/buildx-preflight.txt" 2>&1; then
  fail 'Docker Buildx with linux/amd64 support is required'
fi
verify_local_builder_endpoint "$WORK_DIRECTORY/buildx-preflight.txt"
IMAGE_GATE_BUILDER_NAME=$(awk '
  $1 == "Nodes:" { in_nodes = 1 }
  !in_nodes && $1 == "Name:" { count += 1; builder_name = $2 }
  END { if (count == 1) print builder_name }
' "$WORK_DIRECTORY/buildx-preflight.txt") ||
  fail 'Docker Buildx builder name inspection failed'
case $IMAGE_GATE_BUILDER_NAME in
  '' | [!A-Za-z0-9]* | *[!A-Za-z0-9_.-]*)
    fail 'Docker Buildx builder name is invalid'
    ;;
esac
if ! docker buildx inspect --bootstrap "$IMAGE_GATE_BUILDER_NAME" \
  >"$WORK_DIRECTORY/buildx-inspect.txt" 2>&1; then
  fail 'Docker Buildx with linux/amd64 support is required'
fi
verify_local_builder_endpoint "$WORK_DIRECTORY/buildx-inspect.txt"
if ! grep -Eq '(^|[,[:space:]])linux/amd64([,*[:space:]]|$)' \
  "$WORK_DIRECTORY/buildx-inspect.txt"; then
  fail 'Docker Buildx with linux/amd64 support is required'
fi

image_matrix() {
  cat <<'IMAGE_MATRIX'
app|Dockerfile|1000:1000|mlp-image-gate-app
backup|infra/backup/Dockerfile|10001:10001|mlp-image-gate-backup
caddy|infra/caddy/Dockerfile|65532:65532|mlp-image-gate-caddy
migration|infra/migration/Dockerfile|1000:1000|mlp-image-gate-migration
IMAGE_MATRIX
}

track_image() {
  image_reference=$1
  expected_image_id=$2
  image_retention=$3
  image_record="$image_reference|$expected_image_id|$image_retention"
  if [ -z "$TRACKED_IMAGES" ]; then
    TRACKED_IMAGES=$image_record
  else
    TRACKED_IMAGES=$(printf '%s\n%s' "$TRACKED_IMAGES" "$image_record")
  fi
}

record_image_id() {
  target_image_reference=$1
  recorded_image_id=$2
  target_image_retention=$3
  updated_image_records=
  pending_record_replaced=0
  record_ifs=$IFS
  IFS='
'

  for image_record in $TRACKED_IMAGES; do
    IFS='|'
    # shellcheck disable=SC2086
    set -- $image_record
    IFS='
'
    if [ "$1" = "$target_image_reference" ] && [ "$2" = PENDING ] && \
      [ "$3" = "$target_image_retention" ] && \
      [ "$pending_record_replaced" -eq 0 ]; then
      image_record="$target_image_reference|$recorded_image_id|$target_image_retention"
      pending_record_replaced=1
    fi
    if [ -z "$updated_image_records" ]; then
      updated_image_records=$image_record
    else
      updated_image_records=$(printf '%s\n%s' \
        "$updated_image_records" "$image_record")
    fi
  done
  IFS=$record_ifs

  [ "$pending_record_replaced" -eq 1 ] ||
    fail "pending image record was not found: $target_image_reference"
  TRACKED_IMAGES=$updated_image_records
}

track_container() {
  if [ -z "$TRACKED_CONTAINERS" ]; then
    TRACKED_CONTAINERS=$1
  else
    TRACKED_CONTAINERS=$(printf '%s\n%s' "$TRACKED_CONTAINERS" "$1")
  fi
}

track_network() {
  if [ -z "$TRACKED_NETWORKS" ]; then
    TRACKED_NETWORKS=$1
  else
    TRACKED_NETWORKS=$(printf '%s\n%s' "$TRACKED_NETWORKS" "$1")
  fi
}

track_volume() {
  if [ -z "$TRACKED_VOLUMES" ]; then
    TRACKED_VOLUMES=$1
  else
    TRACKED_VOLUMES=$(printf '%s\n%s' "$TRACKED_VOLUMES" "$1")
  fi
}

report_build_failure() {
  image_name=$1
  build_log=$2
  python3 -I - "$image_name" "$build_log" <<'PY'
from collections import deque
import re
import sys

image_name = sys.argv[1]
build_log = sys.argv[2]
MAX_LINE_CHARS = 4096
categories = (
    ('build-error', re.compile(r'\b(?:error|failed to solve)\b', re.IGNORECASE)),
    ('command-exit', re.compile(r'\b(?:exit code|did not complete successfully)\b', re.IGNORECASE)),
    ('permission', re.compile(r'\bpermission denied\b', re.IGNORECASE)),
    ('not-found', re.compile(r'\b(?:not found|no such file)\b', re.IGNORECASE)),
    ('network', re.compile(r'\b(?:resolve|resolution|network|connection|timeout)\b', re.IGNORECASE)),
    ('checksum', re.compile(r'\b(?:checksum|digest|manifest)\b', re.IGNORECASE)),
    ('no-space', re.compile(r'\bno space left\b', re.IGNORECASE)),
    ('architecture', re.compile(r'\b(?:architecture|platform)\b', re.IGNORECASE)),
    ('invalid-option', re.compile(r'\b(?:unknown|invalid|unrecognized) (?:flag|option|argument)\b', re.IGNORECASE)),
)
detected_categories = []


def bounded_logical_line_prefixes(log_file):
    while True:
        chunk = log_file.readline(MAX_LINE_CHARS + 1)
        if not chunk:
            return
        yield chunk[:MAX_LINE_CHARS]
        while len(chunk) > MAX_LINE_CHARS and not chunk.endswith('\n'):
            chunk = log_file.readline(MAX_LINE_CHARS + 1)
            if not chunk:
                return


try:
    with open(build_log, encoding='utf-8', errors='replace') as log_file:
        bounded_lines = deque(
            bounded_logical_line_prefixes(log_file), maxlen=5000
        )
    for line in bounded_lines:
        for name, pattern in categories:
            if pattern.search(line) and name not in detected_categories:
                detected_categories.append(name)
except OSError:
    print(f'build diagnostics: {image_name}', file=sys.stderr)
    print('build diagnostic categories: scanner-failure', file=sys.stderr)
    sys.exit(2)

print(f'build diagnostics: {image_name}', file=sys.stderr)
summary = ' '.join(detected_categories) or 'unclassified'
print(f'build diagnostic categories: {summary}', file=sys.stderr)
PY
}

build_image() {
  image_name=$1
  dockerfile=$2
  image_tag=$3
  image_reference="$image_tag:$STAGING_IMAGE_SUFFIX"
  invalid_image_reference="$image_tag:invalid-$COMMIT_SHA-$RUN_RANDOM_SUFFIX"
  INVALID_COMMIT_SHA="${COMMIT_SHA}A"

  track_image "$image_reference" PENDING always
  if ! docker buildx build \
    --builder "$IMAGE_GATE_BUILDER_NAME" \
    --platform linux/amd64 \
    --load \
    --build-arg "COMMIT_SHA=$COMMIT_SHA" \
    --tag "$image_reference" \
    --file "$REPOSITORY_ROOT/$dockerfile" \
    "$REPOSITORY_ROOT" >"$WORK_DIRECTORY/build-$image_name.txt" 2>&1; then
    report_build_failure "$image_name" "$WORK_DIRECTORY/build-$image_name.txt"
    fail "image build failed: $image_name"
  fi
  image_id=$(docker image inspect --format '{{.Id}}' "$image_reference" 2>/dev/null) ||
    fail "built image ID recording failed: $image_name"
  record_image_id "$image_reference" "$image_id" always

  if docker buildx build \
    --builder "$IMAGE_GATE_BUILDER_NAME" \
    --platform linux/amd64 \
    --load \
    --build-arg "COMMIT_SHA=$INVALID_COMMIT_SHA" \
    --tag "$invalid_image_reference" \
    --file "$REPOSITORY_ROOT/$dockerfile" \
    "$REPOSITORY_ROOT" >"$WORK_DIRECTORY/negative-build-$image_name.txt" 2>&1; then
    invalid_image_id=$(docker image inspect --format '{{.Id}}' \
      "$invalid_image_reference" 2>/dev/null) ||
      fail "negative image ID recording failed: $image_name"
    track_image "$invalid_image_reference" "$invalid_image_id" always
    fail "negative COMMIT_SHA build unexpectedly succeeded: $image_name"
  fi
}

assert_image_tag_absent() {
  image_reference=$1
  canonical_ids=$(docker image ls --all --quiet --no-trunc \
    "$image_reference" 2>/dev/null) ||
    fail "image tag collision check failed: $image_reference"
  [ -z "$canonical_ids" ] ||
    fail "image tag already exists: $image_reference"
}

acquire_promotion_lock() {
  [ "$PROMOTION_LOCK_HELD" -eq 0 ] ||
    fail 'image promotion lock is already held'
  PROMOTION_DEFERRED_SIGNAL=0
  promotion_lock_acquired=0
  trap 'PROMOTION_DEFERRED_SIGNAL=129' HUP
  trap 'PROMOTION_DEFERRED_SIGNAL=130' INT
  trap 'PROMOTION_DEFERRED_SIGNAL=143' TERM
  exec 9>>"$PROMOTION_LOCK_FILE"
  if flock --exclusive --nonblock 9; then
    promotion_lock_acquired=1
  fi
  if [ "$promotion_lock_acquired" -eq 1 ] && \
    [ "$PROMOTION_DEFERRED_SIGNAL" -eq 0 ]; then
    PROMOTION_LOCK_HELD=1
  else
    exec 9>&-
  fi
  install_cleanup_traps
  if [ "$PROMOTION_DEFERRED_SIGNAL" -ne 0 ]; then
    exit "$PROMOTION_DEFERRED_SIGNAL"
  fi
  [ "$promotion_lock_acquired" -eq 1 ] ||
    fail 'image promotion lock is unavailable'
}

promote_image() {
  staging_image=$1
  canonical_image=$2
  [ "$PROMOTION_LOCK_HELD" -eq 1 ] ||
    fail 'image promotion requires the global promotion lock'
  staging_image_id=$(docker image inspect --format '{{.Id}}' \
    "$staging_image" 2>/dev/null) ||
    fail "staging image promotion inspection failed: $staging_image"

  assert_image_tag_absent "$canonical_image"
  sleep 1
  assert_image_tag_absent "$canonical_image"
  track_image "$canonical_image" "$staging_image_id" failure
  docker image tag "$staging_image" "$canonical_image" >/dev/null 2>&1 ||
    fail "canonical image promotion failed: $canonical_image"
  canonical_image_id=$(docker image inspect --format '{{.Id}}' \
    "$canonical_image" 2>/dev/null) ||
    fail "canonical image promotion verification failed: $canonical_image"
  [ "$canonical_image_id" = "$staging_image_id" ] ||
    fail "canonical image promotion changed the image ID: $canonical_image"
}

verify_promoted_image() {
  staging_image=$1
  canonical_image=$2
  staging_image_id=$(docker image inspect --format '{{.Id}}' \
    "$staging_image" 2>/dev/null) ||
    fail "staging image revalidation failed: $staging_image"
  canonical_image_id=$(docker image inspect --format '{{.Id}}' \
    "$canonical_image" 2>/dev/null) ||
    fail "canonical image revalidation failed: $canonical_image"
  [ "$canonical_image_id" = "$staging_image_id" ] ||
    fail "canonical image set changed during promotion: $canonical_image"
}

assert_image_metadata() {
  image_name=$1
  expected_user=$2
  image_reference=$3

  image_id=$(docker image inspect --format='{{.Id}}' "$image_reference" 2>/dev/null) ||
    fail "image ID inspection failed: $image_name"
  printf '%s\n' "$image_id" | grep -Eq '^sha256:[0-9a-f]{64}$' ||
    fail "image ID is not a canonical digest: $image_name"

  revision=$(docker image inspect --format='{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_reference" 2>/dev/null) ||
    fail "OCI revision inspection failed: $image_name"
  [ "$revision" = "$COMMIT_SHA" ] || fail "OCI revision mismatch: $image_name"

  image_os=$(docker image inspect --format='{{.Os}}' "$image_reference" 2>/dev/null) ||
    fail "image OS inspection failed: $image_name"
  [ "$image_os" = linux ] || fail "image OS mismatch: $image_name"

  architecture=$(docker image inspect --format='{{.Architecture}}' "$image_reference" 2>/dev/null) ||
    fail "image architecture inspection failed: $image_name"
  [ "$architecture" = amd64 ] || fail "image architecture mismatch: $image_name"

  configured_user=$(docker image inspect --format='{{.Config.User}}' "$image_reference" 2>/dev/null) ||
    fail "image user inspection failed: $image_name"
  [ "$configured_user" = "$expected_user" ] || fail "image user mismatch: $image_name"
}

find_private_key_files() {
  python3 -I - "$@" <<'PY'
import base64
import binascii
import math
import os
import re
import stat
import struct
import subprocess
import sys

labels = rb'(?:PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY|DSA PRIVATE KEY|OPENSSH PRIVATE KEY|ENCRYPTED PRIVATE KEY)'
private_key_block = re.compile(
    rb'-----BEGIN (?P<label>' + labels + rb')-----(?P<body>.*?)-----END (?P=label)-----',
    re.DOTALL,
)
base64_line = re.compile(rb'[A-Za-z0-9+/=]+')
legacy_encryption_header = re.compile(
    rb'DEK-Info:[ \t]*(?P<cipher>[A-Za-z0-9-]+),(?P<iv>[0-9A-Fa-f]+)',
    re.IGNORECASE,
)
class ParseError(ValueError):
    pass


class ScannerError(RuntimeError):
    pass


class DerReader:
    def __init__(self, data):
        self.data = data
        self.position = 0

    def at_end(self):
        return self.position == len(self.data)

    def peek_tag(self):
        if self.position >= len(self.data):
            raise ParseError
        return self.data[self.position]

    def read(self, expected_tag=None):
        if self.position >= len(self.data):
            raise ParseError
        tag = self.data[self.position]
        self.position += 1
        if tag & 0x1F == 0x1F or self.position >= len(self.data):
            raise ParseError
        first_length = self.data[self.position]
        self.position += 1
        if first_length < 0x80:
            length = first_length
        else:
            length_bytes = first_length & 0x7F
            if length_bytes == 0 or length_bytes > 4:
                raise ParseError
            length_end = self.position + length_bytes
            if length_end > len(self.data) or self.data[self.position] == 0:
                raise ParseError
            length = int.from_bytes(self.data[self.position:length_end], 'big')
            self.position = length_end
            if length < 0x80:
                raise ParseError
        value_end = self.position + length
        if value_end > len(self.data):
            raise ParseError
        value = self.data[self.position:value_end]
        self.position = value_end
        if expected_tag is not None and tag != expected_tag:
            raise ParseError
        return tag, value


class SshReader:
    def __init__(self, data):
        self.data = data
        self.position = 0

    def at_end(self):
        return self.position == len(self.data)

    def remaining(self):
        return self.data[self.position:]

    def read_u32(self):
        if self.position + 4 > len(self.data):
            raise ParseError
        value = struct.unpack_from('>I', self.data, self.position)[0]
        self.position += 4
        return value

    def read_u8(self):
        if self.position >= len(self.data):
            raise ParseError
        value = self.data[self.position]
        self.position += 1
        return value

    def read_string(self):
        length = self.read_u32()
        value_end = self.position + length
        if value_end > len(self.data):
            raise ParseError
        value = self.data[self.position:value_end]
        self.position = value_end
        return value


def der_sequence(data):
    outer = DerReader(data)
    _, value = outer.read(0x30)
    if not outer.at_end():
        raise ParseError
    return DerReader(value)


def der_integer(reader):
    _, value = reader.read(0x02)
    if not value or value[0] & 0x80:
        raise ParseError
    if len(value) > 1 and value[0] == 0 and value[1] < 0x80:
        raise ParseError
    if len(value) > 1025:
        raise ScannerError
    return int.from_bytes(value, 'big')


def decode_oid(encoded):
    if not encoded:
        raise ParseError
    if len(encoded) > 256:
        raise ScannerError
    subidentifiers = []
    component = 0
    component_start = True
    for byte in encoded:
        if component_start and byte == 0x80:
            raise ParseError
        component = (component << 7) | (byte & 0x7F)
        component_start = False
        if byte & 0x80 == 0:
            subidentifiers.append(component)
            component = 0
            component_start = True
    if not component_start or not subidentifiers:
        raise ParseError
    first = min(subidentifiers[0] // 40, 2)
    second = subidentifiers[0] - first * 40
    return (first, second, *subidentifiers[1:])


def der_oid(reader):
    _, encoded = reader.read(0x06)
    return decode_oid(encoded)


def der_algorithm_identifier(reader):
    _, encoded = reader.read(0x30)
    algorithm = DerReader(encoded)
    oid = der_oid(algorithm)
    parameters = None
    if not algorithm.at_end():
        parameters = algorithm.read()
    if not algorithm.at_end():
        raise ParseError
    return oid, parameters


RSA_ENCRYPTION = (1, 2, 840, 113549, 1, 1, 1)
RSA_PSS = (1, 2, 840, 113549, 1, 1, 10)
EC_PUBLIC_KEY = (1, 2, 840, 10045, 2, 1)
DSA = (1, 2, 840, 10040, 4, 1)
DH_KEY_AGREEMENT = (1, 2, 840, 113549, 1, 3, 1)
DH_PUBLIC_NUMBER = (1, 2, 840, 10046, 2, 1)
PBES2 = (1, 2, 840, 113549, 1, 5, 13)
PBKDF2 = (1, 2, 840, 113549, 1, 5, 12)
SCRYPT = (1, 3, 6, 1, 4, 1, 11591, 4, 11)
MODERN_CURVE_PRIVATE_KEY_SIZES = {
    (1, 3, 101, 110): 32,
    (1, 3, 101, 111): 56,
    (1, 3, 101, 112): 32,
    (1, 3, 101, 113): 57,
 }
NAMED_CURVE_ORDERS = {
    (1, 2, 840, 10045, 3, 1, 1): int(
        'FFFFFFFFFFFFFFFFFFFFFFFF99DEF836146BC9B1B4D22831', 16
    ),
    (1, 3, 132, 0, 33): int(
        'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF000000000000000000000001', 16
    ),
    (1, 2, 840, 10045, 3, 1, 7): int(
        'FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551', 16
    ),
    (1, 3, 132, 0, 34): int(
        'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF'
        '581A0DB248B0A77AECEC196ACCC52973', 16
    ),
    (1, 3, 132, 0, 35): int(
        '01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
        'FA51868783BF2F966B7FCC0148F709A5D03BB5C9B8899C47AEBB6FB71E91386409',
        16,
    ),
    (1, 3, 132, 0, 10): int(
        'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141', 16
    ),
 }


def null_or_absent(parameters):
    return parameters is None or parameters == (0x05, b'')


def require_bounded_integers(*values):
    if any(value.bit_length() > 8192 for value in values):
        raise ScannerError


def valid_pbkdf2_parameters(encoded):
    parameters = DerReader(encoded)
    parameters.read(0x04)
    iterations = der_integer(parameters)
    if iterations <= 0:
        return False
    if not parameters.at_end() and parameters.peek_tag() == 0x02:
        if der_integer(parameters) <= 0:
            return False
    if not parameters.at_end():
        prf, prf_parameters = der_algorithm_identifier(parameters)
        hmac_algorithms = {
            (1, 2, 840, 113549, 2, 7),
            (1, 2, 840, 113549, 2, 8),
            (1, 2, 840, 113549, 2, 9),
            (1, 2, 840, 113549, 2, 10),
            (1, 2, 840, 113549, 2, 11),
            (1, 2, 840, 113549, 2, 12),
            (1, 2, 840, 113549, 2, 13),
            *((2, 16, 840, 1, 101, 3, 4, 2, suffix) for suffix in range(13, 17)),
        }
        if prf not in hmac_algorithms or not null_or_absent(prf_parameters):
            return False
    return parameters.at_end()


def valid_scrypt_parameters(encoded):
    parameters = DerReader(encoded)
    parameters.read(0x04)
    cost = der_integer(parameters)
    block_size = der_integer(parameters)
    parallelization = der_integer(parameters)
    if (
        cost < 2
        or cost & (cost - 1)
        or block_size <= 0
        or parallelization <= 0
    ):
        return False
    if not parameters.at_end() and der_integer(parameters) <= 0:
        return False
    return parameters.at_end()


def pbes2_encryption_requirements(parameters):
    if parameters is None or parameters[0] != 0x30:
        return None
    pbes2 = DerReader(parameters[1])
    kdf, kdf_parameters = der_algorithm_identifier(pbes2)
    if kdf_parameters is None or kdf_parameters[0] != 0x30:
        return None
    if kdf == PBKDF2:
        if not valid_pbkdf2_parameters(kdf_parameters[1]):
            return None
    elif kdf == SCRYPT:
        if not valid_scrypt_parameters(kdf_parameters[1]):
            return None
    else:
        return None
    cipher, cipher_parameters = der_algorithm_identifier(pbes2)
    if not pbes2.at_end():
        return None
    cbc_blocks = {
        (2, 16, 840, 1, 101, 3, 4, 1, 2): 16,
        (2, 16, 840, 1, 101, 3, 4, 1, 22): 16,
        (2, 16, 840, 1, 101, 3, 4, 1, 42): 16,
        (1, 2, 840, 113549, 3, 7): 8,
        (1, 2, 392, 200011, 61, 1, 1, 1, 2): 16,
        (1, 2, 392, 200011, 61, 1, 1, 1, 3): 16,
        (1, 2, 392, 200011, 61, 1, 1, 1, 4): 16,
        (1, 2, 410, 200046, 1, 1, 2): 16,
        (1, 2, 410, 200046, 1, 1, 7): 16,
        (1, 2, 410, 200046, 1, 1, 12): 16,
        (1, 2, 156, 10197, 1, 104, 2): 16,
        (1, 2, 410, 200004, 1, 4): 16,
    }
    block_size = cbc_blocks.get(cipher)
    if block_size is not None:
        if (
            cipher_parameters is None
            or cipher_parameters[0] != 0x04
            or len(cipher_parameters[1]) != block_size
        ):
            return None
        return block_size, block_size
    aes_suffixes = {*range(1, 9), *range(21, 29), *range(41, 49)}
    camellia_suffixes = {1, 3, 4, 9, 21, 23, 24, 29, 41, 43, 44, 49}
    recognized_cipher = (
        cipher[:-1] == (2, 16, 840, 1, 101, 3, 4, 1)
        and cipher[-1] in aes_suffixes
        or cipher[:-1] == (1, 2, 410, 200046, 1, 1)
        and 1 <= cipher[-1] <= 15
        or cipher[:-1] == (1, 2, 156, 10197, 1, 104)
        and 1 <= cipher[-1] <= 7
        or cipher[:-1] == (0, 3, 4401, 5, 3, 1, 9)
        and cipher[-1] in camellia_suffixes
        or cipher == (1, 3, 14, 3, 2, 17)
    )
    if not recognized_cipher:
        return None
    if cipher_parameters is None:
        return 8, None
    parameter_tag, parameter_value = cipher_parameters
    if parameter_tag == 0x04 and len(parameter_value) <= 32:
        return 8, None
    if parameter_tag != 0x30 or not parameter_value or len(parameter_value) > 256:
        return None
    structured_parameters = DerReader(parameter_value)
    while not structured_parameters.at_end():
        structured_parameters.read()
    return 8, None


def valid_dsa_private_key(parameters, private_key):
    if parameters is None or parameters[0] != 0x30:
        return False
    domain = DerReader(parameters[1])
    prime = der_integer(domain)
    subgroup = der_integer(domain)
    generator = der_integer(domain)
    private = DerReader(private_key)
    value = der_integer(private)
    require_bounded_integers(prime, subgroup, generator, value)
    return (
        domain.at_end()
        and private.at_end()
        and prime > 2
        and subgroup > 1
        and (prime - 1) % subgroup == 0
        and 1 < generator < prime
        and 0 < value < subgroup
    )


def valid_dh_private_key(algorithm, parameters, private_key):
    if parameters is None or parameters[0] != 0x30:
        return False
    domain = DerReader(parameters[1])
    prime = der_integer(domain)
    generator = der_integer(domain)
    subgroup = None
    if algorithm == DH_PUBLIC_NUMBER:
        subgroup = der_integer(domain)
        if not domain.at_end() and domain.peek_tag() == 0x02:
            if der_integer(domain) <= 0:
                return False
        if not domain.at_end():
            _, validation_data = domain.read(0x30)
            validation = DerReader(validation_data)
            _, seed = validation.read(0x03)
            counter = der_integer(validation)
            if len(seed) < 2 or seed[0] > 7 or counter < 0 or not validation.at_end():
                return False
    elif not domain.at_end():
        private_value_length = der_integer(domain)
        if private_value_length <= 0 or private_value_length > prime.bit_length():
            return False
    private = DerReader(private_key)
    value = der_integer(private)
    require_bounded_integers(
        prime,
        generator,
        value,
        *(value for value in (subgroup,) if value is not None),
    )
    if (
        not domain.at_end()
        or not private.at_end()
        or prime <= 2
        or not 1 < generator < prime
        or not 0 < value < prime - 1
    ):
        return False
    if subgroup is None:
        return True
    return subgroup > 1 and (prime - 1) % subgroup == 0 and value < subgroup


def valid_modern_curve_private_key(oid, parameters, private_key):
    if parameters is not None:
        return False
    wrapped = DerReader(private_key)
    _, value = wrapped.read(0x04)
    return len(value) == MODERN_CURVE_PRIVATE_KEY_SIZES[oid] and wrapped.at_end()


def valid_pqc_private_key(algorithm, parameters, private_key):
    structured_sizes = {
        (2, 16, 840, 1, 101, 3, 4, 3, 17): (32, 2560),
        (2, 16, 840, 1, 101, 3, 4, 3, 18): (32, 4032),
        (2, 16, 840, 1, 101, 3, 4, 3, 19): (32, 4896),
        (2, 16, 840, 1, 101, 3, 4, 4, 1): (64, 1632),
        (2, 16, 840, 1, 101, 3, 4, 4, 2): (64, 2400),
        (2, 16, 840, 1, 101, 3, 4, 4, 3): (64, 3168),
    }
    raw_sizes = {
        **{
            (2, 16, 840, 1, 101, 3, 4, 3, suffix): 64
            for suffix in (20, 21, 26, 27)
        },
        **{
            (2, 16, 840, 1, 101, 3, 4, 3, suffix): 96
            for suffix in (22, 23, 28, 29)
        },
        **{
            (2, 16, 840, 1, 101, 3, 4, 3, suffix): 128
            for suffix in (24, 25, 30, 31)
        },
    }
    if algorithm in raw_sizes:
        return parameters is None and len(private_key) == raw_sizes[algorithm]
    if algorithm not in structured_sizes:
        return None
    if parameters is not None:
        return False
    seed_size, expanded_size = structured_sizes[algorithm]
    encoded = DerReader(private_key)
    tag, value = encoded.read()
    if not encoded.at_end():
        return False
    if tag == 0x80:
        return len(value) == seed_size
    if tag == 0x04:
        return len(value) == expanded_size
    if tag != 0x30:
        return False
    both = DerReader(value)
    _, seed = both.read(0x04)
    _, expanded = both.read(0x04)
    return (
        len(seed) == seed_size
        and len(expanded) == expanded_size
        and both.at_end()
    )


def valid_with_openssl(data, check_key=False):
    environment = os.environ.copy()
    for variable in ('OPENSSL_CONF', 'OPENSSL_ENGINES', 'OPENSSL_MODULES'):
        environment.pop(variable, None)
    try:
        command = ['openssl', 'pkey', '-inform', 'DER', '-noout']
        if check_key:
            command.append('-check')
        result = subprocess.run(
            command,
            input=data,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=2,
            check=False,
            env=environment,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ScannerError from error
    if result.returncode not in (0, 1):
        raise ScannerError
    return result.returncode == 0


def valid_pkcs8(data):
    key = der_sequence(data)
    version = der_integer(key)
    if version not in (0, 1):
        return False
    algorithm, parameters = der_algorithm_identifier(key)
    _, private_key = key.read(0x04)
    if not private_key:
        return False
    if algorithm == RSA_ENCRYPTION:
        if not null_or_absent(parameters) or not valid_pkcs1(private_key):
            return False
    elif algorithm == RSA_PSS:
        if (
            parameters is not None
            and parameters[0] != 0x30
            or not valid_pkcs1(private_key)
        ):
            return False
    elif algorithm == EC_PUBLIC_KEY:
        if parameters is None or parameters[0] != 0x06:
            return False
        if not valid_sec1(private_key, decode_oid(parameters[1])):
            return False
    elif algorithm == DSA:
        if not valid_dsa_private_key(parameters, private_key):
            return False
    elif algorithm in (DH_KEY_AGREEMENT, DH_PUBLIC_NUMBER):
        if not valid_dh_private_key(algorithm, parameters, private_key):
            return False
    elif algorithm in MODERN_CURVE_PRIVATE_KEY_SIZES:
        if not valid_modern_curve_private_key(algorithm, parameters, private_key):
            return False
    else:
        pqc_validity = valid_pqc_private_key(algorithm, parameters, private_key)
        if pqc_validity is None:
            if not valid_with_openssl(data):
                return False
        elif not pqc_validity:
            return False
    attributes_present = False
    public_key_present = False
    while not key.at_end():
        tag, value = key.read()
        if tag == 0xA0:
            if attributes_present or public_key_present:
                return False
            attributes_present = True
            attributes = DerReader(value)
            while not attributes.at_end():
                attributes.read(0x30)
        elif tag == 0x81:
            if public_key_present:
                return False
            public_key_present = True
            if len(value) < 2 or value[0] != 0:
                return False
        else:
            return False
    return public_key_present == (version == 1)


def valid_encrypted_pkcs8(data):
    key = der_sequence(data)
    algorithm, parameters = der_algorithm_identifier(key)
    _, encrypted_data = key.read(0x04)
    if algorithm == PBES2:
        requirements = pbes2_encryption_requirements(parameters)
        if requirements is None:
            return False
        minimum_size, block_size = requirements
        return (
            len(encrypted_data) >= minimum_size
            and (block_size is None or len(encrypted_data) % block_size == 0)
            and key.at_end()
        )
    legacy_pbe_algorithms = {
        (1, 2, 840, 113549, 1, 5, 1),
        (1, 2, 840, 113549, 1, 5, 3),
        (1, 2, 840, 113549, 1, 5, 4),
        (1, 2, 840, 113549, 1, 5, 6),
        (1, 2, 840, 113549, 1, 5, 10),
        (1, 2, 840, 113549, 1, 5, 11),
        *((1, 2, 840, 113549, 1, 12, 1, index) for index in range(1, 7)),
    }
    if algorithm not in legacy_pbe_algorithms or parameters is None:
        return False
    if parameters[0] != 0x30:
        return False
    pbe = DerReader(parameters[1])
    pbe.read(0x04)
    iterations = der_integer(pbe)
    return (
        iterations > 0
        and pbe.at_end()
        and len(encrypted_data) >= 8
        and key.at_end()
    )


def valid_pkcs1(data):
    key = der_sequence(data)
    version = der_integer(key)
    if version not in (0, 1):
        return False
    modulus, exponent, private_exponent, prime1, prime2, exponent1, exponent2, coefficient = (
        der_integer(key) for _ in range(8)
    )
    other_prime_values = []
    if version == 1:
        _, other_primes_data = key.read(0x30)
        other_primes = DerReader(other_primes_data)
        while not other_primes.at_end():
            _, prime_data = other_primes.read(0x30)
            prime = DerReader(prime_data)
            values = tuple(der_integer(prime) for _ in range(3))
            if not prime.at_end():
                return False
            other_prime_values.append(values)
        if not other_prime_values:
            return False
    if not key.at_end():
        return False
    primes = [prime1, prime2, *(values[0] for values in other_prime_values)]
    integer_values = (
        modulus,
        exponent,
        private_exponent,
        prime1,
        prime2,
        exponent1,
        exponent2,
        coefficient,
        *(value for values in other_prime_values for value in values),
    )
    require_bounded_integers(*integer_values)
    if (
        any(value <= 0 for value in integer_values)
        or any(prime <= 1 for prime in primes)
        or len(set(primes)) != len(primes)
        or exponent <= 1
        or exponent % 2 == 0
        or modulus != math.prod(primes)
    ):
        return False
    totient_lcm = math.lcm(*(prime - 1 for prime in primes))
    if (
        math.gcd(exponent, totient_lcm) != 1
        or exponent * private_exponent % totient_lcm != 1
        or exponent1 != private_exponent % (prime1 - 1)
        or exponent2 != private_exponent % (prime2 - 1)
        or coefficient * prime2 % prime1 != 1
    ):
        return False
    accumulated_primes = prime1 * prime2
    for prime, prime_exponent, prime_coefficient in other_prime_values:
        if (
            prime_exponent != private_exponent % (prime - 1)
            or prime_coefficient * accumulated_primes % prime != 1
        ):
            return False
        accumulated_primes *= prime
    return True


def valid_traditional_dsa(data):
    key = der_sequence(data)
    if der_integer(key) != 0:
        return False
    prime, subgroup, generator, public_key, private_key = (
        der_integer(key) for _ in range(5)
    )
    require_bounded_integers(
        prime,
        subgroup,
        generator,
        public_key,
        private_key,
    )
    if (
        not key.at_end()
        or prime <= 2
        or subgroup <= 1
        or (prime - 1) % subgroup != 0
        or not 1 < generator < prime
        or not 1 < public_key < prime
        or not 0 < private_key < subgroup
    ):
        return False
    return valid_with_openssl(data, check_key=True)


def valid_sec1(data, expected_curve=None):
    key = der_sequence(data)
    if der_integer(key) != 1:
        return False
    _, private_key = key.read(0x04)
    if len(private_key) > 1024:
        raise ScannerError
    scalar = int.from_bytes(private_key, 'big')
    if not private_key or scalar == 0:
        return False
    optional_tags = []
    curve = None
    while not key.at_end():
        tag, value = key.read()
        optional_tags.append(tag)
        wrapped = DerReader(value)
        if tag == 0xA0:
            curve = der_oid(wrapped)
        elif tag == 0xA1:
            _, public_key = wrapped.read(0x03)
            if len(public_key) < 2 or public_key[0] != 0:
                return False
        else:
            return False
        if not wrapped.at_end():
            return False
    if optional_tags != sorted(set(optional_tags)):
        return False
    if curve is not None and expected_curve is not None and curve != expected_curve:
        return False
    curve = curve or expected_curve
    if curve is None:
        return False
    order = NAMED_CURVE_ORDERS.get(curve)
    return order is None or (len(private_key) <= (order.bit_length() + 7) // 8 and scalar < order)


def ssh_text(value):
    try:
        text = value.decode('ascii')
    except UnicodeDecodeError as error:
        raise ParseError from error
    if not text:
        raise ParseError
    return text


def ssh_mpint(reader):
    value = reader.read_string()
    if not value or value[0] & 0x80:
        raise ParseError
    if len(value) > 1 and value[0] == 0 and value[1] < 0x80:
        raise ParseError
    if len(value) > 1025:
        raise ScannerError
    return int.from_bytes(value, 'big')


def ssh_public_key(data):
    key = SshReader(data)
    key_type = ssh_text(key.read_string())
    if key_type == 'sk-ssh-ed25519@openssh.com':
        public_key = key.read_string()
        application = ssh_text(key.read_string())
        if len(public_key) != 32:
            raise ParseError
        fields = (public_key, application)
    elif key_type == 'sk-ecdsa-sha2-nistp256@openssh.com':
        curve = ssh_text(key.read_string())
        public_key = key.read_string()
        application = ssh_text(key.read_string())
        if curve != 'nistp256' or len(public_key) != 65 or public_key[0] != 0x04:
            raise ParseError
        fields = (curve, public_key, application)
    elif key_type == 'ssh-ed25519':
        public_key = key.read_string()
        if len(public_key) != 32:
            raise ParseError
        fields = (public_key,)
    elif key_type == 'ssh-rsa':
        exponent = ssh_mpint(key)
        modulus = ssh_mpint(key)
        if exponent <= 1 or modulus <= 0:
            raise ParseError
        fields = (exponent, modulus)
    elif key_type.startswith('ecdsa-sha2-'):
        curve = ssh_text(key.read_string())
        public_key = key.read_string()
        if key_type != f'ecdsa-sha2-{curve}' or not public_key:
            raise ParseError
        fields = (curve, public_key)
    elif key_type == 'ssh-dss':
        fields = tuple(ssh_mpint(key) for _ in range(4))
        if any(field <= 0 for field in fields):
            raise ParseError
    else:
        raise ParseError
    if not key.at_end():
        raise ParseError
    return key_type, fields


def ssh_private_key(reader, public_key):
    expected_type, expected_fields = public_key
    key_type = ssh_text(reader.read_string())
    if key_type != expected_type:
        raise ParseError
    if key_type == 'sk-ssh-ed25519@openssh.com':
        public_value = reader.read_string()
        application = ssh_text(reader.read_string())
        reader.read_u8()
        key_handle = reader.read_string()
        reader.read_string()
        if (
            len(public_value) != 32
            or not key_handle
            or expected_fields != (public_value, application)
        ):
            raise ParseError
    elif key_type == 'sk-ecdsa-sha2-nistp256@openssh.com':
        curve = ssh_text(reader.read_string())
        public_value = reader.read_string()
        application = ssh_text(reader.read_string())
        reader.read_u8()
        key_handle = reader.read_string()
        reader.read_string()
        if (
            curve != 'nistp256'
            or len(public_value) != 65
            or public_value[0] != 0x04
            or not key_handle
            or expected_fields != (curve, public_value, application)
        ):
            raise ParseError
    elif key_type == 'ssh-ed25519':
        public_value = reader.read_string()
        private_value = reader.read_string()
        if (
            len(public_value) != 32
            or len(private_value) != 64
            or private_value[32:] != public_value
            or expected_fields != (public_value,)
        ):
            raise ParseError
    elif key_type == 'ssh-rsa':
        modulus, exponent, private_exponent, inverse, prime1, prime2 = (
            ssh_mpint(reader) for _ in range(6)
        )
        if (
            any(value <= 0 for value in (
                modulus,
                exponent,
                private_exponent,
                inverse,
                prime1,
                prime2,
            ))
            or expected_fields != (exponent, modulus)
        ):
            raise ParseError
    elif key_type.startswith('ecdsa-sha2-'):
        curve = ssh_text(reader.read_string())
        public_value = reader.read_string()
        private_value = ssh_mpint(reader)
        if private_value <= 0 or expected_fields != (curve, public_value):
            raise ParseError
    elif key_type == 'ssh-dss':
        values = tuple(ssh_mpint(reader) for _ in range(5))
        if any(value <= 0 for value in values) or expected_fields != values[:4]:
            raise ParseError
    reader.read_string()


def valid_openssh(data):
    magic = b'openssh-key-v1\x00'
    if not data.startswith(magic):
        return False
    envelope = SshReader(data[len(magic):])
    cipher_name = ssh_text(envelope.read_string())
    kdf_name = ssh_text(envelope.read_string())
    kdf_options = envelope.read_string()
    key_count = envelope.read_u32()
    if key_count == 0 or key_count > 1024:
        return False
    public_keys = [ssh_public_key(envelope.read_string()) for _ in range(key_count)]
    private_keys = envelope.read_string()
    authentication_tag = envelope.remaining()
    if not private_keys:
        return False
    if cipher_name == 'none':
        if kdf_name != 'none' or kdf_options or authentication_tag:
            return False
        unencrypted = SshReader(private_keys)
        if unencrypted.read_u32() != unencrypted.read_u32():
            return False
        for public_key in public_keys:
            ssh_private_key(unencrypted, public_key)
        padding = unencrypted.remaining()
        return (
            len(padding) <= 255
            and padding == bytes(range(1, len(padding) + 1))
            and len(private_keys) % 8 == 0
        )
    cipher_specs = {
        '3des-cbc': (8, 0),
        'aes128-cbc': (16, 0),
        'aes192-cbc': (16, 0),
        'aes256-cbc': (16, 0),
        'aes128-ctr': (16, 0),
        'aes192-ctr': (16, 0),
        'aes256-ctr': (16, 0),
        'aes128-gcm@openssh.com': (16, 16),
        'aes256-gcm@openssh.com': (16, 16),
        'chacha20-poly1305@openssh.com': (8, 16),
    }
    if cipher_name not in cipher_specs or kdf_name != 'bcrypt':
        return False
    options = SshReader(kdf_options)
    salt = options.read_string()
    rounds = options.read_u32()
    block_size, authentication_tag_size = cipher_specs[cipher_name]
    return (
        len(salt) > 0
        and rounds > 0
        and options.at_end()
        and len(authentication_tag) == authentication_tag_size
        and len(private_keys) >= block_size
        and len(private_keys) % block_size == 0
    )


def normalized_pem_lines(block):
    body = block.group('body')
    body = body.replace(b'\\r\\n', b'\n').replace(b'\\n', b'\n').replace(b'\\r', b'\n')
    return [line.strip() for line in body.splitlines() if line.strip()]


def decoded_body(lines):
    if not lines or any(base64_line.fullmatch(line) is None for line in lines):
        raise ParseError
    try:
        return base64.b64decode(b''.join(lines), validate=True)
    except (binascii.Error, ValueError) as error:
        raise ParseError from error


def valid_legacy_encrypted_key(label, lines):
    if label not in (
        b'RSA PRIVATE KEY',
        b'EC PRIVATE KEY',
        b'DSA PRIVATE KEY',
    ) or len(lines) < 3:
        return False
    if lines[0].upper() != b'PROC-TYPE: 4,ENCRYPTED':
        return False
    header = legacy_encryption_header.fullmatch(lines[1])
    if header is None:
        return False
    iv = header.group('iv')
    if len(iv) < 16 or len(iv) > 64 or len(iv) % 2 != 0:
        return False
    encrypted = decoded_body(lines[2:])
    return len(encrypted) >= 8


def raise_walk_error(error):
    raise error


def regular_files(paths):
    for supplied_path in paths:
        supplied_stat = os.lstat(supplied_path)
        if stat.S_ISREG(supplied_stat.st_mode):
            yield supplied_path
            continue
        if not stat.S_ISDIR(supplied_stat.st_mode):
            continue
        for directory, child_directories, filenames in os.walk(
            supplied_path, followlinks=False, onerror=raise_walk_error
        ):
            child_directories[:] = [
                name
                for name in child_directories
                if stat.S_ISDIR(os.lstat(os.path.join(directory, name)).st_mode)
            ]
            for filename in filenames:
                candidate = os.path.join(directory, filename)
                if stat.S_ISREG(os.lstat(candidate).st_mode):
                    yield candidate


def decoded_private_key(block):
    try:
        label = block.group('label')
        lines = normalized_pem_lines(block)
        if lines and b':' in lines[0]:
            return valid_legacy_encrypted_key(label, lines)
        decoded = decoded_body(lines)
        validators = {
            b'PRIVATE KEY': valid_pkcs8,
            b'ENCRYPTED PRIVATE KEY': valid_encrypted_pkcs8,
            b'RSA PRIVATE KEY': valid_pkcs1,
            b'EC PRIVATE KEY': valid_sec1,
            b'DSA PRIVATE KEY': valid_traditional_dsa,
            b'OPENSSH PRIVATE KEY': valid_openssh,
        }
        return validators[label](decoded)
    except (KeyError, ParseError):
        return False


try:
    for path in regular_files(sys.argv[1:]):
        with open(path, 'rb') as candidate_file:
            contents = candidate_file.read()
        if any(
            decoded_private_key(block) for block in private_key_block.finditer(contents)
        ):
            print(path)
except (OSError, ParseError, ScannerError):
    sys.exit(2)
PY
}

decode_image_environment() {
  environment_json=$1
  decoded_environment=$2
  python3 -I - "$environment_json" "$decoded_environment" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding='utf-8') as environment_file:
        environment = json.load(environment_file)
    if environment is None:
        environment = []
    if not isinstance(environment, list) or any(
        not isinstance(entry, str) for entry in environment
    ):
        raise ValueError
    with open(sys.argv[2], 'wb') as decoded_file:
        for entry in environment:
            encoded = entry.encode('utf-8')
            if b'\x00' in encoded:
                raise ValueError
            decoded_file.write(encoded)
            decoded_file.write(b'\n')
except (OSError, UnicodeError, ValueError):
    sys.exit(2)
PY
}

assert_no_secret_metadata() {
  image_name=$1
  secret_sentinel=$2
  credential_uri_pattern=$3
  shift 3

  if grep -F "$secret_sentinel" "$@" >/dev/null 2>&1; then
    fail "secret-like metadata detected: $image_name"
  else
    grep_status=$?
    [ "$grep_status" -eq 1 ] || fail "secret metadata scan failed: $image_name"
  fi
  if grep -Eiq -- "$credential_uri_pattern" "$@" >/dev/null 2>&1; then
    fail "secret-like metadata detected: $image_name"
  else
    grep_status=$?
    [ "$grep_status" -eq 1 ] || fail "secret metadata scan failed: $image_name"
  fi
}

assert_no_forbidden_secret_paths() {
  image_name=$1
  forbidden_path_pattern=$2
  path_listing=$3

  if grep -Eq -- "$forbidden_path_pattern" "$path_listing" >/dev/null 2>&1; then
    fail "forbidden secret path detected: $image_name"
  else
    grep_status=$?
    [ "$grep_status" -eq 1 ] || fail "secret path scan failed: $image_name"
  fi
}

find_secret_like_files() {
  scan_root=$1
  hits_file=$2
  secret_sentinel=$3
  credential_uri_pattern=$4

  : >"$hits_file" || return 1
  find "$scan_root" -type f -exec sh -c '
    secret_sentinel=$1
    credential_uri_pattern=$2
    shift 2
    for candidate_file do
      matched=0
      if grep -aF "$secret_sentinel" "$candidate_file" >/dev/null 2>&1; then
        matched=1
      else
        grep_status=$?
        [ "$grep_status" -eq 1 ] || exit 2
      fi
      if grep -aEi -- "$credential_uri_pattern" "$candidate_file" >/dev/null 2>&1; then
        matched=1
      else
        grep_status=$?
        [ "$grep_status" -eq 1 ] || exit 2
      fi
      [ "$matched" -eq 0 ] || printf "%s\n" "$candidate_file"
    done
  ' sh "$secret_sentinel" "$credential_uri_pattern" {} + \
    >"$hits_file" 2>/dev/null
}

assert_no_image_secrets() {
  image_name=$1
  image_reference=$2
  history_file="$WORK_DIRECTORY/history-$image_name.txt"
  environment_file="$WORK_DIRECTORY/environment-$image_name.json"
  decoded_environment_file="$WORK_DIRECTORY/environment-$image_name.txt"
  rootfs_archive="$WORK_DIRECTORY/rootfs-$image_name.tar"
  rootfs_listing="$WORK_DIRECTORY/rootfs-$image_name.txt"
  rootfs_directory="$WORK_DIRECTORY/rootfs-$image_name"
  container_name="mlp-image-gate-audit-$image_name-$$"
  credential_uri_pattern='postgres(ql)?://[[:alnum:]_.~-]+:[^@[:space:]/]+@|mongodb://[[:alnum:]_.~-]+:[^@[:space:]/]+@|mongodb\+srv://[[:alnum:]_.~-]+:[^@[:space:]/]+@'
  private_key_hits="$WORK_DIRECTORY/private-key-hits-$image_name.txt"
  secret_hits="$WORK_DIRECTORY/secret-hits-$image_name.txt"

  docker history --no-trunc "$image_reference" >"$history_file" 2>/dev/null ||
    fail "image history inspection failed: $image_name"
  docker image inspect --format='{{json .Config.Env}}' "$image_reference" >"$environment_file" 2>/dev/null ||
    fail "image environment inspection failed: $image_name"
  decode_image_environment "$environment_file" "$decoded_environment_file" ||
    fail "image environment decoding failed: $image_name"

  assert_no_secret_metadata \
    "$image_name" \
    "$MLP_IMAGE_GATE_SECRET_SENTINEL" \
    "$credential_uri_pattern" \
    "$history_file" \
    "$decoded_environment_file"
  find_private_key_files "$history_file" "$decoded_environment_file" >"$private_key_hits" ||
    fail "private-key metadata scan failed: $image_name"
  if [ -s "$private_key_hits" ]; then
    fail "private-key metadata detected: $image_name"
  fi

  track_container "$container_name"
  docker create \
    --name "$container_name" \
    --label "mlp.image-gate.run=$RUN_ID" \
    "$image_reference" >/dev/null 2>&1 ||
    fail "image filesystem container creation failed: $image_name"
  docker export --output "$rootfs_archive" "$container_name" >/dev/null 2>&1 ||
    fail "image filesystem export failed: $image_name"
  tar -tf "$rootfs_archive" >"$rootfs_listing" 2>"$WORK_DIRECTORY/rootfs-list-errors-$image_name.txt" ||
    fail "image filesystem listing failed: $image_name"

  assert_no_forbidden_secret_paths \
    "$image_name" \
    '(^|/)\.env($|[./])|(^|/)run/secrets(/|$)|(^|/)migration-artifacts(/|$)|(^|/)\.\.(/|$)|^/' \
    "$rootfs_listing"

  mkdir "$rootfs_directory"
  tar --no-same-owner --no-same-permissions \
    --exclude='dev/*' --exclude='proc/*' --exclude='sys/*' \
    -xf "$rootfs_archive" -C "$rootfs_directory" \
    2>"$WORK_DIRECTORY/rootfs-extract-errors-$image_name.txt" ||
    fail "image filesystem extraction failed: $image_name"
  chmod -R u+rwX "$rootfs_directory" ||
    fail "image filesystem permission normalization failed: $image_name"
  find_secret_like_files \
    "$rootfs_directory" \
    "$secret_hits" \
    "$MLP_IMAGE_GATE_SECRET_SENTINEL" \
    "$credential_uri_pattern" ||
    fail "secret filesystem scan failed: $image_name"
  find_private_key_files "$rootfs_directory" >"$private_key_hits" ||
    fail "private-key filesystem scan failed: $image_name"
  if [ -s "$secret_hits" ]; then
    fail "secret-like filesystem content detected: $image_name"
  fi
  if [ -s "$private_key_hits" ]; then
    fail "private-key filesystem content detected: $image_name"
  fi
}

assert_container_hardening() {
  image_name=$1
  expected_user=$2
  container_name=$3

  readonly_rootfs=$(docker container inspect --format='{{.HostConfig.ReadonlyRootfs}}' "$container_name" 2>/dev/null) ||
    fail "read-only root filesystem inspection failed: $image_name"
  [ "$readonly_rootfs" = true ] || fail "read-only root filesystem is disabled: $image_name"

  cap_drop=$(docker container inspect --format='{{json .HostConfig.CapDrop}}' "$container_name" 2>/dev/null) ||
    fail "capability inspection failed: $image_name"
  printf '%s\n' "$cap_drop" | jq --exit-status 'index("ALL") != null' >/dev/null ||
    fail "all capabilities were not dropped: $image_name"

  security_options=$(docker container inspect --format='{{json .HostConfig.SecurityOpt}}' "$container_name" 2>/dev/null) ||
    fail "security option inspection failed: $image_name"
  printf '%s\n' "$security_options" |
    jq --exit-status 'index("no-new-privileges:true") != null' >/dev/null ||
    fail "no-new-privileges is disabled: $image_name"

  runtime_user=$(docker container inspect --format='{{.Config.User}}' "$container_name" 2>/dev/null) ||
    fail "runtime user inspection failed: $image_name"
  [ "$runtime_user" = "$expected_user" ] || fail "runtime user mismatch: $image_name"
}

assert_runtime_hardening() {
  image_name=$1
  expected_user=$2
  image_reference=$3
  container_name="$RUN_ID-hardening-$image_name"

  track_container "$container_name"
  case $image_name in
    app)
      docker create \
        --name "$container_name" \
        --label "mlp.image-gate.run=$RUN_ID" \
        --read-only \
        --cap-drop ALL \
        --security-opt no-new-privileges:true \
        --user "$expected_user" \
        --entrypoint /nodejs/bin/node \
        "$image_reference" -e 'process.exit(0)' \
        >"$WORK_DIRECTORY/hardening-create-$image_name.txt" 2>&1 ||
        fail "hardened container creation failed: $image_name"
      ;;
    *)
      docker create \
        --name "$container_name" \
        --label "mlp.image-gate.run=$RUN_ID" \
        --read-only \
        --cap-drop ALL \
        --security-opt no-new-privileges:true \
        --user "$expected_user" \
        --entrypoint /bin/true \
        "$image_reference" >"$WORK_DIRECTORY/hardening-create-$image_name.txt" 2>&1 ||
        fail "hardened container creation failed: $image_name"
      ;;
  esac

  assert_container_hardening "$image_name" "$expected_user" "$container_name"
  docker start --attach "$container_name" >"$WORK_DIRECTORY/hardening-run-$image_name.txt" 2>&1 ||
    fail "hardened container execution failed: $image_name"
}

verify_caddy_runtime() {
  track_container "$CADDY_CAPABILITY_CONTAINER"
  docker run \
    --name "$CADDY_CAPABILITY_CONTAINER" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 65532:65532 \
    --entrypoint /usr/bin/caddy \
    "$CADDY_IMAGE" version \
    >"$WORK_DIRECTORY/caddy-version.txt" 2>&1 ||
    fail 'Caddy hardened version smoke failed'
  assert_container_hardening \
    caddy 65532:65532 "$CADDY_CAPABILITY_CONTAINER"
  grep -F 'v2.11.4' "$WORK_DIRECTORY/caddy-version.txt" >/dev/null ||
    fail 'Caddy version mismatch'

  track_container "$CADDY_CONTAINER"
  docker run --detach \
    --name "$CADDY_CONTAINER" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 65532:65532 \
    --tmpfs /config:rw,nosuid,nodev,noexec,uid=65532,gid=65532,mode=0700 \
    --tmpfs /data:rw,nosuid,nodev,noexec,uid=65532,gid=65532,mode=0700 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,uid=65532,gid=65532,mode=1770 \
    --mount "type=bind,source=$REPOSITORY_ROOT/infra/caddy,target=/etc/caddy,readonly" \
    --env CONTACT_MODE=contact-enabled \
    "$CADDY_IMAGE" >"$WORK_DIRECTORY/caddy-run.txt" 2>&1 ||
    fail 'hardened Caddy start failed'
  assert_container_hardening caddy 65532:65532 "$CADDY_CONTAINER"

  caddy_attempt=0
  while [ "$caddy_attempt" -lt 20 ]; do
    caddy_running=$(docker container inspect --format='{{.State.Running}}' \
      "$CADDY_CONTAINER" 2>/dev/null) ||
      fail 'Caddy runtime state inspection failed'
    if [ "$caddy_running" = true ] &&
      caddy_status=$(docker exec "$CADDY_CONTAINER" curl \
        --silent --output /dev/null --write-out '%{http_code}' \
        --header 'Host: unknown.invalid' \
        http://127.0.0.1:8080/ 2>/dev/null) &&
      [ "$caddy_status" = 421 ]; then
      return 0
    fi
    caddy_attempt=$((caddy_attempt + 1))
    sleep 1
  done
  fail 'hardened Caddy did not remain running'
}

wait_for_postgres() {
  container_name=$1
  database_name=$2
  attempt=0

  while [ "$attempt" -lt 60 ]; do
    if docker exec --user postgres "$container_name" psql \
      --no-psqlrc \
      --tuples-only \
      --no-align \
      --username postgres \
      --dbname "$database_name" \
      --command 'select 1' 2>/dev/null | grep -Fx 1 >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  fail 'source PostgreSQL did not become ready'
}

bootstrap_database_roles() {
  database_container=$1
  database_name=$2

  if ! docker exec --interactive --user postgres "$database_container" \
    psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname "$database_name" \
    --set "database_name=$database_name" \
    >"$WORK_DIRECTORY/bootstrap-$database_name.txt" 2>&1 <<'ROLE_SQL'
\set migrator_password `cat /run/secrets/postgres-migrator-password`
\set app_password `cat /run/secrets/postgres-app-password`
\set backup_password `cat /run/secrets/postgres-backup-password`
begin;
set password_encryption = 'scram-sha-256';
create role portfolio_migrator login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'migrator_password';
create role portfolio_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'app_password';
create role portfolio_backup login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'backup_password';
alter database :"database_name" owner to portfolio_migrator;
revoke connect, temporary on database :"database_name" from public;
revoke create on schema public from public;
grant connect on database :"database_name" to portfolio_migrator, portfolio_app, portfolio_backup;
commit;
ROLE_SQL
  then
    printf '%s\n' "bootstrap diagnostics for $database_name" >&2
    sed -n '1,160p' "$WORK_DIRECTORY/bootstrap-$database_name.txt" >&2 || :
    fail "PostgreSQL production role bootstrap failed: $database_name"
  fi
}

verify_database_security_contract() {
  database_container=$1
  database_name=$2

  if ! docker exec --interactive --user postgres "$database_container" \
    psql --no-psqlrc --set ON_ERROR_STOP=1 --quiet --dbname "$database_name" \
    >"$WORK_DIRECTORY/security-contract-$database_name.txt" 2>&1 <<'SECURITY_SQL'
do $validation$
declare
  application_table_count integer;
  owned_table_count integer;
  constrained_role_count integer;
  table_matrix_ok boolean;
  database_acl text[];
  journal_contact_function oid;
begin
  if (select pg_get_userbyid(datdba) from pg_database
      where datname = current_database()) is distinct from 'portfolio_migrator'
    or (select pg_get_userbyid(nspowner) from pg_namespace
        where nspname = 'public') is distinct from 'pg_database_owner' then
    raise exception 'security contract failed';
  end if;

  select count(*) into application_table_count
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
    and table_name = any(array[
      'profile_sections','current_occupations','hobbies','languages',
      'page_cards','professional_timeline','projects','pursuits',
      'social_links','contact_messages'
    ]);
  if application_table_count <> 10 or (
    select count(*) from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  ) <> 12 then
    raise exception 'security contract failed';
  end if;

  select count(*) into owned_table_count
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relkind = 'r'
    and pg_get_userbyid(relowner) = 'portfolio_migrator';
  if owned_table_count <> 12 then
    raise exception 'security contract failed';
  end if;

  if (select name from kysely_migration order by timestamp desc limit 1)
      is distinct from '003_contact_journal'
    or not exists(
      select 1 from profile_sections where id = 'image-gate-restore-ok'
    ) then
    raise exception 'security contract failed';
  end if;

  select to_regprocedure(
    'public.ensure_journal_contact(uuid,text,text,text,text,timestamptz,text,text,text)'
  )::oid into journal_contact_function;
  if journal_contact_function is null
    or (select pg_get_userbyid(proowner) from pg_proc
        where oid = journal_contact_function) is distinct from 'portfolio_migrator'
    or not has_function_privilege(
      'portfolio_app', journal_contact_function, 'execute'
    )
    or not has_function_privilege(
      'portfolio_migrator', journal_contact_function, 'execute'
    )
    or has_function_privilege(
      'portfolio_backup', journal_contact_function, 'execute'
    )
    or has_function_privilege(
      'portfolio_app', journal_contact_function, 'execute with grant option'
    )
    or exists(
      select 1
      from pg_proc function
      cross join lateral aclexplode(function.proacl) acl
      where function.oid = journal_contact_function
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) then
    raise exception 'security contract failed';
  end if;

  select count(*) into constrained_role_count
  from pg_roles role
  join pg_authid auth on auth.oid = role.oid
  where role.rolname = any(array[
      'portfolio_migrator','portfolio_app','portfolio_backup'
    ])
    and role.rolcanlogin and not role.rolsuper and not role.rolcreatedb
    and not role.rolcreaterole and not role.rolreplication
    and not role.rolbypassrls
    and auth.rolpassword like 'SCRAM-SHA-256$%';
  if constrained_role_count <> 3 then
    raise exception 'security contract failed';
  end if;

  select array_agg(acl_entry order by acl_entry) into database_acl
  from (
    select concat_ws('|',
      case when acl.grantee = 0 then 'PUBLIC'
           else acl.grantee::regrole::text end,
      acl.privilege_type, acl.is_grantable::text,
      acl.grantor::regrole::text
    ) as acl_entry
    from pg_database database
    cross join lateral aclexplode(database.datacl) acl
    where database.datname = current_database()
  ) database_acl_entries;
  if database_acl is distinct from array[
    'portfolio_app|CONNECT|false|portfolio_migrator',
    'portfolio_backup|CONNECT|false|portfolio_migrator',
    'portfolio_migrator|CONNECT|false|portfolio_migrator',
    'portfolio_migrator|CREATE|false|portfolio_migrator',
    'portfolio_migrator|TEMPORARY|false|portfolio_migrator'
  ] then
    raise exception 'security contract failed';
  end if;

  if not (
    has_database_privilege('portfolio_migrator', current_database(), 'connect')
    and has_database_privilege('portfolio_migrator', current_database(), 'create')
    and has_database_privilege('portfolio_migrator', current_database(), 'temporary')
    and has_database_privilege('portfolio_app', current_database(), 'connect')
    and not has_database_privilege('portfolio_app', current_database(), 'connect with grant option')
    and not has_database_privilege('portfolio_app', current_database(), 'create')
    and not has_database_privilege('portfolio_app', current_database(), 'temporary')
    and has_database_privilege('portfolio_backup', current_database(), 'connect')
    and not has_database_privilege('portfolio_backup', current_database(), 'connect with grant option')
    and not has_database_privilege('portfolio_backup', current_database(), 'create')
    and not has_database_privilege('portfolio_backup', current_database(), 'temporary')
    and not has_database_privilege(0::oid, current_database(), 'connect')
    and not has_database_privilege(0::oid, current_database(), 'temporary')
    and has_schema_privilege('portfolio_app', 'public', 'usage')
    and not has_schema_privilege('portfolio_app', 'public', 'usage with grant option')
    and not has_schema_privilege('portfolio_app', 'public', 'create')
    and has_schema_privilege('portfolio_backup', 'public', 'usage')
    and not has_schema_privilege('portfolio_backup', 'public', 'usage with grant option')
    and not has_schema_privilege('portfolio_backup', 'public', 'create')
  ) then
    raise exception 'security contract failed';
  end if;

  with runtime_roles(role_name) as (
    values ('portfolio_app'), ('portfolio_backup')
  ), runtime_tables(table_name) as (
    values
      ('profile_sections'),('current_occupations'),('hobbies'),('languages'),
      ('page_cards'),('professional_timeline'),('projects'),('pursuits'),
      ('social_links'),('contact_messages'),('kysely_migration'),
      ('kysely_migration_lock')
  )
  select bool_and(
    has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'select'
    ) = (
      role_name = 'portfolio_backup'
      or (role_name = 'portfolio_app' and table_name = any(array[
        'profile_sections','current_occupations','hobbies','languages',
        'page_cards','professional_timeline','projects','pursuits',
        'social_links','kysely_migration'
      ]))
    )
    and has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'insert'
    ) = false
    and not has_table_privilege(role_name, format('%I.%I', 'public', table_name), 'update')
    and not has_table_privilege(role_name, format('%I.%I', 'public', table_name), 'delete')
    and not has_table_privilege(role_name, format('%I.%I', 'public', table_name), 'truncate')
    and not has_table_privilege(role_name, format('%I.%I', 'public', table_name), 'references')
    and not has_table_privilege(role_name, format('%I.%I', 'public', table_name), 'trigger')
    and not has_table_privilege(role_name, format('%I.%I', 'public', table_name), 'select with grant option')
    and not has_table_privilege(role_name, format('%I.%I', 'public', table_name), 'insert with grant option')
    and not has_table_privilege(0::oid, format('%I.%I', 'public', table_name), 'select')
    and not has_table_privilege(0::oid, format('%I.%I', 'public', table_name), 'insert')
    and not has_table_privilege(0::oid, format('%I.%I', 'public', table_name), 'update')
    and not has_table_privilege(0::oid, format('%I.%I', 'public', table_name), 'delete')
    and not has_table_privilege(0::oid, format('%I.%I', 'public', table_name), 'truncate')
    and not has_table_privilege(0::oid, format('%I.%I', 'public', table_name), 'references')
    and not has_table_privilege(0::oid, format('%I.%I', 'public', table_name), 'trigger')
  ) into table_matrix_ok
  from runtime_roles cross join runtime_tables;
  if table_matrix_ok is distinct from true then
    raise exception 'security contract failed';
  end if;
end
$validation$;
SECURITY_SQL
  then
    fail 'database security contract verification failed'
  fi
}

prepare_source_database() {
  track_network "$NETWORK_NAME"
  docker network create \
    --label "mlp.image-gate.run=$RUN_ID" \
    "$NETWORK_NAME" >/dev/null 2>&1 ||
    fail 'image gate network creation failed'

  track_volume "$SOURCE_DATABASE_VOLUME"
  docker volume create \
    --label "mlp.image-gate.run=$RUN_ID" \
    "$SOURCE_DATABASE_VOLUME" >/dev/null 2>&1 ||
    fail 'source database volume creation failed'

  track_container "$SOURCE_DATABASE_CONTAINER"
  docker run --detach \
    --name "$SOURCE_DATABASE_CONTAINER" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --network-alias source-postgres \
    --mount "type=volume,source=$SOURCE_DATABASE_VOLUME,target=/var/lib/postgresql" \
    --mount "type=bind,source=$POSTGRES_PASSWORD_FILE,target=/run/secrets/postgres-password,readonly" \
    --mount "type=bind,source=$MIGRATOR_PASSWORD_FILE,target=/run/secrets/postgres-migrator-password,readonly" \
    --mount "type=bind,source=$APP_PASSWORD_FILE,target=/run/secrets/postgres-app-password,readonly" \
    --mount "type=bind,source=$BACKUP_PASSWORD_FILE,target=/run/secrets/postgres-backup-password,readonly" \
    --env POSTGRES_DB=imagegate_source \
    --env POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
    --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password \
    --env POSTGRES_USER=postgres \
    "$POSTGRES_IMAGE" >"$WORK_DIRECTORY/source-postgres-run.txt" 2>&1 ||
    fail 'source PostgreSQL start failed'

  wait_for_postgres "$SOURCE_DATABASE_CONTAINER" imagegate_source
  bootstrap_database_roles "$SOURCE_DATABASE_CONTAINER" imagegate_source
}

run_database_migrations() {
  migrator_container="$RUN_ID-migrator"
  track_container "$migrator_container"

  docker run \
    --name "$migrator_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 1000:1000 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777 \
    --mount "type=bind,source=$MIGRATOR_PASSWORD_FILE,target=/run/secrets/postgres-password,readonly" \
    --env PGCONNECT_TIMEOUT_MS=5000 \
    --env PGDATABASE=imagegate_source \
    --env PGHOST=source-postgres \
    --env PGPASSWORD_FILE=/run/secrets/postgres-password \
    --env PGPOOL_MAX=2 \
    --env PGPORT=5432 \
    --env PGUSER=portfolio_migrator \
    "$APP_IMAGE" /app/dist/scripts/db/migrate.js \
    >"$WORK_DIRECTORY/database-migrations.txt" 2>&1 ||
    fail 'source database migration failed'

  if ! docker exec --interactive --user postgres "$SOURCE_DATABASE_CONTAINER" \
    psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname imagegate_source \
    >"$WORK_DIRECTORY/source-marker.txt" 2>&1 <<'MARKER_SQL'
set role portfolio_migrator;
insert into profile_sections (
  id, source_order, key, title, info, name, surname
) values (
  'image-gate-restore-ok', 0, 'image_gate_restore_marker',
  'Image gate', 'Restore marker', 'Image', 'Gate'
);
reset role;
MARKER_SQL
  then
    fail 'source database marker creation failed'
  fi

  verify_database_security_contract "$SOURCE_DATABASE_CONTAINER" imagegate_source
}

app_curl() {
  docker run --rm \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 65532:65532 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,uid=65532,gid=65532,mode=1770 \
    --entrypoint curl \
    "$CADDY_IMAGE" \
    --silent --show-error --fail --max-time 10 \
    "$@"
}

verify_app_video_range() {
  docker run --rm \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 65532:65532 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,uid=65532,gid=65532,mode=1770 \
    --entrypoint /bin/sh \
    "$CADDY_IMAGE" -eu -c '
      range_status=$(curl --silent --show-error --fail --max-time 10 \
        --header "Range: bytes=0-31" \
        --dump-header /tmp/video-range-headers.txt \
        --output /tmp/video-range-body.bin \
        --write-out "%{http_code}" \
        http://app:3000/assets/man.mp4)
      [ "$range_status" -eq 206 ]
      tr -d "\r" </tmp/video-range-headers.txt \
        >/tmp/video-range-headers-normalized.txt
      grep -Eiq "^Content-Range:[[:space:]]*bytes 0-31/[1-9][0-9]*$" \
        /tmp/video-range-headers-normalized.txt
      range_bytes=$(wc -c </tmp/video-range-body.bin | awk "{ print \$1 }")
      [ "$range_bytes" -eq 32 ]
    '
}

start_and_verify_app() {
  track_container "$APP_CONTAINER"
  docker run --detach \
    --name "$APP_CONTAINER" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --network-alias app \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 1000:1000 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777 \
    --mount "type=bind,source=$APP_PASSWORD_FILE,target=/run/secrets/postgres-password,readonly" \
    --env PGCONNECT_TIMEOUT_MS=5000 \
    --env PGDATABASE=imagegate_source \
    --env PGHOST=source-postgres \
    --env PGPASSWORD_FILE=/run/secrets/postgres-password \
    --env PGPOOL_MAX=5 \
    --env PGPORT=5432 \
    --env PGUSER=portfolio_app \
    "$APP_IMAGE" >"$WORK_DIRECTORY/app-run.txt" 2>&1 ||
    fail 'application start failed'

  assert_container_hardening app 1000:1000 "$APP_CONTAINER"

  attempt=0
  while [ "$attempt" -lt 60 ]; do
    if app_curl http://app:3000/api/health/live >/dev/null 2>&1 &&
      app_curl http://app:3000/api/health/ready >/dev/null 2>&1; then
      break
    fi
    container_running=$(docker container inspect --format='{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null) ||
      fail 'application state inspection failed'
    [ "$container_running" = true ] || fail 'application exited before readiness'
    attempt=$((attempt + 1))
    sleep 1
  done
  [ "$attempt" -lt 60 ] || fail 'application readiness timed out'

  for required_path in /api/health/live /api/health/ready /sw.js /sw-manifest.json; do
    app_curl "http://app:3000$required_path" --output /dev/null ||
      fail 'required application route failed'
  done

  manifest_file="$WORK_DIRECTORY/sw-manifest.json"
  manifest_paths="$WORK_DIRECTORY/sw-manifest-paths.txt"
  app_curl http://app:3000/sw-manifest.json >"$manifest_file" ||
    fail 'service worker manifest request failed'
  jq --exit-status \
    'type == "array" and length > 0 and all(.[]; type == "string" and startswith("/"))' \
    "$manifest_file" >/dev/null ||
    fail 'service worker manifest validation failed'
  jq --raw-output '.[]' "$manifest_file" >"$manifest_paths"
  while IFS= read -r asset_path; do
    app_curl "http://app:3000$asset_path" --output /dev/null ||
      fail 'precache asset request failed'
  done <"$manifest_paths"

  verify_app_video_range >"$WORK_DIRECTORY/video-range.txt" 2>&1 ||
    fail 'video byte-range request failed'
}

run_backup_restore_cycle() {
  track_volume "$RESTIC_VOLUME"
  docker volume create \
    --label "mlp.image-gate.run=$RUN_ID" \
    "$RESTIC_VOLUME" >/dev/null 2>&1 ||
    fail 'Restic repository volume creation failed'

  track_volume "$RESTORE_VOLUME"
  docker volume create \
    --label "mlp.image-gate.run=$RUN_ID" \
    "$RESTORE_VOLUME" >/dev/null 2>&1 ||
    fail 'Restic restore volume creation failed'

  volume_setup_container="$RUN_ID-backup-volume-setup"
  track_container "$volume_setup_container"
  docker run \
    --name "$volume_setup_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --user 0:0 \
    --mount "type=volume,source=$RESTIC_VOLUME,target=/restic" \
    --mount "type=volume,source=$RESTORE_VOLUME,target=/restore" \
    --entrypoint /bin/sh \
    "$POSTGRES_IMAGE" -eu -c 'chown 10001:10001 /restic /restore' \
    >"$WORK_DIRECTORY/backup-volume-setup.txt" 2>&1 ||
    fail 'backup volume ownership setup failed'

  restic_init_container="$RUN_ID-restic-init"
  track_container "$restic_init_container"
  docker run \
    --name "$restic_init_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 10001:10001 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777 \
    --mount "type=volume,source=$RESTIC_VOLUME,target=/restic" \
    --mount "type=bind,source=$RESTIC_PASSWORD_FILE,target=/run/secrets/restic-password,readonly" \
    --mount "type=bind,source=$RESTIC_S3_ACCESS_KEY_ID_FILE,target=/run/secrets/restic-s3-access-key-id,readonly" \
    --mount "type=bind,source=$RESTIC_S3_SECRET_ACCESS_KEY_FILE,target=/run/secrets/restic-s3-secret-access-key,readonly" \
    --env RESTIC_CACHE_DIR=/tmp/restic-cache \
    --env RESTIC_PASSWORD_FILE=/run/secrets/restic-password \
    --env RESTIC_REPOSITORY=/restic \
    --env RESTIC_S3_ACCESS_KEY_ID_FILE=/run/secrets/restic-s3-access-key-id \
    --env RESTIC_S3_SECRET_ACCESS_KEY_FILE=/run/secrets/restic-s3-secret-access-key \
    --entrypoint /usr/local/bin/mlp-restic \
    "$BACKUP_IMAGE" init >"$WORK_DIRECTORY/restic-init.txt" 2>&1 ||
    fail 'Restic repository initialization failed'
  assert_container_hardening backup 10001:10001 "$restic_init_container"

  backup_container="$RUN_ID-backup"
  backup_json="$WORK_DIRECTORY/backup.json"
  track_container "$backup_container"
  docker run \
    --name "$backup_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 10001:10001 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777 \
    --mount "type=volume,source=$RESTIC_VOLUME,target=/restic" \
    --mount "type=bind,source=$BACKUP_PASSWORD_FILE,target=/run/secrets/postgres-password,readonly" \
    --mount "type=bind,source=$RESTIC_PASSWORD_FILE,target=/run/secrets/restic-password,readonly" \
    --mount "type=bind,source=$RESTIC_S3_ACCESS_KEY_ID_FILE,target=/run/secrets/restic-s3-access-key-id,readonly" \
    --mount "type=bind,source=$RESTIC_S3_SECRET_ACCESS_KEY_FILE,target=/run/secrets/restic-s3-secret-access-key,readonly" \
    --env PGDATABASE=imagegate_source \
    --env PGHOST=source-postgres \
    --env PGPASSWORD_FILE=/run/secrets/postgres-password \
    --env PGPORT=5432 \
    --env PGUSER=portfolio_backup \
    --env RESTIC_CACHE_DIR=/tmp/restic-cache \
    --env RESTIC_PASSWORD_FILE=/run/secrets/restic-password \
    --env RESTIC_REPOSITORY=/restic \
    --env RESTIC_S3_ACCESS_KEY_ID_FILE=/run/secrets/restic-s3-access-key-id \
    --env RESTIC_S3_SECRET_ACCESS_KEY_FILE=/run/secrets/restic-s3-secret-access-key \
    --entrypoint /usr/local/bin/mlp-backup \
    "$BACKUP_IMAGE" >"$backup_json" 2>"$WORK_DIRECTORY/backup-errors.txt" ||
    fail 'database backup execution failed'
  assert_container_hardening backup 10001:10001 "$backup_container"

  snapshot_file="$WORK_DIRECTORY/restic-snapshot-id.txt"
  jq --exit-status --raw-output \
    'select(.message_type == "summary") | .snapshot_id' \
    "$backup_json" >"$snapshot_file" 2>"$WORK_DIRECTORY/snapshot-parse-errors.txt" ||
    fail 'Restic snapshot summary validation failed'
  snapshot_lines=$(wc -l <"$snapshot_file" | awk '{ print $1 }')
  [ "$snapshot_lines" -eq 1 ] || fail 'Restic snapshot summary count mismatch'
  snapshot_id=$(sed -n '1p' "$snapshot_file")
  printf '%s\n' "$snapshot_id" | grep -Eq '^[0-9a-f]{64}$' ||
    fail 'Restic snapshot ID is not canonical'

  restic_restore_container="$RUN_ID-restic-restore"
  track_container "$restic_restore_container"
  docker run \
    --name "$restic_restore_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 10001:10001 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777 \
    --mount "type=volume,source=$RESTIC_VOLUME,target=/restic" \
    --mount "type=volume,source=$RESTORE_VOLUME,target=/restore" \
    --mount "type=bind,source=$RESTIC_PASSWORD_FILE,target=/run/secrets/restic-password,readonly" \
    --mount "type=bind,source=$RESTIC_S3_ACCESS_KEY_ID_FILE,target=/run/secrets/restic-s3-access-key-id,readonly" \
    --mount "type=bind,source=$RESTIC_S3_SECRET_ACCESS_KEY_FILE,target=/run/secrets/restic-s3-secret-access-key,readonly" \
    --env RESTIC_CACHE_DIR=/tmp/restic-cache \
    --env RESTIC_PASSWORD_FILE=/run/secrets/restic-password \
    --env RESTIC_REPOSITORY=/restic \
    --env RESTIC_S3_ACCESS_KEY_ID_FILE=/run/secrets/restic-s3-access-key-id \
    --env RESTIC_S3_SECRET_ACCESS_KEY_FILE=/run/secrets/restic-s3-secret-access-key \
    --entrypoint /usr/local/bin/mlp-restic \
    "$BACKUP_IMAGE" restore "$snapshot_id" --target /restore \
    >"$WORK_DIRECTORY/restic-restore.txt" 2>&1 ||
    fail 'Restic snapshot restore failed'
  assert_container_hardening backup 10001:10001 "$restic_restore_container"

  dump_locator_container="$RUN_ID-dump-locator"
  dump_paths="$WORK_DIRECTORY/restored-dump-paths.txt"
  track_container "$dump_locator_container"
  docker run \
    --name "$dump_locator_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 10001:10001 \
    --mount "type=volume,source=$RESTORE_VOLUME,target=/restore,readonly" \
    --entrypoint /bin/sh \
    "$BACKUP_IMAGE" -eu -c \
    'find /restore -type f -name postgresql.dump -print' \
    >"$dump_paths" 2>"$WORK_DIRECTORY/dump-locator-errors.txt" ||
    fail 'restored PostgreSQL dump discovery failed'
  assert_container_hardening backup 10001:10001 "$dump_locator_container"

  dump_path_count=$(wc -l <"$dump_paths" | awk '{ print $1 }')
  [ "$dump_path_count" -eq 1 ] || fail 'restored PostgreSQL dump count mismatch'
  restored_dump_path=$(sed -n '1p' "$dump_paths")
  case $restored_dump_path in
    /restore/*/postgresql.dump) ;;
    *) fail 'restored PostgreSQL dump path is invalid' ;;
  esac

  track_volume "$TARGET_DATABASE_VOLUME"
  docker volume create \
    --label "mlp.image-gate.run=$RUN_ID" \
    "$TARGET_DATABASE_VOLUME" >/dev/null 2>&1 ||
    fail 'target database volume creation failed'

  track_container "$TARGET_DATABASE_CONTAINER"
  docker run --detach \
    --name "$TARGET_DATABASE_CONTAINER" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --network-alias target-postgres \
    --mount "type=volume,source=$TARGET_DATABASE_VOLUME,target=/var/lib/postgresql" \
    --mount "type=bind,source=$POSTGRES_PASSWORD_FILE,target=/run/secrets/postgres-password,readonly" \
    --mount "type=bind,source=$MIGRATOR_PASSWORD_FILE,target=/run/secrets/postgres-migrator-password,readonly" \
    --mount "type=bind,source=$APP_PASSWORD_FILE,target=/run/secrets/postgres-app-password,readonly" \
    --mount "type=bind,source=$BACKUP_PASSWORD_FILE,target=/run/secrets/postgres-backup-password,readonly" \
    --env POSTGRES_DB=imagegate_restore \
    --env POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
    --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password \
    --env POSTGRES_USER=postgres \
    "$POSTGRES_IMAGE" >"$WORK_DIRECTORY/target-postgres-run.txt" 2>&1 ||
    fail 'target PostgreSQL start failed'
  wait_for_postgres "$TARGET_DATABASE_CONTAINER" imagegate_restore
  bootstrap_database_roles "$TARGET_DATABASE_CONTAINER" imagegate_restore

  pg_restore_container="$RUN_ID-pg-restore"
  track_container "$pg_restore_container"
  # shellcheck disable=SC2016
  docker run \
    --name "$pg_restore_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 10001:10001 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,mode=1777 \
    --mount "type=volume,source=$RESTORE_VOLUME,target=/restore,readonly" \
    --mount "type=bind,source=$POSTGRES_PASSWORD_FILE,target=/run/secrets/postgres-password,readonly" \
    --env PGPASSWORD_FILE=/run/secrets/postgres-password \
    --env "RESTORE_DUMP_PATH=$restored_dump_path" \
    --entrypoint /bin/sh \
    "$BACKUP_IMAGE" -eu -c \
    'PGPASSWORD=$(cat "$PGPASSWORD_FILE"); export PGPASSWORD; exec pg_restore --exit-on-error --host target-postgres --port 5432 --username postgres --dbname imagegate_restore "$RESTORE_DUMP_PATH"' \
    >"$WORK_DIRECTORY/pg-restore.txt" 2>&1 ||
    fail 'pg_restore execution failed'
  assert_container_hardening backup 10001:10001 "$pg_restore_container"
  verify_database_security_contract "$TARGET_DATABASE_CONTAINER" imagegate_restore

  restored_marker=$(docker exec --user postgres "$TARGET_DATABASE_CONTAINER" \
    psql --no-psqlrc --quiet --tuples-only --no-align --dbname imagegate_restore \
    --command "set role portfolio_app; select id from profile_sections where id = 'image-gate-restore-ok';" 2>/dev/null) ||
    fail 'restored database marker query failed'
  [ "$restored_marker" = image-gate-restore-ok ] ||
    fail 'restored database marker mismatch'
}

write_public_tree_manifest() {
  public_root=$1
  manifest_path=$2
  entry_list="$manifest_path.entries"

  [ -d "$public_root" ] || fail 'public tree root is missing'
  find "$public_root" -mindepth 1 -print | sort >"$entry_list" ||
    fail 'public tree enumeration failed'
  : >"$manifest_path"

  while IFS= read -r public_entry; do
    relative_entry=${public_entry#"$public_root"/}
    if [ -d "$public_entry" ]; then
      printf 'D %s\n' "$relative_entry" >>"$manifest_path"
    elif [ -f "$public_entry" ] && [ ! -L "$public_entry" ]; then
      entry_digest=$(sha256sum "$public_entry" | awk '{ print $1 }') ||
        fail 'public tree hashing failed'
      printf 'F %s %s\n' "$entry_digest" "$relative_entry" >>"$manifest_path"
    else
      fail 'unsupported public tree entry detected'
    fi
  done <"$entry_list"
}

assert_operator_rejected() {
  invocation_name=$1
  shift
  dispatcher_container="$RUN_ID-dispatcher-$invocation_name"
  dispatcher_output="$WORK_DIRECTORY/dispatcher-$invocation_name.txt"

  track_container "$dispatcher_container"
  set +e
  docker run \
    --name "$dispatcher_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 1000:1000 \
    --env MLP_IMAGE_GATE_SECRET_SENTINEL \
    "$MIGRATION_IMAGE" "$@" >"$dispatcher_output" 2>&1
  dispatcher_status=$?
  set -e

  assert_container_hardening migration 1000:1000 "$dispatcher_container"
  [ "$dispatcher_status" -eq 64 ] || fail 'operator dispatcher did not fail closed'
  expected_usage='usage: mlp-migration {export|rehearsal|preload|contacts|journal-recover|remove-synthetic UUID}'
  dispatcher_message=$(cat "$dispatcher_output")
  [ "$dispatcher_message" = "$expected_usage" ] ||
    fail 'operator dispatcher error was not generic'
  if grep -F "$MLP_IMAGE_GATE_SECRET_SENTINEL" "$dispatcher_output" >/dev/null 2>&1; then
    fail 'operator dispatcher leaked its sentinel'
  fi
}

verify_migration_operator() {
  operator_tools_container="$RUN_ID-operator-tools"
  track_container "$operator_tools_container"
  docker run \
    --name "$operator_tools_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 1000:1000 \
    --entrypoint /bin/sh \
    "$MIGRATION_IMAGE" -eu -c '
      operator_uid=$(id -u)
      [ "$operator_uid" -eq 1000 ]
      [ "$(command -v node)" = /usr/local/bin/node ]
      [ "$(node --version)" = v22.23.1 ]
      [ "$(command -v mongodump)" = /usr/local/bin/mongodump ]
      mongodump --version | grep -F "mongodump version: 100.17.0" >/dev/null
      [ "$(command -v age)" = /usr/local/bin/age ]
      age --version | grep -Fx v1.3.1 >/dev/null
    ' >"$WORK_DIRECTORY/operator-tools.txt" 2>&1 ||
    fail 'migration operator tool verification failed'
  assert_container_hardening migration 1000:1000 "$operator_tools_container"

  host_public_manifest="$WORK_DIRECTORY/host-public-tree.txt"
  image_public_manifest="$WORK_DIRECTORY/image-public-tree.txt"
  write_public_tree_manifest "$REPOSITORY_ROOT/public" "$host_public_manifest"
  write_public_tree_manifest \
    "$WORK_DIRECTORY/rootfs-migration/app/public" "$image_public_manifest"
  cmp -s "$host_public_manifest" "$image_public_manifest" ||
    fail 'migration operator public tree mismatch'

  mongodump_stub="$WORK_DIRECTORY/mongodump-stub"
  cat >"$mongodump_stub" <<'MONGODUMP_STUB'
#!/bin/sh
set -eu
if [ "$#" -eq 1 ] && [ "$1" = --version ]; then
  printf '%s\n' 'mongodump version: 100.17.0'
  exit 0
fi
[ "$#" -eq 5 ]
[ "$1" = --quiet ]
case $2 in
  --config=/fixtures/artifacts/.mongo-export.*/mongodump.yml) ;;
  *) exit 1 ;;
esac
[ "$3" = --db=image_gate ]
[ "$4" = --archive ]
[ "$5" = --gzip ]
config_path=${2#--config=}
[ -f "$config_path" ] && [ ! -L "$config_path" ]
[ "$(stat -c '%a' "$config_path")" = 600 ]
grep -Fx "uri: 'mongodb://127.0.0.1:1'" "$config_path" >/dev/null
printf '%s' 'deterministic-image-gate-mongo-archive'
MONGODUMP_STUB
  chmod 0555 "$mongodump_stub"

  node_target_stub="$WORK_DIRECTORY/node-target-stub"
  cat >"$node_target_stub" <<'NODE_TARGET_STUB'
#!/bin/sh
set -eu
[ "$#" -eq 1 ]
[ "$1" = "$EXPECTED_NODE_TARGET" ]
[ -f "$1" ]
[ ! -L "$1" ]
[ -r "$1" ]
printf '%s\n' "$1"
NODE_TARGET_STUB
  chmod 0555 "$node_target_stub"

  operator_age_identity="$WORK_DIRECTORY/operator-age-identity"
  if ! ssh-keygen -q -t ed25519 -N '' -C mlp-image-gate \
    -f "$operator_age_identity" \
    >"$WORK_DIRECTORY/operator-age-keygen.txt" 2>&1; then
    fail 'operator age identity generation failed'
  fi
  chmod 0444 "$operator_age_identity" "$operator_age_identity.pub"
  operator_age_recipient=$(awk '
    NR == 1 && $1 == "ssh-ed25519" { print $1 " " $2 }
  ' "$operator_age_identity.pub") ||
    fail 'operator age recipient extraction failed'
  case $operator_age_recipient in
    'ssh-ed25519 '*) ;;
    *) fail 'operator age recipient is invalid' ;;
  esac

  operator_export_verifier="$WORK_DIRECTORY/operator-export-verifier"
  cat >"$operator_export_verifier" <<'OPERATOR_EXPORT_VERIFIER'
#!/bin/sh
set -eu
: "${ARTIFACT_DIR:?}"
: "${AGE_IDENTITY_FILE:?}"
[ -f "$AGE_IDENTITY_FILE" ]
[ ! -L "$AGE_IDENTITY_FILE" ]
[ -r "$AGE_IDENTITY_FILE" ]
[ "$(stat -c '%a' "$AGE_IDENTITY_FILE")" = 400 ]
[ "$(stat -c '%u:%g' "$AGE_IDENTITY_FILE")" = 1000:1000 ]
set -- "$ARTIFACT_DIR"/mongo-final-*.archive.gz.age
[ "$#" -eq 1 ]
artifact=$1
[ -f "$artifact" ]
[ ! -L "$artifact" ]
[ -s "$artifact" ]
artifact_bytes=$(stat -c '%s' "$artifact")
[ "$artifact_bytes" -gt 200 ]
[ "$(stat -c '%a' "$artifact")" = 600 ]
[ "$(stat -c '%u:%g' "$artifact")" = 1000:1000 ]
[ "$(sed -n '1p' "$artifact")" = age-encryption.org/v1 ]
expected_digest_line=$(printf '%s' \
  'deterministic-image-gate-mongo-archive' | sha256sum)
expected_digest=${expected_digest_line%% *}
decrypted_digest_line=$(
  /bin/bash -o pipefail -c \
    'age --decrypt --identity "$1" "$2" | sha256sum' \
    operator-export-verifier "$AGE_IDENTITY_FILE" "$artifact"
) || exit 1
decrypted_digest=${decrypted_digest_line%% *}
[ "$decrypted_digest" = "$expected_digest" ]
! find "$ARTIFACT_DIR" -mindepth 1 -maxdepth 1 \
  -type d -name '.mongo-export.*' -print -quit | grep -q .
OPERATOR_EXPORT_VERIFIER
  chmod 0555 "$operator_export_verifier"

  operator_fixture_volume="$RUN_ID-operator-fixtures"
  track_volume "$operator_fixture_volume"
  docker volume create \
    --label "mlp.image-gate.run=$RUN_ID" \
    "$operator_fixture_volume" >/dev/null 2>&1 ||
    fail 'operator fixture volume creation failed'

  operator_identity_volume="$RUN_ID-operator-identity"
  track_volume "$operator_identity_volume"
  docker volume create \
    --label "mlp.image-gate.run=$RUN_ID" \
    "$operator_identity_volume" >/dev/null 2>&1 ||
    fail 'operator identity volume creation failed'

  operator_fixture_setup_container="$RUN_ID-operator-fixture-setup"
  track_container "$operator_fixture_setup_container"
  docker run \
    --name "$operator_fixture_setup_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network none \
    --read-only \
    --cap-drop ALL \
    --cap-add CHOWN \
    --security-opt no-new-privileges:true \
    --user 0:0 \
    --mount "type=volume,source=$operator_fixture_volume,target=/fixtures" \
    --mount "type=volume,source=$operator_identity_volume,target=/identity" \
    --mount "type=bind,source=$operator_age_identity,target=/source-age-identity,readonly" \
    --entrypoint /bin/sh \
    "$MIGRATION_IMAGE" -eu -c '
      mkdir -p /fixtures/artifacts
      printf "%s\n" "mongodb://127.0.0.1:1" >/fixtures/mongo-uri
      cat /source-age-identity >/identity/age-identity
      chmod 0400 /fixtures/mongo-uri
      chmod 0400 /identity/age-identity
      chmod 0700 /fixtures/artifacts
      chown -R 1000:1000 /fixtures /identity
    ' >"$WORK_DIRECTORY/operator-fixture-setup.txt" 2>&1 ||
    fail 'operator fixture setup failed'

  operator_export_container="$RUN_ID-operator-export"
  track_container "$operator_export_container"
  docker run \
    --name "$operator_export_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 1000:1000 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777 \
    --mount "type=volume,source=$operator_fixture_volume,target=/fixtures" \
    --mount "type=bind,source=$mongodump_stub,target=/usr/local/bin/mongodump,readonly" \
    --env "ARCHIVE_RECIPIENT=$operator_age_recipient" \
    --env ARTIFACT_DIR=/fixtures/artifacts \
    --env MONGO_DATABASE=image_gate \
    --env MONGO_URI_FILE=/fixtures/mongo-uri \
    "$MIGRATION_IMAGE" export \
    >"$WORK_DIRECTORY/operator-export.txt" 2>&1 ||
    fail 'operator export dispatcher smoke failed'
  assert_container_hardening migration 1000:1000 "$operator_export_container"

  operator_export_verifier_container="$RUN_ID-operator-export-verifier"
  track_container "$operator_export_verifier_container"
  docker run \
    --name "$operator_export_verifier_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 1000:1000 \
    --mount "type=volume,source=$operator_fixture_volume,target=/fixtures,readonly" \
    --mount "type=volume,source=$operator_identity_volume,target=/identity,readonly" \
    --mount "type=bind,source=$operator_export_verifier,target=/usr/local/bin/verify-operator-export,readonly" \
    --env AGE_IDENTITY_FILE=/identity/age-identity \
    --env ARTIFACT_DIR=/fixtures/artifacts \
    --entrypoint /usr/local/bin/verify-operator-export \
    "$MIGRATION_IMAGE" >"$WORK_DIRECTORY/operator-export-verifier.txt" 2>&1 ||
    fail 'operator encrypted export verification failed'
  assert_container_hardening \
    migration 1000:1000 "$operator_export_verifier_container"

  for dispatcher_command in rehearsal preload contacts; do
    case $dispatcher_command in
      rehearsal)
        expected_node_target=/app/scripts/migration/run-rehearsal.js
        ;;
      preload)
        expected_node_target=/app/scripts/migration/preload-content.js
        ;;
      contacts)
        expected_node_target=/app/scripts/migration/finalize-contacts.js
        ;;
    esac
    dispatcher_smoke_container="$RUN_ID-dispatcher-$dispatcher_command-smoke"
    dispatcher_smoke_output="$WORK_DIRECTORY/dispatcher-$dispatcher_command-smoke.txt"
    track_container "$dispatcher_smoke_container"
    docker run \
      --name "$dispatcher_smoke_container" \
      --label "mlp.image-gate.run=$RUN_ID" \
      --platform linux/amd64 \
      --network none \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges:true \
      --user 1000:1000 \
      --mount "type=bind,source=$node_target_stub,target=/usr/local/bin/node,readonly" \
      --env CONTACT_TRAFFIC_DRAINED=yes \
      --env "EXPECTED_NODE_TARGET=$expected_node_target" \
      "$MIGRATION_IMAGE" "$dispatcher_command" \
      >"$dispatcher_smoke_output" 2>&1 ||
      fail "operator dispatcher smoke failed: $dispatcher_command"
    assert_container_hardening \
      migration 1000:1000 "$dispatcher_smoke_container"
    dispatcher_target=$(cat "$dispatcher_smoke_output")
    [ "$dispatcher_target" = "$expected_node_target" ] ||
      fail "operator dispatcher target mismatch: $dispatcher_command"
  done

  synthetic_contact_id=00000000-0000-4000-8000-000000000001
  protected_contact_id=00000000-0000-4000-8000-000000000002
  if ! docker exec --interactive --user postgres "$SOURCE_DATABASE_CONTAINER" \
    psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname imagegate_source \
    >"$WORK_DIRECTORY/operator-synthetic-contact.txt" 2>&1 <<'SYNTHETIC_CONTACT_SQL'
set role portfolio_migrator;
insert into contact_messages (
  id, full_name, email, subject, message, created_at
) values (
  '00000000-0000-4000-8000-000000000001',
  'Image Gate', 'image-gate@example.invalid',
  'Synthetic image gate contact', 'remove me',
  '2026-07-15T00:00:00Z'
), (
  '00000000-0000-4000-8000-000000000002',
  'Protected Image Gate', 'protected-image-gate@example.invalid',
  'Protected contact', 'must survive',
  '2026-07-15T00:00:01Z'
);
reset role;
SYNTHETIC_CONTACT_SQL
  then
    fail 'synthetic contact fixture creation failed'
  fi

  remove_synthetic_container="$RUN_ID-remove-synthetic"
  track_container "$remove_synthetic_container"
  docker run \
    --name "$remove_synthetic_container" \
    --label "mlp.image-gate.run=$RUN_ID" \
    --platform linux/amd64 \
    --network "$NETWORK_NAME" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --user 1000:1000 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777 \
    --mount "type=bind,source=$MIGRATOR_PASSWORD_FILE,target=/run/secrets/postgres-password,readonly" \
    --env MONGO_DATABASE=must-be-unset \
    --env MONGO_URI_FILE=/must-be-unset \
    --env PGCONNECT_TIMEOUT_MS=5000 \
    --env PGDATABASE=imagegate_source \
    --env PGHOST=source-postgres \
    --env PGPASSWORD_FILE=/run/secrets/postgres-password \
    --env PGPOOL_MAX=2 \
    --env PGPORT=5432 \
    --env PGUSER=portfolio_migrator \
    "$MIGRATION_IMAGE" remove-synthetic "$synthetic_contact_id" \
    >"$WORK_DIRECTORY/operator-remove-synthetic.txt" 2>&1 ||
    fail 'operator remove-synthetic dispatcher smoke failed'
  assert_container_hardening migration 1000:1000 "$remove_synthetic_container"
  remove_synthetic_message=$(cat "$WORK_DIRECTORY/operator-remove-synthetic.txt")
  [ "$remove_synthetic_message" = 'synthetic contact removed' ] ||
    fail 'operator remove-synthetic response mismatch'
  protected_contact_state=$(docker exec --user postgres \
    "$SOURCE_DATABASE_CONTAINER" \
    psql --no-psqlrc --quiet --tuples-only --no-align \
    --dbname imagegate_source --command "
      select concat_ws('|',
        id, full_name, email, subject, message,
        (created_at = timestamptz '2026-07-15T00:00:01Z')::text
      )
      from contact_messages
      where id in ('$synthetic_contact_id', '$protected_contact_id')
      order by id;
    " 2>/dev/null) || fail 'synthetic contact removal verification failed'
  expected_protected_contact_state='00000000-0000-4000-8000-000000000002|Protected Image Gate|protected-image-gate@example.invalid|Protected contact|must survive|true'
  [ "$protected_contact_state" = "$expected_protected_contact_state" ] ||
    fail 'remove-synthetic contact isolation verification failed'

  assert_operator_rejected no-arguments
  assert_operator_rejected unknown-command shell
  assert_operator_rejected wrong-export-arity export extra
  assert_operator_rejected missing-remove-uuid remove-synthetic
  assert_operator_rejected extra-remove-argument \
    remove-synthetic 00000000-0000-4000-8000-000000000000 extra
}

for candidate_image in \
  "$APP_CANONICAL_IMAGE" \
  "$BACKUP_CANONICAL_IMAGE" \
  "$CADDY_CANONICAL_IMAGE" \
  "$MIGRATION_CANONICAL_IMAGE" \
  "$APP_IMAGE" \
  "$BACKUP_IMAGE" \
  "$CADDY_IMAGE" \
  "$MIGRATION_IMAGE"; do
  assert_image_tag_absent "$candidate_image"
done

image_matrix >"$WORK_DIRECTORY/image-matrix.txt"
while IFS='|' read -r image_name dockerfile expected_user image_tag; do
  image_reference="$image_tag:$STAGING_IMAGE_SUFFIX"
  build_image "$image_name" "$dockerfile" "$image_tag"
  assert_image_metadata "$image_name" "$expected_user" "$image_reference"
  assert_no_image_secrets "$image_name" "$image_reference"
  assert_runtime_hardening "$image_name" "$expected_user" "$image_reference"
done <"$WORK_DIRECTORY/image-matrix.txt"

verify_caddy_runtime
prepare_source_database
run_database_migrations
start_and_verify_app
run_backup_restore_cycle
verify_migration_operator

acquire_promotion_lock
promote_image "$APP_IMAGE" "$APP_CANONICAL_IMAGE"
promote_image "$BACKUP_IMAGE" "$BACKUP_CANONICAL_IMAGE"
promote_image "$CADDY_IMAGE" "$CADDY_CANONICAL_IMAGE"
promote_image "$MIGRATION_IMAGE" "$MIGRATION_CANONICAL_IMAGE"
verify_promoted_image "$APP_IMAGE" "$APP_CANONICAL_IMAGE"
verify_promoted_image "$BACKUP_IMAGE" "$BACKUP_CANONICAL_IMAGE"
verify_promoted_image "$CADDY_IMAGE" "$CADDY_CANONICAL_IMAGE"
verify_promoted_image "$MIGRATION_IMAGE" "$MIGRATION_CANONICAL_IMAGE"
SUCCESS=1
