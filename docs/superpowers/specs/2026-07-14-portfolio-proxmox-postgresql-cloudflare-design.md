# Portfolio Self-Hosting Design

**Date:** 2026-07-14

**Status:** Approved for implementation planning

**Project:** `mlp` / `martin-lindblad.com`

## 1. Goal

Move the complete portfolio application from Vercel and MongoDB Atlas to one
Proxmox virtual machine. The VM will run the Next.js frontend and API,
PostgreSQL, Caddy, and redundant Cloudflare Tunnel connectors through Docker
Compose.

The finished system must have no runtime, DNS, deployment, or database
dependency on Vercel or MongoDB. Existing public URLs, rendered content, API
response shapes, and contact-form behavior must continue to work.

## 2. Scope

### Included

- One production environment; there is no permanent staging environment.
- A new Debian 13 KVM guest on the existing Proxmox host.
- Docker Compose for the application, database, internal reverse proxy,
  Cloudflare Tunnel connectors, database migrations, and backup jobs.
- Self-hosted Next.js Pages Router frontend and API routes.
- PostgreSQL 18.4 as the target database.
- Migration of every document from all ten active MongoDB collections.
- Transfer of authoritative DNS from Vercel DNS to Cloudflare DNS.
- Public ingress through Cloudflare Tunnel only.
- A temporary Cloudflare Access-protected migration hostname for external
  verification; it is removed after cutover.
- A maximum 30-minute final write-maintenance window.
- Removal of the Vercel project and the portfolio's MongoDB resources after
  acceptance criteria pass.

### Excluded

- A permanent staging environment.
- A separate database VM.
- Kubernetes, Swarm, or another container orchestrator.
- A standalone backend service; Next.js API routes remain the backend.
- An admin application or content-management system.
- Dual writes between MongoDB and PostgreSQL.
- Syncal-specific monorepo, deployment-controller, ETL, staging, or backup
  architecture.

## 3. Current-State Evidence

The repository is a single Next.js 13 Pages Router application. The frontend
and backend are not separate deployables: pages and API routes share one build
and one Node.js runtime.

The application currently uses the native MongoDB driver through
`lib/mongodb.ts`. It reads `NEXT_ATLAS_URI` and `NEXT_ATLAS_DATABASE`. The
current public site is served by Vercel, and `martin-lindblad.com` currently
uses Vercel's authoritative nameservers.

The active MongoDB collections used by the application are:

1. `about`
2. `current_occupation`
3. `hobbys`
4. `languages`
5. `page_cards`
6. `proffessional_timeline`
7. `projects_and_cases`
8. `pursuit`
9. `social_media`
10. `contact`

The only production write path found in the application is
`POST /api/contact/route`. The other routes are read-only. Dynamic case URLs
embed MongoDB ObjectId strings and therefore require stable legacy IDs.

The repository currently has no database migration framework, automated
tests, Docker files, Compose files, CI workflow, health endpoint, backup job,
or deployment manifest.

## 4. Locked Architecture

### 4.1 Virtual machine

The production VM has this baseline:

- Debian GNU/Linux 13.
- KVM virtualization.
- 4 vCPU.
- 4 GiB fixed RAM; memory ballooning is disabled.
- 40 GiB VirtIO SCSI disk with discard enabled.
- VirtIO network adapter on the existing private bridge.
- QEMU Guest Agent installed, enabled, and exposed to Proxmox.
- Automatic start after the Proxmox host, with a startup delay that allows
  host networking and storage to become ready.
- A DHCP reservation or static private address; the concrete address remains
  environment configuration and is not committed to Git.

This capacity is intentionally sized for one low-traffic portfolio, one Node
process, and one small PostgreSQL database. Image builds run in GitHub Actions,
not on the VM.

### 4.2 Compose services

The production Compose project is named `mlp-prod` and contains:

- `app`: the complete Next.js frontend and API.
- `postgres`: PostgreSQL 18.4 with persistent storage.
- `migrator`: a one-shot Kysely migration process using the same application
  image as `app`.
- `caddy`: the internal HTTP reverse proxy.
- `cloudflared-a` and `cloudflared-b`: two replicas connected to the same
  remotely managed production tunnel.
- `db-backup`: a one-shot PostgreSQL backup process invoked by the deployment
  wrapper, migration wrapper, or the root-owned nightly systemd timer.

All production images are pinned to immutable image digests. Mutable tags are
not accepted by the production deployment check.

The application image is a multi-stage Node 22 Debian-slim image. It uses
Next.js `output: "standalone"`, includes `public` and `.next/static`, runs as a
non-root user, and exposes port 3000 only to the Compose network.

### 4.3 Networks

Compose uses four purpose-specific networks:

- `tunnel`: `cloudflared-*` and Caddy.
- `web`: Caddy and `app`.
- `database`: `app`, `migrator`, `db-backup`, and PostgreSQL.
- `egress`: `cloudflared-*`, `app`, and `db-backup`.

The `tunnel`, `web`, and `database` networks are Docker-internal networks.
PostgreSQL, Caddy, and Next.js publish no host ports. The `egress` network has
no inbound exposure. The host firewall permits outbound DNS, NTP, HTTPS, and
Cloudflare Tunnel traffic; no service listens on that network. The application
keeps outbound HTTPS because existing content may ask Next.js image
optimization to retrieve a remote source. The backup job uses outbound HTTPS
for Restic storage.

The Proxmox host, VM, and router expose no new inbound ports for this project.
SSH administration is key-only over the existing protected management path,
not from the public internet. The Docker API is never exposed over TCP.

### 4.4 Request flow

Production requests follow this path:

`Browser -> Cloudflare -> Cloudflare Tunnel -> Caddy -> Next.js -> PostgreSQL`

Cloudflare terminates public TLS. `cloudflared` creates outbound-only
connections from the VM. Caddy listens on internal HTTP, accepts only the
production hostnames, redirects `www.martin-lindblad.com` to
`https://martin-lindblad.com` with status 308, and rejects unknown hostnames.

Caddy rejects production requests without `CF-Connecting-IP`, replaces
forwarded client-address headers with that trusted value, and sets
`X-Forwarded-Proto: https`. It enables zstd and gzip compression, limits the
contact request body to 32 KiB, uses a five-second upstream dial timeout and a
30-second response-header timeout, and sets `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and
`X-Frame-Options: DENY`. Cloudflare sets HSTS after TLS and routing checks pass.

## 5. Cloudflare and DNS Design

Cloudflare becomes authoritative DNS for `martin-lindblad.com` before the
application cutover. The DNS move and hosting move are separate operations.

The sequence is:

1. Create the zone in the Cloudflare account that owns the production tunnel.
2. Export and inventory every Vercel DNS record.
3. Recreate the full zone in Cloudflare, including verification and mail
   records if present at execution time.
4. Initially keep the application records pointed at Vercel and set them to
   DNS-only where proxying would alter current behavior.
5. Set the application-record TTL to 300 seconds at least 24 hours before
   cutover.
6. Change registrar nameservers to Cloudflare.
7. Verify DNS through multiple public resolvers while Vercel still serves the
   application.
8. Create one remotely managed production tunnel named `mlp-prod`.
9. Configure the temporary hostname `migration.martin-lindblad.com` to route
   to Caddy and protect it with Cloudflare Access for the operator identity.
10. After pre-cutover verification, route the apex and `www` hostnames to the
   production tunnel.
11. Remove the temporary hostname and its Access application after cutover.

Both `cloudflared` containers use the same root-only tunnel-token file. Two
replicas improve connector availability but do not make the single VM highly
available. Stopping the VM remains a full application outage.

## 6. Application Runtime Design

The frontend and API remain one Next.js application. No extra backend service
is introduced.

The production image contains:

- the Next.js standalone server;
- the `public` directory;
- `.next/static`;
- PostgreSQL runtime dependencies;
- Kysely migration files;
- production-only Node dependencies.

The app has these health routes:

- `GET /api/health/live`: returns 200 when the Node process can serve HTTP.
- `GET /api/health/ready`: runs a bounded `SELECT 1`, verifies the expected
  Kysely migration version, and returns 200 only when the database is ready.

Readiness returns 503 with a generic response when PostgreSQL is unavailable
or the schema version is wrong. It never exposes a connection string, SQL
error, hostname, stack trace, or secret.

The Docker health check calls readiness. Compose starts `app` only after
PostgreSQL is healthy and the fresh `migrator` container exits successfully.
Every service uses `restart: unless-stopped` except the one-shot migrator and
backup jobs.

The single Next.js instance owns its ISR cache, which is appropriate for this
single-VM design. The existing five-second case-page revalidation behavior is
preserved unless tests show that an explicit cache invalidation is required.

## 7. PostgreSQL Design

### 7.1 Libraries and roles

The application uses Kysely and `pg`. Versioned SQL migrations are stored in
the repository and are the only supported way to change the production
schema. Zod validates data at the MongoDB migration boundary and validates the
nested JSON stored for project details.

PostgreSQL uses distinct roles:

- `portfolio_migrator`: owns application schema objects and runs migrations.
- `portfolio_app`: has only the DML privileges required by the running app.
- `portfolio_backup`: has read access needed for logical backups.

Role passwords are separate, high-entropy secrets. The running application
does not receive migrator or backup credentials.

### 7.2 Table mapping

| MongoDB collection | PostgreSQL table |
| --- | --- |
| `about` | `profile_sections` |
| `current_occupation` | `current_occupations` |
| `hobbys` | `hobbies` |
| `languages` | `languages` |
| `page_cards` | `page_cards` |
| `proffessional_timeline` | `professional_timeline` |
| `projects_and_cases` | `projects` |
| `pursuit` | `pursuits` |
| `social_media` | `social_links` |
| `contact` | `contact_messages` |

The internal table names correct legacy spelling mistakes. Public API route
names and JSON property names do not change.

### 7.3 Core columns

Every imported row has `id text primary key`. Existing 24-character MongoDB
ObjectId strings are preserved exactly. New contact rows use
`crypto.randomUUID()` serialized as text. API adapters map `id` back to `_id`
where existing clients expect `_id`.

The tables contain these domain columns:

- `profile_sections`: `id`, `key`, `title`, `info`, `name`, `surname`,
  `description text[]`, `image_source`, `link`, `link_text`, `profile_image`.
- `current_occupations`: `id`, `occupation_type`, `description`, `from_label`,
  `to_label`, `introduction`, `name`, `link`.
- `hobbies`: `id`, `title`, `content`, `type`.
- `languages`: `id`, `name`, `spoken`, `written`.
- `page_cards`: `id`, `title`, `description`, `link`, `content`, `key`, `type`.
- `professional_timeline`: `id`, `company`, `institution`, `qualification`,
  `duration`, `title`, `description`, `sort_index`.
- `projects`: `id`, `title`, `description`, `image_source`, `from_label`,
  `to_label`, `project_details jsonb`.
- `pursuits`: `id`, `title`, `description`, `left_image_source`,
  `right_image_source`.
- `social_links`: `id`, `name`, `link`.
- `contact_messages`: `id`, `full_name`, `email`, `subject`, `message`,
  `created_at timestamptz`.

Columns that are optional in the current TypeScript contracts are nullable.
All other domain columns are non-null. The `profile_sections.key` and
`professional_timeline.sort_index` columns are indexed. Case IDs remain the
public case identifiers.

The nested `project_details` object remains JSON because it is one content
aggregate, is fetched as a whole, and is never joined or filtered by nested
properties. A strict Zod schema preserves its current fields and rejects
unknown migration input. PostgreSQL receives no generic raw-Mongo catch-all
column.

### 7.4 Compatibility behavior

Repository functions replace direct collection access. Existing route paths,
HTTP success statuses, list limits, response property casing, and serialized
date format remain stable.

The implementation corrects two existing defects while preserving intended
behavior:

- the introduction query filters `key = 'introduction'` instead of relying on
  an unordered `limit(1)`;
- the contact schema consistently uses `fullName` at the API boundary and
  `full_name` in PostgreSQL, eliminating the current `fullname`/`fullName`
  validator mismatch.

All API routes catch database timeouts and return a generic 503. Validation
errors return 400, unsupported contact methods return 405, and successful
contact inserts return 201 as they do today.

## 8. Data Migration Design

### 8.1 Rules

- Every document in all ten source collections has an explicit destination.
- Existing IDs are immutable.
- BSON dates become PostgreSQL `timestamptz` values without losing the instant.
- Human-readable `from`, `to`, and `duration` values remain text; the migration
  does not guess calendar semantics.
- Unknown source fields, duplicate IDs, invalid required values, malformed
  project details, or unparseable dates fail the migration.
- Failed rows are reported by collection, ID, and reason without logging PII.
- No source document is silently dropped or coerced.
- No production dual-write period exists.

### 8.2 Migration artifacts

The migration tooling produces:

- an encrypted, compressed `mongodump` archive of the source database;
- a machine-readable source inventory with collection counts and sorted IDs;
- a migration report with per-table counts, sorted IDs, and canonical hashes;
- a validation report comparing source and destination;
- a smoke-test report for the public application.

Artifacts containing source data or contact PII are never committed. They are
root-readable during migration and then moved into the encrypted off-VM backup
repository. Reports committed to Git contain counts and hashes only.

### 8.3 Rehearsal

At least one complete rehearsal runs before cutover:

1. Connect to Atlas with a temporary read-only migration user.
2. Inventory collection options, validators, indexes, counts, document keys,
   BSON types, and IDs.
3. Create the encrypted source archive.
4. Create an empty rehearsal PostgreSQL database.
5. Apply all Kysely migrations.
6. Run the strict transformer and importer in one database transaction.
7. Compare counts, sorted IDs, and canonical document/row hashes.
8. Run repository integration tests and application smoke tests.
9. Destroy the rehearsal database only after its report is saved.

The strict source-key inventory is compared with the mapper's allowed-key set.
Any source field not covered by the approved mapping blocks cutover and is
added explicitly to the schema or migration mapping before another rehearsal.

### 8.4 Final migration

The final write-maintenance window is at most 30 minutes. The only application
writer is the contact endpoint, so content can be preloaded before the window.

1. Record source counts, IDs, and the latest contact ID/date.
2. Import all read-only content collections into production PostgreSQL and
   validate them while Vercel continues serving production.
3. Route traffic through the tunnel with Caddy returning 503 plus
   `Retry-After` only for `POST /api/contact/route`; page and read-API traffic
   uses the new application.
4. Wait one complete 300-second TTL and confirm that the Vercel request count
   has stopped before taking the final contact snapshot.
5. Export the final `contact` snapshot and import missing contacts in one
   transaction.
6. Compare final source and destination contact IDs, counts, timestamps, and
   canonical hashes.
7. Exercise a synthetic contact submission in PostgreSQL and remove the
   synthetic row after verification.
8. Enable the production contact endpoint.

If any validation fails, the contact endpoint remains in maintenance mode,
the PostgreSQL import transaction rolls back, and the DNS record returns to
the verified Vercel origin. No MongoDB document is modified or deleted by the
migration.

## 9. Build and Deployment Design

GitHub Actions is the build authority. On pushes and pull requests it runs:

- dependency installation from the lockfile;
- formatting, ESLint, and TypeScript checks;
- unit and integration tests;
- PostgreSQL migration tests against a disposable PostgreSQL 18 container;
- a production Next.js build;
- container configuration checks.

A manual production workflow builds the application image, records SBOM and
provenance, pushes it to GHCR under the commit SHA, and exposes the immutable
digest as a workflow artifact. It does not change production automatically.

The VM has a root-owned deployment script. The script accepts an exact image
digest and Git commit, rejects a dirty or mismatched infrastructure checkout,
takes a pre-deploy database backup, pulls the image, recreates a fresh migrator
container, waits for its successful exit, replaces the app container, and
waits for readiness. A failed readiness check restores the previous app image.
Database migrations must be backward-compatible with the previous image for
this rollback path.

Runtime configuration is stored under `/etc/mlp/`:

- `/etc/mlp/env/app.env`
- `/etc/mlp/env/migrator.env`
- `/etc/mlp/env/backup.env`
- `/etc/mlp/secrets/postgres-app-password`
- `/etc/mlp/secrets/postgres-migrator-password`
- `/etc/mlp/secrets/postgres-backup-password`
- `/etc/mlp/secrets/cloudflare-tunnel-token`
- `/etc/mlp/secrets/restic-password`

Directories are root-owned mode `0700`; secret and environment files are
root-owned mode `0600`. Example files in Git contain variable names and safe
dummy values only.

## 10. Backup and Restore Design

The PostgreSQL volume is persistent but is not itself a backup.

The `db-backup` job creates a PostgreSQL custom-format logical backup, verifies
that `pg_restore --list` can read it, and stores it in an encrypted Restic
repository located outside the VM and outside its Proxmox disk. The repository
URL and credentials are root-only runtime configuration.

A root-owned `mlp-db-backup.timer` systemd timer invokes the fixed backup
wrapper every day at 02:17 UTC. The normal SSH user cannot edit the unit,
wrapper, Compose file, or backup environment.

Backup policy:

- one scheduled backup every night;
- one required backup immediately before every production deployment and
  database migration;
- retain 30 daily snapshots;
- run Restic integrity checking after pruning;
- perform a monthly restore into an isolated disposable PostgreSQL container;
- verify schema version, table counts, and representative queries after the
  restore.

Cutover is blocked until the off-VM repository accepts a backup and a test
restore succeeds. A Proxmox VM backup is additional defense and does not
replace the database-level backup.

## 11. Security and Operations

- No app, database, Caddy, Docker, or SSH port is newly exposed publicly.
- Cloudflare Tunnel is the only application ingress.
- The tunnel token and database credentials are not environment values in the
  Compose file and are never committed.
- Containers run without privileged mode and drop unnecessary capabilities.
- The app runs as a non-root user.
- PostgreSQL accepts connections only from its internal Compose network and
  uses SCRAM password authentication.
- Caddy allows only the apex, `www`, and temporary migration hostname.
- Contact payload size is limited to 32 KiB at Caddy and in the API.
- Application logs exclude request bodies, email addresses, messages,
  connection strings, and secrets.
- Docker uses bounded JSON logs with `max-size: 10m` and `max-file: 5`.
- Debian unattended security upgrades are enabled; reboots remain deliberate.
- Cloudflare, PostgreSQL, Caddy, `cloudflared`, Node, and base images are pinned
  and upgraded through reviewed pull requests.

## 12. Testing and Acceptance

### 12.1 Automated tests

The implementation adds:

- unit tests for Mongo-to-PostgreSQL field mapping and strict unknown-field
  rejection;
- unit tests for API compatibility serialization;
- repository integration tests against disposable PostgreSQL 18;
- migration tests for a second, idempotent run;
- contact validation and method tests;
- health/readiness tests;
- Playwright smoke tests for every public route and one representative case
  page;
- tests that verify all referenced local static assets with exact Linux
  filename casing;
- service-worker installation tests that fail on missing precache assets;
- Compose and Caddy configuration validation.

### 12.2 Production acceptance criteria

Cutover is successful only when all of these are true:

- The apex and `www` resolve through Cloudflare and have valid TLS.
- `www` redirects to the apex with 308 and preserves the path and query.
- The VM exposes no public origin ports for the application or PostgreSQL.
- Both tunnel connectors are healthy; stopping either one keeps the site
  available.
- Every public page returns the expected status and content.
- Every API route returns the existing JSON shape and success status.
- Existing case URLs retain their exact 24-character IDs and return 200.
- All static images, video range requests, manifest assets, and the service
  worker work on Linux.
- Source and PostgreSQL counts, IDs, timestamps, and canonical hashes match for
  all ten collections.
- The contact endpoint rejects invalid input, accepts one synthetic valid
  submission with 201, persists it in PostgreSQL, and no longer touches MongoDB.
- Readiness fails when PostgreSQL is unavailable and recovers when it returns.
- A fresh off-VM backup and isolated restore both succeed.
- Application and proxy logs contain no unexpected errors or PII during a
  minimum 24-hour observation period.

## 13. Decommission and Rollback

Vercel and MongoDB remain untouched during rehearsals. They are decommissioned
only after every production acceptance criterion, including the 24-hour
observation and restore test, passes.

Decommission order:

1. Save the final encrypted MongoDB archive and validation report off-VM.
2. Remove `NEXT_ATLAS_URI` and `NEXT_ATLAS_DATABASE` from all runtime
   configuration.
3. Remove `lib/mongodb.ts`, the MongoDB package, MongoDB global types, and the
   one-time live connector from the application repository.
4. Build, deploy, and verify the PostgreSQL-only image.
5. Remove the portfolio database user, network access, and database from Atlas.
6. Delete the Atlas cluster/project only if the inventory proves it is
   dedicated exclusively to this portfolio; shared Atlas resources are not
   touched beyond the portfolio database and user.
7. Remove the custom domain and environment variables from Vercel.
8. Delete the Vercel project after confirming Cloudflare still resolves and
   serves production.
9. Revoke and delete obsolete Vercel and Atlas credentials.

Before PostgreSQL accepts the first new contact write, rollback consists of
pointing Cloudflare application records back to Vercel and discarding the
failed PostgreSQL import. After PostgreSQL accepts production writes, rollback
to stale MongoDB is forbidden; recovery uses the PostgreSQL backup or a forward
fix so new contact messages are not lost.

The encrypted final MongoDB archive is retained with the 30-day backup policy,
then deleted after its retention expires and a PostgreSQL restore has passed.

## 14. Execution Prerequisites and Hard Gates

Implementation work may begin locally after this design and its implementation
plan are approved. Remote provisioning and cutover are blocked until all of
these access paths work:

- authenticated administrative access to the Proxmox host;
- key-based SSH to the new VM through the protected management path;
- Cloudflare zone, Tunnel, Access, and DNS administration;
- registrar access for the nameserver change;
- Vercel project access for DNS inventory and final removal;
- MongoDB Atlas read/export access and authority to remove only the portfolio
  resources;
- GitHub Actions and GHCR package permissions;
- a tested Restic repository outside the VM.

The current read-only investigation confirmed the Proxmox service but did not
obtain administrative authentication. It also found no MongoDB connection
values in the working copy. These are access prerequisites, not reasons to
weaken migration verification.

## 15. References

- [Cloudflare Tunnel documentation](https://developers.cloudflare.com/tunnel/)
- [Cloudflare Tunnel DNS routing](https://developers.cloudflare.com/tunnel/routing/)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [PostgreSQL 18.4 documentation](https://www.postgresql.org/docs/18/)
- [Next.js 13 standalone output](https://nextjs.org/docs/13/pages/api-reference/next-config-js/output)
- [Next.js self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting)
