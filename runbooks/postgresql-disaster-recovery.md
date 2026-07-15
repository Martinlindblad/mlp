# PostgreSQL backup, restore drill, and disaster recovery

This runbook covers the root-operated PostgreSQL logical backup and the
isolated restore proof for the MLP VM. The restore drill is a verification
tool, not authorization to overwrite the production database. A production
recovery requires an incident record, a reviewed replacement target, and a
second operator approving the selected snapshot and traffic switch.

## Safety invariants

- Keep the current PostgreSQL volume and all failed-restore evidence intact.
- Select one explicit 64-character lowercase hexadecimal snapshot ID from the
  root-only successful-backup report. Never use a floating snapshot alias.
- Never perform repository lock recovery automatically. Escalate a repository
  lock or integrity failure for manual review.
- Restore the custom-format dump as the bootstrap `postgres` role. Do not strip
  object ownership or ACLs from the dump.
- The drill must remain on its random internal Docker network with no published
  ports. Only resources carrying both this run's operation label and run ID may
  be cleaned up.
- Do not delete VM, database, container, network, volume, or source-origin data
  as part of diagnosis. Destructive cleanup is a later, separately approved
  change.
- Before the PostgreSQL write commit point, the documented cutover rollback may
  return traffic to the still-current origin. After that point, stale MongoDB
  is not a recovery target; recover PostgreSQL or apply a forward fix.

## Verify the scheduled backup

The nightly timer calls the fixed root wrapper. An operator may also start one
backup explicitly:

```sh
sudo /usr/local/sbin/mlp-backup
sudo systemctl status mlp-db-backup.service --no-pager
```

The operation succeeds only after the dump is readable by `pg_restore`, the
off-VM Restic snapshot is complete, retention has run, and repository checking
has passed. Restic host and tag are fixed to `mlp-prod` and
`mlp-postgresql`. The dump contains neither cluster globals nor role password
hashes.

Inspect the redacted reports without copying secret files or journal content:

```sh
sudo jq -e '
  type == "object"
  and ((keys | sort) == ["completedAt","snapshotId","startedAt","status"])
  and .status == "passed"
  and (.snapshotId | test("^[0-9a-f]{64}$"))
' /var/lib/mlp/backup-reports/latest-success.json

sudo jq -e '.status == "passed" or .status == "failed"' \
  /var/lib/mlp/backup-reports/last-attempt.json
```

A failed attempt updates only `last-attempt.json`. It must not replace
`latest-success.json`. Treat a missing, stale, abbreviated, or malformed
snapshot ID as no usable recovery point.

## Run the isolated restore proof

Run the fixed drill wrapper and inspect its systemd result:

```sh
sudo /usr/local/sbin/mlp-restore-test
sudo systemctl status mlp-db-restore-test.service --no-pager
```

The wrapper reads the exact snapshot ID from
`/var/lib/mlp/backup-reports/latest-success.json`, restores it through the
image's `mlp-restic` helper, and starts digest-pinned PostgreSQL 18.4 on an
internal network. It creates passwordless disposable copies of
`portfolio_migrator`, `portfolio_app`, and `portfolio_backup`; production role
credentials are never copied into the drill database.

Success requires all of the following:

- all ten application tables and both Kysely migration tables exist;
- all twelve tables are owned by `portfolio_migrator`;
- the latest migration is `002_runtime_grants`;
- database CONNECT/TEMP, schema, and complete table ACL privilege matrix match
  the production security model, with no grant options for runtime roles;
- all nine content tables are populated;
- representative reads work as `portfolio_app` and `portfolio_backup`;
- a representative contact insert works as `portfolio_app` and is rolled back;
- the labeled test container, network, and volume are proven absent before the
  plaintext work directory is deleted.

Verify the atomic root-only success report:

```sh
sudo jq -e '
  type == "object"
  and .status == "passed"
  and (.snapshotId | test("^[0-9a-f]{64}$"))
  and .migration == "002_runtime_grants"
  and .counts.applicationTables == 10
  and .counts.ownedTables == 12
  and .counts.populatedContentTables == 9
  and (.counts.contentRows >= 0)
  and (.counts.contactMessages >= 0)
' /var/lib/mlp/restore-reports/latest-success.json
```

The report at
`/var/lib/mlp/restore-reports/latest-success.json` contains only timestamps,
the snapshot ID, migration, status, and aggregate counts. It is the acceptance
artifact for the monthly restore gate.

## Failure and evidence handling

If the drill exits nonzero, do not infer that cleanup completed. Record the
service start/end timestamps and preserve the generic error output. Inspect
the root-only directory names and modes without reading dump contents into a
ticket:

```sh
sudo find /var/lib/mlp/restore-work -mindepth 1 -maxdepth 1 \
  -type d -printf '%f %u:%g %m\n'
sudo systemctl status mlp-db-restore-test.service --no-pager
```

When absence of every labeled Docker resource cannot be proven, the wrapper
retains and secures `/var/lib/mlp/restore-work/<run-id>` as root-only evidence.
Preserve that directory until an operator has matched resource labels, Docker
events, and service timestamps to the same run ID. Never remove an unlabeled or
mismatched resource, and never erase retained plaintext merely to make the next
timer invocation appear successful.

Repository authentication, database passwords, source rows, contact fields,
and dump paths must not be copied into reports, chat, tickets, or command-line
arguments. Escalate suspected credential exposure and rotate the affected
credential through the secret-file procedure.

## Controlled production recovery

1. Declare the incident, identify whether the PostgreSQL write commit point has
   passed, and put VM contact writes into maintenance when the platform is able
   to serve that state.
2. Preserve the VM and current PostgreSQL storage as evidence. Record the
   current application digest, migration, backup report, and incident time.
3. Run the isolated restore proof for the proposed full snapshot ID. Stop if
   ownership, ACL, counts, representative queries, or cleanup proof fails.
4. Provision a separate reviewed PostgreSQL replacement target. Recreate the
   three production roles through the approved secret-file bootstrap, restore
   as `postgres`, and repeat the same ownership and privilege-matrix checks.
5. Compare required application counts and migration state, then have a second
   operator approve the replacement. Do not expose the replacement publicly.
6. Switch the application to the replacement through a reviewed deployment,
   wait for all five permanent service health checks, and run public read and
   contact acceptance checks.
7. Take a new off-VM backup and run another isolated restore. Preserve the old
   database until the incident review and retention decision are complete.

If no snapshot passes the isolated proof, keep contact writes disabled and
escalate. Do not improvise an in-place destructive repair or silently weaken
owner/ACL validation.
