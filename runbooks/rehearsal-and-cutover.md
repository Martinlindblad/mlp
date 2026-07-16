# Portfolio Migration Rehearsal and Cutover

This is the operator checklist for moving `martin-lindblad.com` from
Vercel/MongoDB Atlas to the self-hosted PostgreSQL platform. It is a procedure,
not evidence that a cutover has happened. Copy it into a root-readable,
timestamped incident record and attach only redacted counts, IDs, hashes,
timestamps, and command results. Never commit source data, contact values,
credentials, Cloudflare record payloads, or raw logs.

Use two operators: one executes and one reads every gate and stop condition.
Record all times in UTC. Mark a gate passed only after its evidence has been
copied to the encrypted off-VM repository and independently hash-verified.

## Operator record

Create a fresh record for each attempt; never reuse evidence from a failed
attempt.

```text
CUTOVER_ID=<YYYYMMDDTHHMMSSZ>
OPERATOR=
REVIEWER=
APP_IMAGE=
APP_CADDY_IMAGE=
BACKUP_IMAGE=
MIGRATION_IMAGE=
GIT_COMMIT=
REHEARSAL_STARTED_AT=
REHEARSAL_COMPLETED_AT=
CUTOVER_STARTED_AT=
CUTOVER_COMPLETED_AT=
```

The four image references must be the reviewed `@sha256:` publication
artifacts for the same commit. The operator record contains no tokens,
passwords, connection strings, email addresses, messages, or source contact
values. Work below a root-owned `0700` evidence directory with `umask 077`;
files are regular, non-symlink files mode `0600`.

## Non-negotiable stop conditions

- Use a temporary Atlas user with read-only access scoped only to the `mlp_db` database.
  There are no source writes, deletes, or schema changes.
- `MONGO_URI_FILE` is a root-readable regular file, never a command-line value.
- MongoDB Database Tools is exactly 100.17.0. `age` and the database tools stay
  outside the production application image.
- The cutover stops on an unknown field, malformed nested value, duplicate ID,
  invalid required value, date parse failure, missing Linux asset, or any
  count, ID, timestamp, or canonical-hash mismatch.
- PII or a secret in a report or log blocks cutover. Delete the unsafe derived
  report after retaining only encrypted evidence needed for diagnosis, fix the
  producer, and repeat the complete rehearsal.
- Cloudflare authority must be continuously proven for at least 172800 seconds
  while Vercel still serves the application, and TTL 300 must be proven active
  for at least 86400 seconds before the switch.
- Contact maintenance may last at most 1800 seconds. No gate is waived to meet
  the clock.
- Live use requires the reviewed `finalizeContactSnapshot()` build. It imports
  and performs all count/ID/timestamp/hash validation inside one serializable,
  rollback-capable transaction and is covered by the PostgreSQL 18.4 integration
  test. If final contact import and all verification are not inside the same
  rollback-capable transaction, cutover completion must not be declared. A
  verified in-transaction mismatch throws before commit and is a known rollback
  of inserted rows. If the test or its evidence is absent, do not proceed to
  Gate 14.
- A nonzero CLI exit alone does not prove rollback. A report-write failure or
  cleanup failure after finalization is a known post-commit failure: contacts
  remain committed even when complete reports are absent. A COMMIT transport
  failure is commit-unknown and therefore ambiguous. Partial success reports are
  not success evidence.
- For a known post-commit failure or ambiguous Gate 13 outcome, keep contact
  maintenance enabled and never delete contacts. Re-run the complete finalizer;
  only its idempotent full-destination verification and both newly completed
  reports establish state.

## Runtime command boundary

On the production VM use only the installed, root-owned wrappers:

```text
/usr/local/sbin/mlp-migration export
/usr/local/sbin/mlp-migration rehearsal
/usr/local/sbin/mlp-migration preload
/usr/local/sbin/mlp-migration contacts
/usr/local/sbin/mlp-migration remove-synthetic <exact-uuid>
/usr/local/sbin/mlp-backup
/usr/local/sbin/mlp-restore-test
/usr/local/sbin/mlp-contact-mode maintenance
/usr/local/sbin/mlp-contact-mode enabled
```

Do not use Compose overrides, mutable image tags, raw secret environment
values, an exposed Docker socket, or a production application image for the
one-time MongoDB tooling. The rehearsal runs against a disposable PostgreSQL
18.4 database; production wrappers are used later for preload and finalization.
Rehearsal and content preload each run import and complete verification in one
serializable transaction. Any verification mismatch rolls back all newly
inserted rows. Redacted report writing begins only after the verified database
commit. A report-write failure requires an idempotent rerun and does not claim a
database rollback; the already verified commit remains authoritative.

## Pre-write rollback branch

This branch is available only before the first successful public
PostgreSQL-backed contact response. Prepare it before Gate 1 and rehearse it
without changing production DNS:

1. Save the exact prior apex and `www` Cloudflare record JSON as separate
   root-readable files. Validate that each document identifies the expected
   zone, record name, type, Vercel value, proxy state, and TTL.
2. Keep the new Caddy contact endpoint in maintenance.
3. If any DNS, TLS, routing, page/API, connector, Vercel-drain, comparison, or
   timing check fails before contact writes are enabled, restore the two saved
   record documents to their verified Vercel values.
4. From an independent client, verify that Vercel again serves pages and that
   Vercel contact writes succeed. Do not infer recovery from DNS alone.
5. Treat only an independently verified in-transaction mismatch as a known
   rollback. Retain its redacted validation failure evidence.
6. If finalization returned and a report write or target cleanup then failed,
   treat contacts as committed. Keep contact maintenance enabled, never delete
   contacts, and re-run the complete finalizer to produce both complete reports.
7. Treat a COMMIT transport failure or any other commit-unknown result as
   ambiguous. Use the same no-delete recovery and require the rerun's idempotent
   full-destination verification to establish state. Partial success reports are
   not success evidence.
8. If a later pre-write gate fails after Gate 13 succeeded, leave the verified
   PostgreSQL rows intact; restore Vercel routing and let the next attempt
   re-verify those rows idempotently. Never perform a partial compensating delete.
9. End the window without modifying or deleting Atlas. Retain redacted failure
   evidence and open a new cutover record only after the defect is fixed.

The saved Cloudflare documents are rollback inputs, not repository artifacts.
Never print them or pass their contents through shell arguments.

## Ordered gates

Every gate records `started_at`, `completed_at`, `status`, operator, reviewer,
and SHA-256 evidence hashes. Execute the headings below in numeric order.

### Gate 1: Encrypted source archive

On the trusted migration operator environment, install MongoDB Database Tools
100.17.0 and `age`. Require `mongodump --version` to report 100.17.0 exactly.
Set the source database name to `mlp_db`, the root-readable `MONGO_URI_FILE`, a
recoverable age recipient, and a fresh root-only artifact directory. Then run
the repository export script or the installed equivalent:

```bash
umask 077
export MONGO_URI_FILE=/etc/mlp/secrets/mongo-readonly-uri
export MONGO_DATABASE=mlp_db
export ARTIFACT_DIR=/var/lib/mlp/migration-artifacts/operator/source
export ARCHIVE_RECIPIENT="$(cat /etc/mlp/age-archive-recipient)"
scripts/migration/export-mongo.sh
# Production-VM equivalent after its immutable operator image is reviewed:
sudo /usr/local/sbin/mlp-migration export
```

Record the encrypted archive filename, size, mode, SHA-256 hash, database-tools
version, and age version. Do not decrypt it on the production VM. Prove the
temporary Atlas user has no write roles and record its revocation owner.

### Gate 2: Source inventory

Run the strict inventory through the rehearsal CLI. It must cover exactly these
ten collections: `about`, `current_occupation`, `hobbys`, `languages`,
`page_cards`, `proffessional_timeline`, `projects_and_cases`, `pursuit`,
`social_media`, and `contact`.

The machine-readable source inventory records only collection counts, sorted
24-character IDs, known keys/BSON types, index metadata, and validator hashes.
Compare the source-key inventory with the mapper's allowed-key set. Any
uncovered field blocks the attempt; add an explicit schema/mapping/test and
repeat from Gate 1. Inventory and snapshot are separate reads, so this report
does not replace the final drained contact capture.

### Gate 3: Strict full rehearsal

Create a new empty `portfolio_rehearsal` database on disposable PostgreSQL
18.4. Point only the migration operator and test processes at it. Apply all
Kysely migrations twice and require the second run to be idempotent. Then run:

```bash
yarn migration:rehearsal
# Installed immutable operator equivalent:
sudo /usr/local/sbin/mlp-migration rehearsal
```

The run must strictly parse and import all ten collections in one transaction.
Compare source and destination counts, sorted IDs, timestamps, and canonical
hashes. Require all booleans in the validation report to be true. Run the
repository integration tests against `portfolio_rehearsal`, then seed/run the
application and execute Playwright against that database. Verify every legacy
case ID and every referenced Linux-cased static asset.

An invalid row or mismatch fails the transaction and the entire rehearsal.
Do not hand-edit the destination or a report.

### Gate 4: Off-VM backup and isolated restore

Copy the encrypted archive and redacted reports to the approved encrypted
off-VM repository. Verify their hashes at that independent destination. Take a
logical backup, verify its custom-format catalog, and perform an isolated
PostgreSQL restore with the reviewed tooling. On the VM the fixed commands are:

```bash
sudo /usr/local/sbin/mlp-backup
sudo /usr/local/sbin/mlp-restore-test
```

Require `/var/lib/mlp/backup-reports/latest-success.json` and
`/var/lib/mlp/restore-reports/latest-success.json` to be root-owned mode
`0600`, status `passed`, and tied to the exact same 64-character snapshot ID.
Only after a second operator verifies the off-VM hashes and redacted reports
may the operator drop `portfolio_rehearsal` and revoke its credentials.

### Gate 5: 48-hour DNS authority proof

Leave apex and `www` pointed at Vercel. Run Task 13's authority gate against
the saved two-name-server file. `scripts/acceptance/dns-authority.sh` owns the
fixed `/var/lib/mlp/cloudflare-authority-start` state path; callers cannot
override it. Require Cloudflare NS/SOA at 1.1.1.1, 8.8.8.8, and 9.9.9.9, a
complete cloned zone, and continuous Vercel service during the hold.

```bash
sudo EXPECTED_NS_FILE=/etc/mlp/cloudflare-nameservers \
  ORIGIN_EXPECTATIONS_FILE=/etc/mlp/vercel-origin-records.tsv \
  INVENTORY_REPORT_FILE=/var/lib/mlp/dns-inventory-comparison.json \
  scripts/acceptance/dns-authority.sh martin-lindblad.com
```

Record `dns_authority_seconds >= 172800`. Exit 75 means the hold is incomplete,
not passed. Exit 0 and the exact output
`authority stable for at least 172800 seconds` are required. Any resolver, SOA,
origin, or inventory mismatch removes the state file; after the mismatch is
corrected, begin a new 172800-second hold.

### Gate 6: 24-hour TTL-300 proof

Record the API responses and independent authoritative answers that establish
apex and `www` TTL exactly 300 while both still target Vercel. Record the first
continuous-success epoch in the root-only operator record. At the gate,
require `ttl_300_seconds >= 86400`; a later record edit or TTL change resets
the clock.

### Gate 7: Migration-host checks

The Access-protected migration hostname must reach the reviewed production
digest through Caddy and PostgreSQL while public apex/`www` remain on Vercel.
Run Task 13's tunnel health gate with its root-readable Access credentials:

```bash
sudo scripts/acceptance/tunnel-health.sh
```

Through an authenticated browser, exercise every public page, read API, and
legacy case ID. Stop PostgreSQL once; require migration-host readiness 503 with
no connection detail or stack trace, restart PostgreSQL, and require automatic
recovery to 200. Verify images, a 206 video range response, manifest icons,
service-worker assets, two-connector failover, and no host port exposure. Run
the two connector stops serially and restore one healthy connector before
stopping the other.

### Gate 8: Content preload and hash match

Install the four reviewed digest-qualified image references. Bootstrap the
empty production volume once: start PostgreSQL, run a fresh migrator, start
app/Caddy/connectors, require every health check, and take the first backup.
All later releases use `mlp-deploy`.

With Vercel still public, run:

```bash
sudo /usr/local/sbin/mlp-backup
sudo /usr/local/sbin/mlp-migration preload
```

Require reports for exactly the nine read-only collections. Destination
counts, sorted IDs, source order, and canonical hashes must match their source
reports. Repeat Gate 7 after preload. Preserve the verified report paths as
`CONTENT_MIGRATION_REPORT` and `CONTENT_VALIDATION_REPORT` in the operator
record.

### Gate 9: Enable contact maintenance

Immediately before changing the contact path, start the hard clock:

```bash
CUTOVER_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CUTOVER_STARTED_AT_EPOCH="$(date -u +%s)"
sudo /usr/local/sbin/mlp-contact-mode maintenance
```

Re-check authority `>= 172800`, TTL-300 `>= 86400`, both connector health,
fresh backup status, available disk/memory, reviewed image digests, and the
prepared rollback files. At every later pre-write gate compute elapsed seconds
from `CUTOVER_STARTED_AT_EPOCH`. Abort before contact writes are enabled when
the projected or actual window would exceed 1800 seconds. The final record
must prove `maintenance_window_seconds <= 1800`.

Require pages and read APIs to remain 200 while only the contact POST returns
503 with `Retry-After: 300`. A GET or any unrelated route returning maintenance
is a stop condition.

### Gate 10: Switch apex and `www` to the tunnel

Read `/var/lib/mlp/cloudflare-tunnel.json` without printing it. Validate the
saved response and derive the record target only after this succeeds:

```bash
jq -er '.name == "mlp-prod" and (.id | test("^[0-9a-f-]{36}$"))' \
  /var/lib/mlp/cloudflare-tunnel.json >/dev/null
tunnel_target="$(jq -r '.id' /var/lib/mlp/cloudflare-tunnel.json).cfargotunnel.com"
```

Change only the apex and `www` application records to proxied CNAMEs targeting
that exact value. Save and hash the Cloudflare responses. Do not change mail,
verification, migration-host, Access, or nameserver records.

### Gate 11: Wait one 300-second TTL

Wait a complete 300 seconds measured by monotonic operator timestamps. During
the wait, verify apex and `www` TLS, the path/query-preserving 308, public page
and read API status, connector health, and contact-only maintenance. Do not
begin the traffic-drain observation early.

### Gate 12: Confirm Vercel traffic has stopped

After Gate 11, observe Vercel analytics/request logs for another complete five
minutes. Require no new portfolio requests. Record the time range and redacted
zero count; do not copy raw request logs. If any request appears, restart this
gate's five-minute clock. Before a PostgreSQL-backed public contact 201, any
failure follows the pre-write rollback branch.

### Gate 13: Final contact transaction and hash match

Capture the final Atlas contact snapshot only after Vercel traffic has drained.
Keep contact maintenance active and run:

```bash
sudo /usr/local/sbin/mlp-migration contacts
```

The approved build must import only missing contacts and compare the complete
source/destination contact set inside one rollback-capable transaction. Require
exact count, sorted IDs, ISO timestamps, and canonical hash match. Proceed only
after a zero exit and both complete redacted final migration and validation
reports. A verified in-transaction mismatch is a known rollback and leaves
maintenance enabled. A report-write or cleanup failure after finalization is a
known post-commit failure, so the contacts remain committed. A COMMIT transport
failure is commit-unknown and ambiguous. In either case, keep maintenance enabled,
never delete contacts, and re-run the complete finalizer. Its idempotent
full-destination verification and two new complete reports must establish state;
partial success reports are not success evidence.

### Gate 14: Internal synthetic insert and delete

While public contact remains in maintenance, generate a unique non-PII subject.
From inside the app container, submit directly to the local app API and require 201. Query through the migrator role by that exact subject, require one UUID,
verify the row, and remove exactly that UUID:

```bash
synthetic_subject="migration-internal-$(date -u +%Y%m%dT%H%M%SZ)"
sudo /usr/local/sbin/mlp-compose exec -T -e \
  SYNTHETIC_SUBJECT="$synthetic_subject" app node -e '
fetch("http://127.0.0.1:3000/api/contact/route",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fullName:"Migration Test",email:"migration-test@example.invalid",subject:process.env.SYNTHETIC_SUBJECT,message:"Synthetic cutover verification"})}).then(async response=>{if(response.status!==201)throw new Error(`status ${response.status}`)})'
synthetic_id="$(sudo /usr/local/sbin/mlp-compose exec -T postgres sh -ec 'PGPASSWORD="$(cat /run/secrets/postgres-migrator-password)" psql -At -U portfolio_migrator -d portfolio -v subject="$1" -c "select id from contact_messages where subject = :'\''subject'\''"' sh "$synthetic_subject")"
[[ "$synthetic_id" =~ ^[0-9a-f-]{36}$ ]]
sudo /usr/local/sbin/mlp-migration remove-synthetic "$synthetic_id"
```

Require exactly one row before deletion and zero afterward. Do not use a
24-character legacy MongoDB ID. This internal test is not the public write
commit point.

### Gate 15: Enable contact writes

Recompute elapsed time and require enough margin to execute Gate 16 before
1800 seconds. Then run:

```bash
sudo /usr/local/sbin/mlp-contact-mode enabled
```

Verify the contact POST no longer has the maintenance response and all other
public smoke checks remain healthy. Do not restore DNS merely because contact
writes are now enabled; Gate 16 creates the one-way boundary.

### Gate 16: Public synthetic insert and delete — PostgreSQL write commit point

Generate a new unique subject. Submit one valid synthetic contact through the
public apex, require 201, and immediately record:

```bash
POSTGRESQL_WRITE_COMMIT_POINT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

The successful public 201 is the boundary even if a later verification fails.
Query PostgreSQL through the migrator role, require exactly one UUID for the
subject, inspect only the expected synthetic row, and remove exactly that UUID
with `/usr/local/sbin/mlp-migration remove-synthetic`. Re-query to require zero
rows. Using the temporary read-only Atlas path, re-run the final Atlas contact
count and unique-subject lookup; require the count unchanged and no matching
subject. Store only the count and boolean result.

Compute `maintenance_window_seconds` from `CUTOVER_STARTED_AT_EPOCH` to the
successful public 201 timestamp and require it to be `<= 1800`.

## Post-commit recovery boundary

After the successful public write, rollback to stale MongoDB/Vercel is forbidden.
Keep DNS on the tunnel. Any subsequent failure uses a PostgreSQL restore or a forward fix
so the newly accepted contact cannot be lost. Preserve
the database and evidence; do not re-run a source snapshot as an authoritative
replacement for PostgreSQL.

### Gate 17: Enable HSTS

Verify valid public Cloudflare TLS at apex and `www`, exact path/query
preservation on the `www` 308, both connectors, and no origin ports. Then use a
reviewed Cloudflare change to enable HSTS with `max-age=63072000`. Keep preload
disabled and do not include broader subdomains without a complete HTTPS DNS
inventory.

```bash
curl -fsSI https://martin-lindblad.com | tr -d '\r' | \
  grep -i '^strict-transport-security:.*max-age=63072000'
scripts/acceptance/production-smoke.sh
```

### Gate 18: 24-hour acceptance observation

Immediately take and restore-test a fresh off-VM backup:

```bash
sudo /usr/local/sbin/mlp-backup
sudo /usr/local/sbin/mlp-restore-test
```

For at least 24 hours after the recorded public-write boundary, collect one
redacted observation each hour. Every observation runs:

```bash
scripts/acceptance/production-smoke.sh
sudo scripts/acceptance/tunnel-health.sh
sudo /usr/local/sbin/mlp-status
sudo scripts/acceptance/log-redaction.sh --since 1h
```

The final aggregate also runs
`scripts/acceptance/log-redaction.sh --since 24h`, verifies all legacy case IDs
from the redacted `projects_and_cases` ID report, and proves the nine content
comparisons plus final contact comparison cover all ten collections with no
mismatch. Review app, Caddy, both connectors, PostgreSQL readiness, restart
counts, disk, memory, last backup status, and isolated-restore status. Raw logs
never enter the operator record.

Require at least 86400 seconds from the public-write boundary to the final
successful observation. Any unexpected error, PII match, failed backup,
restore failure, connector loss, route failure, or data mismatch fails
acceptance and uses the post-commit recovery boundary.

## Final acceptance record

The reviewer signs only a redacted record containing these exact results:

```text
dns_authority_seconds >= 172800
maintenance_window_seconds <= 1800
source_destination_collections = 10
source_destination_mismatches = 0
tunnel_connectors_healthy = 2
backup = passed
isolated_restore = passed
observation_seconds >= 86400
unexpected_errors = 0
pii_log_matches = 0
```

Record exact image digests, Git commit, report hashes, backup snapshot ID,
restore-report hash, first/last observation timestamps, and two operator
sign-offs. Task 15 decommissioning remains forbidden until this record passes
and the encrypted final MongoDB archive is independently present off-VM.
