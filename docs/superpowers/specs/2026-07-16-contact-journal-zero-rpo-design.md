# Contact Journal Zero-RPO Design

**Date:** 2026-07-16

**Status:** Architecture approved; written specification pending user review

**Project:** `mlp` / `martin-lindblad.com`

## 1. Decision

New production contact messages will use a synchronous, encrypted Cloudflare
R2 journal in addition to PostgreSQL. PostgreSQL remains the application's
primary database. R2 is the durable off-VM recovery journal for the only
production write path, `POST /api/contact/route`.

Each logical submission uses two immutable R2 objects:

1. an encrypted intent containing the exact canonical contact row; and
2. a non-PII acceptance marker bound cryptographically to that intent.

The API may return HTTP 201 only after the intent is verified, PostgreSQL has
inserted or exactly matched the row, and the acceptance marker is verified.
Recovery automatically replays only intents with valid acceptance markers.

This document amends the contact-write, post-write recovery, backup evidence,
and cutover acceptance sections of
`2026-07-14-portfolio-proxmox-postgresql-cloudflare-design.md`. The earlier
design remains authoritative for every other part of the migration.

## 2. Problem and Required Guarantee

The existing design takes nightly logical PostgreSQL backups and retains 30
daily Restic snapshots. A contact accepted after the latest snapshot can
therefore be lost if the PostgreSQL volume or VM fails before the next backup.
The existing recovery proof compares aggregate counts, not the exact set of
contacts accepted after the production write commit point.

The new design provides this guarantee:

> Every contact that reaches the R2 acceptance-marker state is recoverable
> with its exact ID, normalized fields, and original timestamp after loss of
> the VM or PostgreSQL volume.

An intent without a valid acceptance marker is not accepted and is never
replayed automatically. A network failure can prevent the browser from seeing
the final HTTP 201 after acceptance; a stable idempotency key makes that
ambiguous outcome safe to retry.

The guarantee assumes that the R2 bucket, its locked objects, and the offline
recovery keys remain available. It does not claim that an operator can recover
data after deliberately removing the bucket lock, deleting the journal, and
destroying every escrowed recovery key.

## 3. Scope

### Included

- First-party contact-form idempotency.
- A dedicated private Cloudflare R2 journal bucket in the EU jurisdiction.
- Client-side authenticated encryption before journal data leaves the VM.
- A prepare/project/accept state machine spanning R2 and PostgreSQL.
- A least-privilege PostgreSQL function for atomic insert-or-exact-match.
- Exact journal replay and reconciliation after a PostgreSQL restore.
- Redacted backup, recovery, and cutover evidence.
- Fault-injection, privilege, encryption, retry, and live R2 acceptance tests.
- Preservation of the exact seven-service production Compose topology.

### Excluded

- Replacing PostgreSQL with R2 as the primary contact database.
- A PostgreSQL replica, WAL archive, or general point-in-time recovery system.
- Journaling the nine read-only content collections.
- A new permanent service, worker, queue, sidecar, or admin UI.
- Automatic contact-retention or data-erasure workflows. No lifecycle deletion
  is enabled by this change.
- Reusing the Restic bucket, Restic credentials, or MongoDB export key.

## 4. Locked Architecture

The permanent Compose project remains exactly:

- `app`
- `postgres`
- `migrator`
- `caddy`
- `cloudflared-a`
- `cloudflared-b`
- `db-backup`

The existing `app` service writes the journal because it already owns the
contact API and already has outbound HTTPS through the `egress` network.
Recovery runs as a bounded, root-operated one-shot command using an immutable
operator image. It is not an eighth production service.

The contact write path becomes:

`Browser -> Cloudflare -> Tunnel -> Caddy -> Next.js -> R2 intent -> PostgreSQL -> R2 acceptance marker -> HTTP 201`

Read routes and static pages do not depend on R2. An R2 failure makes contact
writes unavailable but must not make the portfolio's read paths unhealthy.

## 5. R2 Resource Design

### 5.1 Bucket

Create one bucket named exactly `mlp-contact-journal` with:

- jurisdiction: `eu`;
- storage class: Standard;
- public access: disabled;
- custom domains: none;
- CORS rules: none;
- lifecycle rules: none at initial deployment;
- bucket lock: enabled for prefix `v1/` with a minimum age of 60 days.

The 60-day lock exceeds the 30-daily-snapshot Restic window and leaves margin
for detection, incident response, and restore testing. Objects remain after
the lock expires because no lifecycle deletion exists. Any later lifecycle or
retention policy requires a separate reviewed design and legal/privacy
approval.

The journal bucket is separate from the future
`mlp-postgres-backups` bucket. Cloudflare R2 object credentials can be scoped
to a bucket but not to the narrower intent or marker prefixes; sharing a bucket
would unnecessarily expose Restic objects to the application credential.

Bucket-lock configuration credentials never enter the VM. Runtime credentials
cannot edit bucket configuration. Removing or weakening the lock requires two
operators, a recorded change, and a reread of the effective rule. The design
recognizes that an R2 bucket lock is removable by an authorized configuration
administrator and is not irreversible compliance-mode WORM storage.

### 5.2 Credentials

Use three independent access paths:

1. **Application writer:** bucket-scoped R2 Object Read & Write credentials for
   `mlp-contact-journal`, mounted only into `app`.
2. **Recovery reader:** bucket-scoped R2 Object Read-only credentials, issued
   or supplied only for a controlled recovery or drill.
3. **Bucket administrator:** permission to create the bucket and manage lock
   configuration, kept off the VM.

The application credential is broader than the logical PUT/GET requirement
because R2 exposes Object Read & Write as one permission. The bucket lock is
therefore a required defense against overwrite and deletion. The application
must never call delete, copy, multipart upload, lifecycle, or bucket-management
operations.

The EU S3 endpoint is exactly:

`https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`

The S3 region value is `auto`. The account ID, endpoint, bucket name, and
active key ID are non-secret configuration. Access key material is secret-file
configuration.

## 6. Cryptographic Design

### 6.1 Canonical plaintext

The API validates and trims fields with the existing Zod rules, then constructs
one canonical UTF-8 JSON document with this exact field order:

1. `schema`
2. `id`
3. `fullName`
4. `email`
5. `subject`
6. `message`
7. `createdAt`

`schema` is exactly `mlp.contact.v1`. The ID is a canonical lowercase
UUID. `createdAt` is UTC in JavaScript `Date.toISOString()` format with
exactly millisecond precision. Strings use the validated, trimmed values and
are not case-folded or Unicode-normalized beyond the application's existing
behavior. Serialization contains no insignificant whitespace.

### 6.2 Encryption and authentication

The application image contains the checksum-pinned `age` 1.3.1 binary already
reviewed for the migration operator. It encrypts the canonical plaintext to a
dedicated age recipient. The application receives only the public recipient;
the private age identity remains in separately backed-up operator custody
outside the VM.

The application also computes HMAC-SHA-256 with a dedicated 32-byte random
journal MAC key. Each HMAC input begins with a distinct fixed ASCII domain
label and a zero byte, so plaintext, envelope, and receipt authentication
cannot be confused across protocols:

- `mlp.contact.plaintext.v1` for the canonical plaintext;
- `mlp.contact.intent-envelope.v1` for the intent envelope;
- `mlp.contact.acceptance-receipt.v1` for the acceptance marker.

MAC values are encoded as unpadded base64url. The MAC key is unrelated to
PostgreSQL, Restic, Cloudflare Tunnel, MongoDB export, and age keys.

Every key generation has a short non-secret `keyId`. The key ID selects both
the age recipient and the journal MAC key version. Recovery retains every age
identity and MAC key needed by objects still in the bucket. Rotation keeps the
previous verification keys available to the application for at least the
60-day pending-retry horizon and to recovery for the full journal-retention
horizon.

The age process receives plaintext through standard input and returns
ciphertext through standard output. It uses no plaintext temporary file.
Subprocess input, output, runtime, and exit status are bounded. Neither stderr
nor plaintext is copied to application logs.

R2 also encrypts objects at rest and uses TLS in transit, but those provider
controls do not replace client-side encryption.

## 7. Object Formats

Object keys contain only a random UUID:

- `v1/intents/<uuid>.json`
- `v1/accepted/<uuid>.json`

No name, email, subject, timestamp, or payload hash appears in an object key or
R2 metadata.

### 7.1 Intent envelope

The intent object is a strict JSON object with exactly:

- `schema`: `mlp.contact-intent.v1`
- `id`: canonical lowercase UUID
- `createdAt`: the canonical row timestamp
- `keyId`: encryption/MAC key generation
- `mac`: HMAC of the canonical plaintext
- `ciphertextSha256`: lowercase SHA-256 of the age ciphertext bytes
- `ciphertext`: base64 of the age ciphertext bytes
- `envelopeMac`: HMAC over every preceding envelope field in its fixed order

The intent is written with `If-None-Match: *`. It is never overwritten.
Its encoded size must not exceed 64 KiB.

### 7.2 Acceptance marker

The acceptance marker contains no contact fields. It is a strict JSON object
with exactly:

- `schema`: `mlp.contact-accepted.v1`
- `id`
- `intentSchema`
- `keyId`
- `mac`
- `ciphertextSha256`
- `envelopeMac`
- `acceptedAt`: UTC timestamp with millisecond precision
- `receiptMac`: HMAC over all preceding marker fields in their fixed order

The marker is also written with `If-None-Match: *` and is never overwritten.
It proves which immutable intent is eligible for automatic recovery. Its
encoded size must not exceed 4 KiB.

R2 ETags are transport evidence only. Correctness uses the authenticated
canonical fields, `mac`, `ciphertextSha256`, `envelopeMac`, and
`receiptMac`; it never assumes an ETag is a plaintext or ciphertext content
hash.

## 8. Idempotency Contract

The first-party browser generates one lowercase UUID with
`crypto.randomUUID()` for one logical form submission and sends it as
`Idempotency-Key`.

The browser:

- disables concurrent submission while a request is in flight;
- retains the same key after an HTTP 503, timeout, disconnect, or invalid JSON
  response;
- reuses the key only while the normalized form payload is unchanged;
- generates a new key after the user edits the payload following a failed
  attempt;
- clears the key only after a confirmed success.

For backward compatibility, the API accepts a missing header and generates a
server UUID. It returns the effective key in an `Idempotency-Key` response
header. A client that omits the header can still receive a zero-RPO accepted
write, but cannot prevent a duplicate after a completely lost response. All
first-party, synthetic, and cutover callers must send the header.

A malformed key returns the existing generic validation response with HTTP 400.
Reusing one key with a different normalized payload returns HTTP 409 with
exactly `{"errorMessage":"Unable to send message.","success":false}`.
Reusing one key with the same payload is an idempotent retry and returns the
same HTTP 201 success body after all durable state is verified.

## 9. PostgreSQL Design

Add migration `003_contact_journal`.

It adds nullable journal metadata to `contact_messages`:

- `journal_schema`
- `journal_key_id`
- `journal_mac`

Legacy MongoDB contacts have all three columns null. New journal-backed rows
must have all three values present. Check constraints enforce the schema
literal, bounded key ID, and canonical MAC encoding.

The migration creates a hardened
`ensure_journal_contact(...)` security-definer function owned by
`portfolio_migrator`. It:

1. validates the journal schema, UUID, key ID, MAC, and timestamp;
2. locks the matching contact row when one exists;
3. inserts the exact row and journal metadata when absent;
4. compares every stored field, timestamp, and journal value when present;
5. returns only `inserted` or `matched`;
6. raises a generic conflict on any difference.

The function has a fixed safe search path and fully qualifies application
objects. Execute is revoked from `PUBLIC` and granted only to
`portfolio_app`. Migration 003 revokes the application's direct INSERT
privilege on `contact_messages`, so a production write cannot bypass the
journal protocol. The application still has no direct SELECT, UPDATE, or
DELETE privilege on contact rows. The migrator and backup roles retain only
their previously reviewed responsibilities.

The function is the database idempotency boundary. It must be covered by real
PostgreSQL 18.4 concurrency and privilege tests, not only mocked repository
tests.

## 10. Contact Acceptance State Machine

The valid states for one idempotency key are:

- **ABSENT:** no intent, no journal-backed PostgreSQL row, no marker.
- **PREPARED:** valid immutable intent only.
- **PROJECTED:** valid intent plus an exact PostgreSQL row, but no marker.
- **ACCEPTED:** valid intent, exact PostgreSQL row, and valid marker.
- **RESTORE_GAP:** valid intent and marker, but the row is missing after
  restoring an older PostgreSQL snapshot.
- **CONFLICT:** corrupt, missing, mismatched, or unverifiable state.

Only ACCEPTED may produce HTTP 201. RESTORE_GAP is accepted durable state and
is repaired before traffic is re-enabled. PREPARED and PROJECTED are
unconfirmed attempts and are not replayed automatically.

### 10.1 Request sequence

1. Validate method, body, size, and effective idempotency key.
2. Canonicalize the payload.
3. Establish the intent:
   - attempt conditional PUT;
   - on HTTP 412, GET and authenticate the existing envelope;
   - on an ambiguous timeout, GET the same key before deciding;
   - reuse the stored `createdAt` for a matching retry;
   - return 409 on a payload mismatch;
   - return 503 without touching PostgreSQL if no valid intent is proven.
4. Call `ensure_journal_contact` with the exact intent values.
5. Establish the acceptance marker with another conditional PUT.
6. On HTTP 412 or an ambiguous marker timeout, GET and authenticate the
   existing marker.
7. Return the existing HTTP 201 success JSON only after the exact marker is
   proven.

All age, R2, and PostgreSQL work is bounded by a 20-second end-to-end contact
deadline, below Caddy's 30-second response-header timeout. Individual R2
operations have a three-second deadline; PostgreSQL work uses the application's
bounded acquisition and statement deadlines. There is no unbounded retry loop.

### 10.2 Crash outcomes

- Before intent success: ABSENT or an ambiguous PREPARED state; no 201.
- After intent and before PostgreSQL commit: PREPARED; safe retry.
- After PostgreSQL commit and before marker: PROJECTED; safe retry.
- After marker success and before the browser receives 201: ACCEPTED; retry
  verifies the same state and returns 201 without creating a duplicate.
- After restoring a snapshot older than an accepted contact: RESTORE_GAP;
  controlled recovery restores the exact row.
- Existing object, row, or marker with different authenticated values:
  CONFLICT; fail closed and alert without overwriting anything.

Concurrent identical requests converge on one intent, one exact row, and one
marker. Concurrent requests with different payloads under one key produce one
winner and one generic conflict.

HTTP cannot prove that a browser received a response after the server emitted
it. Therefore an R2 marker can represent accepted state even when the browser
observed a disconnect. The stable key is the mechanism for resolving that
ambiguity safely.

## 11. Error Handling and Observability

The existing normal response bodies remain:

- 201: `Message sent successfully`
- 400: validation failure
- 405: method not allowed
- 503: generic unavailability

HTTP 409 is added only for reuse of one idempotency key with a different
normalized payload. No response identifies whether R2, age, PostgreSQL, or a
specific state transition failed.

The application never logs:

- contact fields or request bodies;
- UUIDs, object keys, object URLs, envelopes, ciphertext, MACs, or hashes;
- R2 account IDs, endpoints, access keys, secret keys, or authorization data;
- age recipients, identities, or MAC-key material;
- PostgreSQL errors containing values.

Generic metrics distinguish intent failure, database projection failure,
marker failure, conflict, and success without labels derived from a request.
The existing log-redaction and image-secret scanners expand to cover R2/AWS
credential names, object URLs, journal envelopes, and ciphertext sentinels.

R2 is deliberately not part of the global readiness route. A journal outage
returns 503 for contact POST while pages and read APIs remain available.

## 12. Runtime Configuration and Secret Custody

The `app` service receives non-secret journal configuration in
`app.env` and exactly three new per-consumer secret sources:

- journal R2 access-key ID;
- journal R2 secret access key;
- one journal MAC-keyring file.

The age recipient is public configuration. The keyring is one compact,
single-line, strict JSON object mapping bounded key IDs to base64 values; each
value must decode to exactly 32 bytes and the active key ID must exist exactly
once. Unknown fields, duplicate keys, invalid encodings, and an empty keyring
are rejected. Secret files remain root-controlled in the canonical tree and
are staged as UID/GID 1000 mode `0400` only for the app consumer. The Compose
wrapper's exact allowlists, staged-file inventory, configuration verifier,
examples, and tests must all expand deliberately.

The recovery age identity, recovery R2 credential, and bucket-admin credential
are never mounted into the permanent Compose project and are never stored in
the application image. Recovery material is supplied to an incident-only
one-shot process from off-VM operator custody, mounted read-only into tmpfs,
and removed after cleanup is proven.

Keys are backed up independently of:

- the VM and Proxmox disk;
- PostgreSQL and Restic;
- the R2 bucket;
- Cloudflare access credentials;
- the Git repository.

Losing any required recovery key blocks recovery and must never be bypassed by
silently dropping journal entries.

## 13. Recovery Protocol

Recovery is a root-operated, fail-closed workflow:

1. Declare the incident and identify that the PostgreSQL production write
   commit point has passed.
2. Put contact writes into maintenance, wait longer than the maximum contact
   request duration, and stop the application writer before inventory.
3. Preserve the current VM, PostgreSQL volume, reports, and failed resources.
4. Restore one explicit, already-proven Restic snapshot into a reviewed
   replacement target.
5. Supply the read-only R2 credential, required age identities, and MAC key
   ring from off-VM custody.
6. Paginate the complete `v1/accepted/` listing. Capture two identical,
   stable inventories while writes are stopped.
7. For every marker:
   - validate the strict marker schema and receipt MAC;
   - require the matching intent;
   - validate the intent schema, UUID/key correspondence, plaintext MAC,
     ciphertext hash, and envelope MAC;
   - decrypt with the selected age identity;
   - validate the canonical plaintext, ID, timestamp, and HMAC.
8. Count but do not replay intent-only entries.
9. In one SERIALIZABLE transaction, lock the destination contact table,
   insert missing accepted rows, accept exact existing rows, and abort on the
   first mismatch.
10. Reread and prove that every accepted marker has one exact PostgreSQL row.
    Legacy contacts and unmarked pending rows may be additional rows; they do
    not weaken the accepted-journal subset proof.
11. Take a fresh off-VM PostgreSQL backup.
12. Restore that exact new snapshot in isolation and repeat the accepted-set
    proof.
13. Require a second operator to approve the reports before restarting the
    writer and removing contact maintenance.

Recovery never overwrites an existing differing row, deletes a pending object,
repairs a marker, skips an unreadable key generation, or falls back to stale
MongoDB.

### 13.1 Exact accepted-set evidence

At a drained point, the authoritative watermark is an exact set rather than a
maximum UUID. Build one sorted line per accepted marker from:

`keyId<TAB>id<TAB>mac<TAB>ciphertextSha256<TAB>envelopeMac<TAB>receiptMac`

Sort by unsigned UTF-8 byte order and calculate SHA-256 over the newline-
terminated sequence. The report records:

- inventory count;
- accepted-set SHA-256;
- schema and key IDs encountered;
- pre-existing, inserted, final, pending, and mismatch counts;
- Restic snapshot ID;
- R2 bucket jurisdiction and lock-rule ID;
- operation timestamps and status.

The report contains no individual ID, contact field, object key, ciphertext,
credential, or object URL. Two identical inventory count/digest pairs while
writes are stopped prove a stable recovery input. UUID ordering is never
treated as a live-list watermark.

## 14. Backup and Restore Integration

The R2 journal complements but does not replace the nightly PostgreSQL dump,
Restic encryption, 30-daily-snapshot retention, repository check, or isolated
restore.

Backup reports expand with the PostgreSQL journal-row count and a digest of the
journal metadata actually present in that dump. Cutover and recovery reports
separately record the authoritative R2 accepted-set count and digest. The two
digests are not interchangeable. A restored snapshot is never rejected merely
because it predates a new accepted marker; recovery must replay the missing
exact rows from R2. Traffic remains disabled until every entry in the complete
drained accepted set has exactly one matching PostgreSQL row and a fresh backup
of that state passes an isolated restore with the same proof.

Before enabling the first PostgreSQL production contact write, the cutover
must prove:

1. the production R2 bucket and lock configuration;
2. the independent writer and recovery credentials;
3. the recoverability of every active key generation;
4. one accepted synthetic contact in PostgreSQL and R2;
5. replay of that contact into a disposable database restored from a snapshot
   that predates it;
6. exact accepted-set equality after replay;
7. a fresh backup and isolated restore containing the reconciled result.

The synthetic contact uses only reserved `.example` data and remains as an
accepted journal-backed row until a separate approved deletion removes both
stores after the lock permits it. The existing workflow must not delete the
PostgreSQL synthetic row while its acceptance marker would cause recovery to
restore it.

## 15. Test Strategy

### 15.1 Unit and contract tests

- Canonical JSON field order, trimming, escaping, timestamp precision, and
  deterministic HMAC.
- Strict intent and marker schemas with unknown-field rejection.
- Age subprocess stdin/stdout, timeout, size, signal, and redaction behavior.
- Idempotency-key validation and effective-key response header.
- Every state-machine transition, including all ambiguous timeout paths.
- Same-key/same-body success and same-key/different-body conflict.
- Exact current 201/400/405/503 response bodies.
- Frontend key reuse, edit reset, success reset, and concurrent-submit lock.

### 15.2 PostgreSQL 18.4 integration tests

- Migration 003 constraints, owner, search path, execute ACL, and downgrade.
- Direct app INSERT/SELECT/UPDATE/DELETE denial.
- Function insert and exact retry.
- Field, timestamp, key ID, schema, and MAC mismatch rejection.
- Concurrent identical and conflicting calls.
- Legacy null journal metadata remains readable by the backup role.
- Backup/restore ownership and ACL matrix includes the function and new
  columns.

### 15.3 Journal and recovery tests

- Conditional duplicate PUT yields HTTP 412 and never overwrites.
- Ambiguous PUT timeout followed by successful GET verification.
- Immediate GET and paginated LIST visibility.
- Missing intent, missing marker, corrupt JSON, unknown key ID, bad MAC,
  ciphertext tampering, envelope tampering, age failure, receipt mismatch, and
  object-key/ID mismatch all fail closed.
- Restore from snapshots before and after an accepted contact.
- Exact existing rows are no-ops, missing rows insert, and mismatches roll back
  the entire reconciliation transaction.
- Intent-only and projected-but-unmarked attempts are not replayed.
- Interrupted recovery before and after commit is safe to rerun.
- Reports and diagnostics contain no contact values or secret sentinels.

### 15.4 Live Cloudflare acceptance

Before production writes are enabled, use non-PII fixtures to prove:

- bucket jurisdiction is EU and storage class is Standard;
- public, anonymous, and cross-bucket access are denied;
- the app token cannot manage bucket or lock configuration;
- the recovery token cannot PUT, overwrite, or delete;
- conditional PUT, immediate GET, and immediate LIST behave as required;
- overwrite and delete are denied for locked `v1/` objects;
- the effective lock duration is at least 60 days;
- no public domain, CORS rule, or lifecycle deletion exists.

Cloudflare IAM changes can take time to propagate. Credential tests must wait
for and prove the intended effective permissions before a failed denial is
treated as authoritative.

### 15.5 Infrastructure invariants

- Production Compose still has exactly seven services.
- Only `app` receives journal writer secrets.
- Recovery and admin secrets are absent from Compose, images, histories,
  metadata, SBOMs, logs, and the repository.
- App and operator images contain the exact reviewed age version.
- All new infrastructure tests are included in the exhaustive required CI
  target.

## 16. Production Acceptance Criteria

The journal work is accepted only when all of these are proven:

- The bucket, EU jurisdiction, private access, separate credentials, and
  60-day lock match this specification.
- The seven-service stack is healthy with no new published host port.
- Valid first-party contact submissions use a stable idempotency key.
- One logical submission creates exactly one intent, one exact PostgreSQL row,
  and one acceptance marker.
- An identical retry returns the same success without an extra row or object.
- A conflicting retry fails without changing existing state.
- R2 failure returns a generic contact 503 while public read routes remain
  healthy.
- Every fault-injection boundary converges to a documented state.
- A pre-contact PostgreSQL snapshot plus journal replay reconstructs the exact
  accepted synthetic row.
- The accepted-set count and digest match before and after replay and after the
  subsequent isolated restore.
- Logs, reports, image scans, and runtime diagnostics contain no PII or secret
  material.
- PostgreSQL no longer permits a direct application contact insert.
- No accepted contact can require stale MongoDB as a recovery source.

Only after these criteria and the existing migration acceptance gates pass may
Cloudflare move production traffic to the VM.

## 17. Deployment Sequence

1. Implement and verify the design locally and in required CI.
2. Create the EU journal bucket, lock rule, independent credentials, age key
   pair, and MAC key.
3. Escrow recovery keys off the VM and prove they decrypt a non-PII fixture.
4. Install only application writer configuration on the VM.
5. Deploy with contact writes still in maintenance.
6. Run live R2 negative and consistency gates.
7. Rehearse the complete contact state machine and recovery workflow with
   non-PII data.
8. Run the pre-contact backup, synthetic accepted contact, pre-snapshot replay,
   fresh backup, and isolated restore proof.
9. Enable PostgreSQL contact writes and record the production write commit
   point.
10. Continue with the existing MongoDB finalization, Cloudflare traffic
    switch, 24-hour observation, and decommission gates.

No Vercel or Atlas resource is deleted as part of this journal deployment.

## 18. References

- [Cloudflare R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/)
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 authentication](https://developers.cloudflare.com/r2/api/tokens/)
- [Cloudflare R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [Cloudflare R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)
- [Cloudflare R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [age 1.3.1 release](https://github.com/FiloSottile/age/releases/tag/v1.3.1)
