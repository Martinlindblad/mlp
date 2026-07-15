# Production runtime configuration

These files are harmless examples for configuration validation only. Never use
their image digests, passwords, token, repository value, or backend keys in a
deployment.

Create the production tree as `/etc/mlp`; keep its directories `root:root` mode `0700`.
That includes persistent `/etc/mlp/compose-secrets` and
`/etc/mlp/docker-client`, so systemd services with `ProtectHome=true` never
depend on `/root`. Set every canonical environment and secret file to mode
`0600`. All paths must be regular, non-symlink files or directories. Each
canonical secret contains exactly one non-empty line ending in a newline. Each
environment record is one non-empty `KEY=value` line.

Keep interpolation namespaces separate: `APP_*`, `MIGRATOR_*`, and
`BACKUP_*`. Generate all eight secrets independently. The root-only wrapper
normalizes them into persistent, per-consumer bind sources. Those staged files
are owned by the exact container UID/GID with mode `0400`; containers receive
only their explicitly granted files under `/run/secrets`, never raw secret
environment values. The wrapper creates a missing staged file atomically but
refuses any later byte, owner, or mode mismatch before Compose runs. Secret
rotation therefore requires the reviewed maintenance procedure to replace the
complete affected set and recreate every consumer; never edit a staged bind
source in place.

Install the reviewed standalone Docker Compose release at
`/usr/local/libexec/mlp/docker-compose` as `root:root` mode `0755`. Store the
Docker client's production configuration below `/etc/mlp/docker-client`; do
not place registry credentials in this example tree.

`depends_on` sequences initial startup, but it does not restart dependents when
a dependency becomes unhealthy later. Task 10 adds monitoring and recovery for
that runtime condition.

The Restic provider, bucket, prefix, and region are not approved. Keep
`BACKUP_RESTIC_REPOSITORY` unconfigured until scoped list/get/put/delete
credentials exist and Task 10 proves a real encrypted off-VM backup and restore.
Passing static Compose validation is not backup acceptance.
