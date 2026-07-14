# Production runtime configuration

These files are harmless examples for configuration validation only. Never use
their image digests, passwords, token, repository value, or backend keys in a
deployment.

Create the production tree as `/etc/mlp`; keep its directories `root:root` mode `0700`.
Set every environment and secret file to mode `0600`. All paths must be regular,
non-symlink files or directories. Each secret contains exactly one non-empty
line ending in a newline. Each environment record is one non-empty
`KEY=value` line.

Keep interpolation namespaces separate: `APP_*`, `MIGRATOR_*`, and
`BACKUP_*`. Generate all eight secrets independently. The root-only wrapper
loads them as short-lived Compose secret sources; containers receive only
mode-`0400` files under `/run/secrets`, never raw secret environment values.

`depends_on` sequences initial startup, but it does not restart dependents when
a dependency becomes unhealthy later. Task 10 adds monitoring and recovery for
that runtime condition.

The Restic provider, bucket, prefix, and region are not approved. Keep
`BACKUP_RESTIC_REPOSITORY` unconfigured until scoped list/get/put/delete
credentials exist and Task 10 proves a real encrypted off-VM backup and restore.
Passing static Compose validation is not backup acceptance.
