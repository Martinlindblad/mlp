# Contact Journal Zero-RPO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every accepted production contact exactly recoverable after loss of the VM or PostgreSQL volume by projecting an authenticated, encrypted Cloudflare R2 journal into PostgreSQL.

**Architecture:** The existing Next.js `app` service conditionally creates one immutable encrypted intent, calls a hardened PostgreSQL insert-or-exact-match function, then conditionally creates one immutable non-PII acceptance marker before returning HTTP 201. Shared journal modules define canonical bytes, authentication, R2 access, and recovery validation; the existing migration operator image runs bounded recovery and live acceptance commands, so the permanent Compose topology remains exactly seven services.

**Tech Stack:** Node.js 22.23.1, TypeScript, Next.js 13.5.3, React 18.2.0, Kysely 0.29.3, PostgreSQL 18.4, Zod 4.4.3, `@aws-sdk/client-s3` 3.1087.0, age 1.3.1, Docker Compose 5.3.1, Cloudflare R2 EU.

## Global Constraints

- The approved source of truth is `docs/superpowers/specs/2026-07-16-contact-journal-zero-rpo-design.md`; do not weaken or reinterpret it during implementation.
- Use exact Node.js `22.23.1` and Yarn `1.22.22`; keep the repository engine range `>=22.23.1 <23`.
- Pin `@aws-sdk/client-s3` to exact version `3.1087.0` in both application and operator dependency locks.
- Keep PostgreSQL at `18.4` and age at `1.3.1`; every downloaded age archive remains checksum-pinned to SHA-256 `bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377`.
- The production Compose project remains exactly `app`, `postgres`, `migrator`, `caddy`, `cloudflared-a`, `cloudflared-b`, and `db-backup`; do not add an eighth service or a published host port.
- The R2 bucket is exactly `mlp-contact-journal`, jurisdiction `eu`, Standard storage, private, with no custom domain, CORS, or lifecycle rule and with an enabled `v1/` age lock of at least `5_184_000` seconds (60 days).
- The R2 endpoint is exactly `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`; the SDK region is exactly `auto`.
- Contact acceptance has one 20-second end-to-end deadline; every R2 operation has a three-second deadline; Caddy's response-header timeout remains 30 seconds.
- Intent envelopes are at most 65,536 encoded bytes and acceptance markers are at most 4,096 encoded bytes.
- Only a proven ACCEPTED state returns HTTP 201; a payload conflict returns the exact generic HTTP 409 body, and unavailable journal/database work returns the exact generic HTTP 503 body.
- Never log contact fields, request bodies, journal UUIDs, object keys/URLs, envelopes, ciphertext, MACs, hashes, R2 account/credential values, age keys/recipients, or PostgreSQL value-bearing errors.
- Use TDD for every behavior change: write one focused failing test, run it and record the expected failure, implement the minimum behavior, then rerun focused and affected suites before committing.
- Run PostgreSQL behavior and ACL tests against a real PostgreSQL 18.4 server; do not replace them with repository mocks.
- Recovery material and bucket-admin credentials never enter the permanent Compose project, application image, VM secret tree, Git repository, logs, or command arguments.
- Do not create Cloudflare resources until the deterministic implementation and credential-custody gates pass. Do not move production traffic until every production acceptance criterion in the approved specification passes.

## File and Interface Map

- `server/journal/contracts.ts`: canonical row, strict intent/marker/keyring schemas, UUID/key/MAC validation, and deterministic serialization.
- `server/journal/authentication.ts`: domain-separated HMAC, ciphertext SHA-256, envelope/receipt construction, and constant-time verification.
- `server/journal/age-process.ts`: bounded `age` encryption/decryption over stdin/stdout with no plaintext file or data-bearing diagnostic.
- `server/journal/config.ts`: strict non-secret environment and secret-file loading for app and incident operator contexts.
- `server/journal/r2-store.ts`: the only S3/R2 adapter; conditional PUT, bounded GET, and complete paginated LIST.
- `server/journal/contact-journal.ts`: prepare/project/accept state machine and typed generic failure categories.
- `server/journal/metrics.ts`: fixed unlabeled journal outcomes with a value-free JSON-line serializer.
- `server/journal/recovery.ts`: stable accepted-set inventory, decrypt/authenticate, SERIALIZABLE reconciliation, post-commit exact proof, and redacted report model.
- `server/journal/recovery-staging.ts`: session-local PostgreSQL temporary tables that bound recovery memory while retaining authenticated contacts for post-commit proof.
- `server/db/migrations/003_contact_journal.ts`: nullable legacy metadata, constraints, hardened `ensure_journal_contact`, and exact runtime ACLs.
- `server/repositories/contact-repository.ts`: application call to `ensure_journal_contact`; no direct application INSERT.
- `server/api/contact-handler.ts` and `src/pages/api/contact/route.ts`: idempotency contract, 20-second deadline, and production dependency assembly.
- `src/contact/idempotency.ts` and `src/components/Form.tsx`: first-party stable-key state machine and concurrent-submit lock.
- `scripts/journal/recover.ts` and `scripts/journal/live-r2-gate.ts`: immutable operator-image entrypoints for recovery and live provider acceptance.
- `ops/journal-recover.sh`: root-only, fixed-path incident wrapper that verifies maintenance/drain evidence and mounts incident material read-only.
- `infra/backup/backup.sh`, `ops/backup.sh`, and `ops/restore-test.sh`: same-snapshot PostgreSQL journal metadata evidence and isolated restore proof.
- `compose.production.yml`, `ops/compose.sh`, `infra/runtime.example/**`, and `Dockerfile`: writer-only runtime configuration and age binary.
- `scripts/acceptance/r2-journal-config.sh`, `runbooks/contact-journal.md`, and `runbooks/postgresql-disaster-recovery.md`: bucket/IAM/configuration checks and two-operator recovery procedure.
- `scripts/acceptance/contact-journal-outage.sh`: pre-cutover proof that R2 failure returns contact 503 without impairing pages/read APIs or creating a database row.
- Existing unit, integration, infrastructure, image, browser, and workflow suites remain the acceptance harness; new journal suites are added to the ordinary required CI targets.

---

### Task 1: Canonical contact, envelopes, markers, and authenticated bytes

**Files:**

- Create: `server/journal/contracts.ts`
- Create: `server/journal/authentication.ts`
- Create: `tests/unit/journal/contracts.test.ts`
- Create: `tests/unit/journal/authentication.test.ts`
- Modify: `package.json`
- Modify: `yarn.lock`
- Modify: `infra/migration/package.json`
- Modify: `infra/migration/yarn.lock`

**Interfaces:**

- Produces: `CanonicalContact`, `ContactIntentEnvelope`, `ContactAcceptanceMarker`, `JournalMacKeyring`, `canonicalContactJson`, `intentAuthenticatedFieldsJson`, `intentEnvelopeJson`, `acceptanceAuthenticatedFieldsJson`, `acceptanceMarkerJson`, `parseCanonicalContact`, `parseIntentEnvelope`, `parseAcceptanceMarker`, `parseMacKeyring`, `createIntentEnvelope`, `verifyIntentEnvelope`, `createAcceptanceMarker`, and `verifyAcceptanceMarker`.
- Consumes: Node `crypto` only for authentication; no R2, subprocess, PostgreSQL, or environment access is allowed in these files.

- [ ] **Step 1: Add exact locked S3 dependencies**

Run with the exact Node toolchain:

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn add --exact @aws-sdk/client-s3@3.1087.0
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn --cwd infra/migration add --exact @aws-sdk/client-s3@3.1087.0
```

Expected: both manifests contain `"@aws-sdk/client-s3": "3.1087.0"`, both lockfiles resolve that exact package, and no caret range is introduced.

- [ ] **Step 2: Write failing canonical-contract tests**

Create `tests/unit/journal/contracts.test.ts` with this exact canonical fixture and expected byte string:

```ts
const contact = {
  schema: 'mlp.contact.v1' as const,
  id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
  fullName: 'Martin Lindblad',
  email: 'martin@example.com',
  subject: 'Hello',
  message: 'Line one\n"Line two"',
  createdAt: '2026-07-16T12:00:00.123Z',
};

expect(canonicalContactJson(contact)).toBe(
  '{"schema":"mlp.contact.v1","id":"71eb8a54-d43b-45d5-9ea7-77b5834eeed3","fullName":"Martin Lindblad","email":"martin@example.com","subject":"Hello","message":"Line one\\n\\"Line two\\"","createdAt":"2026-07-16T12:00:00.123Z"}',
);
expect(
  parseCanonicalContact(Buffer.from(canonicalContactJson(contact))),
).toEqual(contact);
```

Add one rejected case for each of: reordered/missing/unknown field, uppercase/non-v4/non-canonical UUID, an invalid calendar date, timestamp without exactly three fractional digits, wrong schema, untrimmed string, key ID that fails exact regex `^[a-z0-9][a-z0-9._-]{0,31}$` including longer than 32 characters, padded/non-base64url MAC, non-canonical standard-base64 ciphertext, keyring duplicate/unknown/empty field, and key material that does not decode to exactly 32 bytes. Prove that composed and decomposed Unicode remain byte-distinct and that accepted name/email case is preserved without Unicode normalization or case-folding. Measure raw `Uint8Array.byteLength` before UTF-8 decode: an intent input of at most 65,536 bytes and marker input of at most 4,096 bytes proceeds to canonical/schema validation, while 65,537/4,097 bytes throws a fixed size error. Prove outbound serializers reject the first valid constructed intent or marker document whose canonical UTF-8 output exceeds its cap. A canonical marker cannot naturally fill 4 KiB because all its fields are bounded, so do not fabricate an unknown padding field merely to make a “valid” boundary fixture.

- [ ] **Step 3: Run the contract test and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/contracts.test.ts
```

Expected: FAIL because `server/journal/contracts.ts` does not exist.

- [ ] **Step 4: Implement strict types and deterministic serialization**

Implement these exported shapes exactly:

```ts
export const CONTACT_SCHEMA = 'mlp.contact.v1' as const;
export const INTENT_SCHEMA = 'mlp.contact-intent.v1' as const;
export const ACCEPTED_SCHEMA = 'mlp.contact-accepted.v1' as const;
export const INTENT_MAX_BYTES = 65_536;
export const ACCEPTED_MAX_BYTES = 4_096;

export interface CanonicalContact {
  schema: typeof CONTACT_SCHEMA;
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
}

export interface ContactIntentEnvelope {
  schema: typeof INTENT_SCHEMA;
  id: string;
  createdAt: string;
  keyId: string;
  mac: string;
  ciphertextSha256: string;
  ciphertext: string;
  envelopeMac: string;
}

export interface ContactAcceptanceMarker {
  schema: typeof ACCEPTED_SCHEMA;
  id: string;
  intentSchema: typeof INTENT_SCHEMA;
  keyId: string;
  mac: string;
  ciphertextSha256: string;
  envelopeMac: string;
  acceptedAt: string;
  receiptMac: string;
}

export type JournalMacKeyring = ReadonlyMap<string, Buffer>;
```

Use strict Zod objects, transform dates to canonical strings only at the API boundary, and manually construct object literals in the specified field order before `JSON.stringify`. Export these exact parser/serializer signatures:

```ts
export function canonicalContactJson(value: CanonicalContact): string;
export function intentAuthenticatedFieldsJson(
  value: Omit<ContactIntentEnvelope, 'envelopeMac'>,
): string;
export function intentEnvelopeJson(value: ContactIntentEnvelope): string;
export function acceptanceAuthenticatedFieldsJson(
  value: Omit<ContactAcceptanceMarker, 'receiptMac'>,
): string;
export function acceptanceMarkerJson(value: ContactAcceptanceMarker): string;
export function parseCanonicalContact(encoded: Uint8Array): CanonicalContact;
export function parseIntentEnvelope(encoded: Uint8Array): ContactIntentEnvelope;
export function parseAcceptanceMarker(
  encoded: Uint8Array,
): ContactAcceptanceMarker;
export function parseMacKeyring(encoded: Uint8Array): JournalMacKeyring;
```

Every contact, envelope, and marker `id` is an exact canonical lowercase UUID v4 matching `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`. The keyring wire value is one compact single-line JSON object whose dynamic property names are canonical key IDs matching `^[a-z0-9][a-z0-9._-]{0,31}$` and whose values are canonical padded base64 for exactly 32 bytes; it contains no `activeKeyId` wrapper field. Detect duplicate raw JSON property names before materializing the map and reject an empty map. Task 3 separately requires the writer's non-secret active key ID to exist in this map; recovery has no active generation. For authenticated protocol documents, reject any parsed JSON whose reserialization is not byte-for-byte identical to the supplied UTF-8 text; this prevents alternate whitespace/order encodings from becoming authenticated protocol inputs. Standard base64 ciphertext must decode and re-encode to the identical padded text. Every intent/marker parser checks the raw byte cap before UTF-8 decode. Every intent/marker serializer validates the supplied shape, constructs canonical text, measures `Buffer.byteLength(text, 'utf8')`, and rejects output above its cap with the same fixed size error. `createIntentEnvelope` and `createAcceptanceMarker` must route their final objects through the corresponding serializer before returning so the application can never construct oversized outbound protocol documents.

- [ ] **Step 5: Run canonical tests and verify GREEN**

Run the Step 3 command. Expected: all contract cases PASS.

- [ ] **Step 6: Write failing domain-separated authentication tests**

Create `tests/unit/journal/authentication.test.ts`. Use `Buffer.alloc(32, 0x11)` and `Buffer.from('age-encryption-fixture-v1')`; assert these literal deterministic results:

```ts
const canonicalBytes = Buffer.from(canonicalContactJson(contact));
const intent = createIntentEnvelope(
  contact,
  'journal-2026-01',
  key,
  ciphertext,
);
const verifiedIntent = verifyIntentEnvelope(
  Buffer.from(intentEnvelopeJson(intent)),
  new Map([['journal-2026-01', key]]),
).envelope;
const marker = createAcceptanceMarker(
  verifiedIntent,
  '2026-07-16T12:00:01.456Z',
  key,
);
expect(
  verifyAcceptanceMarker(
    Buffer.from(acceptanceMarkerJson(marker)),
    verifiedIntent,
    new Map([['journal-2026-01', key]]),
  ),
).toEqual(marker);

expect(plaintextMac(canonicalBytes, key)).toBe(
  'zF_HCPIsHWQmrSTWU8j-T0Pytr7nH2Q2x_Fqr-JAD14',
);
expect(intent.ciphertextSha256).toBe(
  '1388b9eb0517dff373af1676d0611d37e99dead6c9051a6fffc04387874aba8a',
);
expect(intent.ciphertext).toBe('YWdlLWVuY3J5cHRpb24tZml4dHVyZS12MQ==');
expect(intent.envelopeMac).toBe('l_L3-aIoOFRbgF3pqPihsDX0ho9PtN107rplNqKN-yQ');
expect(marker.receiptMac).toBe('riEvRLlxUUj6_uDp55b61Refnsus6unTR4CJK5YpCwc');
```

For each authenticated field, mutate exactly one byte and assert generic verification failure. Assert that a plaintext MAC cannot verify as an envelope/receipt MAC, unknown key IDs fail, and `timingSafeEqual` is reached only for equal-length decoded MACs.

- [ ] **Step 7: Run authentication tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/authentication.test.ts
```

Expected: FAIL because `server/journal/authentication.ts` does not exist.

- [ ] **Step 8: Implement the exact authentication protocol**

Export these domain constants and functions:

```ts
export const PLAINTEXT_DOMAIN = Buffer.from('mlp.contact.plaintext.v1\0');
export const ENVELOPE_DOMAIN = Buffer.from('mlp.contact.intent-envelope.v1\0');
export const RECEIPT_DOMAIN = Buffer.from(
  'mlp.contact.acceptance-receipt.v1\0',
);

export function plaintextMac(plaintext: Uint8Array, key: Uint8Array): string;
export function createIntentEnvelope(
  contact: CanonicalContact,
  keyId: string,
  key: Uint8Array,
  ciphertext: Uint8Array,
): ContactIntentEnvelope;
export function verifyIntentEnvelope(
  encoded: Uint8Array,
  keyring: ReadonlyMap<string, Buffer>,
): { envelope: ContactIntentEnvelope; canonicalContactMac: string };
export function createAcceptanceMarker(
  intent: ContactIntentEnvelope,
  acceptedAt: string,
  key: Uint8Array,
): ContactAcceptanceMarker;
export function verifyAcceptanceMarker(
  encoded: Uint8Array,
  intent: ContactIntentEnvelope,
  keyring: ReadonlyMap<string, Buffer>,
): ContactAcceptanceMarker;
```

HMAC input is the domain buffer followed by the exact canonical UTF-8 JSON bytes for the authenticated fields. Encode HMAC as `digest('base64url')`, hash ciphertext with lowercase SHA-256 hex, compare MAC bytes with `timingSafeEqual`, and throw only fixed non-value-bearing error messages.

- [ ] **Step 9: Run both suites, typecheck, and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/contracts.test.ts tests/unit/journal/authentication.test.ts
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn typecheck
git diff --check
git add package.json yarn.lock infra/migration/package.json infra/migration/yarn.lock \
  server/journal/contracts.ts server/journal/authentication.ts \
  tests/unit/journal/contracts.test.ts tests/unit/journal/authentication.test.ts
git commit -m "feat(journal): define authenticated contact protocol"
```

Expected: focused tests and typecheck PASS; commit contains no provider, DB, or runtime wiring.

---

### Task 2: Bounded age encryption and decryption

**Files:**

- Create: `server/journal/age-process.ts`
- Create: `tests/fixtures/fake-age.mjs`
- Create: `tests/unit/journal/age-process.test.ts`

**Interfaces:**

- Consumes: canonical UTF-8 bytes from Task 1, `/usr/local/bin/age` in production, an `AbortSignal`, and either a public recipient or a read-only identity-file path.
- Produces: `AgeProcess` with `encrypt(plaintext, recipient, signal)` and `decrypt(ciphertext, identityFile, signal)`; neither method exposes child stderr.

- [ ] **Step 1: Write failing real-subprocess tests**

The fixture executable must implement deterministic modes selected only by arguments/environment supplied by the test: copy stdin with a fixed prefix, exit nonzero after writing a PII/secret sentinel to stderr, sleep past deadline, exceed stdout limit, or ignore TERM. Test the real `spawn`/pipe behavior, not a mocked child process.

Use the production-facing API:

```ts
const age = createAgeProcess({
  executable: fixturePath,
  operationTimeoutMs: 100,
  killAfterMs: 100,
  ciphertextLimitBytes: 65_536,
  plaintextLimitBytes: 32_768,
});
await expect(
  age.encrypt(Buffer.from('canonical'), AGE_RECIPIENT, signal),
).resolves.toEqual(expectedCiphertext);
```

Assert exact argv (`--encrypt --recipient <recipient>` and `--decrypt --identity <path>`), stdin/stdout only, timeout plus forced kill, output-size rejection during streaming, parent abort, missing executable, nonzero exit, and absence of fixture stderr/plaintext/recipient/identity path in every thrown message.

- [ ] **Step 2: Run the age suite and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/age-process.test.ts
```

Expected: FAIL because the age adapter does not exist.

- [ ] **Step 3: Implement a streaming, bounded child lifecycle**

Implement this interface:

```ts
export interface AgeProcess {
  encrypt(
    plaintext: Uint8Array,
    recipient: string,
    signal: AbortSignal,
  ): Promise<Buffer>;
  decrypt(
    ciphertext: Uint8Array,
    identityFile: string,
    signal: AbortSignal,
  ): Promise<Buffer>;
}

export function createAgeProcess(options?: {
  executable?: string;
  operationTimeoutMs?: number;
  killAfterMs?: number;
  ciphertextLimitBytes?: number;
  plaintextLimitBytes?: number;
}): AgeProcess;
```

Default to `/usr/local/bin/age`, 3,000 ms operation timeout, 500 ms TERM-to-KILL grace, 65,536 ciphertext bytes, and 32,768 plaintext bytes. Spawn with `shell:false`, `windowsHide:true`, fixed minimal environment (`PATH`, `LC_ALL`), `stdio:['pipe','pipe','pipe']`; drain but never retain stderr. Count stdout chunks before concatenation, close stdin after one bounded write, combine the parent signal with the local timeout, remove every listener/timer on all exits, and return only fixed `journal encryption unavailable` or `journal decryption unavailable` errors.

- [ ] **Step 4: Run tests, force-hang probe, typecheck, and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/age-process.test.ts
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn typecheck
git diff --check
git add server/journal/age-process.ts tests/fixtures/fake-age.mjs \
  tests/unit/journal/age-process.test.ts
git commit -m "feat(journal): bound age subprocess handling"
```

Expected: all child processes are reaped and the suite exits without an open-handle warning.

---

### Task 3: Strict journal configuration and R2 object store

**Files:**

- Create: `server/journal/config.ts`
- Create: `server/journal/r2-store.ts`
- Create: `tests/unit/journal/config.test.ts`
- Create: `tests/unit/journal/r2-store.test.ts`

**Interfaces:**

- Consumes: exact non-secret environment values and fixed secret-file paths; AWS SDK `S3Client`, `PutObjectCommand`, `GetObjectCommand`, and `ListObjectsV2Command`.
- Produces: `JournalWriterConfig`, `JournalRecoveryConfig`, `JournalObjectStore`, categorized conditional-PUT results, bounded object bytes, and complete pages.

- [ ] **Step 1: Write failing configuration tests**

Exercise real current-UID mode-`0400` temporary runtime files. Require this exact writer shape:

```ts
export interface JournalWriterConfig {
  endpoint: string;
  bucket: 'mlp-contact-journal';
  activeKeyId: string;
  ageRecipient: string;
  accessKeyId: string;
  secretAccessKey: string;
  macKeys: ReadonlyMap<string, Buffer>;
}

export interface JournalRecoveryConfig {
  endpoint: string;
  bucket: 'mlp-contact-journal';
  jurisdiction: 'eu';
  lockRuleId: string;
  accessKeyId: string;
  secretAccessKey: string;
  identityFile: string;
  macKeys: ReadonlyMap<string, Buffer>;
  postgresHost: string;
  postgresPort: 5432;
  postgresDatabase: string;
  postgresUser: 'portfolio_migrator';
  postgresPasswordFile: string;
  postgresStatementTimeoutMillis: 60_000;
  reportDirectory: '/run/recovery-output';
  recoveryDeadlineSeconds: number;
}
```

The public runtime loaders must accept only an HTTPS `*.eu.r2.cloudflarestorage.com` account endpoint, exact bucket, canonical active key ID, valid age recipient, three absolute `/run/secrets/...` app paths, one trailing newline for scalar secret files, and a strict single-line MAC-keyring JSON value. Runtime loaders read only regular single-link files owned by the current non-root UID with exact mode `0400`; unit fixtures use `process.getuid()` and mode `0400`. Because local unit runs may not have writable `/run`, implement an unexported/shared test seam that accepts a caller-supplied secret root while preserving the same stat/open/fstat validator and same relative runtime filenames. Tests use a temporary root through that seam and separately assert the public loaders reject non-`/run/secrets/...` app paths and non-`/run/recovery-secrets/...` recovery paths. Production-facing exported loaders keep the canonical `/run/...` roots. Reject inherited AWS credentials, endpoint userinfo/query/fragment/path, symlinks, unsafe/multiline/oversized/empty files, unknown keyring fields, and missing active generation.

- [ ] **Step 2: Run config tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/config.test.ts
```

Expected: FAIL because `server/journal/config.ts` does not exist.

- [ ] **Step 3: Implement fixed config loaders**

Export:

```ts
export function loadJournalWriterConfig(
  env: NodeJS.ProcessEnv,
): JournalWriterConfig;
export function loadJournalRecoveryConfig(
  env: NodeJS.ProcessEnv,
): JournalRecoveryConfig;
```

Writer environment keys are exactly `JOURNAL_R2_ENDPOINT`, `JOURNAL_R2_BUCKET`, `JOURNAL_ACTIVE_KEY_ID`, `JOURNAL_AGE_RECIPIENT`, `JOURNAL_R2_ACCESS_KEY_ID_FILE`, `JOURNAL_R2_SECRET_ACCESS_KEY_FILE`, and `JOURNAL_MAC_KEYRING_FILE`. Recovery additionally requires non-secret `JOURNAL_R2_JURISDICTION=eu`, canonical `JOURNAL_R2_LOCK_RULE_ID`, `PGHOST`, `PGPORT=5432`, `PGDATABASE`, `PGUSER=portfolio_migrator`, `PGSTATEMENT_TIMEOUT_MS=60000`, `RECOVERY_REPORT_DIRECTORY=/run/recovery-output`, and `RECOVERY_DEADLINE_SECONDS` in `7200..604800`, plus fixed `/run/recovery-secrets/` paths for a read-only access key, secret key, age identities, MAC keyring, and PostgreSQL password.

Open every runtime secret with this exact invariant: `lstat`, `open(O_RDONLY | O_NOFOLLOW | O_CLOEXEC)`, then `fstat`; both stats must describe the same `dev`/`ino`, a regular file, current effective UID, `nlink === 1`, and mode `0400`. Cap scalar files at 4 KiB and keyrings/identity files at 64 KiB, read through the already-open descriptor, and never include values or paths in errors. Task 7 separately proves the root-owned canonical sources are regular `root:root 0600` and that staging produces these UID-1000 `0400` runtime files.

- [ ] **Step 4: Write failing R2 adapter tests**

Inject a complete `S3ClientLike` port at the SDK `send(command, {abortSignal})` boundary while exercising real command objects and response streams. Assert:

```ts
export type ConditionalPutResult = 'created' | 'exists' | 'ambiguous';

export interface JournalObjectStore {
  putIfAbsent(
    key: string,
    body: Uint8Array,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<ConditionalPutResult>;
  get(
    key: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<Buffer | null>;
  listPage(
    prefix: 'v1/accepted/' | 'v1/intents/',
    continuationToken: string | undefined,
    signal: AbortSignal,
  ): Promise<{ keys: string[]; nextToken?: string }>;
}

export type JournalObjectReader = Pick<JournalObjectStore, 'get' | 'listPage'>;
```

Verify exact bucket/key/content type/body, `IfNoneMatch: '*'`, no metadata, no multipart/copy/delete command, 412 to `exists`, 409/AbortError/transport uncertainty to `ambiguous`, definitive access/config errors to a fixed unavailable error, GET 404 to null, streaming size enforcement before concatenation, canonical object-key validation, duplicate/unsorted LIST rejection, correct continuation-token progress, and that ETag values are never consumed as content hashes or correctness evidence. The three-second child deadline must remain armed through both `send()` and complete GET body consumption: a fixture that returns headers immediately and stalls its body beyond three seconds must abort, destroy the stream, and reject generically.

- [ ] **Step 5: Run the R2 tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/r2-store.test.ts
```

Expected: FAIL because `server/journal/r2-store.ts` does not exist.

- [ ] **Step 6: Implement the single allowed R2 adapter**

Create the SDK client only as:

```ts
new S3Client({
  region: 'auto',
  endpoint: config.endpoint,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
  maxAttempts: 1,
});
```

Validate keys against `^v1/(intents|accepted)/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.json$`. Wrap each whole operation, not only the SDK call, in:

```ts
await withOperationDeadline(3_000, callerSignal, async (operationSignal) => {
  const response = await client.send(command, {
    abortSignal: operationSignal,
  });
  return readBoundedBody(response.Body, maximumBytes, operationSignal);
});
```

`readBoundedBody` destroys/stops the response stream on overflow or abort and checks the 65,536-byte intent or 4,096-byte marker limit before concatenation. Require LIST keys to match the requested prefix and every non-final page to advance a non-empty token.

- [ ] **Step 7: Run all Task 3 tests, typecheck, and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/config.test.ts tests/unit/journal/r2-store.test.ts
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn typecheck
git diff --check
git add server/journal/config.ts server/journal/r2-store.ts \
  tests/unit/journal/config.test.ts tests/unit/journal/r2-store.test.ts
git commit -m "feat(journal): add strict R2 object store"
```

Expected: configuration values never appear in test diagnostics or snapshots.

---

### Task 4: PostgreSQL 003 idempotency boundary and privilege revocation

**Files:**

- Create: `server/db/migrations/003_contact_journal.ts`
- Create: `tests/integration/db/contact-journal.test.ts`
- Modify: `server/db/database.types.ts`
- Modify: `server/db/config.ts`
- Modify: `server/db/client.ts`
- Modify: `server/repositories/contact-repository.ts`
- Modify: `tests/unit/db/config.test.ts`
- Modify: `tests/integration/db/migrations.test.ts`
- Modify: `tests/integration/db/repositories.test.ts`
- Modify: `tests/helpers/postgres.ts`

**Interfaces:**

- Consumes: `CanonicalContact`, authenticated `journalSchema`, `journalKeyId`, and `journalMac` from Tasks 1–3.
- Produces: PostgreSQL function `public.ensure_journal_contact(uuid,text,text,text,text,timestamptz,text,text,text) RETURNS text` and repository method `ensureJournalContact(input, signal): Promise<'inserted' | 'matched'>` whose dedicated pool client is destroyed on abort.

- [ ] **Step 1: Write failing PostgreSQL migration and ACL tests**

Extend the expected latest migration to `003_contact_journal` and require columns:

```text
journal_schema text null
journal_key_id text null
journal_mac text null
```

Assert check constraints enforce either all three null or all three present, exact schema `mlp.contact.v1`, key ID `^[a-z0-9][a-z0-9._-]{0,31}$`, and MAC `^[A-Za-z0-9_-]{43}$`. Query `pg_proc`, `pg_namespace`, `pg_roles`, `proconfig`, and `aclexplode` to require: SECURITY DEFINER, owner `portfolio_migrator`, fixed `search_path=pg_catalog`, no PUBLIC execute, and execute only for `portfolio_app`/owner.

Connect or `SET ROLE portfolio_app` and prove direct SELECT/INSERT/UPDATE/DELETE all fail while function execute succeeds. Preserve backup SELECT and legacy rows with three null fields.

In this same RED step, create `tests/integration/db/contact-journal.test.ts` with a real start barrier and independent PostgreSQL clients. Require first/exact retry `inserted` then `matched`; every individual field/timestamp/schema/key-ID/MAC mismatch to raise the same generic conflict without mutation; invalid UUID/schema/key/MAC rejection before write; app table denial and backup reads for both legacy-null/journal rows; supplied sentinels absent from function errors; two concurrent identical calls to resolve as the multiset `['inserted','matched']`; two concurrent different payloads to produce exactly one winner and one generic conflict; and one-row/no-mutation invariants. This test exists before the function implementation and may never accept a unique-violation outcome.

- [ ] **Step 2: Run the focused migration test and verify RED**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/integration/db/migrations.test.ts \
  tests/integration/db/contact-journal.test.ts --no-file-parallelism
```

Expected: FAIL because migration 003 and the new columns/function do not exist.

- [ ] **Step 3: Implement migration 003 and exact downgrade**

The `up` migration must add columns and named constraints, then create this fully qualified function contract. `ON CONFLICT DO NOTHING` is required because a missing row cannot be locked; after a conflicting insert finishes, the following statement obtains a fresh READ COMMITTED snapshot, locks the winner, and exact-compares it:

```sql
create function public.ensure_journal_contact(
  p_id uuid,
  p_full_name text,
  p_email text,
  p_subject text,
  p_message text,
  p_created_at timestamptz,
  p_journal_schema text,
  p_journal_key_id text,
  p_journal_mac text
) returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  existing public.contact_messages%rowtype;
  inserted_rows integer;
begin
  if p_id is null
     or p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_journal_schema is distinct from 'mlp.contact.v1'
     or p_journal_key_id is null
     or p_journal_key_id !~ '^[a-z0-9][a-z0-9._-]{0,31}$'
     or p_journal_mac is null
     or p_journal_mac !~ '^[A-Za-z0-9_-]{43}$'
     or p_created_at is null
     or date_trunc('milliseconds', p_created_at) is distinct from p_created_at then
    raise exception using errcode = '22023', message = 'journal contact rejected';
  end if;

  insert into public.contact_messages (
    id, full_name, email, subject, message, created_at,
    journal_schema, journal_key_id, journal_mac
  ) values (
    p_id::text, p_full_name, p_email, p_subject, p_message, p_created_at,
    p_journal_schema, p_journal_key_id, p_journal_mac
  ) on conflict (id) do nothing;
  get diagnostics inserted_rows = row_count;

  if inserted_rows = 1 then
    return 'inserted';
  end if;

  select * into existing
  from public.contact_messages
  where id = p_id::text
  for update;

  if not found then
    raise exception using errcode = '40001', message = 'journal contact conflict';
  end if;

  if row(existing.full_name, existing.email, existing.subject,
         existing.message, existing.created_at, existing.journal_schema,
         existing.journal_key_id, existing.journal_mac)
     is not distinct from
     row(p_full_name, p_email, p_subject, p_message, p_created_at,
         p_journal_schema, p_journal_key_id, p_journal_mac) then
    return 'matched';
  end if;

  raise exception using errcode = '23505', message = 'journal contact conflict';
end
$$;
```

Before granting execute, revoke direct `INSERT` from `portfolio_app` and revoke function execute from `PUBLIC`. The `down` migration drops the function, restores the exact migration-002 INSERT grant, removes named constraints, then removes the three columns.

- [ ] **Step 4: Add bounded PostgreSQL settings and expose the shared pool**

Extend `DatabaseConfig` with `statementTimeoutMillis`, parse `PGSTATEMENT_TIMEOUT_MS` as a positive integer capped at 60,000, and pass it to the `pg.Pool` as `statement_timeout`. Runtime values are 5,000 ms for app and 60,000 ms for migrator/operator. Add unit cases for missing/default, zero, fractional, infinite, and above-cap values. `server/db/client.ts` owns one shared `Pool`, passes it to `PostgresDialect`, and exports `getDatabasePool()` for the contact repository; it must not create a pool per request. Update `tests/helpers/postgres.ts` to create all three runtime roles, create each isolated database owned by `portfolio_migrator`, and supply the new config field so ownership tests reflect production.

- [ ] **Step 5: Write failing repository and abort tests**

The function cases already written in Step 1 remain the database boundary suite. Extend `tests/integration/db/repositories.test.ts` to require:

- first call returns `inserted`, exact retry returns `matched`, and any unknown result/error maps to a fixed non-value-bearing repository error;
- all SQL values are parameterized;
- an already-aborted signal acquires no client and writes nothing;
- while a separate transaction holds the target row lock, abort after 100 ms destroys the dedicated pool client, rejects generically, writes nothing, and leaves no matching active query in `pg_stat_activity` within two seconds.

```ts
await expect(
  repository.ensureJournalContact(input, new AbortController().signal),
).resolves.toBe('inserted');
await expect(
  repository.ensureJournalContact(input, new AbortController().signal),
).resolves.toBe('matched');
```

- [ ] **Step 6: Run function tests and verify RED**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/integration/db/contact-journal.test.ts \
  tests/integration/db/repositories.test.ts --no-file-parallelism
```

Expected: FAIL because the repository still performs direct INSERT and has no abort-aware pool-client lifecycle.

- [ ] **Step 7: Implement the repository function call**

Replace `insertContact` with:

```ts
export interface JournalContactInput extends NewContactMessage {
  journalSchema: 'mlp.contact.v1';
  journalKeyId: string;
  journalMac: string;
}

export interface ContactRepository {
  ensureJournalContact(
    message: JournalContactInput,
    signal: AbortSignal,
  ): Promise<'inserted' | 'matched'>;
}
```

Construct the repository with the shared `pg.Pool`. Acquire through the callback API so an abort that wins while queued marks the request settled and immediately destroys/releases any client delivered later. After acquisition, register one `{once:true}` abort listener that calls `client.release(true)`; execute one parameterized `select public.ensure_journal_contact(...) as outcome`; accept only the two literal outcomes. Remove the listener and release exactly once on every path. Map every other result/error to a fixed repository error without interpolating database values/messages. The server-side `statement_timeout=5000` is defense in depth; the request signal is what stops PostgreSQL work at the 20-second end-to-end deadline.

- [ ] **Step 8: Run PostgreSQL 18.4 suites, typechecks, and commit**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn test:integration
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn test:unit
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn typecheck
git diff --check
git add server/db server/repositories/contact-repository.ts tests/helpers/postgres.ts \
  tests/unit/db/config.test.ts tests/integration/db
git commit -m "feat(db): enforce journal-backed contact inserts"
```

Expected: migration latest is 003, full privilege matrix passes, and no app direct contact insert remains.

---

### Task 5: Prepare/project/accept state machine and API contract

**Files:**

- Create: `server/journal/contact-journal.ts`
- Create: `server/journal/metrics.ts`
- Create: `tests/unit/journal/contact-journal.test.ts`
- Create: `tests/unit/journal/metrics.test.ts`
- Modify: `server/api/contact-handler.ts`
- Modify: `src/pages/api/contact/route.ts`
- Modify: `tests/unit/api/contact-handler.test.ts`
- Modify: `tests/helpers/next-api.ts`

**Interfaces:**

- Consumes: Tasks 1–4 `AgeProcess`, `JournalObjectStore`, `ContactRepository`, canonical/authentication functions, `randomUUID`, and `now`.
- Produces: `ContactJournal.accept(input, signal): Promise<{id:string}>`, typed `ContactConflictError`/`ContactUnavailableError`, `serializeJournalOutcome(outcome): string`, response `Idempotency-Key`, and exact HTTP mappings.

- [ ] **Step 1: Write the complete failing state-transition table**

Use small in-memory behavioral ports that store real encoded bytes and enforce conditional writes; do not assert that mocks were called. Drive the real journal service through these states:

```text
ABSENT -> PREPARED -> PROJECTED -> ACCEPTED
PREPARED -> PROJECTED -> ACCEPTED
PROJECTED -> ACCEPTED
ACCEPTED -> ACCEPTED
```

Inject one failure/ambiguous outcome immediately before and after each intent PUT, DB call, and marker PUT. Assert: no 201-equivalent result before a verified marker; ambiguous PUT performs exactly one GET verification; invalid/missing GET fails closed; same-key/same-normalized-body reuses stored `createdAt`; same-key/different-body conflicts; existing mismatched envelope/marker never gets overwritten; concurrent identical requests converge; concurrent different payloads produce one winner; timer/abort listeners are cleaned.

Add an explicit rotation case: create PREPARED and PROJECTED intents with a retained old key generation, switch `activeKeyId` to a new generation while keeping both verification keys, retry, and require the new marker's `keyId` and receipt MAC to use `verifiedIntent.keyId`/`macKeys.get(verifiedIntent.keyId)`, never the current active generation. Remove that retained old key and require generic unavailability without writing a marker.

Exercise every error class explicitly. `ContactConflictError` is permitted only after a stored intent has authenticated successfully and the constant-time plaintext-MAC comparison proves that the normalized request payload differs. Invalid, missing, or unauthenticated intent/marker bytes; envelope-marker disagreement; absent retained keys; and repository disagreement/corruption must all become `ContactUnavailableError`. Prove none of those latter cases are misclassified as a payload conflict.

Create a separate metrics test that permits only these fixed values:

```ts
export type JournalOutcome =
  | 'intent_failure'
  | 'projection_failure'
  | 'marker_failure'
  | 'conflict'
  | 'success';

export function serializeJournalOutcome(outcome: JournalOutcome): string;
```

Each record is exactly `{"event":"contact_journal","outcome":"<fixed>"}` plus one newline. The function accepts only the union value, constructs the two-field literal internally, and has no labels/metadata parameter. Prove contact, UUID, object, hash, endpoint, key, and secret sentinels cannot enter its output.

- [ ] **Step 2: Run the journal service test and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/contact-journal.test.ts \
  tests/unit/journal/metrics.test.ts
```

Expected: FAIL because `server/journal/contact-journal.ts` and `server/journal/metrics.ts` do not exist.

- [ ] **Step 3: Implement the bounded state machine**

Expose this dependency boundary:

```ts
export interface ContactJournal {
  accept(
    input: {
      id: string;
      fullName: string;
      email: string;
      subject: string;
      message: string;
    },
    signal: AbortSignal,
  ): Promise<{ id: string }>;
}

export function createContactJournal(deps: {
  store: JournalObjectStore;
  age: AgeProcess;
  contacts: ContactRepository;
  activeKeyId: string;
  ageRecipient: string;
  macKeys: ReadonlyMap<string, Buffer>;
  now(): Date;
  emitMetricLine(line: string): void;
}): ContactJournal;
```

For a new intent, canonicalize `createdAt` from `now().toISOString()`, encrypt, authenticate, encode, and conditionally PUT. For `exists` or `ambiguous`, GET and authenticate the stored intent, rebuild the requested contact using the stored timestamp, and constant-time compare its plaintext MAC. Only that successful authentication followed by a differing plaintext MAC may throw `ContactConflictError`; every other journal or repository inconsistency throws `ContactUnavailableError`. Project only exact verified intent fields through `ensureJournalContact(input, signal)`. Build/PUT the marker with the retained MAC key selected by `verifiedIntent.keyId`—never blindly with `activeKeyId`—and fail unavailable before PUT if that key is absent. Then always prove either the just-built or fetched marker with the verified intent before returning. Perform no retry loop beyond the single verification GET required by an existing/ambiguous PUT. In one outer `try/catch`, map each terminal path to exactly one `serializeJournalOutcome` call and pass the returned fixed line to `emitMetricLine`; no request-derived value reaches that dependency. Production assembly sets `emitMetricLine: (line) => process.stdout.write(line)`.

- [ ] **Step 4: Write failing API contract tests**

Extend handler tests to require:

- missing header gets a generated canonical lowercase UUID and returns it as `Idempotency-Key`;
- one valid header is preserved in the response;
- array, comma-joined, whitespace, uppercase, non-v4, or malformed key returns the existing HTTP 400 body without journal access;
- normalized body is passed to the journal;
- same-key/different-body conflict maps to exact `409 {"errorMessage":"Unable to send message.","success":false}`;
- invalid/missing/unauthenticated journal objects, envelope-marker disagreement, absent retained keys, and repository disagreement are `ContactUnavailableError` and map to the exact current 503 body, never 409;
- unavailable/timeout maps to the exact current 503 body;
- 201/400/405 bodies remain exact;
- every POST with a valid or missing key includes the effective key; malformed-key 400 and 405 responses do not echo or manufacture one;
- handler passes a signal that aborts at 20,000 ms and clears its timer after completion;
- when the journal is blocked in PostgreSQL, the same signal reaches `ensureJournalContact`, aborts its dedicated client, and the handler does not outlive the 20-second deadline (Task 4 runs the real 100 ms analogue);
- thrown sentinel values never appear in the response.

- [ ] **Step 5: Run API tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/api/contact-handler.test.ts
```

Expected: FAIL because the handler has no idempotency header or journal dependency.

- [ ] **Step 6: Implement the API boundary and production assembly**

Change the handler dependency to:

```ts
export function createContactHandler(deps: {
  acceptContact(input: ContactSubmission, signal: AbortSignal): Promise<void>;
  randomUUID(): string;
}): NextApiHandler;
```

Validate `request.headers['idempotency-key']` as exactly one canonical v4 UUID; generate when absent; set `Idempotency-Key` before calling the journal. Use one 20-second `AbortController`, clear its timer in `finally`, and map only `ContactConflictError` to 409; every other journal/storage/database/abort error maps to generic 503.

The controller signal is the single end-to-end cancellation source. R2 body reads, age subprocesses, and the repository's pool client all consume that same signal; the handler awaits their rejection before sending 503, so no database work can continue after the HTTP deadline.

In `src/pages/api/contact/route.ts`, lazily construct one singleton writer config, R2 store, age process, repository, and contact journal. Do not construct them for GET/405. Do not add R2 to `/api/health/ready`.

- [ ] **Step 7: Run journal/API/unit suites, typecheck, and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal tests/unit/api/contact-handler.test.ts
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn test:unit
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn typecheck
git diff --check
git add server/journal/contact-journal.ts server/journal/metrics.ts \
  server/api/contact-handler.ts src/pages/api/contact/route.ts \
  tests/unit/journal/contact-journal.test.ts tests/unit/journal/metrics.test.ts \
  tests/unit/api/contact-handler.test.ts tests/helpers/next-api.ts
git commit -m "feat(contact): accept only verified journal writes"
```

Expected: global readiness tests remain unchanged and pass without R2 configuration.

---

### Task 6: First-party stable idempotency key and submit lock

**Files:**

- Create: `src/contact/idempotency.ts`
- Create: `tests/unit/contact/idempotency.test.ts`
- Create: `tests/e2e/contact-idempotency.spec.ts`
- Modify: `src/components/Form.tsx`

**Interfaces:**

- Consumes: normalized four-field browser payload and `crypto.randomUUID()`.
- Produces: one key per unchanged logical submission, retained across ambiguous/unavailable results, reset on edit after failure and after confirmed success, plus a disabled in-flight submit button.

- [ ] **Step 1: Write failing pure browser-state tests**

Define the desired reducer/API first:

```ts
export interface PendingContactAttempt {
  key: string;
  canonicalPayload: string;
}

export function contactPayloadJson(input: ContactFormValues): string;
export function selectAttempt(
  current: PendingContactAttempt | null,
  input: ContactFormValues,
  randomUUID: () => string,
): PendingContactAttempt;
```

Assert deterministic trimmed payload field order, reuse for identical normalized values, a new key after any normalized field changes, and rejection of non-canonical UUID output.

- [ ] **Step 2: Run pure tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/contact/idempotency.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure state functions**

Manually serialize `{fullName,email,subject,message}` in that order after `.trim()`. Reuse only when the exact canonical payload matches; otherwise call the injected UUID generator and validate its canonical lowercase v4 result.

- [ ] **Step 4: Write failing Playwright behavior tests against the real form**

Intercept only `/api/contact/route`, capture actual request headers/body, and return complete production-shaped responses. Cover:

1. first click sends one canonical `Idempotency-Key` and disables the button;
2. second click while unresolved emits no request;
3. HTTP 503 then retry without editing reuses the key;
4. invalid JSON/disconnect then retry reuses the key;
5. editing any field after failure creates a new key;
6. HTTP 201 clears fields and key; the next submission gets a new key;
7. HTTP 409 displays only the generic error and keeps the key until edit/retry decision.

- [ ] **Step 5: Run the Playwright test and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn playwright test tests/e2e/contact-idempotency.spec.ts --project=chromium
```

Expected: FAIL because the form sends no idempotency header and permits concurrent submits.

- [ ] **Step 6: Wire the form state machine**

Add `submitting` and `pendingAttempt` state. On submit, return immediately if already submitting, select/reuse the attempt from the normalized values, send `Idempotency-Key`, and set `submitting` in a `try/finally`. Keep the attempt after any non-success or parse/network error. Clear it only after a confirmed `res.ok && data.success === true`; input edits naturally cause `selectAttempt` to replace it on the next submission. Set the button's `disabled`, `aria-disabled`, and visible pending label without logging the caught error object.

- [ ] **Step 7: Run unit/browser/typecheck and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/contact/idempotency.test.ts
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn playwright test tests/e2e/contact-idempotency.spec.ts --project=chromium
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn typecheck
git diff --check
git add src/contact/idempotency.ts src/components/Form.tsx \
  tests/unit/contact/idempotency.test.ts tests/e2e/contact-idempotency.spec.ts
git commit -m "feat(contact): retain browser idempotency keys"
```

Expected: no browser console error contains form content or response details.

---

### Task 7: App image, Compose, secret staging, and deterministic configuration gates

**Files:**

- Modify: `Dockerfile`
- Modify: `compose.production.yml`
- Modify: `ops/compose.sh`
- Modify: `scripts/verify-production-config.mjs`
- Modify: `infra/runtime.example/env/app.env`
- Create: `infra/runtime.example/secrets/journal-r2-access-key-id`
- Create: `infra/runtime.example/secrets/journal-r2-secret-access-key`
- Create: `infra/runtime.example/secrets/journal-mac-keyring`
- Modify: `infra/runtime.example/README.md`
- Modify: `infra/proxmox/bootstrap-vm.sh`
- Modify: `tests/infra/docker-image.test.mjs`
- Modify: `tests/infra/compose.test.mjs`
- Modify: `tests/infra/compose-wrapper.test.mjs`
- Modify: `tests/infra/proxmox.test.mjs`

**Interfaces:**

- Consumes: app config names from Task 3 and age 1.3.1 from Task 2.
- Produces: exactly three new app-only Compose secret mounts, exact non-secret journal environment, fixed host staging, and a checksum-verified age binary in the app image.

- [ ] **Step 1: Write failing image and Compose invariants**

Extend deterministic tests to require:

- service list remains exactly seven and permanent service list remains five;
- only `app` receives `journal-r2-access-key-id`, `journal-r2-secret-access-key`, and `journal-mac-keyring` targets;
- no recovery/admin/age identity secret appears anywhere in Compose;
- only app environment receives journal settings and only app has existing `egress` access;
- no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` environment values are used;
- app image contains `/usr/local/bin/age`, mode `0555`, owner root, version exactly `v1.3.1`, and no `age-keygen`/identity;
- image history/SBOM/metadata and every non-app image contain none of the new secret names or sentinels;
- wrapper accepts canonical sources only as regular root:root mode `0600`, `nlink=1`, non-symlink files; opens them with `O_NOFOLLOW` and verifies lstat/fstat `dev`/`ino`; stages fresh regular UID/GID 1000 mode `0400`, `nlink=1` files; refuses rotation behind a running bind inode; and clears inherited `JOURNAL_`/`AWS_` variables.

- [ ] **Step 2: Run infrastructure suites and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/docker-image.test.mjs tests/infra/compose.test.mjs \
  tests/infra/compose-wrapper.test.mjs tests/infra/proxmox.test.mjs
```

Expected: FAIL because the journal runtime contract is absent.

- [ ] **Step 3: Install the checksum-pinned age binary into the app image**

Add a dedicated build stage that downloads exactly:

```dockerfile
ADD --checksum=sha256:bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377 \
  https://github.com/FiloSottile/age/releases/download/v1.3.1/age-v1.3.1-linux-amd64.tar.gz \
  /tmp/age.tgz
```

Verify `uname -m` is `x86_64`, verify the archive again with `sha256sum -c`, extract only `age/age`, install root:root `0555`, remove the archive/extraction tree, and copy only `/usr/local/bin/age` into the final runner. Add a final non-root build check for exact version and non-writability.

- [ ] **Step 4: Add exact app runtime settings and secrets**

Map these required app environment values:

```yaml
JOURNAL_R2_ENDPOINT: ${APP_JOURNAL_R2_ENDPOINT:?APP_JOURNAL_R2_ENDPOINT is required}
JOURNAL_R2_BUCKET: ${APP_JOURNAL_R2_BUCKET:?APP_JOURNAL_R2_BUCKET is required}
JOURNAL_ACTIVE_KEY_ID: ${APP_JOURNAL_ACTIVE_KEY_ID:?APP_JOURNAL_ACTIVE_KEY_ID is required}
JOURNAL_AGE_RECIPIENT: ${APP_JOURNAL_AGE_RECIPIENT:?APP_JOURNAL_AGE_RECIPIENT is required}
JOURNAL_R2_ACCESS_KEY_ID_FILE: /run/secrets/journal-r2-access-key-id
JOURNAL_R2_SECRET_ACCESS_KEY_FILE: /run/secrets/journal-r2-secret-access-key
JOURNAL_MAC_KEYRING_FILE: /run/secrets/journal-mac-keyring
PGSTATEMENT_TIMEOUT_MS: ${APP_PGSTATEMENT_TIMEOUT_MS:?APP_PGSTATEMENT_TIMEOUT_MS is required}
```

Add `MIGRATOR_PGSTATEMENT_TIMEOUT_MS` mapping for the migrator. Add exact app env example values: bucket `mlp-contact-journal`, endpoint placeholder with `.eu.r2.cloudflarestorage.com`, app statement timeout `5000`, and public age/key-ID placeholders that fail the production verifier until replaced.

- [ ] **Step 5: Expand fixed wrapper allowlists and staging**

Add canonical root-only source files under `/etc/mlp/secrets/`. Before any staging, require `lstat` plus no-follow open/fstat agreement on device/inode, regular type, root:root ownership, exact mode `0600`, and link count one. Copy through the validated descriptor into a newly created destination; then require regular type, UID/GID 1000, exact mode `0400`, link count one, and a different inode from both source and prior stage. Stage:

```text
journal-r2-access-key-id -> journal-r2-access-key-id-app 1000:1000 0400
journal-r2-secret-access-key -> journal-r2-secret-access-key-app 1000:1000 0400
journal-mac-keyring -> journal-mac-keyring-app 1000:1000 0400
```

Extend the app env allowlist with the four `APP_JOURNAL_*` keys plus `APP_PGSTATEMENT_TIMEOUT_MS`; extend migrator with its statement timeout. Clear inherited `AWS_` and `JOURNAL_` prefixes before loading fixed files. Have bootstrap create empty root:root mode-`0600` canonical placeholders only on first install; never overwrite an existing secret.

- [ ] **Step 6: Make production config verification strict**

Require exact bucket, EU endpoint shape, canonical key ID, valid age recipient, app statement timeout `5000`, migrator statement timeout `60000`, and the existing immutable image references. Reject placeholder/unconfigured values and any extra service/secret/environment/mount.

- [ ] **Step 7: Run Compose/image/provisioning suites and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/docker-image.test.mjs tests/infra/compose.test.mjs \
  tests/infra/compose-wrapper.test.mjs tests/infra/proxmox.test.mjs
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn test:compose
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn typecheck
git diff --check
git add Dockerfile compose.production.yml ops/compose.sh \
  scripts/verify-production-config.mjs infra/runtime.example infra/proxmox/bootstrap-vm.sh \
  tests/infra/docker-image.test.mjs tests/infra/compose.test.mjs \
  tests/infra/compose-wrapper.test.mjs tests/infra/proxmox.test.mjs
git commit -m "feat(runtime): mount journal writer secrets only in app"
```

Expected: rendered Compose has exactly seven services, three new app-only secret targets, and zero new ports.

---

### Task 8: Stable accepted-set inventory and exact recovery engine

**Files:**

- Create: `server/journal/recovery.ts`
- Create: `server/journal/recovery-staging.ts`
- Create: `scripts/journal/recover.ts`
- Create: `tests/unit/journal/recovery.test.ts`
- Create: `tests/integration/db/journal-recovery.test.ts`
- Modify: `tsconfig.migration-build.json`
- Modify: `infra/migration/Dockerfile`
- Modify: `infra/migration/entrypoint.sh`
- Modify: `tests/infra/migration-image.test.mjs`

**Interfaces:**

- Consumes: read-only `JournalObjectReader`, age identities/keyring, one dedicated `portfolio_migrator` PostgreSQL pool client, an explicit Restic snapshot ID, and a drained/stable inventory.
- Produces: two equal redacted inventory watermarks, session-local PostgreSQL staging instead of an in-memory contact array, one SERIALIZABLE reconciliation, a separate post-commit exact subset proof, and a strict no-PII `JournalRecoveryReport`.

- [ ] **Step 1: Write failing inventory/authentication tests**

Use an in-memory object store containing real encoded marker/intent fixtures and a behavioral `RecoveryStaging` port. Require complete pagination until no token, a second independent complete listing/GET pass, and exact equality of count plus digest. Build each digest line exactly:

```ts
`${keyId}\t${id}\t${mac}\t${ciphertextSha256}\t${envelopeMac}\t${receiptMac}\n`;
```

The staging port returns each pass's lines in unsigned UTF-8 byte order; hash them incrementally without collecting them. Reject duplicate keys/IDs, prefix/key/ID mismatch, unstable inventories, missing intent/marker, corrupt/unknown JSON fields, unknown key ID, any bad MAC/hash/receipt, age failure, plaintext schema/ID/timestamp/MAC mismatch, noncanonical decrypted bytes, and LIST token loops. Count intent-only objects separately and never stage them as replay candidates. The second pass re-GETs and authenticates every marker and intent before staging its evidence; it does not trust keys from LIST alone.

- [ ] **Step 2: Run recovery unit tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/recovery.test.ts
```

Expected: FAIL because the recovery engine does not exist.

- [ ] **Step 3: Implement stable inventory and exact decryption**

Export:

```ts
export interface AcceptedSetWatermark {
  count: number;
  sha256: string;
  schemas: string[];
  keyIds: string[];
}

export interface RecoveredAcceptedContact {
  contact: CanonicalContact;
  keyId: string;
  mac: string;
}

export interface AcceptedMarkerEvidence {
  id: string;
  keyId: string;
  mac: string;
  ciphertextSha256: string;
  envelopeMac: string;
  receiptMac: string;
}

export interface RecoveryStaging {
  stageFirst(
    evidence: AcceptedMarkerEvidence,
    recovered: RecoveredAcceptedContact,
  ): Promise<void>;
  stageSecond(evidence: AcceptedMarkerEvidence): Promise<void>;
  hasAcceptedId(id: string): Promise<boolean>;
  watermark(pass: 'first' | 'second'): Promise<AcceptedSetWatermark>;
}

export async function readStableAcceptedSet(deps: {
  store: JournalObjectReader;
  age: AgeProcess;
  identityFile: string;
  macKeys: ReadonlyMap<string, Buffer>;
  staging: RecoveryStaging;
  signal: AbortSignal;
}): Promise<{
  watermark: AcceptedSetWatermark;
  pendingIntentCount: number;
}>;
```

Read every marker, verify marker before fetching/decrypting its intent, validate every layer after decryption, immediately pass one bounded record to `staging.stageFirst`, and release its buffers before reading the next object. Perform the complete authenticated second pass into `stageSecond` after all first-pass objects are verified; abort unless the two staged count/digest pairs match. Return only fixed index-free errors.

- [ ] **Step 4: Write failing real PostgreSQL reconciliation tests**

Against PostgreSQL 18.4, restore/seed these cases and run the real recovery API on one dedicated pool client:

- missing accepted rows insert with exact ID/fields/timestamp/journal metadata;
- exact rows count as pre-existing;
- one differing row rolls back every insertion;
- legacy and pending unmarked rows remain untouched and may be additional;
- a rerun after commit is all exact no-op;
- interruption before commit leaves no partial set;
- after commit, a new read-only statement exact-compares all nine stored fields (ID, four contact fields, timestamp, schema, key ID, and MAC) against the still-present temp staging table before any `passed` report can exist;
- two concurrent recovery attempts serialize or one fails safely without divergence.

Create two `ON COMMIT PRESERVE ROWS` temporary tables: the first contains the recovered contact plus all authenticated evidence, and the second contains only authenticated evidence. Add unique constraints for ID and canonical digest line. Compute each watermark with keyset pages of at most 1,000 rows ordered as `convert_to(line, 'UTF8')`, updating one Node SHA-256 incrementally. A capacity fixture stages/reconciles 10,000 valid contacts under `node --max-old-space-size=96`, with separate fixtures at the maximum individual contact/object size; assert at most one object/contact and one 1,000-line page are resident in JavaScript, temp tables are dropped on release, and deadline/capacity failure emits no passing report.

- [ ] **Step 5: Run integration test and verify RED**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/integration/db/journal-recovery.test.ts --no-file-parallelism
```

Expected: FAIL because reconciliation is absent.

- [ ] **Step 6: Implement one SERIALIZABLE recovery transaction**

Export:

```ts
export async function withRecoverySession<T>(
  pool: Pool,
  operation: (session: RecoverySession) => Promise<T>,
): Promise<T>;

export interface RecoverySession extends RecoveryStaging {
  reconcileAcceptedContacts(): Promise<{
    preExisting: number;
    inserted: number;
    final: number;
    mismatch: 0;
  }>;
  proveExactRowsAfterCommit(): Promise<void>;
}

export async function reconcileAcceptedContacts(
  session: RecoverySession,
): Promise<{
  preExisting: number;
  inserted: number;
  final: number;
  mismatch: 0;
}>;
```

`withRecoverySession` acquires one client, creates the temp tables, runs the operation, drops them, and destroys the client on abort/error uncertainty. Reconciliation runs a SERIALIZABLE transaction, `LOCK TABLE public.contact_messages IN SHARE ROW EXCLUSIVE MODE`, rejects any existing differing row with one fixed exception, inserts missing staged rows as migrator, and exact-compares the full staged subset before commit. After `COMMIT` returns, `proveExactRowsAfterCommit()` executes a separate read-only query against the retained first-pass temp table and exact-compares ID, four contact fields, timestamp, schema, key ID, and MAC. Only that post-commit method can authorize report creation. Do not delete or update any application row.

- [ ] **Step 7: Add an immutable operator entrypoint**

`scripts/journal/recover.ts` must load only recovery config, require `RESTIC_SNAPSHOT_ID` matching `^[0-9a-f]{64}$`, create one overall abort from the manifest-supplied `RECOVERY_DEADLINE_SECONDS` in the accepted 7,200..604,800 range, and call `withRecoverySession` → stable inventory → reconciliation → `proveExactRowsAfterCommit`. The deadline is explicit and bounded but not a false fixed two-hour capacity claim; expiry fails closed, keeps maintenance active, and emits no `passed` report. After the post-commit proof, atomically write mode-`0600` output as UID 1000 into the exact writable bind `/run/recovery-output`; the root wrapper validates and installs it. The report schema is exactly:

```ts
interface JournalRecoveryReport {
  status: 'passed';
  startedAt: string;
  completedAt: string;
  resticSnapshotId: string;
  r2BucketJurisdiction: 'eu';
  r2LockRuleId: string;
  acceptedSetCount: number;
  acceptedSetSha256: string;
  schemas: string[];
  keyIds: string[];
  preExisting: number;
  inserted: number;
  final: number;
  pending: number;
  mismatch: 0;
}
```

Compile shared journal and recovery sources into `operator-dist`, copy them and exact AWS SDK production dependencies into the existing migration operator image, and add an entrypoint case `journal-recover` that first unsets every Mongo writer/export value. Do not copy recovery secret material into any image layer.

- [ ] **Step 8: Run unit/integration/image suites and commit**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/recovery.test.ts \
  tests/integration/db/journal-recovery.test.ts --no-file-parallelism
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/migration-image.test.mjs
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn build:migration
git diff --check
git add server/journal/recovery.ts server/journal/recovery-staging.ts \
  scripts/journal/recover.ts \
  tests/unit/journal/recovery.test.ts tests/integration/db/journal-recovery.test.ts \
  tsconfig.migration-build.json infra/migration/Dockerfile \
  infra/migration/entrypoint.sh tests/infra/migration-image.test.mjs
git commit -m "feat(recovery): replay exact accepted journal set"
```

Expected: recovery image has read/list code but no bucket-admin or permanent recovery credential.

---

### Task 9: Root-only recovery orchestration and drain evidence

**Files:**

- Create: `ops/journal-recover.sh`
- Create: `tests/infra/journal-recovery-ops.test.mjs`
- Modify: `ops/contact-mode.sh`
- Modify: `infra/proxmox/bootstrap-vm.sh`
- Modify: `infra/tmpfiles.d/mlp.conf`
- Modify: `tests/infra/contact-mode.test.mjs`
- Modify: `tests/infra/proxmox.test.mjs`
- Modify: `tests/infra/ops-security.test.mjs`

**Interfaces:**

- Consumes: an exact operator image digest already locally pulled/inspected, contact-maintenance evidence, a stopped app writer, fixed incident secret files in tmpfs, a reviewed internal replacement PostgreSQL network/container, a wrapper-created ephemeral egress network, and explicit snapshot ID.
- Produces: `/usr/local/sbin/mlp-journal-recover`, a root-only recovery report, cleanup proof, and no permanent secret residue.

- [ ] **Step 1: Write failing hostile-environment/orchestration tests**

The sourceable shell harness must prove:

- privileged Bash, tracing disabled before environment access, fixed PATH/locale/umask, root-only, global operations lock;
- no caller override for script, Docker, Compose, config, secret, report, or working paths;
- recovery starts only when Caddy reports `contact-maintenance`, that state is stable for longer than 20 seconds, and the app container is then stopped/absent;
- it does not self-assert a `CONTACT_TRAFFIC_DRAINED=yes` variable;
- replacement database network/container/image/run ID come from one root-owned strict manifest and match fixed regexes plus labels; the database network must inspect as `Internal=true`;
- exact digest is inspected as local `linux/amd64` before `docker create --pull never`;
- the run directory and manifest are root-owned mode `0700`/`0600`; the wrapper copies operator-supplied sources into regular, non-symlink, single-link staged files as UID/GID 1000 mode `0400` under that inaccessible tmpfs directory and mounts only those copies read-only at `/run/recovery-secrets/`;
- wrapper creates one labeled, non-internal, ICC-disabled ephemeral bridge named from the validated run ID; creates the container without starting it on the internal database network, connects the ephemeral egress network with exact `docker network connect --gw-priority 1 "$egress_network" "$container"`, and only then starts it, so PostgreSQL stays unpublished while DNS/TLS to R2 works;
- before start, parsed container-inspect JSON proves exactly those two attachments, `GwPriority == 1` for the egress endpoint, and a strictly lower priority for the internal database endpoint; missing/non-numeric/equal priorities fail closed;
- container is non-root, read-only, all capabilities dropped, no-new-privileges, attached only to those two inspected networks, tmpfs `/tmp`, one UID-1000 writable report bind, no published port, log driver `none`, and an explicit manifest deadline in `7200..604800` seconds;
- a live success proves both replacement PostgreSQL and R2 DNS/TLS connectivity; every exit removes the labeled container and ephemeral egress network, and teardown uncertainty is failure;
- report is strict/redacted and atomically installed root:root `0600`;
- labeled container and incident tmpfs directory are proven absent before success; cleanup uncertainty retains secured evidence and returns nonzero;
- signals terminate/kill/reap the child and cannot report success.

- [ ] **Step 2: Run ops tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/journal-recovery-ops.test.mjs
```

Expected: FAIL because no recovery wrapper exists.

- [ ] **Step 3: Add machine-verifiable contact drain evidence**

Extend `ops/contact-mode.sh` so a successful stable maintenance transition atomically writes `/var/lib/mlp/contact-mode/maintenance.json` with only:

```json
{
  "mode": "contact-maintenance",
  "verifiedAt": "2026-07-16T12:00:00Z",
  "maximumRequestSeconds": 20
}
```

The recovery wrapper validates root ownership/mode, strict keys/types/time, requires age strictly greater than 20 seconds, re-probes maintenance, then stops the app and proves its container is absent before any R2 listing. Enabling contacts atomically invalidates/removes the maintenance evidence. This is the drain contract; no environment assertion is accepted.

- [ ] **Step 4: Implement the fixed recovery wrapper**

Accept exactly one argument: a 32-lowercase-hex run ID naming `/run/mlp/journal-recovery/<run-id>/manifest.json`. The strict manifest contains exact immutable operator image, replacement internal network/container names, PostgreSQL host/database/user, 64-hex Restic snapshot, expected R2 non-secret endpoint/bucket, literal jurisdiction `eu`, canonical effective lock-rule ID, `recoveryDeadlineSeconds` in `7200..604800`, and five absolute source paths from protected removable/operator custody. Validate all unknown fields are absent.

Map the manifest to container environment exactly as follows; no caller environment is forwarded:

```text
PGHOST, PGPORT=5432, PGDATABASE, PGUSER=portfolio_migrator
PGPASSWORD_FILE=/run/recovery-secrets/postgres-password
PGSTATEMENT_TIMEOUT_MS=60000
JOURNAL_R2_ENDPOINT, JOURNAL_R2_BUCKET=mlp-contact-journal
JOURNAL_R2_JURISDICTION=eu, JOURNAL_R2_LOCK_RULE_ID
JOURNAL_R2_ACCESS_KEY_ID_FILE=/run/recovery-secrets/r2-access-key-id
JOURNAL_R2_SECRET_ACCESS_KEY_FILE=/run/recovery-secrets/r2-secret-access-key
JOURNAL_AGE_IDENTITIES_FILE=/run/recovery-secrets/age-identities
JOURNAL_MAC_KEYRING_FILE=/run/recovery-secrets/mac-keyring
RESTIC_SNAPSHOT_ID, RECOVERY_DEADLINE_SECONDS
RECOVERY_REPORT_DIRECTORY=/run/recovery-output
```

Open each source with `O_NOFOLLOW`, require lstat/fstat device/inode agreement, regular type, root ownership, mode `0400` or `0600`, link count one, and bounded size. Copy through the open descriptor into a newly created staged file, `chown 1000:1000`, set exact mode `0400`, and reverify regular type/link count/ownership. Create a fresh UID/GID-1000 mode-`0700` report staging directory in the same root-only tmpfs run directory and mount it read-write only at `/run/recovery-output`; mount only the five staged secret files read-only. Create the container on the inspected internal DB network, run exact `docker network connect --gw-priority 1 "$egress_network" "$container"`, then parse `docker container inspect` and require exactly those two networks with egress `GwPriority` equal to integer `1` and internal priority strictly lower before start. Invoke `journal-recover`, then validate the strict report. The operator process has already performed the exact post-commit row proof while authenticated contacts were available; the wrapper must not claim that report count/digest alone can reconstruct a SQL subset. Atomically install the validated report root:root `0600`, remove the container/networks/tmpfs, and prove cleanup.

- [ ] **Step 5: Install only code/directories, never incident files**

Bootstrap installs the reviewed wrapper root:root `0755` and tmpfiles creates `/var/lib/mlp/contact-mode`, `/var/lib/mlp/journal-recovery-reports`, and `/var/lib/mlp/journal-recovery-evidence` root:root `0700`. It must not create `/run/mlp/journal-recovery/<run-id>` or any recovery credential placeholder.

- [ ] **Step 6: Run shell/infrastructure suites and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/journal-recovery-ops.test.mjs \
  tests/infra/contact-mode.test.mjs tests/infra/proxmox.test.mjs \
  tests/infra/ops-security.test.mjs
shellcheck ops/journal-recover.sh ops/contact-mode.sh infra/proxmox/bootstrap-vm.sh
git diff --check
git add ops/journal-recover.sh ops/contact-mode.sh infra/proxmox/bootstrap-vm.sh \
  infra/tmpfiles.d/mlp.conf tests/infra/journal-recovery-ops.test.mjs \
  tests/infra/contact-mode.test.mjs tests/infra/proxmox.test.mjs \
  tests/infra/ops-security.test.mjs
git commit -m "feat(recovery): require proven contact drain"
```

Expected: the wrapper cannot be invoked by setting a drain environment variable and leaves no incident secret after a passing run.

---

### Task 10: Same-snapshot backup metadata and isolated restore proof

**Files:**

- Modify: `infra/backup/Dockerfile`
- Modify: `infra/backup/backup.sh`
- Modify: `ops/backup.sh`
- Modify: `ops/restore-test.sh`
- Modify: `tests/infra/backup.test.mjs`
- Modify: `tests/infra/restore.test.mjs`
- Modify: `tests/infra/docker-image.test.mjs`
- Modify: `runbooks/postgresql-disaster-recovery.md`

**Interfaces:**

- Consumes: migration 003, PostgreSQL backup role, one exported PostgreSQL snapshot, Restic, and the existing root wrappers.
- Produces: journal-row count/digest proven to describe the same snapshot as `postgresql.dump`, inclusion of its strict manifest in the Restic snapshot, and equality after isolated restore.

- [ ] **Step 1: Write failing backup-image and report tests**

Require the backup image to:

- include exact PostgreSQL 18.4 `psql`, `pg_dump`, and `pg_restore` binaries/libraries;
- begin `REPEATABLE READ READ ONLY`, call `pg_export_snapshot()`, hold that transaction while `pg_dump --snapshot=<exported-id>` completes, and release it on every success/failure/signal;
- select only non-PII journal metadata (`id`, `journal_schema`, `journal_key_id`, `journal_mac`) in the exporting transaction;
- sort canonical tab-separated, newline-terminated rows and SHA-256 them without printing rows;
- write strict `journal-evidence.json` beside `postgresql.dump` and pass the containing snapshot directory to Restic;
- emit exactly one Restic summary and one `mlp_journal_summary` event;
- reject malformed snapshot IDs, counts, digests, unexpected output, or leaked sentinel values.

Require root backup reports to add only `journalRows` and `journalSha256` to the current strict success keys. Failure reports remain value-free.

- [ ] **Step 2: Run backup tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/backup.test.mjs tests/infra/docker-image.test.mjs
```

Expected: FAIL because backup evidence has no journal fields or exported-snapshot coordination.

- [ ] **Step 3: Add psql to the minimal backup image**

Extend the existing allowlisted PostgreSQL tool copy to `/usr/local/bin/psql` and only the same resolved runtime libraries already validated from the exact PostgreSQL image. Test version `18.4`, executable mode `0555`, root ownership, and non-writability as UID 10001.

- [ ] **Step 4: Implement one held exported snapshot**

Inside the rootless backup container, use a mode-`0700` private work directory, a mode-`0600` control FIFO, and a separate private acknowledgement FIFO. Start this exact output contract as a tracked child, keeping the control writer descriptor open:

```bash
psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 \
  --no-align --tuples-only \
  --field-separator=$'\t' --record-separator=$'\n' \
  <"$control_fifo" >"$ack_fifo" 2>/dev/null &
```

Send these commands with the two output paths replaced only by fixed files inside the private work directory:

```sql
begin transaction isolation level repeatable read read only;
\o /work/private/snapshot-id.tmp
select pg_export_snapshot();
\o /work/private/journal-rows.tmp
select id, journal_schema, journal_key_id, journal_mac
from public.contact_messages
where journal_schema is not null
order by id collate "C";
\o
\echo mlp_backup_metadata_ready_v1
```

Read exactly one acknowledgement line equal to `mlp_backup_metadata_ready_v1`; reject EOF, any extra line, or any other text. Because psql processes `\o` closure before `\echo`, that line is the deterministic proof that both private files are closed and complete. Validate the one-line exported snapshot ID against PostgreSQL's exported-snapshot grammar and validate every metadata row as four canonical tab-separated fields before use. With the exporting transaction still blocked on the open control FIFO, run `pg_dump --format=custom --snapshot="$snapshot_id"`. Only after a zero exit send `commit;` and `\q`, close the writer, and reap psql at zero. On error/signal send `rollback;`/`\q` when possible, then TERM/KILL/reap; never leave the exporter transaction alive. The metadata file is already canonical `id<TAB>schema<TAB>keyId<TAB>mac\n`; compute count/digest without echoing rows and atomically create:

```json
{
  "schema": "mlp.backup-journal.v1",
  "journalRows": 0,
  "journalSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

Back up the directory containing exactly `postgresql.dump` and `journal-evidence.json`; suppress data-bearing subprocess stderr.

- [ ] **Step 5: Write failing isolated-restore equality tests**

Require restore to locate exactly one dump and exactly one strict evidence manifest from the explicit Restic snapshot. After restoring, query journal metadata as `portfolio_backup`, recompute the same canonical count/digest, and require equality before the restore can pass. Update the representative app write: direct INSERT must now fail; a rolled-back `ensure_journal_contact` call must succeed. Require latest migration `003_contact_journal` and function/ACL checks.

- [ ] **Step 6: Run restore tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/restore.test.mjs
```

Expected: FAIL because restore ignores a journal evidence manifest and still expects a direct app insert.

- [ ] **Step 7: Implement strict restore comparison and report fields**

Validate the manifest before starting the database. Recompute after restore without placing rows in stdout/stderr. Add `journalRows` and `journalSha256` to the strict success report and require they equal the backup report for the exact snapshot. Preserve the existing labeled cleanup and plaintext evidence behavior on all failures.

- [ ] **Step 8: Run all backup/restore/image suites and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/backup.test.mjs tests/infra/restore.test.mjs \
  tests/infra/docker-image.test.mjs
shellcheck infra/backup/backup.sh ops/backup.sh ops/restore-test.sh
git diff --check
git add infra/backup/Dockerfile infra/backup/backup.sh ops/backup.sh \
  ops/restore-test.sh tests/infra/backup.test.mjs tests/infra/restore.test.mjs \
  tests/infra/docker-image.test.mjs runbooks/postgresql-disaster-recovery.md
git commit -m "feat(backup): prove journal metadata in each snapshot"
```

Expected: an isolated restore cannot pass with a manifest from a different dump.

---

### Task 11: Cloudflare R2 configuration and live least-privilege gate

**Files:**

- Create: `scripts/acceptance/r2-journal-config.sh`
- Create: `scripts/journal/live-r2-gate.ts`
- Create: `tests/infra/r2-journal-gates.test.mjs`
- Create: `tests/unit/journal/live-r2-gate.test.ts`
- Modify: `tsconfig.migration-build.json`
- Modify: `infra/migration/Dockerfile`
- Modify: `infra/migration/entrypoint.sh`
- Modify: `tests/infra/migration-image.test.mjs`
- Create: `runbooks/contact-journal.md`
- Modify: `infra/cloudflare/README.md`

**Interfaces:**

- Consumes: off-VM bucket-admin bearer token for read/configuration operations, independent bucket-scoped writer and recovery S3 credentials, public recipient plus escrowed test identity/MAC key, and the immutable operator image.
- Produces: strict configuration evidence and live non-PII object/IAM/consistency/lock evidence before app credentials are installed on the VM.

- [ ] **Step 1: Write failing configuration-gate shell tests**

Stub fixed `/usr/bin/curl` and require the script to read token/account ID from root-owned mode-`0600` files into a temporary header file, never arguments/output. Validate exact Cloudflare API responses for:

- bucket name `mlp-contact-journal`, jurisdiction header/result `eu`, Standard storage;
- public access disabled and no custom domains;
- no CORS rule, no lifecycle rule of any kind, no event notification, disabled `r2.dev`, and no custom domain;
- an enabled lock rule covering exact prefix `v1/` with age `>= 5184000` seconds;
- no broader credential or output disclosure;
- strict `success:true`, empty standard error/message arrays, official response keys only, and rejection of unknown/ambiguous response shapes.

- [ ] **Step 2: Run configuration-gate tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/r2-journal-gates.test.mjs
```

Expected: FAIL because the gate does not exist.

- [ ] **Step 3: Implement the read/configuration gate**

Read and validate `account_id` from the protected file, set `base="https://api.cloudflare.com/client/v4/accounts/${account_id}"`, and make exactly these journal-bucket GET requests:

```text
${base}/r2/buckets/mlp-contact-journal
${base}/r2/buckets/mlp-contact-journal/lock
${base}/r2/buckets/mlp-contact-journal/domains/managed
${base}/r2/buckets/mlp-contact-journal/domains/custom
${base}/r2/buckets/mlp-contact-journal/cors
${base}/r2/buckets/mlp-contact-journal/lifecycle
${base}/event_notifications/r2/mlp-contact-journal/configuration
```

When supplied the strict live-gate manifest, make one additional GET to `${base}/r2/buckets/${scope_probe_bucket}` after validating the random bucket name; require that result to exist in jurisdiction `eu` with Standard storage. Use `curl -q --fail --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 5 --max-time 15 --header @file` and `cf-r2-jurisdiction: eu` for every request. Strict jq schemas require: bucket result name/jurisdiction/storage class exactly `mlp-contact-journal`/`eu`/`Standard`; exactly one enabled `v1/` lock rule with `condition.type == "Age"` and integer `maxAgeSeconds >= 5184000`; managed-domain `enabled == false`; `domains == []`; CORS `rules == []`; lifecycle `rules == []`; and event `queues == []`. Root-only temporary files hold bodies and the authorization header; diagnostics contain only the endpoint class and pass/fail. The gate runs on the protected operator workstation, not the VM.

- [ ] **Step 4: Write failing live S3 behavior tests**

At the SDK port level, then against a local S3-compatible conditional-write fixture, require `scripts/journal/live-r2-gate.ts` to:

- create one random valid `.example` PREPARED intent under `v1/intents/` using the real canonical/encryption code, and never create an acceptance marker directly through the provider gate;
- prove writer conditional PUT, immediate GET, immediate LIST, and duplicate PUT failure without overwrite;
- require writer/recovery access-key IDs to be different, prove anonymous GET/LIST denial, and prove both credentials are denied against an administrator-created, known-existing EU scope-probe bucket containing one random object;
- prove recovery credential GET/LIST success and PUT/overwrite/delete denial;
- prove the writer cannot overwrite/delete the locked prepared intent;
- verify downloaded bytes exactly and output only counts/status, schema/key IDs, and a digest—never IDs/keys/object names/data/credentials;
- leave the locked prepared intent in place as a pending non-replayable fixture and never invoke deletion. The first valid acceptance marker is created only through the complete application state machine in Task 13.

- [ ] **Step 5: Run live-gate deterministic tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/live-r2-gate.test.ts
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/r2-journal-gates.test.mjs
```

Expected: FAIL because no immutable live-gate command exists.

- [ ] **Step 6: Implement the immutable live gate and image command**

Load two credential pairs from distinct read-only files, reject equal access-key IDs with a generic error, and use two `S3Client` instances with `maxAttempts:1`. Require a strict non-secret gate manifest naming the existing random scope-probe bucket; the bucket-admin configuration gate first GETs that bucket successfully, and the live gate proves both scoped credentials cannot GET/LIST/PUT it. Apply bounded permission retries only for IAM propagation: at most 20 observations, five seconds apart, while requiring the intended allowed and denied matrices to converge together. A denial is authoritative only after allowed operations work with the same credential. Add entrypoint `journal-live-gate`, compile/copy the command, and ensure it cannot dispatch recovery or Mongo behavior accidentally.

- [ ] **Step 7: Write the exact two-operator resource runbook**

Document, without credential values, this order:

1. create EU bucket `mlp-contact-journal` with Standard storage;
2. set exact `v1/` age-lock rule to at least 5,184,000 seconds and reread it;
3. verify disabled `r2.dev`, empty custom-domain/CORS/lifecycle/event arrays;
4. issue bucket-scoped Object Read & Write writer credentials and independent Object Read-only recovery credentials, record a two-operator redacted attestation of exact role and bucket scope, and require distinct access-key IDs;
5. create a random temporary EU scope-probe bucket plus object with bucket-admin authority, prove its existence through the configuration gate, and use it for cross-bucket denial rather than treating `NoSuchBucket` as permission evidence;
6. generate one dedicated age identity/recipient and one 32-byte MAC key off VM; record a non-secret key ID;
7. escrow age/MAC recovery material independently of VM, R2, Restic, Cloudflare credentials, and Git;
8. run deterministic config gate and prepared-intent live gate, delete/prove absence of the unlocked scope-probe bucket, then revoke the temporary bucket-admin token;
9. install only writer files/config on the VM after the redacted evidence passes. The Task 13 synthetic application request creates the first acceptance marker.

State explicitly that lock removal/configuration requires two operators and a reread; S3 writer/recovery credentials never authorize bucket configuration. Key rotation adds a new active generation without rewriting old objects, keeps every prior verification generation in the application for at least the 60-day pending-retry horizon, and keeps every recovery identity/MAC generation for the full journal-retention horizon. A rotation is incomplete until old and new non-PII fixtures both decrypt/verify from escrow.

- [ ] **Step 8: Run gates/build/typechecks and commit**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/r2-journal-gates.test.mjs \
  tests/infra/migration-image.test.mjs
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn vitest run tests/unit/journal/live-r2-gate.test.ts
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  yarn build:migration
shellcheck scripts/acceptance/r2-journal-config.sh
git diff --check
git add scripts/acceptance/r2-journal-config.sh scripts/journal/live-r2-gate.ts \
  tests/infra/r2-journal-gates.test.mjs tests/unit/journal/live-r2-gate.test.ts \
  tsconfig.migration-build.json infra/migration/Dockerfile \
  infra/migration/entrypoint.sh tests/infra/migration-image.test.mjs \
  runbooks/contact-journal.md infra/cloudflare/README.md
git commit -m "feat(cloudflare): gate locked EU contact journal"
```

Expected: all deterministic gates pass without a live Cloudflare credential; live execution remains a separate recorded production gate.

---

### Task 12: Log/image redaction, CI exhaustiveness, and cutover/recovery rehearsal

**Files:**

- Modify: `scripts/acceptance/log-redaction.sh`
- Modify: `scripts/ci/verify-images.sh`
- Modify: `tests/infra/image-gates.test.mjs`
- Modify: `tests/infra/ops-security.test.mjs`
- Modify: `tests/infra/workflow-pins.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish-image.yml`
- Modify: `runbooks/rehearsal-and-cutover.md`
- Modify: `runbooks/postgresql-disaster-recovery.md`
- Modify: `scripts/migration/remove-synthetic-contact.ts`
- Modify: `tests/unit/migration/operator-safety.test.ts`
- Create: `tests/infra/contact-journal-cutover.test.mjs`
- Create: `scripts/acceptance/contact-journal-outage.sh`
- Create: `tests/infra/contact-journal-outage.test.mjs`

**Interfaces:**

- Consumes: all prior journal tasks and existing migration/cutover gates.
- Produces: exhaustive required CI execution, expanded secret/PII scans, journal-aware synthetic rehearsal, and an exact production decision gate before Cloudflare traffic moves.

- [ ] **Step 1: Write failing scanner and workflow coverage tests**

Add distinct value sentinels for R2 access/secret keys, MAC keys, age identity, PostgreSQL password, S3 authorization, R2 object URL, age ciphertext, a full serialized envelope/marker field cluster, UUID/object key, and `.example` contact body. Apply this exact artifact matrix:

```text
logs/build logs: reject every value/PII/object/envelope sentinel
image filesystem/history/SBOM/attestations: reject secret values, age identity,
  raw credential assignments, and copied runtime secret files
image config/environment: reject AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
  JOURNAL_R2_ACCESS_KEY_ID, JOURNAL_R2_SECRET_ACCESS_KEY and any literal value
source/binary/config names: allow JOURNAL_R2_ENDPOINT, JOURNAL_R2_BUCKET,
  *_FILE identifiers, mlp-contact-journal, and journal schema literals
```

Tests must include both a forbidden positive fixture and an allowed public/`_FILE` fixture for each artifact class; scanners never print the matching content.

Require ordinary CI to execute every new unit/integration/browser/infrastructure suite; require image publish gates to build/inspect age and operator commands before promotion. Add `test:journal-infra` for the R2, recovery-ops, cutover, and outage Node infrastructure files and include it in the existing deterministic quality job.

- [ ] **Step 2: Run the new coverage tests and verify RED**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH \
  node --test tests/infra/image-gates.test.mjs tests/infra/ops-security.test.mjs \
  tests/infra/workflow-pins.test.mjs tests/infra/contact-journal-cutover.test.mjs \
  tests/infra/contact-journal-outage.test.mjs
```

Expected: FAIL because scanners, workflows, and cutover docs do not include journal behavior.

- [ ] **Step 3: Expand scanners without exposing matched content**

Implement the artifact matrix from Step 1. Raw credential environment assignments (`JOURNAL_R2_ACCESS_KEY_ID`, `JOURNAL_R2_SECRET_ACCESS_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are forbidden; approved `JOURNAL_R2_ENDPOINT`, `JOURNAL_R2_BUCKET`, `JOURNAL_R2_*_FILE`, bucket, and schema identifiers are not findings by themselves. S3 authorization, R2 object URLs, `age-encryption.org/v1`, serialized envelope/marker field clusters, and contact JSON remain forbidden in logs and reports. Scanners print only service/artifact and count plus pass/fail; never the matching line. Keep log capture bounded before scan and deletion.

- [ ] **Step 4: Make synthetic deletion fail closed for journal rows**

Change the existing removal command so it first reads only `journal_schema` by exact UUID and refuses deletion when any journal metadata is present. It may remove only the pre-journal legacy synthetic fixture the old migration workflow created. Tests prove an accepted journal row is retained and no contact fields are printed. Update cutover text so accepted synthetic R2/PostgreSQL rows remain until a separately approved post-lock deletion design exists.

- [ ] **Step 5: Replace contact cutover gates with the zero-RPO sequence**

Update the runbook to require, while public contact is in maintenance:

1. production bucket/config/IAM/key recoverability evidence passes;
2. before any accepted write, run `contact-journal-outage.sh`: stage a known-invalid writer credential through the fixed wrapper, restart app, prove page plus read APIs stay healthy, submit reserved `.example` data and require the exact generic 503, prove no PostgreSQL row exists, restore the canonical credential, restart, and prove readiness/log redaction; traffic still points to Vercel during this fault gate;
3. take and record a pre-contact Restic snapshot and isolated restore;
4. submit one `.example` synthetic contact with a stable v4 `Idempotency-Key` through the internal endpoint;
5. prove one intent, one exact PostgreSQL row, one marker, and an identical retry with no additional object/row;
6. prove same key/different body is 409 and changes nothing;
7. restore the pre-contact snapshot into the labeled replacement target;
8. run stable accepted-set recovery and require the synthetic exact row to be inserted;
9. require accepted count/digest equality before/after replay;
10. take a fresh backup of reconciled state, restore it in isolation, and require the same subset proof;
11. obtain second-operator approval, then enable contact writes and record the PostgreSQL production write commit point;
12. never roll back to Atlas after that commit point; use journal recovery or a forward fix.

Remove every instruction that deletes an accepted synthetic row or treats an aggregate count as sufficient.

- [ ] **Step 6: Add deterministic cutover contract assertions**

`tests/infra/contact-journal-cutover.test.mjs` reads the runbooks/scripts and proves ordering by source indices, exact command names, stable-key requirement, pre-snapshot recovery, fresh backup/restore, second operator, retained synthetic row, 24-hour observation, and Atlas/Vercel deletion prohibition. It rejects raw `docker compose`, direct journal-row DELETE, recovery from Mongo after commit, or environment-only drain confirmation.

`tests/infra/contact-journal-outage.test.mjs` executes the sourceable outage gate with fixed fake Docker/curl/psql binaries. It proves the invalid credential is never printed or persisted, page/read probes precede the 503 assertion, the reserved UUID is absent from PostgreSQL, canonical staging is restored on every signal/failure, logs are scanned, and the script cannot run after the VM traffic commit point.

- [ ] **Step 7: Run deterministic and full CI-equivalent suites**

```bash
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:unit
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:integration
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:assets
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:images
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:compose
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:ops
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:cutover
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:image-gates
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:proxmox
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:cloudflare
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:journal-infra
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:e2e
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn test:workflow
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn typecheck
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn migration:typecheck
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn build:production
PATH=/tmp/mlp-node-v22.23.1-darwin-arm64/node-v22.23.1-darwin-arm64/bin:$PATH yarn build:migration
```

Expected: every command PASS with no warning/error output containing a sentinel.

- [ ] **Step 8: Commit the acceptance integration**

```bash
git diff --check
git add scripts/acceptance/log-redaction.sh scripts/ci/verify-images.sh \
  tests/infra/image-gates.test.mjs tests/infra/ops-security.test.mjs \
  tests/infra/workflow-pins.test.mjs tests/infra/contact-journal-cutover.test.mjs \
  package.json .github/workflows/ci.yml .github/workflows/publish-image.yml \
  runbooks/rehearsal-and-cutover.md runbooks/postgresql-disaster-recovery.md \
  scripts/migration/remove-synthetic-contact.ts \
  tests/unit/migration/operator-safety.test.ts \
  scripts/acceptance/contact-journal-outage.sh \
  tests/infra/contact-journal-outage.test.mjs
git commit -m "feat(cutover): require zero-rpo contact recovery proof"
```

Expected: commit contains the complete deterministic acceptance contract but no live evidence or credential.

---

### Task 13: Independent review, live R2 proof, and VM deployment checkpoint

**Files:**

- Modify only if review finds a tested defect in a prior task.
- Create outside Git: root-only redacted evidence under the existing `/var/lib/mlp/` report directories and protected operator evidence storage.

**Interfaces:**

- Consumes: reviewed commits from Tasks 1–12, immutable published app/operator/backup/Caddy image digests, off-VM Cloudflare/key custody, and VM 105.
- Produces: a go/no-go deployment checkpoint; it does not move apex/`www` traffic by itself.

- [ ] **Step 1: Request two-stage review of every task and one whole-branch review**

For each task, compare its base/head commit against that task's requirements, fix every Critical/Important finding with a failing regression test, rerun affected suites, and obtain re-review. Then request one fresh whole-branch review against the approved specification and this plan. Do not proceed with any open Critical/Important finding.

- [ ] **Step 2: Verify all immutable image gates before publish**

Run the complete Step 12 command set plus `./scripts/ci/verify-images.sh` with the exact 40-hex commit. Require age 1.3.1, migration/recovery entrypoints, seven-service Compose, no secret/PII sentinel, `linux/amd64`, correct OCI revision, warning-free checks, and cleanup proof. Publish only the reviewed images and record immutable digests. On the first publication, if a newly created GHCR package (notably `mlp-caddy`) defaults private, let the workflow stop at its anonymous-pull gate after publication, use the protected GitHub Packages settings to make exactly `mlp`, `mlp-backup`, `mlp-caddy`, and `mlp-migration` public, and rerun the exact same commit. Proceed only when the workflow itself proves clean anonymous digest pulls; never place a GHCR token on VM 105.

- [ ] **Step 3: Create and prove Cloudflare R2 resources off VM**

Follow `runbooks/contact-journal.md` with two operators. Run the strict configuration gate and immutable prepared-intent live gate from the protected workstation, including the known-existing scope-probe bucket and distinct credential-ID proof. Escrow and independently test every active age/MAC generation. Delete the unlocked scope-probe bucket and revoke the temporary bucket-admin gate token after evidence capture. This step creates no acceptance marker. Stop if any permission denial/allowance, EU jurisdiction, lock, privacy, or consistency check is ambiguous.

- [ ] **Step 4: Install only writer material and deploy in contact maintenance**

Copy only the three writer canonical files plus non-secret app env values to VM 105 through a protected root session; validate root ownership/mode without printing content. Deploy the exact image digests with contact maintenance active. Require all seven service definitions, five permanent services healthy, no published port, R2-independent readiness, and warning-free logs/redaction gate. While public DNS still targets Vercel, run the Task 12 invalid-writer outage gate and require page/read health, exact generic contact 503, no PostgreSQL row, restored canonical credentials, and healthy/redacted restart.

- [ ] **Step 5: Execute the pre-write recovery rehearsal**

Run the exact Task 12 pre-snapshot synthetic sequence. This complete application path creates the first valid acceptance marker. Require stable accepted-set count/digest, exact replay into the pre-contact restored database, fresh backup, isolated restore, identical subset proof, strict redacted reports, complete incident-secret/network cleanup, and two-operator approval.

- [ ] **Step 6: Record the journal deployment checkpoint**

Record commit/image digests, R2 config report hash, live-gate report hash, accepted-set count/digest, pre/fresh Restic snapshot IDs, backup/restore/recovery report hashes, UTC timestamps, and both operator approvals. Do not record object/contact IDs or values. Only then mark the journal implementation ready for the broader MongoDB finalization and Cloudflare DNS cutover plan.

Expected: journal-backed contact writes are demonstrably recoverable, but Vercel/Atlas remain connected and production DNS remains unchanged until the broader migration gates execute.
