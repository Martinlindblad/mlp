# Portfolio Self-Hosting Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the complete `martin-lindblad.com` portfolio from Vercel and MongoDB Atlas to a Debian 13 Proxmox VM running the Next.js frontend/API, PostgreSQL 18.4, Caddy, and redundant Cloudflare Tunnel connectors, then remove every Vercel and MongoDB dependency after verified acceptance.

**Architecture:** Keep the frontend and API as one Next.js Pages Router process and replace direct MongoDB access with typed Kysely repositories over PostgreSQL. Package the app and backup tooling as immutable containers in a seven-service Docker Compose project on one private Proxmox VM; Cloudflare is authoritative DNS and the only public ingress. Rehearse the strict, transactional data conversion before a gated cutover, preserve Vercel/Atlas as the rollback origin until PostgreSQL has accepted production writes, observe the new platform for 24 hours, restore-test the backup, and only then decommission the old services.

**Tech Stack:** Debian GNU/Linux 13, Proxmox VE/KVM, Docker Engine, Docker Compose >= 2.33.1, Node.js 22.23.1, Yarn 1.22.22, Next.js 13.5.11 Pages Router, TypeScript 5.2, Kysely 0.29.3, `pg` 8.22.0, Zod 4.4.3, PostgreSQL 18.4, Vitest 4.1.10, Playwright 1.61.1, Caddy 2.10.2, cloudflared 2026.7.1, Restic 0.18.1, temporary MongoDB Database Tools 100.17.0 plus age, GitHub Actions/GHCR, and Cloudflare DNS/Tunnel/Access.

## Global Constraints

- Production consists of one Debian GNU/Linux 13 KVM guest with 4 vCPU, 4 GiB fixed RAM, disabled ballooning, one 40 GiB discard-enabled VirtIO SCSI disk, VirtIO networking, QEMU Guest Agent, automatic start, and a private address that is never committed.
- There is one production environment and no permanent staging environment.
- The production Compose project is exactly `mlp-prod` with exactly seven services: `app`, `postgres`, `migrator`, `caddy`, `cloudflared-a`, `cloudflared-b`, and `db-backup`.
- PostgreSQL is exactly 18.4; Node is exactly 22.23.1; Yarn is exactly 1.22.22; Docker Compose must be at least 2.33.1.
- Production image references must contain `@sha256:` followed by 64 lowercase hexadecimal characters; mutable tags are rejected.
- The app and migrator use the same application image; image builds run in GitHub Actions, never on the VM.
- No application, PostgreSQL, Caddy, Docker API, or new SSH port may be exposed publicly; Cloudflare Tunnel is the only application ingress.
- Compose networks are `tunnel`, `web`, `database`, and `egress`; the first three are internal, and only `egress` supplies a default route.
- Existing public routes, API paths, success statuses, JSON property casing, list limits, case URLs, 24-character MongoDB IDs, and five-second case ISR revalidation remain stable.
- The introduction lookup deliberately fixes the legacy defect by filtering `key = 'introduction'`.
- The contact API uses `fullName` externally and `full_name` internally, accepts at most 32 KiB, returns the existing 201/400/405 bodies, and returns a generic 503 for database unavailability.
- Every source document in all ten MongoDB collections must map explicitly; unknown fields, malformed nested values, duplicate IDs, invalid required values, and unparseable dates abort the transaction.
- Each of the nine read-only tables has non-serialized `source_order integer not null`; imports populate it from snapshot order and repositories order by it before applying legacy limits.
- MongoDB dates preserve their instant as `timestamptz`; human-readable `from`, `to`, and `duration` values remain text; `project_details` remains strictly validated JSONB.
- Logs and committed reports contain no request bodies, email addresses, messages, connection strings, passwords, tokens, or source contact values.
- Runtime files live below `/etc/mlp`, owned by root with directory mode `0700` and file mode `0600`; safe examples in Git contain only dummy values.
- PostgreSQL roles are separate: `portfolio_migrator` owns schema objects, `portfolio_app` has minimum runtime DML privileges, and `portfolio_backup` has minimum logical-backup read privileges.
- The final contact write-maintenance window is at most 30 minutes and uses HTTP 503 plus `Retry-After: 300` only for `POST /api/contact/route`.
- Cloudflare nameserver authority must remain verified for at least 48 hours while app records still point to Vercel; application-record TTL is 300 seconds for at least 24 hours before cutover.
- Before the first PostgreSQL production contact write, rollback may return DNS to Vercel; after that write, rollback to stale MongoDB is forbidden and recovery is PostgreSQL restore or a forward fix.
- Atlas and Vercel remain untouched until all acceptance checks, a fresh off-VM backup, an isolated restore, and a minimum 24-hour observation period pass.
- The approved design is `docs/superpowers/specs/2026-07-14-portfolio-proxmox-postgresql-cloudflare-design.md`; any conflict is resolved in favor of that document.

---

## File and Responsibility Map

The implementation uses root-level `server/` because the existing `src/*` TypeScript alias resolves from the repository root. Migration-only MongoDB code lives under `migration/` so it can be deleted cleanly after acceptance.

| Area | Files | Responsibility |
| --- | --- | --- |
| Runtime database | `server/db/config.ts`, `client.ts`, `database.types.ts`, `migrator.ts`, `migrations/*.ts` | Typed PostgreSQL connection, schema, versioned changes, and least-privilege grants |
| Runtime data access | `server/repositories/*.ts` | Stable limits/order, database rows, project lookup, and contact insert |
| API boundary | `server/api/contracts.ts`, `serializers.ts`, `read-handler.ts`, `contact-handler.ts` | Preserve legacy JSON and isolate validation/error behavior |
| Page/readiness boundary | `server/pages/case-data.ts`, `server/health/readiness.ts` | Case SSG/ISR data and bounded database readiness |
| One-time conversion | `migration/*.ts`, `scripts/migration/*` | Strict Mongo inventory, mapping, import, hashes, reports, rehearsal, and final delta |
| Container platform | `Dockerfile`, `infra/backup/Dockerfile`, `compose.production.yml`, `infra/caddy/*` | Immutable app/backup images, seven-service topology, and ingress policy |
| VM operations | `ops/*.sh`, `infra/systemd/*`, `infra/proxmox/*`, `infra/runtime.example/*` | Provisioning, root-only secrets, deployment, maintenance mode, backup, and restore |
| Cloudflare/cutover | `infra/cloudflare/*.md`, `runbooks/*.md`, `scripts/acceptance/*` | Nameserver/tunnel gates, public checks, rollback, and decommission evidence |
| Automated assurance | `tests/{unit,integration,assets,infra,e2e}/**`, `.github/workflows/*.yml` | Contract, migration, Linux asset, container, topology, browser, and CI checks |

## Execution Gates

1. Tasks 1-11 are local/repository work and may start immediately.
2. Task 12 requires authenticated Proxmox administration and the existing protected VM-management path.
3. Task 13 requires Cloudflare, registrar, Vercel DNS, and tunnel administration; the nameserver phase has an unavoidable 48-hour hold.
4. Task 14 requires temporary Atlas read/export access, production VM access, GHCR pull access, and the tested off-VM Restic repository.
5. Task 15 is forbidden until the 24-hour observation and isolated restore both pass.

### Task 1: Pin the Toolchain and Establish Contract Tests

**Files:**
- Create: `.nvmrc`
- Create: `.node-version`
- Create: `vitest.config.ts`
- Create: `tests/helpers/next-api.ts`
- Create: `tests/unit/api/contracts.test.ts`
- Modify: `package.json`
- Modify: `yarn.lock`
- Modify: `types/DBTypes.ts`
- Modify: `src/components/CaseCarousel.tsx`
- Modify: `src/components/CaseCarouselItem.tsx`
- Modify: `src/components/CaseItem.tsx`

**Interfaces:**
- Consumes: Existing public TypeScript shapes in `types/DBTypes.ts` and current API behavior.
- Produces: Node 22.23.1/Yarn 1.22.22 reproducibility; `LegacyId = string`; `MockNextResponse`; `createMockRequest()` and `createMockResponse()` for later handler tests.

- [ ] **Step 1: Pin the runtime and install the exact test/database dependencies**

Create both version files with exactly:

```text
22.23.1
```

Run under Node 22.23.1:

```bash
corepack disable
npm install --global yarn@1.22.22
yarn add --exact kysely@0.29.3 pg@8.22.0 zod@4.4.3
yarn add --dev --exact vitest@4.1.10 tsx@4.23.1 @types/pg@8.20.0 @types/node@22.20.1 @playwright/test@1.61.1
```

Change the engine and scripts in `package.json` to these exact values while retaining unrelated scripts:

```json
{
  "engines": { "node": ">=22.23.1 <23" },
  "scripts": {
    "test": "yarn test:unit && yarn test:integration",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration --no-file-parallelism",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit --pretty"
  }
}
```

- [ ] **Step 2: Write the failing string-ID contract test**

Create `tests/unit/api/contracts.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CaseData, PersonalInfo } from '../../../types/DBTypes';

describe('legacy public identifiers', () => {
  it('remain serialized strings', () => {
    const profile: PersonalInfo = {
      _id: '64b000000000000000000001',
      title: 'Hej',
      info: 'Portfolio',
      name: 'Martin',
      surname: 'Lindblad',
      key: 'introduction',
    };

    expect(profile._id).toMatch(/^[0-9a-f]{24}$/);
    expectTypeOf<CaseData['_id']>().toEqualTypeOf<string>();
  });
});
```

- [ ] **Step 3: Run the test and capture the expected red state**

Run: `yarn vitest run tests/unit/api/contracts.test.ts`

Expected: FAIL during type checking or collection because `_id` still requires MongoDB `ObjectId`.

- [ ] **Step 4: Remove MongoDB types from all browser/runtime contracts**

In `types/DBTypes.ts`, remove the MongoDB import, add this declaration at the top, and replace every `_id: ObjectId` with `_id: LegacyId`:

```ts
export type LegacyId = string;
```

Remove `ObjectId` imports and casts from `src/components/CaseCarousel.tsx`, `src/components/CaseCarouselItem.tsx`, and `src/components/CaseItem.tsx`; component props continue to consume `CaseData` and use `_id` directly as a string.

- [ ] **Step 5: Add the shared Next API test adapter**

Create `tests/helpers/next-api.ts`:

```ts
import type { NextApiRequest, NextApiResponse } from 'next';

export type MockNextResponse = NextApiResponse & {
  statusCode: number;
  payload: unknown;
  headers: Record<string, string | number | readonly string[]>;
};

export function createMockRequest(
  overrides: Partial<NextApiRequest> = {},
): NextApiRequest {
  return {
    method: 'GET',
    body: undefined,
    query: {},
    cookies: {},
    headers: {},
    ...overrides,
  } as NextApiRequest;
}

export function createMockResponse(): MockNextResponse {
  const response = {
    statusCode: 200,
    payload: undefined,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.payload = value;
      return this;
    },
    send(value: unknown) {
      this.payload = value;
      return this;
    },
    end(value?: unknown) {
      this.payload = value;
      return this;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    },
  } as unknown as MockNextResponse;

  return response;
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { src: path.resolve(__dirname) } },
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 6: Verify the foundation**

Run:

```bash
node --version
yarn --version
yarn vitest run tests/unit/api/contracts.test.ts
yarn typecheck
```

Expected: `v22.23.1`, `1.22.22`, one passing Vitest file, and TypeScript exit 0.

- [ ] **Step 7: Commit**

```bash
git add .nvmrc .node-version package.json yarn.lock vitest.config.ts tests/helpers/next-api.ts tests/unit/api/contracts.test.ts types/DBTypes.ts src/components/CaseCarousel.tsx src/components/CaseCarouselItem.tsx src/components/CaseItem.tsx
git commit -m "test: establish postgres migration contracts"
```

### Task 2: Create the PostgreSQL Schema, Roles, and Migration Runner

**Files:**
- Create: `server/db/config.ts`
- Create: `server/db/database.types.ts`
- Create: `server/db/client.ts`
- Create: `server/db/migrator.ts`
- Create: `server/db/migrations/001_initial_schema.ts`
- Create: `server/db/migrations/002_runtime_grants.ts`
- Create: `scripts/db/migrate.ts`
- Create: `infra/postgres/init-roles.sh`
- Create: `tests/helpers/postgres.ts`
- Create: `tests/integration/db/migrations.test.ts`
- Create: `tsconfig.scripts.json`

**Interfaces:**
- Consumes: `ProjectDetails` and Node 22 file-secret support.
- Produces: `Database`, `DatabaseConfig`, `loadDatabaseConfig(env)`, `createDatabase(config)`, `getDatabase()`, `createMigrator(db)`, `migrateToLatest(db)`, migration name `002_runtime_grants`, and a compiled `dist/scripts/db/migrate.js` entrypoint.

- [ ] **Step 1: Write the failing configuration and schema integration tests**

Create `tests/integration/db/migrations.test.ts` with these assertions (the helper creates a unique database from `TEST_DATABASE_URL` and removes it after the suite):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createIsolatedDatabase } from '../../helpers/postgres';
import { migrateToLatest } from '../../../server/db/migrator';

const expectedTables = [
  'contact_messages',
  'current_occupations',
  'hobbies',
  'languages',
  'page_cards',
  'professional_timeline',
  'profile_sections',
  'projects',
  'pursuits',
  'social_links',
];

describe('database migrations', () => {
  const isolated = createIsolatedDatabase();
  beforeAll(async () => isolated.start());
  afterAll(async () => isolated.stop());

  it('creates the exact schema and is idempotent', async () => {
    await migrateToLatest(isolated.db);
    await migrateToLatest(isolated.db);

    const tables = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      and table_name not like 'kysely_%'
      order by table_name
    `.execute(isolated.db);
    expect(tables.rows.map((row) => row.table_name)).toEqual(expectedTables);

    const contentColumns = await sql<{ table_name: string }>`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'source_order'
      order by table_name
    `.execute(isolated.db);
    expect(contentColumns.rows.map((row) => row.table_name)).toEqual(
      expectedTables.filter((name) => name !== 'contact_messages'),
    );

    const migration = await sql<{ name: string }>`
      select name from kysely_migration order by timestamp desc limit 1
    `.executeTakeFirstOrThrow(isolated.db);
    expect(migration.name).toBe('002_runtime_grants');
  });
});
```

- [ ] **Step 2: Run the migration test and confirm it is red**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn vitest run tests/integration/db/migrations.test.ts --no-file-parallelism`

Expected: FAIL with a module-not-found error for `server/db/migrator`.

- [ ] **Step 3: Define the database types and file-backed configuration**

Create `server/db/config.ts`:

```ts
import fs from 'node:fs';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections: number;
  connectionTimeoutMillis: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing database setting: ${name}`);
  return value;
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  const passwordFile = required(env, 'PGPASSWORD_FILE');
  return {
    host: required(env, 'PGHOST'),
    port: Number(env.PGPORT ?? '5432'),
    database: required(env, 'PGDATABASE'),
    user: required(env, 'PGUSER'),
    password: fs.readFileSync(passwordFile, 'utf8').trim(),
    maxConnections: Number(env.PGPOOL_MAX ?? '5'),
    connectionTimeoutMillis: Number(env.PGCONNECT_TIMEOUT_MS ?? '5000'),
  };
}
```

Create `server/db/database.types.ts` with one `Selectable`/`Insertable` interface per table and this exact shared shape:

```ts
import type { ColumnType, Generated, JSONColumnType } from 'kysely';
import type { ProjectDetails } from '../../types/DBTypes';

type Imported = { id: string; source_order: number };

export interface ProfileSectionsTable extends Imported {
  key: string;
  title: string;
  info: string;
  name: string;
  surname: string;
  description: string[] | null;
  image_source: string | null;
  link: string | null;
  link_text: string | null;
  profile_image: string | null;
}
export interface CurrentOccupationsTable extends Imported {
  occupation_type: string;
  description: string;
  from_label: string;
  to_label: string;
  introduction: string;
  name: string;
  link: string;
}
export interface HobbiesTable extends Imported { title: string; content: string; type: string }
export interface LanguagesTable extends Imported { name: string; spoken: string; written: string }
export interface PageCardsTable extends Imported {
  title: string; description: string; link: string; content: string; key: string; type: string;
}
export interface ProfessionalTimelineTable extends Imported {
  company: string | null;
  institution: string | null;
  qualification: string | null;
  duration: string;
  title: string;
  description: string;
  sort_index: number;
}
export interface ProjectsTable extends Imported {
  title: string;
  description: string;
  image_source: string;
  from_label: string;
  to_label: string;
  project_details: JSONColumnType<ProjectDetails>;
}
export interface PursuitsTable extends Imported {
  title: string; description: string; left_image_source: string; right_image_source: string;
}
export interface SocialLinksTable extends Imported { name: string; link: string }
export interface ContactMessagesTable {
  id: string;
  full_name: string;
  email: string;
  subject: string;
  message: string;
  created_at: ColumnType<Date, Date | string, never>;
}

export interface Database {
  profile_sections: ProfileSectionsTable;
  current_occupations: CurrentOccupationsTable;
  hobbies: HobbiesTable;
  languages: LanguagesTable;
  page_cards: PageCardsTable;
  professional_timeline: ProfessionalTimelineTable;
  projects: ProjectsTable;
  pursuits: PursuitsTable;
  social_links: SocialLinksTable;
  contact_messages: ContactMessagesTable;
  kysely_migration: { name: string; timestamp: string };
  kysely_migration_lock: { id: string; is_locked: Generated<number> };
}
```

- [ ] **Step 4: Implement the pooled client and migration provider**

Create `server/db/client.ts`:

```ts
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './database.types';
import { loadDatabaseConfig, type DatabaseConfig } from './config';

export function createDatabase(config: DatabaseConfig): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: config.maxConnections,
        connectionTimeoutMillis: config.connectionTimeoutMillis,
        ssl: false,
      }),
    }),
  });
}

let singleton: Kysely<Database> | undefined;
export function getDatabase(): Kysely<Database> {
  singleton ??= createDatabase(loadDatabaseConfig(process.env));
  return singleton;
}
```

Create `server/db/migrator.ts`:

```ts
import path from 'node:path';
import { FileMigrationProvider, Migrator, type Kysely } from 'kysely';
import { promises as fs } from 'node:fs';
import type { Database } from './database.types';

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });
}

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const result = await createMigrator(db).migrateToLatest();
  if (result.error) throw result.error;
}
```

- [ ] **Step 5: Implement the exact ten-table schema**

Create `server/db/migrations/001_initial_schema.ts` with the complete schema:

```ts
import type { Kysely } from 'kysely';
import type { Database } from '../database.types';

export async function up(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('profile_sections')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('info', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('surname', 'text', (column) => column.notNull())
    .addColumn('description', 'text[]')
    .addColumn('image_source', 'text')
    .addColumn('link', 'text')
    .addColumn('link_text', 'text')
    .addColumn('profile_image', 'text')
    .execute();

  await db.schema
    .createTable('current_occupations')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('occupation_type', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('from_label', 'text', (column) => column.notNull())
    .addColumn('to_label', 'text', (column) => column.notNull())
    .addColumn('introduction', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('link', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('hobbies')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('content', 'text', (column) => column.notNull())
    .addColumn('type', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('languages')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('spoken', 'text', (column) => column.notNull())
    .addColumn('written', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('page_cards')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('link', 'text', (column) => column.notNull())
    .addColumn('content', 'text', (column) => column.notNull())
    .addColumn('key', 'text', (column) => column.notNull())
    .addColumn('type', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('professional_timeline')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('company', 'text')
    .addColumn('institution', 'text')
    .addColumn('qualification', 'text')
    .addColumn('duration', 'text', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('sort_index', 'integer', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('projects')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('image_source', 'text', (column) => column.notNull())
    .addColumn('from_label', 'text', (column) => column.notNull())
    .addColumn('to_label', 'text', (column) => column.notNull())
    .addColumn('project_details', 'jsonb', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('pursuits')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('description', 'text', (column) => column.notNull())
    .addColumn('left_image_source', 'text', (column) => column.notNull())
    .addColumn('right_image_source', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('social_links')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('source_order', 'integer', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('link', 'text', (column) => column.notNull())
    .execute();

  await db.schema
    .createTable('contact_messages')
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('full_name', 'text', (column) => column.notNull())
    .addColumn('email', 'text', (column) => column.notNull())
    .addColumn('subject', 'text', (column) => column.notNull())
    .addColumn('message', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull())
    .execute();

  await db.schema.createIndex('profile_sections_key_idx').on('profile_sections').column('key').execute();
  await db.schema.createIndex('professional_timeline_sort_index_idx').on('professional_timeline').column('sort_index').execute();
}

export async function down(db: Kysely<Database>): Promise<void> {
  for (const table of ['contact_messages', 'social_links', 'pursuits', 'projects', 'professional_timeline', 'page_cards', 'languages', 'hobbies', 'current_occupations', 'profile_sections'] as const) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
```

- [ ] **Step 6: Add least-privilege role grants and bootstrap**

Create `infra/postgres/init-roles.sh`; it runs only during empty-volume initialization, reads the three Docker secret files, creates `portfolio_app` and `portfolio_backup` with SCRAM passwords using `psql` variables, and leaves `portfolio_migrator` as the database owner. Do not print passwords. The executable body is:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

app_password="$(tr -d '\n' </run/secrets/postgres-app-password)"
backup_password="$(tr -d '\n' </run/secrets/postgres-backup-password)"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$app_password" --set=backup_password="$backup_password" \
  --set=db_name="$POSTGRES_DB" <<'SQL'
set password_encryption = 'scram-sha-256';
create role portfolio_app login password :'app_password';
create role portfolio_backup login password :'backup_password';
grant connect on database :"db_name" to portfolio_app, portfolio_backup;
SQL
unset app_password backup_password
```

Create `server/db/migrations/002_runtime_grants.ts`:

```ts
import { sql, type Kysely } from 'kysely';
import type { Database } from '../database.types';

const contentTables = [
  'profile_sections', 'current_occupations', 'hobbies', 'languages', 'page_cards',
  'professional_timeline', 'projects', 'pursuits', 'social_links',
] as const;
const backupTables = [...contentTables, 'contact_messages', 'kysely_migration'] as const;

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`grant usage on schema public to portfolio_app, portfolio_backup`.execute(db);
  for (const table of contentTables) {
    await sql.raw(`grant select on table "${table}" to portfolio_app`).execute(db);
  }
  await sql`grant insert on table contact_messages to portfolio_app`.execute(db);
  await sql`grant select on table kysely_migration to portfolio_app`.execute(db);
  for (const table of backupTables) {
    await sql.raw(`grant select on table "${table}" to portfolio_backup`).execute(db);
  }
}

export async function down(db: Kysely<Database>): Promise<void> {
  for (const table of backupTables) {
    await sql.raw(`revoke select on table "${table}" from portfolio_backup`).execute(db);
  }
  await sql`revoke select on table kysely_migration from portfolio_app`.execute(db);
  await sql`revoke insert on table contact_messages from portfolio_app`.execute(db);
  for (const table of contentTables) {
    await sql.raw(`revoke select on table "${table}" from portfolio_app`).execute(db);
  }
  await sql`revoke usage on schema public from portfolio_app, portfolio_backup`.execute(db);
}
```

The only raw identifiers come from the two fixed source-code arrays; no runtime/user value reaches `sql.raw()`.

- [ ] **Step 7: Add the CLI and test database helper**

Create `scripts/db/migrate.ts`:

```ts
import { getDatabase } from '../../server/db/client';
import { migrateToLatest } from '../../server/db/migrator';

async function main(): Promise<void> {
  const db = getDatabase();
  try {
    await migrateToLatest(db);
    process.stdout.write('database migrations applied\n');
  } finally {
    await db.destroy();
  }
}

main().catch(() => {
  process.stderr.write('database migration failed\n');
  process.exitCode = 1;
});
```

Create `tests/helpers/postgres.ts` to parse `TEST_DATABASE_URL`, connect to its maintenance database with `pg`, ensure `portfolio_app` and `portfolio_backup` test roles exist through an idempotent `DO` block, generate a database name `mlp_test_${process.pid}_${randomUUID().replaceAll('-', '')}`, create the database, expose `db = createDatabase(...)`, and on `stop()` destroy Kysely then terminate sessions and drop the database. Never accept a URL whose hostname is not `127.0.0.1`, `localhost`, or `postgres`.

Create `tsconfig.scripts.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "dist",
    "noEmit": false,
    "declaration": false
  },
  "include": ["server/**/*.ts", "scripts/db/**/*.ts"]
}
```

- [ ] **Step 8: Run migrations twice and verify schema/privileges**

Run:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn vitest run tests/integration/db/migrations.test.ts --no-file-parallelism
yarn tsc --project tsconfig.scripts.json
test -f dist/scripts/db/migrate.js
```

Expected: the integration suite passes; the second migration run applies zero changes and exits 0; the compiled entrypoint exists.

- [ ] **Step 9: Commit**

```bash
git add server/db scripts/db infra/postgres tests/helpers/postgres.ts tests/integration/db/migrations.test.ts tsconfig.scripts.json
git commit -m "feat: add postgresql schema and migrations"
```

### Task 3: Preserve Read API Contracts Through PostgreSQL Repositories

**Files:**
- Create: `server/api/contracts.ts`
- Create: `server/api/serializers.ts`
- Create: `server/api/read-handler.ts`
- Create: `server/api/runtime-read-handlers.ts`
- Create: `server/repositories/content-repository.ts`
- Create: `server/repositories/project-repository.ts`
- Create: `tests/unit/api/serializers.test.ts`
- Create: `tests/unit/api/read-handler.test.ts`
- Create: `tests/integration/db/repositories.test.ts`
- Replace: `src/pages/api/about.js` with `src/pages/api/about.ts`
- Replace: `src/pages/api/introduction.js` with `src/pages/api/introduction.ts`
- Replace: `src/pages/api/currentOccupation.js` with `src/pages/api/currentOccupation.ts`
- Replace: `src/pages/api/languages.js` with `src/pages/api/languages.ts`
- Replace: `src/pages/api/list.js` with `src/pages/api/list.ts`
- Replace: `src/pages/api/pageCards.js` with `src/pages/api/pageCards.ts`
- Replace: `src/pages/api/professionalTimeline.js` with `src/pages/api/professionalTimeline.ts`
- Replace: `src/pages/api/projectsAndCases.js` with `src/pages/api/projectsAndCases.ts`
- Replace: `src/pages/api/pursuit.js` with `src/pages/api/pursuit.ts`
- Replace: `src/pages/api/socialmedia.js` with `src/pages/api/socialmedia.ts`

**Interfaces:**
- Consumes: `Database`, `getDatabase()`, and public types from `types/DBTypes.ts`.
- Produces: `ContentRepository`, `ProjectRepository`, `createContentRepository(db)`, `createProjectRepository(db)`, one serializer per public shape, `SERVICE_UNAVAILABLE`, and `createReadHandler<T>(load)`.

- [ ] **Step 1: Lock serialization, ordering, and route-error behavior in failing tests**

Create `tests/unit/api/serializers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serializeProfileSection, serializeTimeline } from '../../../server/api/serializers';

describe('legacy serializers', () => {
  it('maps snake_case and omits SQL null without exposing source order', () => {
    expect(serializeProfileSection({
      id: '64b000000000000000000001', source_order: 4, key: 'introduction',
      title: 'Hej', info: 'Portfolio', name: 'Martin', surname: 'Lindblad',
      description: null, image_source: null, link: null, link_text: null,
      profile_image: null,
    })).toEqual({
      _id: '64b000000000000000000001', key: 'introduction', title: 'Hej',
      info: 'Portfolio', name: 'Martin', surname: 'Lindblad',
    });
  });

  it('maps timeline sort_index to index', () => {
    expect(serializeTimeline({
      id: '64b000000000000000000002', source_order: 0, company: null,
      institution: 'School', qualification: null, duration: '2020–2022',
      title: 'Course', description: 'Description', sort_index: 7,
    })).toEqual({
      _id: '64b000000000000000000002', institution: 'School',
      duration: '2020–2022', title: 'Course', description: 'Description', index: 7,
    });
  });
});
```

Create `tests/unit/api/read-handler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createReadHandler, SERVICE_UNAVAILABLE } from '../../../server/api/read-handler';
import { createMockRequest, createMockResponse } from '../../helpers/next-api';

describe('read handler', () => {
  it('returns loaded legacy values', async () => {
    const handler = createReadHandler(async () => [{ _id: '64b000000000000000000001' }]);
    const response = createMockResponse();
    await handler(createMockRequest(), response);
    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual([{ _id: '64b000000000000000000001' }]);
  });

  it('hides database errors behind a generic 503', async () => {
    const handler = createReadHandler(async () => { throw new Error('password=secret'); });
    const response = createMockResponse();
    await handler(createMockRequest(), response);
    expect(response.statusCode).toBe(503);
    expect(response.payload).toEqual(SERVICE_UNAVAILABLE);
    expect(JSON.stringify(response.payload)).not.toContain('secret');
  });
});
```

In `tests/integration/db/repositories.test.ts`, migrate an isolated database, insert three hobbies with source orders `8`, `2`, `5`, and assert `findHobbies(2)` returns IDs for orders `2`, `5`. Insert two profile rows where the introduction has the higher order and assert `findIntroduction()` returns the introduction. Repeat an ordering/limit assertion for each of the nine content tables and assert project lookup is by the unchanged text ID.

- [ ] **Step 2: Run the focused tests and confirm missing modules**

Run:

```bash
yarn vitest run tests/unit/api/serializers.test.ts tests/unit/api/read-handler.test.ts
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn vitest run tests/integration/db/repositories.test.ts --no-file-parallelism
```

Expected: both commands fail because the serializers, handler, and repositories do not exist.

- [ ] **Step 3: Define exact public contracts and serializers**

Create `server/api/contracts.ts`:

```ts
export const READ_LIMITS = {
  about: 3,
  currentOccupation: 1,
  hobbies: 10,
  languages: 3,
  pageCards: 10,
  professionalTimeline: 10,
  projectsAndCases: 50,
  pursuit: 1,
  socialmedia: 10,
} as const;

export const SERVICE_UNAVAILABLE = {
  errorMessage: 'Service temporarily unavailable',
  success: false,
} as const;
```

Create `server/api/serializers.ts`. Use a local `definedEntries()` helper that removes only `null`/`undefined`, never empty strings, and export these functions with exact return types:

```ts
import type { Selectable } from 'kysely';
import type {
  CurrentOccupationsTable, HobbiesTable, LanguagesTable, PageCardsTable,
  ProfessionalTimelineTable, ProfileSectionsTable, ProjectsTable,
  PursuitsTable, SocialLinksTable,
} from '../db/database.types';
import type {
  CareerSummary, CaseData, InformationCard, Interest, Language,
  PersonalInfo, ProfessionalTimeline, Pursuit, SocailMediaLink,
} from '../../types/DBTypes';

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined),
  ) as T;
}

export const serializeProfileSection = (row: Selectable<ProfileSectionsTable>): PersonalInfo => compact({
  _id: row.id, key: row.key, title: row.title, info: row.info, name: row.name,
  surname: row.surname, description: row.description, imageSource: row.image_source,
  link: row.link, linkText: row.link_text, profileImage: row.profile_image,
}) as PersonalInfo;

export const serializeCurrentOccupation = (row: Selectable<CurrentOccupationsTable>): CareerSummary => ({
  _id: row.id, occupationType: row.occupation_type, description: row.description,
  from: row.from_label, to: row.to_label, introduction: row.introduction,
  name: row.name, link: row.link,
});
export const serializeHobby = (row: Selectable<HobbiesTable>): Interest => ({
  _id: row.id, title: row.title, content: row.content, type: row.type as Interest['type'],
});
export const serializeLanguage = (row: Selectable<LanguagesTable>): Language => ({
  _id: row.id, name: row.name, spoken: row.spoken, written: row.written,
});
export const serializePageCard = (row: Selectable<PageCardsTable>): InformationCard => ({
  _id: row.id, title: row.title, description: row.description, link: row.link,
  content: row.content, key: row.key as InformationCard['key'], type: row.type as InformationCard['type'],
});
export const serializeTimeline = (row: Selectable<ProfessionalTimelineTable>): ProfessionalTimeline => compact({
  _id: row.id, company: row.company, institution: row.institution,
  qualification: row.qualification, duration: row.duration, title: row.title,
  description: row.description, index: row.sort_index,
}) as ProfessionalTimeline;
export const serializeProject = (row: Selectable<ProjectsTable>): CaseData => ({
  _id: row.id, title: row.title, description: row.description,
  imageSource: row.image_source, from: row.from_label, to: row.to_label,
  projectDetails: row.project_details,
});
export const serializePursuit = (row: Selectable<PursuitsTable>): Pursuit => ({
  _id: row.id, title: row.title, description: row.description,
  leftImageSource: row.left_image_source, rightImageSource: row.right_image_source,
});
export const serializeSocialLink = (row: Selectable<SocialLinksTable>): SocailMediaLink => ({
  _id: row.id, name: row.name as SocailMediaLink['name'], link: row.link,
});
```

Extend the existing public interfaces in `types/DBTypes.ts` only where the current Mongo JSON already exposes optional profile fields; do not add `source_order` or any snake_case property.

- [ ] **Step 4: Implement repositories with explicit `source_order`**

Create `server/repositories/content-repository.ts` with this public contract and queries:

```ts
import type { Kysely, Selectable } from 'kysely';
import type {
  CurrentOccupationsTable, Database, HobbiesTable, LanguagesTable,
  PageCardsTable, ProfessionalTimelineTable, ProfileSectionsTable,
  PursuitsTable, SocialLinksTable,
} from '../db/database.types';
import { READ_LIMITS } from '../api/contracts';

export interface ContentRepository {
  findProfileSections(): Promise<Selectable<ProfileSectionsTable>[]>;
  findIntroduction(): Promise<Selectable<ProfileSectionsTable>[]>;
  findCurrentOccupations(): Promise<Selectable<CurrentOccupationsTable>[]>;
  findHobbies(): Promise<Selectable<HobbiesTable>[]>;
  findLanguages(): Promise<Selectable<LanguagesTable>[]>;
  findPageCards(): Promise<Selectable<PageCardsTable>[]>;
  findTimeline(): Promise<Selectable<ProfessionalTimelineTable>[]>;
  findPursuits(): Promise<Selectable<PursuitsTable>[]>;
  findSocialLinks(): Promise<Selectable<SocialLinksTable>[]>;
}

export function createContentRepository(db: Kysely<Database>): ContentRepository {
  return {
    findProfileSections: () => db.selectFrom('profile_sections').selectAll()
      .orderBy('source_order', 'asc').limit(READ_LIMITS.about).execute(),
    findIntroduction: () => db.selectFrom('profile_sections').selectAll()
      .where('key', '=', 'introduction').orderBy('source_order', 'asc').limit(1).execute(),
    findCurrentOccupations: () => db.selectFrom('current_occupations').selectAll()
      .orderBy('source_order', 'asc').limit(READ_LIMITS.currentOccupation).execute(),
    findHobbies: () => db.selectFrom('hobbies').selectAll()
      .orderBy('source_order', 'asc').limit(READ_LIMITS.hobbies).execute(),
    findLanguages: () => db.selectFrom('languages').selectAll()
      .orderBy('source_order', 'asc').limit(READ_LIMITS.languages).execute(),
    findPageCards: () => db.selectFrom('page_cards').selectAll()
      .orderBy('source_order', 'asc').limit(READ_LIMITS.pageCards).execute(),
    findTimeline: () => db.selectFrom('professional_timeline').selectAll()
      .orderBy('source_order', 'asc').limit(READ_LIMITS.professionalTimeline).execute(),
    findPursuits: () => db.selectFrom('pursuits').selectAll()
      .orderBy('source_order', 'asc').limit(READ_LIMITS.pursuit).execute(),
    findSocialLinks: () => db.selectFrom('social_links').selectAll()
      .orderBy('source_order', 'asc').limit(READ_LIMITS.socialmedia).execute(),
  };
}
```

Create `server/repositories/project-repository.ts`:

```ts
import type { Kysely, Selectable } from 'kysely';
import type { Database, ProjectsTable } from '../db/database.types';
import { READ_LIMITS } from '../api/contracts';

export interface ProjectRepository {
  list(): Promise<Selectable<ProjectsTable>[]>;
  listIds(): Promise<string[]>;
  findById(id: string): Promise<Selectable<ProjectsTable> | undefined>;
}

export function createProjectRepository(db: Kysely<Database>): ProjectRepository {
  return {
    list: () => db.selectFrom('projects').selectAll().orderBy('source_order', 'asc')
      .limit(READ_LIMITS.projectsAndCases).execute(),
    listIds: async () => (await db.selectFrom('projects').select('id')
      .orderBy('source_order', 'asc').execute()).map(({ id }) => id),
    findById: (id) => db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst(),
  };
}
```

- [ ] **Step 5: Implement the generic read handler**

Create `server/api/read-handler.ts`:

```ts
import type { NextApiHandler } from 'next';
import { SERVICE_UNAVAILABLE } from './contracts';

export { SERVICE_UNAVAILABLE } from './contracts';

export function createReadHandler<T>(load: () => Promise<readonly T[]>): NextApiHandler {
  return async (_request, response) => {
    try {
      response.status(200).json(await load());
    } catch {
      response.status(503).json(SERVICE_UNAVAILABLE);
    }
  };
}
```

- [ ] **Step 6: Build lazy runtime handlers and replace all ten routes without changing URLs**

Create `server/api/runtime-read-handlers.ts` so database configuration is loaded on request, not during Next's module evaluation:

```ts
import { getDatabase } from '../db/client';
import { createContentRepository } from '../repositories/content-repository';
import { createProjectRepository } from '../repositories/project-repository';
import { createReadHandler } from './read-handler';
import {
  serializeCurrentOccupation, serializeHobby, serializeLanguage, serializePageCard,
  serializeProfileSection, serializeProject, serializePursuit, serializeSocialLink,
  serializeTimeline,
} from './serializers';

const content = () => createContentRepository(getDatabase());
const projects = () => createProjectRepository(getDatabase());

export const aboutHandler = createReadHandler(async () =>
  (await content().findProfileSections()).map(serializeProfileSection));
export const introductionHandler = createReadHandler(async () =>
  (await content().findIntroduction()).map(serializeProfileSection));
export const currentOccupationHandler = createReadHandler(async () =>
  (await content().findCurrentOccupations()).map(serializeCurrentOccupation));
export const languagesHandler = createReadHandler(async () =>
  (await content().findLanguages()).map(serializeLanguage));
export const hobbiesHandler = createReadHandler(async () =>
  (await content().findHobbies()).map(serializeHobby));
export const pageCardsHandler = createReadHandler(async () =>
  (await content().findPageCards()).map(serializePageCard));
export const timelineHandler = createReadHandler(async () =>
  (await content().findTimeline()).map(serializeTimeline));
export const projectsHandler = createReadHandler(async () =>
  (await projects().list()).map(serializeProject));
export const pursuitHandler = createReadHandler(async () =>
  (await content().findPursuits()).map(serializePursuit));
export const socialMediaHandler = createReadHandler(async () =>
  (await content().findSocialLinks()).map(serializeSocialLink));
```

Replace the ten route files with these complete one-line modules, then delete their `.js` predecessors:

```ts
// src/pages/api/about.ts
export { aboutHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/introduction.ts
export { introductionHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/currentOccupation.ts
export { currentOccupationHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/languages.ts
export { languagesHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/list.ts
export { hobbiesHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/pageCards.ts
export { pageCardsHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/professionalTimeline.ts
export { timelineHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/projectsAndCases.ts
export { projectsHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/pursuit.ts
export { pursuitHandler as default } from '../../../server/api/runtime-read-handlers';
// src/pages/api/socialmedia.ts
export { socialMediaHandler as default } from '../../../server/api/runtime-read-handlers';
```

- [ ] **Step 7: Verify every compatibility boundary**

Run:

```bash
yarn vitest run tests/unit/api/serializers.test.ts tests/unit/api/read-handler.test.ts
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn vitest run tests/integration/db/repositories.test.ts --no-file-parallelism
yarn typecheck
rg -n "connectToDatabase|from ['\"]mongodb['\"]" src/pages/api --glob '!contact/route.js'
```

Expected: tests and typecheck pass; the final search returns no matches.

- [ ] **Step 8: Commit**

```bash
git add server/api server/repositories tests/unit/api tests/integration/db src/pages/api types/DBTypes.ts
git commit -m "feat: serve portfolio reads from postgresql"
```

### Task 4: Move Contact Writes, Case Pages, and Health Checks to PostgreSQL

**Files:**
- Create: `server/repositories/contact-repository.ts`
- Create: `server/api/contact-handler.ts`
- Create: `server/pages/case-data.ts`
- Create: `server/health/readiness.ts`
- Create: `src/pages/api/health/live.ts`
- Create: `src/pages/api/health/ready.ts`
- Create: `tests/unit/api/contact-handler.test.ts`
- Create: `tests/unit/pages/case-data.test.ts`
- Create: `tests/unit/health/readiness.test.ts`
- Replace: `src/pages/api/contact/route.js` with `src/pages/api/contact/route.ts`
- Modify: `src/pages/cases/[id]/index.tsx`

**Interfaces:**
- Consumes: `Database`, `ProjectRepository`, `serializeProject()`, shared API test helpers.
- Produces: `NewContactMessage`, `ContactRepository`, `createContactRepository(db)`, `createContactHandler(deps)`, `buildCaseStaticPaths(createRepository)`, `buildCaseStaticProps(repo,id)`, `checkReadiness(db,requiredMigration,timeoutMs)`, and health routes.

- [ ] **Step 1: Write failing contact-contract tests**

Create `tests/unit/api/contact-handler.test.ts` and cover these exact cases:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createContactHandler } from '../../../server/api/contact-handler';
import { createMockRequest, createMockResponse } from '../../helpers/next-api';

const valid = { fullName: 'Martin Lindblad', email: 'martin@example.com', subject: 'Hello', message: 'Test message' };

describe('contact handler', () => {
  it('preserves method, validation, success, and unavailable responses', async () => {
    const insertContact = vi.fn().mockResolvedValue(undefined);
    const handler = createContactHandler({
      insertContact,
      randomUUID: () => '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    });

    const method = createMockResponse();
    await handler(createMockRequest({ method: 'GET' }), method);
    expect([method.statusCode, method.payload]).toEqual([405, { errorMessage: 'Method Not Allowed' }]);

    const invalid = createMockResponse();
    await handler(createMockRequest({ method: 'POST', body: { ...valid, email: '' } }), invalid);
    expect([invalid.statusCode, invalid.payload]).toEqual([400, { errorMessage: 'Missing fields', success: false }]);

    const success = createMockResponse();
    await handler(createMockRequest({ method: 'POST', body: valid }), success);
    expect([success.statusCode, success.payload]).toEqual([201, { successMessage: 'Message sent successfully', success: true }]);
    expect(insertContact).toHaveBeenCalledWith({
      id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3', ...valid,
      createdAt: new Date('2026-07-14T12:00:00.000Z'),
    });

    insertContact.mockRejectedValueOnce(new Error('postgres host secret'));
    const unavailable = createMockResponse();
    await handler(createMockRequest({ method: 'POST', body: valid }), unavailable);
    expect([unavailable.statusCode, unavailable.payload]).toEqual([503, { errorMessage: 'Unable to send message.', success: false }]);
  });
});
```

- [ ] **Step 2: Run the contact test and verify red**

Run: `yarn vitest run tests/unit/api/contact-handler.test.ts`

Expected: FAIL because `server/api/contact-handler.ts` is absent.

- [ ] **Step 3: Implement contact validation and persistence**

Create `server/repositories/contact-repository.ts`:

```ts
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.types';

export interface NewContactMessage {
  id: string; fullName: string; email: string; subject: string; message: string; createdAt: Date;
}
export interface ContactRepository { insertContact(message: NewContactMessage): Promise<void> }

export function createContactRepository(db: Kysely<Database>): ContactRepository {
  return {
    async insertContact(message) {
      await db.insertInto('contact_messages').values({
        id: message.id, full_name: message.fullName, email: message.email,
        subject: message.subject, message: message.message, created_at: message.createdAt,
      }).executeTakeFirstOrThrow();
    },
  };
}
```

Create `server/api/contact-handler.ts`:

```ts
import type { NextApiHandler } from 'next';
import { z } from 'zod';
import type { NewContactMessage } from '../repositories/contact-repository';

const schema = z.object({
  fullName: z.string().trim().min(2).max(50),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(30_000),
}).strict();

export function createContactHandler(deps: {
  insertContact(message: NewContactMessage): Promise<void>;
  randomUUID(): string;
  now(): Date;
}): NextApiHandler {
  return async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ errorMessage: 'Method Not Allowed' });
      return;
    }
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ errorMessage: 'Missing fields', success: false });
      return;
    }
    try {
      await deps.insertContact({ id: deps.randomUUID(), ...parsed.data, createdAt: deps.now() });
      response.status(201).json({ successMessage: 'Message sent successfully', success: true });
    } catch {
      response.status(503).json({ errorMessage: 'Unable to send message.', success: false });
    }
  };
}
```

Replace the API file with:

```ts
import { randomUUID } from 'node:crypto';
import { createContactHandler } from '../../../../server/api/contact-handler';
import { getDatabase } from '../../../../server/db/client';
import { createContactRepository } from '../../../../server/repositories/contact-repository';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
export default createContactHandler({
  insertContact: (message) => createContactRepository(getDatabase()).insertContact(message),
  randomUUID,
  now: () => new Date(),
});
```

- [ ] **Step 4: Write failing case-page and readiness tests**

Create `tests/unit/pages/case-data.test.ts` with a fake `ProjectRepository` and assert: IDs become `{ params: { id } }`, fallback is `'blocking'`, absent build-time database config returns empty paths, unknown ID returns `{ notFound: true }`, and a found row returns serialized props plus `revalidate: 5`.

Create `tests/unit/health/readiness.test.ts` with a fake Kysely executor and fake timers; assert readiness returns true only when `select 1` succeeds and `kysely_migration` contains `002_runtime_grants`, false when either query rejects, and returns false within 2,000 ms when a query never settles.

Run:

```bash
yarn vitest run tests/unit/pages/case-data.test.ts tests/unit/health/readiness.test.ts
```

Expected: FAIL because both runtime modules are missing.

- [ ] **Step 5: Implement case SSG helpers and remove direct Mongo access**

Create `server/pages/case-data.ts`:

```ts
import type { GetStaticPathsResult, GetStaticPropsResult } from 'next';
import type { CasePageProps } from '../../types/DBTypes';
import { serializeProject } from '../api/serializers';
import type { ProjectRepository } from '../repositories/project-repository';

export async function buildCaseStaticPaths(
  createRepository: () => ProjectRepository,
): Promise<GetStaticPathsResult> {
  try {
    const repository = createRepository();
    return {
      paths: (await repository.listIds()).map((id) => ({ params: { id } })),
      fallback: 'blocking',
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Missing database setting:')) {
      return { paths: [], fallback: 'blocking' };
    }
    throw error;
  }
}

export async function buildCaseStaticProps(
  repository: ProjectRepository,
  id: string,
): Promise<GetStaticPropsResult<CasePageProps>> {
  const row = await repository.findById(id);
  if (!row) return { notFound: true };
  return { props: { caseData: serializeProject(row) }, revalidate: 5 };
}
```

In `src/pages/cases/[id]/index.tsx`, delete the MongoDB/ObjectId imports and the two inline data functions. Create the repository through `getDatabase()` inside each exported Next function so missing build-time configuration can be caught, then delegate exactly:

```ts
export const getStaticPaths: GetStaticPaths = async () =>
  buildCaseStaticPaths(() => createProjectRepository(getDatabase()));

export const getStaticProps: GetStaticProps = async ({ params }) =>
  buildCaseStaticProps(createProjectRepository(getDatabase()), String(params?.id ?? ''));
```

- [ ] **Step 6: Implement bounded liveness/readiness without leaking errors**

Create `server/health/readiness.ts`:

```ts
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/database.types';

export async function checkReadiness(
  db: Kysely<Database>,
  requiredMigration: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  const check = async () => {
    await sql`select 1`.execute(db);
    const migration = await db.selectFrom('kysely_migration').select('name')
      .where('name', '=', requiredMigration).executeTakeFirst();
    return migration?.name === requiredMigration;
  };
  try {
    return await Promise.race([
      check(),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  } catch {
    return false;
  }
}
```

Create `src/pages/api/health/live.ts`:

```ts
import type { NextApiHandler } from 'next';
const handler: NextApiHandler = (_request, response) => response.status(200).json({ status: 'ok' });
export default handler;
```

Create `src/pages/api/health/ready.ts`:

```ts
import type { NextApiHandler } from 'next';
import { getDatabase } from '../../../../server/db/client';
import { checkReadiness } from '../../../../server/health/readiness';

const handler: NextApiHandler = async (_request, response) => {
  let ready = false;
  try {
    ready = await checkReadiness(getDatabase(), '002_runtime_grants');
  } catch {
    ready = false;
  }
  response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
};
export default handler;
```

- [ ] **Step 7: Verify database-only runtime behavior**

Run:

```bash
yarn vitest run tests/unit/api/contact-handler.test.ts tests/unit/pages/case-data.test.ts tests/unit/health/readiness.test.ts
yarn typecheck
rg -n "connectToDatabase|ObjectId|from ['\"]mongodb['\"]" src/pages src/components types --glob '!**/*.test.*'
```

Expected: all focused tests and typecheck pass; the search returns no runtime matches.

- [ ] **Step 8: Commit**

```bash
git add server/api/contact-handler.ts server/repositories/contact-repository.ts server/pages server/health src/pages/api/contact src/pages/api/health src/pages/cases tests/unit
git commit -m "feat: move contact cases and health to postgresql"
```

### Task 5: Build the Strict MongoDB-to-PostgreSQL Mapping Boundary

**Files:**
- Create: `migration/source-collections.ts`
- Create: `migration/source-schemas.ts`
- Create: `migration/mappers.ts`
- Create: `migration/canonical.ts`
- Create: `migration/errors.ts`
- Create: `tests/unit/migration/source-schemas.test.ts`
- Create: `tests/unit/migration/mappers.test.ts`
- Create: `tests/unit/migration/canonical.test.ts`

**Interfaces:**
- Consumes: MongoDB `ObjectId` only in migration code, destination insert types, public serializer shapes.
- Produces: `SourceCollection`, `SOURCE_COLLECTIONS`, `parseSourceDocument(collection,input)`, `mapSourceDocument(collection,document,sourceOrder)`, `canonicalHash(rows)`, and redacted `MigrationIssue`.

- [ ] **Step 1: Write failing tests for every rejection and preservation rule**

Create table-driven tests with one valid fixture for each collection and these mandatory assertions:

```ts
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { parseSourceDocument } from '../../../migration/source-schemas';
import { mapSourceDocument } from '../../../migration/mappers';

describe('strict source boundary', () => {
  it('preserves Mongo ID, instant, spelling conversion, and snapshot order', () => {
    const document = parseSourceDocument('contact', {
      _id: new ObjectId('64b000000000000000000001'),
      fullName: 'Martin Lindblad', email: 'martin@example.com', subject: 'Hej',
      message: 'Meddelande', date: new Date('2024-02-03T04:05:06.789Z'),
    });
    expect(mapSourceDocument('contact', document, 91)).toEqual({
      id: '64b000000000000000000001', full_name: 'Martin Lindblad',
      email: 'martin@example.com', subject: 'Hej', message: 'Meddelande',
      created_at: new Date('2024-02-03T04:05:06.789Z'),
    });
  });

  it.each([
    ['unknown top-level field', { _id: new ObjectId(), fullName: 'A B', email: 'a@b.se', subject: 's', message: 'm', date: new Date(), extra: true }],
    ['both name spellings', { _id: new ObjectId(), fullName: 'A B', fullname: 'A B', email: 'a@b.se', subject: 's', message: 'm', date: new Date() }],
    ['invalid date', { _id: new ObjectId(), fullName: 'A B', email: 'a@b.se', subject: 's', message: 'm', date: 'yesterday' }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseSourceDocument('contact', input)).toThrow();
  });
});
```

Add separate tests that reject an unknown field at every nested `projectDetails` level, reject missing required fields, preserve empty strings when the existing contract permits them, preserve `from`/`to`/`duration` as text, convert optional source absence to SQL `null`, and assert canonical hashes are independent of input row order but change when any mapped value changes.

- [ ] **Step 2: Run the mapper suite and verify red**

Run: `yarn vitest run tests/unit/migration`

Expected: FAIL with module-not-found errors for the `migration` modules.

- [ ] **Step 3: Define the collection registry and redacted error type**

Create `migration/source-collections.ts`:

```ts
export const SOURCE_COLLECTIONS = {
  about: 'profile_sections',
  current_occupation: 'current_occupations',
  hobbys: 'hobbies',
  languages: 'languages',
  page_cards: 'page_cards',
  proffessional_timeline: 'professional_timeline',
  projects_and_cases: 'projects',
  pursuit: 'pursuits',
  social_media: 'social_links',
  contact: 'contact_messages',
} as const;

export type SourceCollection = keyof typeof SOURCE_COLLECTIONS;
export const CONTENT_COLLECTIONS = Object.keys(SOURCE_COLLECTIONS)
  .filter((name) => name !== 'contact') as Exclude<SourceCollection, 'contact'>[];
```

Create `migration/errors.ts`:

```ts
import type { SourceCollection } from './source-collections';

export interface MigrationIssue {
  collection: SourceCollection;
  id: string;
  code: 'unknown_field' | 'invalid_value' | 'duplicate_id' | 'hash_mismatch' | 'asset_missing';
  path: string;
}

export class MigrationValidationError extends Error {
  constructor(public readonly issues: readonly MigrationIssue[]) {
    super(`migration validation failed with ${issues.length} issue(s)`);
    this.name = 'MigrationValidationError';
  }
}
```

- [ ] **Step 4: Define strict Zod schemas for all ten source documents**

Create `migration/source-schemas.ts`. Every `z.object` must call `.strict()`, including link/detail/project objects. Use these building blocks and registry:

```ts
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { SourceCollection } from './source-collections';

const objectId = z.custom<ObjectId>(
  (value) => value instanceof ObjectId && ObjectId.isValid(value),
  'valid ObjectId required',
);
const base = { _id: objectId };
const projectLink = z.object({ title: z.string(), path: z.string() }).strict();
const projectDetail = z.object({ title: z.string(), description: z.string() }).strict();
export const projectDetailsSchema = z.object({
  headline: z.string(),
  description: z.string(),
  videoID: z.string().optional(),
  videoTitle: z.string().optional(),
  videoDescription: z.string().optional(),
  imageSources: z.array(z.string()).optional(),
  roleDetails: z.array(z.string()),
  roleTitle: z.string(),
  links: z.array(projectLink).optional(),
  details: z.array(projectDetail),
}).strict();

const schemas = {
  about: z.object({ ...base, title: z.string(), info: z.string(), name: z.string(),
    surname: z.string(), key: z.string(), description: z.array(z.string()).optional(),
    imageSource: z.string().optional(), link: z.string().optional(),
    linkText: z.string().optional(), profileImage: z.string().optional() }).strict(),
  current_occupation: z.object({ ...base, occupationType: z.string(), description: z.string(),
    from: z.string(), to: z.string(), introduction: z.string(), name: z.string(), link: z.string() }).strict(),
  hobbys: z.object({ ...base, title: z.string(), content: z.string(), type: z.string() }).strict(),
  languages: z.object({ ...base, name: z.string(), spoken: z.string(), written: z.string() }).strict(),
  page_cards: z.object({ ...base, title: z.string(), description: z.string(), link: z.string(),
    content: z.string(), key: z.string(), type: z.string() }).strict(),
  proffessional_timeline: z.object({ ...base, company: z.string().optional(),
    institution: z.string().optional(), qualification: z.string().optional(), duration: z.string(),
    title: z.string(), description: z.string(), index: z.number().int() }).strict(),
  projects_and_cases: z.object({ ...base, title: z.string(), description: z.string(),
    imageSource: z.string(), from: z.string(), to: z.string(), projectDetails: projectDetailsSchema }).strict(),
  pursuit: z.object({ ...base, title: z.string(), description: z.string(),
    leftImageSource: z.string(), rightImageSource: z.string() }).strict(),
  social_media: z.object({ ...base, name: z.string(), link: z.string() }).strict(),
  contact: z.union([
    z.object({ ...base, fullName: z.string(), email: z.string(), subject: z.string(), message: z.string(), date: z.date() }).strict(),
    z.object({ ...base, fullname: z.string(), email: z.string(), subject: z.string(), message: z.string(), date: z.date() }).strict(),
  ]),
} satisfies Record<SourceCollection, z.ZodType>;

export type SourceDocument<K extends SourceCollection> = z.infer<(typeof schemas)[K]>;
export function parseSourceDocument<K extends SourceCollection>(collection: K, input: unknown): SourceDocument<K> {
  return schemas[collection].parse(input) as SourceDocument<K>;
}
export const allowedSourceKeys = (collection: SourceCollection): ReadonlySet<string> => {
  const schema = schemas[collection];
  const options = schema instanceof z.ZodUnion ? schema.options : [schema];
  return new Set(options.flatMap((option) => Object.keys(option.shape)));
};
```

The Atlas inventory in Task 6 is the authority for actual optionality and exact source keys. A mismatch blocks progress; update the schema with a reviewed, explicit field mapping and a new test before another rehearsal. Never switch these schemas to `.passthrough()` or `.strip()`.

- [ ] **Step 5: Implement explicit table mappers**

Create `migration/mappers.ts`. Export overloads for each collection so the importer receives typed inserts. Every content mapper includes `source_order`; the contact mapper does not. The implementation must be the following exhaustive switch:

```ts
import type { Insertable } from 'kysely';
import type { Database } from '../server/db/database.types';
import type { SourceCollection } from './source-collections';
import type { SourceDocument } from './source-schemas';

interface DestinationMap {
  about: Insertable<Database['profile_sections']>;
  current_occupation: Insertable<Database['current_occupations']>;
  hobbys: Insertable<Database['hobbies']>;
  languages: Insertable<Database['languages']>;
  page_cards: Insertable<Database['page_cards']>;
  proffessional_timeline: Insertable<Database['professional_timeline']>;
  projects_and_cases: Insertable<Database['projects']>;
  pursuit: Insertable<Database['pursuits']>;
  social_media: Insertable<Database['social_links']>;
  contact: Insertable<Database['contact_messages']>;
}
export type DestinationInsert<K extends SourceCollection> = DestinationMap[K];
type Mapper<K extends SourceCollection> = (
  document: SourceDocument<K>, sourceOrder: number,
) => DestinationInsert<K>;

const mappers = {
  about: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder, key: document.key,
    title: document.title, info: document.info, name: document.name, surname: document.surname,
    description: document.description ?? null, image_source: document.imageSource ?? null,
    link: document.link ?? null, link_text: document.linkText ?? null,
    profile_image: document.profileImage ?? null,
  }),
  current_occupation: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder,
    occupation_type: document.occupationType, description: document.description,
    from_label: document.from, to_label: document.to, introduction: document.introduction,
    name: document.name, link: document.link,
  }),
  hobbys: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder,
    title: document.title, content: document.content, type: document.type,
  }),
  languages: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder,
    name: document.name, spoken: document.spoken, written: document.written,
  }),
  page_cards: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder, title: document.title,
    description: document.description, link: document.link, content: document.content,
    key: document.key, type: document.type,
  }),
  proffessional_timeline: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder,
    company: document.company ?? null, institution: document.institution ?? null,
    qualification: document.qualification ?? null, duration: document.duration,
    title: document.title, description: document.description, sort_index: document.index,
  }),
  projects_and_cases: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder, title: document.title,
    description: document.description, image_source: document.imageSource,
    from_label: document.from, to_label: document.to, project_details: document.projectDetails,
  }),
  pursuit: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder, title: document.title,
    description: document.description, left_image_source: document.leftImageSource,
    right_image_source: document.rightImageSource,
  }),
  social_media: (document, sourceOrder) => ({
    id: document._id.toHexString(), source_order: sourceOrder,
    name: document.name, link: document.link,
  }),
  contact: (document) => ({
    id: document._id.toHexString(),
    full_name: 'fullName' in document ? document.fullName : document.fullname,
    email: document.email, subject: document.subject, message: document.message,
    created_at: document.date,
  }),
} satisfies { [K in SourceCollection]: Mapper<K> };

export function mapSourceDocument<K extends SourceCollection>(
  collection: K,
  document: SourceDocument<K>,
  sourceOrder: number,
): DestinationInsert<K> {
  const mapper = mappers[collection] as Mapper<K>;
  return mapper(document, sourceOrder);
}
```

- [ ] **Step 6: Implement deterministic canonical hashes**

Create `migration/canonical.ts`:

```ts
import { createHash } from 'node:crypto';

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

export function canonicalHash(rows: readonly Record<string, unknown>[]): string {
  const ordered = [...rows].sort((left, right) => String(left._id).localeCompare(String(right._id)));
  return createHash('sha256').update(JSON.stringify(normalize(ordered))).digest('hex');
}
```

Canonical source rows and destination rows must both be transformed to the existing public/API field shape before hashing. Contact canonical rows use `_id`, `fullName`, `email`, `subject`, `message`, and ISO `date`; they are never written into reports.

- [ ] **Step 7: Verify strictness and exact transformations**

Run:

```bash
yarn vitest run tests/unit/migration
yarn typecheck
rg -n "passthrough\(|\.strip\(|console\.(log|error).*document|\bany\b" migration
```

Expected: all tests pass; the search returns no matches.

- [ ] **Step 8: Commit**

```bash
git add migration tests/unit/migration
git commit -m "feat: add strict mongo postgres mapping"
```

### Task 6: Implement Inventory, Transactional Import, Verification, and Migration Commands

**Files:**
- Create: `migration/mongo-client.ts`
- Create: `migration/inventory.ts`
- Create: `migration/importer.ts`
- Create: `migration/verification.ts`
- Create: `migration/report.ts`
- Create: `scripts/migration/export-mongo.sh`
- Create: `scripts/migration/run-rehearsal.ts`
- Create: `scripts/migration/preload-content.ts`
- Create: `scripts/migration/finalize-contacts.ts`
- Create: `scripts/migration/remove-synthetic-contact.ts`
- Create: `tests/unit/migration/inventory.test.ts`
- Create: `tests/integration/db/importer.test.ts`
- Modify: `.gitignore`
- Create: `tsconfig.migration.json`

**Interfaces:**
- Consumes: strict parsers/mappers, `Database`, `SOURCE_COLLECTIONS`, and canonical serializers.
- Produces: `SourceSnapshot`, `SourceInventory`, `MigrationReport`, `ValidationReport`, `inventorySource(db)`, `captureSnapshot(db,collections)`, `importSnapshot(db,snapshot)`, `verifySnapshot(db,snapshot)`, and four operator CLIs.

- [ ] **Step 1: Write failing importer and inventory tests**

Create an importer integration fixture containing at least two rows per collection. The test must assert one transaction across the requested snapshot, exact counts/IDs/hashes, preserved `source_order`, an identical second run with no duplicate rows, total rollback when one row is invalid, total rollback for duplicate source IDs, and rejection when an existing destination ID has a different canonical hash.

Create `tests/unit/migration/inventory.test.ts` with a fake Mongo database that returns collection options, validators, indexes, and BSON documents. Assert the report contains only:

```ts
{
  generatedAt: '2026-07-14T12:00:00.000Z',
  collections: {
    contact: {
      count: 1,
      ids: ['64b000000000000000000001'],
      keys: ['_id', 'date', 'email', 'fullName', 'message', 'subject'],
      bsonTypes: { '_id': ['objectId'], date: ['date'], email: ['string'], fullName: ['string'], message: ['string'], subject: ['string'] },
      indexes: [{ name: '_id_', keys: { _id: 1 }, unique: true }],
      validatorHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
  },
}
```

Assert JSON output does not contain `martin@example.com`, contact names, subjects, messages, Mongo URI, or database name.

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```bash
yarn vitest run tests/unit/migration/inventory.test.ts
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn vitest run tests/integration/db/importer.test.ts --no-file-parallelism
```

Expected: module-not-found failures for inventory/importer.

- [ ] **Step 3: Implement a migration-only Mongo client and ordered snapshots**

Create `migration/mongo-client.ts`:

```ts
import fs from 'node:fs';
import { MongoClient, type Db } from 'mongodb';

export async function withSourceDatabase<T>(run: (db: Db) => Promise<T>): Promise<T> {
  const uriFile = process.env.MONGO_URI_FILE;
  const databaseName = process.env.MONGO_DATABASE;
  if (!uriFile || !databaseName) throw new Error('migration source configuration missing');
  const uri = fs.readFileSync(uriFile, 'utf8').trim();
  const client = new MongoClient(uri, { appName: 'mlp-read-only-migration', serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    return await run(client.db(databaseName));
  } finally {
    await client.close();
  }
}
```

In `migration/inventory.ts`, inspect exactly the ten registered collections, use the order returned by `find({}).toArray()` as the snapshot order, recurse through objects/arrays to collect key paths and BSON type names, hash validators with `canonicalHash`, and return counts plus lexically sorted 24-character IDs. Compare each top-level key set to `allowedSourceKeys(collection)` and throw `MigrationValidationError` for every uncovered key.

Export these inventory types and function:

```ts
export interface InventoryIndex {
  name: string;
  keys: Record<string, 1 | -1 | 'text' | 'hashed'>;
  unique: boolean;
}
export interface CollectionInventory {
  count: number;
  ids: string[];
  keys: string[];
  bsonTypes: Record<string, string[]>;
  indexes: InventoryIndex[];
  validatorHash: string;
}
export interface SourceInventory {
  generatedAt: string;
  collections: Record<SourceCollection, CollectionInventory>;
}
export async function inventorySource(db: import('mongodb').Db): Promise<SourceInventory>;
```

Define snapshots without serialization loss:

```ts
import type { SourceCollection } from './source-collections';

export interface SnapshotDocument { sourceOrder: number; value: unknown }
export type SourceSnapshot = Record<SourceCollection, SnapshotDocument[]>;

export async function captureSnapshot(
  db: import('mongodb').Db,
  collections: readonly SourceCollection[],
): Promise<Partial<SourceSnapshot>> {
  const entries = await Promise.all(collections.map(async (collection) => {
    const rows = await db.collection(collection).find({}).toArray();
    return [collection, rows.map((value, sourceOrder) => ({ sourceOrder, value }))] as const;
  }));
  return Object.fromEntries(entries);
}
```

- [ ] **Step 4: Implement atomic, idempotent import and verification**

In `migration/importer.ts`, parse all documents before starting SQL, reject duplicate IDs with a `Set`, then use `db.transaction().execute(async trx => ...)`. For each collection, load all existing rows with matching IDs, compare canonical public-shape hashes, skip identical rows, abort on different rows, and insert the remaining values with one explicit `insertInto()` branch per destination table. Never use `onConflict().doNothing()` because it would hide hash mismatches.

Export these exact types/functions:

```ts
export interface CollectionResult { count: number; ids: string[]; canonicalHash: string }
export interface MigrationReport {
  generatedAt: string;
  collections: Partial<Record<SourceCollection, CollectionResult>>;
}
export async function importSnapshot(
  db: import('kysely').Kysely<import('../server/db/database.types').Database>,
  snapshot: Partial<import('./inventory').SourceSnapshot>,
): Promise<MigrationReport>;
```

In `migration/verification.ts`, query each requested destination table, serialize rows back to source/public casing, sort IDs, calculate canonical hashes, and compare count, exact ID array, timestamp ISO values for contacts, and hashes. Return:

```ts
export interface ValidationReport {
  valid: boolean;
  generatedAt: string;
  collections: Partial<Record<SourceCollection, {
    sourceCount: number; destinationCount: number;
    idsMatch: boolean; timestampsMatch: boolean; hashMatch: boolean;
  }>>;
}
```

Throw before writing a report when `valid` is false. Reports use counts, IDs, booleans, and hashes only.

- [ ] **Step 5: Implement safe report and encrypted archive handling**

Add to `.gitignore`:

```gitignore
/migration-artifacts/
```

Create `migration/report.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.MIGRATION_REPORT_ROOT ?? 'migration-artifacts/reports');
const secretPattern = /mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|"(?:password|token|uri)"\s*:/i;

export function reportPath(fileName: string): string {
  if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(fileName)) throw new Error('invalid report filename');
  return path.join(root, fileName);
}

export async function writeReport(filePath: string, value: unknown): Promise<void> {
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== root) throw new Error('report path outside report root');
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (secretPattern.test(json)) throw new Error('report contains sensitive value');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(resolved, json, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}
```

Report types expose only counts, sorted IDs, aggregate hashes, schema key/type names, index definitions, timestamps of the operation, and validation booleans. Contact document values are never arguments to `writeReport`.

Create executable `scripts/migration/export-mongo.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${MONGO_URI_FILE:?MONGO_URI_FILE is required}"
: "${MONGO_DATABASE:?MONGO_DATABASE is required}"
: "${ARCHIVE_RECIPIENT:?ARCHIVE_RECIPIENT is required}"
: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"

mkdir -p "$ARTIFACT_DIR"
work="$(mktemp -d "$ARTIFACT_DIR/.mongo-export.XXXXXX")"
trap 'rm -rf "$work"' EXIT
uri="$(tr -d '\n' <"$MONGO_URI_FILE")"
archive="$ARTIFACT_DIR/mongo-final-$(date -u +%Y%m%dT%H%M%SZ).archive.gz.age"

mongodump --quiet --uri "$uri" --db "$MONGO_DATABASE" --archive --gzip \
  | age --recipient "$ARCHIVE_RECIPIENT" --output "$archive"
unset uri
test -s "$archive"
chmod 0600 "$archive"
printf '%s\n' "$archive"
```

- [ ] **Step 6: Implement rehearsal and cutover CLIs**

Each CLI imports configuration through `MONGO_URI_FILE`/`MONGO_DATABASE` and PostgreSQL file-backed settings, writes only redacted reports, destroys database clients in `finally`, and exits nonzero on any mismatch:

```ts
// run-rehearsal.ts
const collections = Object.keys(SOURCE_COLLECTIONS) as SourceCollection[];
const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
await withSourceDatabase(async (source) => {
  const inventory = await inventorySource(source);
  const snapshot = await captureSnapshot(source, collections);
  const imported = await importSnapshot(target, snapshot);
  const validated = await verifySnapshot(target, snapshot);
  await writeReport(reportPath(`${runId}-inventory.json`), inventory);
  await writeReport(reportPath(`${runId}-migration.json`), imported);
  await writeReport(reportPath(`${runId}-validation.json`), validated);
});
```

`preload-content.ts` uses only `CONTENT_COLLECTIONS`. `finalize-contacts.ts` captures only `contact`, imports only contacts missing from the verified preload boundary, and verifies the complete contact snapshot in the same command. `remove-synthetic-contact.ts` requires an exact UUID argument, refuses 24-character IDs, deletes exactly one PostgreSQL row, and exits nonzero if affected-row count is not one.

Create `tsconfig.migration.json` so one-time MongoDB code is type-checked separately and never copied into the production app image:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["migration/**/*.ts", "scripts/migration/**/*.ts", "server/**/*.ts", "types/**/*.ts"]
}
```

Add these package scripts:

```json
{
  "scripts": {
    "migration:rehearsal": "tsx scripts/migration/run-rehearsal.ts",
    "migration:preload": "tsx scripts/migration/preload-content.ts",
    "migration:contacts": "tsx scripts/migration/finalize-contacts.ts",
    "migration:remove-synthetic": "tsx scripts/migration/remove-synthetic-contact.ts",
    "migration:typecheck": "tsc --project tsconfig.migration.json"
  }
}
```

- [ ] **Step 7: Verify importer safety and output redaction**

Run:

```bash
yarn vitest run tests/unit/migration
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn vitest run tests/integration/db/importer.test.ts --no-file-parallelism
shellcheck scripts/migration/export-mongo.sh
yarn migration:typecheck
git check-ignore migration-artifacts/contact-source.json
```

Expected: tests/typecheck/ShellCheck pass and `git check-ignore` prints `migration-artifacts/contact-source.json`.

- [ ] **Step 8: Commit**

```bash
git add .gitignore migration scripts/migration tests/unit/migration tests/integration/db/importer.test.ts tsconfig.migration.json package.json yarn.lock
git commit -m "feat: add verified transactional data migration"
```

### Task 7: Make Static Assets and the Service Worker Linux-Safe

**Files:**
- Create: `tests/assets/local-assets.test.mjs`
- Create: `tests/assets/service-worker.test.mjs`
- Create: `public/sw-manifest.json`
- Modify: `public/sw.js`
- Modify: `public/manifest.json`
- Rename/index-normalize: `public/Images/**` to `public/images/**`
- Rename: `public/images/Cases/**` to `public/images/cases/**`
- Modify: `src/components/About/HeroIntroduction.tsx`
- Modify: `src/components/CaseCarousel.tsx`
- Modify: `src/components/Profile/Avatar.tsx`
- Modify: `src/components/SEO.tsx`
- Modify: `src/pages/cases/index.tsx`
- Modify: `src/pages/showcases.tsx`

**Interfaces:**
- Consumes: Existing local URL references and the actual Git index.
- Produces: One lowercase asset tree, `sw-manifest.json`, a same-origin/API-safe service worker, and reusable exact-casing checks for CI and migrated database URLs.

- [ ] **Step 1: Write an exact-segment asset test and capture current failures**

Create `tests/assets/local-assets.test.mjs`. It must scan tracked `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.json`, and `.xml` files for absolute local `/images/`, `/assets/`, `/favicon`, and `/manifest` URLs; decode query/hash suffixes; then walk each segment using `fs.readdir()` and compare exact string casing instead of relying on `existsSync()`.

The core assertion is:

```js
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

async function assertExactPath(root, urlPath) {
  let current = root;
  for (const segment of urlPath.split('/').filter(Boolean)) {
    const entries = await readdir(current);
    assert.ok(entries.includes(segment), `${urlPath}: expected exact segment ${segment} in ${current}`);
    current = path.join(current, segment);
  }
}

test('all tracked local assets resolve with Linux-exact casing', async () => {
  for (const urlPath of await collectTrackedLocalUrls(process.cwd())) {
    await assertExactPath(path.join(process.cwd(), 'public'), urlPath);
  }
});
```

Implement `collectTrackedLocalUrls()` with `git ls-files -z`, the extensions above, and a URL regex; export it so migration verification can feed database `imageSource` values into the same `assertExactPath()` function.

Run: `node --test tests/assets/local-assets.test.mjs`

Expected: FAIL for `/Images`, `/images/Cases`, four social `.webp` references whose files are `.png`, `socail-media.webp`, and the nonexistent `/_next/static/css/styles.chunk.css` service-worker entry.

- [ ] **Step 2: Normalize the case-colliding Git index safely on macOS**

Run these exact commands from a clean worktree; the temporary names force the filesystem to record the case transition while `update-index` removes duplicate uppercase entries:

```bash
git ls-files -z 'public/Images/**' | xargs -0 git update-index --force-remove --
mv public/Images public/images-normalizing
mv public/images-normalizing public/images
git ls-files -z 'public/images/Cases/**' | xargs -0 git update-index --force-remove --
mv public/images/Cases public/images/cases-normalizing
mv public/images/cases-normalizing public/images/cases
git add -A public/images
```

Update every source/manifest reference to lowercase `/images/...` and `/images/cases/...`; use `.png` for Facebook, GitHub, Instagram, and LinkedIn; correct `socail-media.webp` to `social-media.webp`.

- [ ] **Step 3: Write failing service-worker lifecycle tests**

Create `tests/assets/service-worker.test.mjs` using `node:vm` with fake `self`, `caches`, `fetch`, and `Request`. Assert install rejects if any manifest URL is 404, activate deletes all caches except `mlp-shell-v2`, navigation is network-first, static assets are cache-first, failed responses are not stored, cross-origin requests are untouched, and every `/api/` request plus every non-GET request is untouched.

Run: `node --test tests/assets/service-worker.test.mjs`

Expected: FAIL against the current service worker because it intercepts API/non-GET requests and its precache list contains missing files.

- [ ] **Step 4: Replace the precache manifest and service worker**

Create `public/sw-manifest.json`:

```json
[
  "/",
  "/favicon.ico",
  "/manifest.json",
  "/images/profilepicture.webp"
]
```

Replace `public/sw.js` completely:

```js
const CACHE_NAME = 'mlp-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const manifestResponse = await fetch('/sw-manifest.json', { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error('service-worker manifest unavailable');
    const urls = await manifestResponse.json();
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(['/sw-manifest.json', ...urls]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  })());
});
```

Update `public/manifest.json` icons to `/images/profilepicture.webp`.

- [ ] **Step 5: Verify Linux paths and lifecycle behavior**

Run:

```bash
node --test tests/assets/local-assets.test.mjs tests/assets/service-worker.test.mjs
rg -n '/Images/|/images/Cases/|socail-media|/(facebook|github|instagram|linkedin)\.webp|styles\.chunk\.css' src public
git ls-files | LC_ALL=C sort | awk 'tolower($0) in seen { print } { seen[tolower($0)]=1 }'
```

Expected: two passing files; both searches produce no output.

- [ ] **Step 6: Commit**

```bash
git add -A public src tests/assets
git commit -m "fix: normalize linux assets and service worker"
```

### Task 8: Build Immutable App and Backup Images

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `infra/backup/Dockerfile`
- Create: `infra/backup/backup.sh`
- Create: `tests/infra/docker-image.test.mjs`
- Modify: `next.config.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Next standalone build, compiled `dist/scripts/db/migrate.js`, readiness route, and PostgreSQL/Restic file secrets.
- Produces: non-root `app` image on port 3000 and `db-backup` image with `pg_dump`, `pg_restore`, and Restic.

- [ ] **Step 1: Write failing Dockerfile contract tests**

Create `tests/infra/docker-image.test.mjs` to parse both Dockerfiles and assert exact digest-pinned `FROM` lines, app user `node`, `HOSTNAME=0.0.0.0`, port 3000, readiness healthcheck, OCI revision label, copied standalone/public/static/migrations, no secret build args, and backup binaries. Run:

```bash
node --test tests/infra/docker-image.test.mjs
```

Expected: FAIL because neither Dockerfile exists.

- [ ] **Step 2: Enable standalone output and deterministic build scripts**

Add `output: 'standalone'` to the exported object in `next.config.js`. Add:

```json
{
  "scripts": {
    "build:scripts": "tsc --project tsconfig.scripts.json",
    "build:production": "yarn build:scripts && next build"
  }
}
```

- [ ] **Step 3: Add the app Dockerfile**

Create `Dockerfile`:

```dockerfile
ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json yarn.lock ./
COPY patches ./patches
RUN yarn install --frozen-lockfile

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build:production

FROM ${NODE_IMAGE} AS runner
ARG COMMIT_SHA
LABEL org.opencontainers.image.source="https://github.com/martinlindblad/mlp" \
      org.opencontainers.image.revision=$COMMIT_SHA
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
```

Create `.dockerignore`:

```text
.git
.github
.next
node_modules
dist
migration-artifacts
migration
scripts/migration
.env*
infra/runtime.example/secrets
docs
tests
```

- [ ] **Step 4: Add the backup image and verified logical-backup script**

Create `infra/backup/Dockerfile`:

```dockerfile
FROM restic/restic:0.18.1@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76 AS restic
FROM postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY infra/backup/backup.sh /usr/local/bin/mlp-backup
RUN chmod 0555 /usr/local/bin/mlp-backup /usr/local/bin/restic
ENTRYPOINT ["/usr/local/bin/mlp-backup"]
```

Create `infra/backup/backup.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${PGPASSWORD_FILE:?PGPASSWORD_FILE is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"

export PGPASSWORD="$(tr -d '\n' <"$PGPASSWORD_FILE")"
work="$(mktemp -d /tmp/mlp-backup.XXXXXX)"
trap 'unset PGPASSWORD; rm -rf "$work"' EXIT
dump="$work/mlp-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump --format=custom --no-owner --no-acl --file="$dump"
pg_restore --list "$dump" >/dev/null
restic backup --tag mlp-postgresql "$dump"
restic forget --tag mlp-postgresql --keep-daily 30 --prune
restic check --read-data-subset=5%
```

- [ ] **Step 5: Build and inspect both images**

Run on Linux or CI with Docker:

```bash
docker build --build-arg COMMIT_SHA="$(git rev-parse HEAD)" --tag mlp:test .
docker build --file infra/backup/Dockerfile --tag mlp-backup:test .
node --test tests/infra/docker-image.test.mjs
docker run --rm --entrypoint sh mlp:test -ec 'test "$(id -u)" -ne 0; test -f /app/server.js; test -d /app/public; test -d /app/.next/static; test -f /app/dist/scripts/db/migrate.js'
docker run --rm --entrypoint sh mlp-backup:test -ec 'pg_dump --version | grep "18.4"; pg_restore --version | grep "18.4"; restic version | grep "0.18.1"'
docker inspect mlp:test --format '{{.Config.User}} {{json .Config.Healthcheck}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Expected: builds pass, app UID is nonzero, required files/binaries exist, versions are 18.4/0.18.1, and the OCI revision equals `git rev-parse HEAD`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore infra/backup next.config.js package.json yarn.lock tests/infra/docker-image.test.mjs
git commit -m "feat: add immutable production images"
```

### Task 9: Define Caddy, Compose Networks, and Root-Only Secret Injection

**Files:**
- Create: `infra/caddy/Caddyfile`
- Create: `infra/caddy/modes/contact-enabled.caddy`
- Create: `infra/caddy/modes/contact-maintenance.caddy`
- Create: `compose.production.yml`
- Create: `infra/runtime.example/env/app.env`
- Create: `infra/runtime.example/env/migrator.env`
- Create: `infra/runtime.example/env/backup.env`
- Create: `infra/runtime.example/secrets/*`
- Create: `infra/runtime.example/README.md`
- Create: `infra/cloudflare/README.md`
- Create: `ops/compose.sh`
- Create: `scripts/verify-production-config.mjs`
- Create: `tests/infra/caddy.test.mjs`
- Create: `tests/infra/compose.test.mjs`
- Create: `tests/infra/fixtures/echo-server.mjs`
- Create: `tests/infra/fixtures/caddy.compose.yml`

**Interfaces:**
- Consumes: app/backup image references, health endpoints, file-backed password settings, and internal Caddy port 8080.
- Produces: the exact seven-service `mlp-prod` topology, four networks, Caddy production policy, environment-backed Compose secrets materialized with service UIDs, and `mlp-compose` wrapper.

- [ ] **Step 1: Write failing Caddy and Compose contract tests**

`tests/infra/compose.test.mjs` must render `docker compose config --format json` with safe example configuration and assert:

```js
assert.deepEqual(Object.keys(config.services).sort(), [
  'app', 'caddy', 'cloudflared-a', 'cloudflared-b', 'db-backup', 'migrator', 'postgres',
]);
for (const service of Object.values(config.services)) assert.equal(service.ports, undefined);
for (const name of ['tunnel', 'web', 'database']) assert.equal(config.networks[name].internal, true);
assert.equal(config.networks.egress.internal ?? false, false);
assert.deepEqual(Object.keys(config.services.postgres.networks), ['database']);
assert.match(config.services.app.image, /@sha256:[0-9a-f]{64}$/);
assert.equal(config.services.app.image, config.services.migrator.image);
```

Also assert exact network membership, `gw_priority: 1` only on egress consumers, all log limits, restart policies, dependencies, no privileged service, dropped capabilities, seven digest references after interpolation, authenticated PostgreSQL healthcheck, readiness app healthcheck, two cloudflared healthchecks, and `nofile >= 70000`.

`tests/infra/caddy.test.mjs` starts the pinned Caddy image and echo fixture on an isolated Docker network. Assert unknown host 421, missing `CF-Connecting-IP` 403, `www` 308 preserving `/path?q=1`, replacement rather than append of spoofed forwarding headers, 32 KiB contact limit, maintenance-only contact 503 with `Retry-After: 300`, normal GET/read API passthrough, zstd/gzip support, security headers, and `/sw.js` no-cache.

Run:

```bash
node --test tests/infra/compose.test.mjs tests/infra/caddy.test.mjs
```

Expected: FAIL because production configuration does not exist.

- [ ] **Step 2: Implement the Caddy policy and both contact modes**

Create `infra/caddy/Caddyfile`:

```caddyfile
{
  auto_https off
  admin off
}

:8080 {
  route {
    @unknown_host not host martin-lindblad.com www.martin-lindblad.com migration.martin-lindblad.com
    respond @unknown_host 421

    @missing_cloudflare not header CF-Connecting-IP *
    respond @missing_cloudflare 403

    @www host www.martin-lindblad.com
    redir @www https://martin-lindblad.com{uri} 308

    import /etc/caddy/modes/{env.CONTACT_MODE}.caddy

    @contact {
      method POST
      path /api/contact/route
    }
    request_body @contact {
      max_size 32KiB
    }

    header {
      X-Content-Type-Options nosniff
      Referrer-Policy strict-origin-when-cross-origin
      X-Frame-Options DENY
    }
    header /sw.js Cache-Control "no-cache"
    encode zstd gzip

    reverse_proxy app:3000 {
      transport http {
        dial_timeout 5s
        response_header_timeout 30s
      }
      header_up -Forwarded
      header_up -X-Forwarded-For
      header_up -X-Real-IP
      header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
      header_up X-Real-IP {http.request.header.CF-Connecting-IP}
      header_up X-Forwarded-Proto https
    }
  }
}
```

Create `infra/caddy/modes/contact-enabled.caddy`:

```caddyfile
# Contact writes continue to the application.
```

Create `infra/caddy/modes/contact-maintenance.caddy`:

```caddyfile
@contact_maintenance {
  method POST
  path /api/contact/route
}
header @contact_maintenance Retry-After 300
respond @contact_maintenance "Contact form temporarily unavailable" 503
```

Caddy has no host port and no HSTS header; HSTS is enabled at Cloudflare only after public TLS and redirect verification.

- [ ] **Step 3: Add safe runtime examples**

Create `infra/runtime.example/env/app.env`:

```dotenv
APP_IMAGE=ghcr.io/martinlindblad/mlp@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
APP_CADDY_IMAGE=ghcr.io/martinlindblad/mlp-caddy@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
BACKUP_IMAGE=ghcr.io/martinlindblad/mlp-backup@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
PGHOST=postgres
PGPORT=5432
PGDATABASE=portfolio
PGUSER=portfolio_app
PGPOOL_MAX=5
PGCONNECT_TIMEOUT_MS=5000
CONTACT_MODE=contact-enabled
```

Create `infra/runtime.example/env/migrator.env`:

```dotenv
PGHOST=postgres
PGPORT=5432
PGDATABASE=portfolio
PGUSER=portfolio_migrator
PGPOOL_MAX=2
PGCONNECT_TIMEOUT_MS=5000
```

Create `infra/runtime.example/env/backup.env`:

```dotenv
PGHOST=postgres
PGPORT=5432
PGDATABASE=portfolio
PGUSER=portfolio_backup
RESTIC_REPOSITORY=s3:s3.eu-north-1.amazonaws.com/mlp-encrypted-backup
```

Create each example secret file with a safe dummy value ending in a newline: `postgres-app-password`, `postgres-migrator-password`, `postgres-backup-password`, `cloudflare-tunnel-token`, and `restic-password`. Document that `/etc/mlp` is root:root `0700`, files are `0600`, values are generated independently, and example values must never be used outside config validation.

- [ ] **Step 4: Add the seven-service Compose file**

Create `compose.production.yml` with `name: mlp-prod`, the four named networks, `postgres-data`, and top-level environment-sourced secrets:

```yaml
name: mlp-prod

x-logging: &bounded-logging
  driver: json-file
  options: { max-size: "10m", max-file: "5" }
x-harden: &harden
  cap_drop: [ALL]
  security_opt: [no-new-privileges:true]

services:
  postgres:
    image: postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15
    restart: unless-stopped
    environment:
      POSTGRES_DB: portfolio
      POSTGRES_USER: portfolio_migrator
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres-migrator-password
      POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256
    secrets: [postgres-migrator-password, postgres-app-password, postgres-backup-password]
    volumes:
      - postgres-data:/var/lib/postgresql
      - ./infra/postgres/init-roles.sh:/docker-entrypoint-initdb.d/10-init-roles.sh:ro
    networks: [database]
    healthcheck:
      test: [CMD-SHELL, "PGPASSWORD=$$(cat /run/secrets/postgres-migrator-password) psql -U portfolio_migrator -d portfolio -c 'select 1' >/dev/null"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s
    logging: *bounded-logging

  migrator:
    image: ${APP_IMAGE:?APP_IMAGE must be a digest}
    restart: "no"
    command: [node, /app/dist/scripts/db/migrate.js]
    environment:
      PGHOST: postgres
      PGPORT: "5432"
      PGDATABASE: portfolio
      PGUSER: portfolio_migrator
      PGPASSWORD_FILE: /run/secrets/postgres-migrator-password
      PGPOOL_MAX: "2"
      PGCONNECT_TIMEOUT_MS: "5000"
    secrets:
      - source: postgres-migrator-password
        target: postgres-migrator-password
        uid: "1000"
        gid: "1000"
        mode: 0400
    networks: [database]
    depends_on: { postgres: { condition: service_healthy } }
    logging: *bounded-logging
    <<: *harden

  app:
    image: ${APP_IMAGE:?APP_IMAGE must be a digest}
    restart: unless-stopped
    environment:
      PGHOST: postgres
      PGPORT: "5432"
      PGDATABASE: portfolio
      PGUSER: portfolio_app
      PGPASSWORD_FILE: /run/secrets/postgres-app-password
      PGPOOL_MAX: "5"
      PGCONNECT_TIMEOUT_MS: "5000"
    secrets:
      - source: postgres-app-password
        target: postgres-app-password
        uid: "1000"
        gid: "1000"
        mode: 0400
    networks:
      web: {}
      database: {}
      egress: { gw_priority: 1 }
    depends_on:
      postgres: { condition: service_healthy }
      migrator: { condition: service_completed_successfully }
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/api/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 4
      start_period: 20s
    logging: *bounded-logging
    <<: *harden

  caddy:
    image: ${APP_CADDY_IMAGE:?APP_CADDY_IMAGE must be a digest}
    restart: unless-stopped
    environment: { CONTACT_MODE: ${CONTACT_MODE:-contact-enabled} }
    volumes: [./infra/caddy:/etc/caddy:ro]
    networks: [tunnel, web]
    depends_on: { app: { condition: service_healthy } }
    healthcheck:
      test: [CMD, wget, -q, --header=Host:martin-lindblad.com, --header=CF-Connecting-IP:127.0.0.1, --spider, http://127.0.0.1:8080/api/health/live]
      interval: 15s
      timeout: 5s
      retries: 4
    logging: *bounded-logging
    <<: *harden

  cloudflared-a: &cloudflared
    image: cloudflare/cloudflared:2026.7.1@sha256:188bb03589a32affed3cf4d0590565ffe67b78866e6b5582574afab2b705bafe
    restart: unless-stopped
    command: [tunnel, --metrics, 0.0.0.0:2000, run, --token-file, /run/secrets/cloudflare-tunnel-token]
    secrets:
      - source: cloudflare-tunnel-token
        target: cloudflare-tunnel-token
        uid: "65532"
        gid: "65532"
        mode: 0400
    networks:
      tunnel: {}
      egress: { gw_priority: 1 }
    ulimits: { nofile: { soft: 70000, hard: 70000 } }
    healthcheck:
      test: [CMD, cloudflared, tunnel, --metrics, 127.0.0.1:2000, ready]
      interval: 15s
      timeout: 5s
      retries: 4
      start_period: 20s
    depends_on: { caddy: { condition: service_healthy } }
    logging: *bounded-logging
    <<: *harden

  cloudflared-b:
    <<: *cloudflared

  db-backup:
    image: ${BACKUP_IMAGE:?BACKUP_IMAGE must be a digest}
    profiles: [jobs]
    restart: "no"
    environment:
      PGHOST: postgres
      PGPORT: "5432"
      PGDATABASE: portfolio
      PGUSER: portfolio_backup
      PGPASSWORD_FILE: /run/secrets/postgres-backup-password
      RESTIC_PASSWORD_FILE: /run/secrets/restic-password
      RESTIC_REPOSITORY: ${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}
    secrets: [postgres-backup-password, restic-password]
    networks:
      database: {}
      egress: { gw_priority: 1 }
    depends_on: { postgres: { condition: service_healthy } }
    logging: *bounded-logging
    <<: *harden

networks:
  tunnel: { internal: true }
  web: { internal: true }
  database: { internal: true }
  egress: {}
volumes:
  postgres-data: {}
secrets:
  postgres-app-password: { environment: MLP_POSTGRES_APP_PASSWORD }
  postgres-migrator-password: { environment: MLP_POSTGRES_MIGRATOR_PASSWORD }
  postgres-backup-password: { environment: MLP_POSTGRES_BACKUP_PASSWORD }
  cloudflare-tunnel-token: { environment: MLP_CLOUDFLARE_TUNNEL_TOKEN }
  restic-password: { environment: MLP_RESTIC_PASSWORD }
```

After rendering, verify whether the pinned PostgreSQL image accepts `cap_drop: ALL`; if it does, add `<<: *harden` to `postgres`. If it requires a capability during initialization, leave PostgreSQL unprivileged/non-privileged without the anchor and record the exact Docker error in `tests/infra/compose.test.mjs` as the only allowed capability exception.

- [ ] **Step 5: Implement the root-only Compose wrapper**

Create executable `ops/compose.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ ${EUID:-$(id -u)} -eq 0 ]] || { printf 'mlp-compose requires root\n' >&2; exit 77; }

repo="${MLP_REPO_ROOT:-/opt/mlp}"
config="${MLP_CONFIG_ROOT:-/etc/mlp}"
for name in postgres-app-password postgres-migrator-password postgres-backup-password cloudflare-tunnel-token restic-password; do
  [[ -r "$config/secrets/$name" ]] || { printf 'missing secret: %s\n' "$name" >&2; exit 78; }
done

export MLP_POSTGRES_APP_PASSWORD="$(tr -d '\n' <"$config/secrets/postgres-app-password")"
export MLP_POSTGRES_MIGRATOR_PASSWORD="$(tr -d '\n' <"$config/secrets/postgres-migrator-password")"
export MLP_POSTGRES_BACKUP_PASSWORD="$(tr -d '\n' <"$config/secrets/postgres-backup-password")"
export MLP_CLOUDFLARE_TUNNEL_TOKEN="$(tr -d '\n' <"$config/secrets/cloudflare-tunnel-token")"
export MLP_RESTIC_PASSWORD="$(tr -d '\n' <"$config/secrets/restic-password")"

exec docker compose --project-directory "$repo" \
  --env-file "$config/env/app.env" --env-file "$config/env/backup.env" \
  --file "$repo/compose.production.yml" "$@"
```

The secret values exist only in the short-lived wrapper/Compose client environment. They are mounted as Compose secrets and are not service environment variables or committed values.

- [ ] **Step 6: Add static production-config validation and Cloudflare route documentation**

`scripts/verify-production-config.mjs` must run the wrapper's equivalent `docker compose config --format json`, reject any service `ports`, mutable image, unknown service/network, extra external network, missing healthcheck, privileged flag, host network/PID/IPC, Docker socket mount, writable Caddy config mount, or secret in service `environment`. It exits with exactly `production config valid` on success.

`infra/cloudflare/README.md` records remote-managed tunnel rules in this order: apex, `www`, and temporary migration hostname all route to `http://caddy:8080`; final catch-all returns HTTP 404; Cloudflare Access applies only to the migration hostname and the operator identity; both connectors use the same tunnel token.

- [ ] **Step 7: Validate configuration and behavior**

Run:

```bash
sudo env MLP_REPO_ROOT="$PWD" MLP_CONFIG_ROOT="$PWD/infra/runtime.example" ./ops/compose.sh config --quiet
MLP_REPO_ROOT="$PWD" MLP_CONFIG_ROOT="$PWD/infra/runtime.example" node scripts/verify-production-config.mjs
docker build --build-arg COMMIT_SHA="$(git rev-parse HEAD)" --tag mlp-caddy:validate --file infra/caddy/Dockerfile .
docker run --rm -e CONTACT_MODE=contact-enabled -v "$PWD/infra/caddy:/etc/caddy:ro" mlp-caddy:validate caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
node --test tests/infra/compose.test.mjs tests/infra/caddy.test.mjs
shellcheck ops/compose.sh infra/postgres/init-roles.sh
```

Expected: Compose/config/Caddy/ShellCheck/tests all exit 0; output contains `production config valid`; no host port appears in rendered JSON.

- [ ] **Step 8: Commit**

```bash
git add compose.production.yml infra/caddy infra/cloudflare infra/runtime.example ops/compose.sh scripts/verify-production-config.mjs tests/infra
git commit -m "feat: define private compose cloudflare ingress"
```

### Task 10: Add Backup, Restore, Deployment, Maintenance, and Rollback Operations

**Files:**
- Create: `ops/backup.sh`
- Create: `ops/restore-test.sh`
- Create: `ops/deploy.sh`
- Create: `ops/contact-mode.sh`
- Create: `infra/systemd/mlp-db-backup.service`
- Create: `infra/systemd/mlp-db-backup.timer`
- Create: `infra/systemd/mlp-db-restore-test.service`
- Create: `infra/systemd/mlp-db-restore-test.timer`
- Create: `tests/infra/backup.test.mjs`
- Create: `tests/infra/deploy.test.mjs`
- Create: `tests/infra/systemd.test.mjs`

**Interfaces:**
- Consumes: `/usr/local/sbin/mlp-compose`, immutable app/backup references, backward-compatible migrations, and `/etc/mlp` runtime files.
- Produces: `mlp-backup`, `mlp-restore-test`, `mlp-deploy`, `mlp-contact-mode`, nightly backup timer, monthly restore timer, and app-image rollback that never rolls schema backward.

- [ ] **Step 1: Write failing shell-contract tests**

Create Node tests that put fake `docker`, `git`, `flock`, `systemctl`, and `mlp-backup` executables first in a temporary `PATH`. Cover:

- deploy rejects non-root, mutable image refs, non-40-character commits, dirty/untracked checkout, mismatched HEAD, backup failure, pull failure, OCI revision mismatch, migration failure, and unhealthy replacement;
- failed readiness recreates the prior app image but never down-migrates PostgreSQL;
- success atomically persists the new `APP_IMAGE`, reconciles Caddy/connectors, and reports the digest;
- backup wrapper uses `--profile jobs run --rm db-backup` under `flock`;
- maintenance mode accepts only `enabled` and `maintenance`, atomically changes `CONTACT_MODE`, recreates only Caddy, and waits for health;
- systemd timers are UTC, nightly at 02:17, monthly restore at 03:17 on day 1, persistent, root-owned targets, and never embed secrets.

Run: `node --test tests/infra/backup.test.mjs tests/infra/deploy.test.mjs tests/infra/systemd.test.mjs`

Expected: FAIL because the scripts and unit files are absent.

- [ ] **Step 2: Implement serialized backup and monthly isolated restore**

Create executable `ops/backup.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || exit 77
exec 9>/run/lock/mlp-backup.lock
flock -n 9 || { printf 'backup already running\n' >&2; exit 75; }
exec /usr/local/sbin/mlp-compose --profile jobs run --rm db-backup
```

Create executable `ops/restore-test.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || exit 77
exec 9>/run/lock/mlp-backup.lock
flock -n 9 || { printf 'backup or restore already running\n' >&2; exit 75; }

work="$(mktemp -d /var/lib/mlp/.restore-test.XXXXXX)"
suffix="$(date -u +%Y%m%dT%H%M%SZ)-$$"
container="mlp-restore-$suffix"
network="mlp-restore-$suffix"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

/usr/local/sbin/mlp-compose --profile jobs run --rm \
  --volume "$work:/restore" --entrypoint restic db-backup \
  restore latest --tag mlp-postgresql --target /restore
mapfile -d '' dumps < <(find "$work" -type f -name '*.dump' -print0)
[[ ${#dumps[@]} -eq 1 ]] || { printf 'expected exactly one restored dump\n' >&2; exit 1; }

docker network create --internal "$network" >/dev/null
docker run -d --name "$container" --network "$network" \
  -e POSTGRES_PASSWORD=restore-test-only -e POSTGRES_DB=portfolio_restore \
  postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15 >/dev/null
for attempt in $(seq 1 60); do
  docker exec "$container" pg_isready -U postgres -d portfolio_restore >/dev/null 2>&1 && break
  [[ $attempt -lt 60 ]] || { printf 'restore postgres unavailable\n' >&2; exit 1; }
  sleep 1
done
docker cp "${dumps[0]}" "$container:/tmp/portfolio.dump"
docker exec "$container" pg_restore --list /tmp/portfolio.dump >/dev/null
docker exec "$container" pg_restore --exit-on-error --no-owner --no-acl \
  --username postgres --dbname portfolio_restore /tmp/portfolio.dump

tables="$(docker exec "$container" psql -At -U postgres -d portfolio_restore -c "
select count(*) from information_schema.tables where table_schema='public'
and table_name in ('profile_sections','current_occupations','hobbies','languages','page_cards','professional_timeline','projects','pursuits','social_links','contact_messages');")"
migration="$(docker exec "$container" psql -At -U postgres -d portfolio_restore -c "select name from kysely_migration where name='002_runtime_grants';")"
profiles="$(docker exec "$container" psql -At -U postgres -d portfolio_restore -c 'select count(*) from profile_sections;')"
projects="$(docker exec "$container" psql -At -U postgres -d portfolio_restore -c 'select count(*) from projects;')"
[[ "$tables" == 10 && "$migration" == 002_runtime_grants && "$profiles" -ge 1 && "$projects" -ge 1 ]]

install -d -o root -g root -m 0700 /var/lib/mlp/restore-reports
jq -n --arg at "$(date -u +%FT%TZ)" --arg migration "$migration" \
  --argjson tables "$tables" --argjson profiles "$profiles" --argjson projects "$projects" \
  '{restoredAt:$at,status:"passed",migration:$migration,tables:$tables,profileSections:$profiles,projects:$projects}' \
  >"$work/report.json"
install -o root -g root -m 0600 "$work/report.json" /var/lib/mlp/restore-reports/latest.json
printf 'isolated restore passed\n'
```

The script verifies these conditions through the SQL in its body:

```sql
select count(*) = 10
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profile_sections','current_occupations','hobbies','languages','page_cards',
    'professional_timeline','projects','pursuits','social_links','contact_messages'
  );
select exists(select 1 from kysely_migration where name = '002_runtime_grants');
select count(*) >= 1 from profile_sections;
select count(*) >= 1 from projects;
```

The trap removes the container, internal network, and temporary directory on every exit. The report contains only timestamp, table counts, migration name, and pass/fail; it never writes row contents.

- [ ] **Step 3: Implement strict contact-mode switching**

Create executable `ops/contact-mode.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || exit 77
case "${1:-}" in
  enabled) value=contact-enabled ;;
  maintenance) value=contact-maintenance ;;
  *) printf 'usage: mlp-contact-mode enabled|maintenance\n' >&2; exit 64 ;;
esac

exec 9>/run/lock/mlp-deploy.lock
flock 9
env_file=/etc/mlp/env/app.env
tmp="$(mktemp /etc/mlp/env/.app.env.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
awk -v value="$value" 'BEGIN{done=0} /^CONTACT_MODE=/{print "CONTACT_MODE=" value; done=1; next} {print} END{if(!done) print "CONTACT_MODE=" value}' "$env_file" >"$tmp"
chmod 0600 "$tmp"
chown root:root "$tmp"
mv -f "$tmp" "$env_file"
/usr/local/sbin/mlp-compose up -d --no-deps --force-recreate caddy
for attempt in $(seq 1 30); do
  [[ "$(docker inspect mlp-prod-caddy-1 --format '{{.State.Health.Status}}' 2>/dev/null)" == healthy ]] && exit 0
  sleep 2
done
printf 'caddy did not become healthy\n' >&2
exit 1
```

- [ ] **Step 4: Implement digest-only deploy with application rollback**

Create executable `ops/deploy.sh` with these exact phases and exit gates:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || exit 77
exec 9>/run/lock/mlp-deploy.lock
flock -n 9 || { printf 'deployment already running\n' >&2; exit 75; }

image= commit=
while (($#)); do
  case "$1" in
    --image) image="${2:-}"; shift 2 ;;
    --commit) commit="${2:-}"; shift 2 ;;
    *) printf 'unknown deploy argument\n' >&2; exit 64 ;;
  esac
done
[[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || { printf 'immutable GHCR image required\n' >&2; exit 64; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { printf '40-character commit required\n' >&2; exit 64; }

cd /opt/mlp
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { printf 'checkout is dirty\n' >&2; exit 65; }
[[ "$(git rev-parse HEAD)" == "$commit" ]] || { printf 'checkout commit mismatch\n' >&2; exit 65; }
node scripts/verify-production-config.mjs
previous="$(sed -n 's/^APP_IMAGE=//p' /etc/mlp/env/app.env)"
[[ "$previous" =~ @sha256:[0-9a-f]{64}$ ]] || { printf 'previous image missing\n' >&2; exit 78; }

/usr/local/sbin/mlp-backup
APP_IMAGE="$image" /usr/local/sbin/mlp-compose pull app migrator
revision="$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$revision" == "$commit" ]] || { printf 'image revision mismatch\n' >&2; exit 65; }
/usr/local/sbin/mlp-compose up -d postgres
APP_IMAGE="$image" /usr/local/sbin/mlp-compose run --rm migrator
APP_IMAGE="$image" /usr/local/sbin/mlp-compose up -d --no-deps --force-recreate app

healthy=false
for attempt in $(seq 1 60); do
  if [[ "$(docker inspect mlp-prod-app-1 --format '{{.State.Health.Status}}' 2>/dev/null)" == healthy ]]; then healthy=true; break; fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  APP_IMAGE="$previous" /usr/local/sbin/mlp-compose up -d --no-deps --force-recreate app
  printf 'new app unhealthy; previous app image restored; schema retained\n' >&2
  exit 1
fi

tmp="$(mktemp /etc/mlp/env/.app.env.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
awk -v image="$image" 'BEGIN{done=0} /^APP_IMAGE=/{print "APP_IMAGE=" image; done=1; next} {print} END{if(!done) print "APP_IMAGE=" image}' /etc/mlp/env/app.env >"$tmp"
chmod 0600 "$tmp" && chown root:root "$tmp" && mv -f "$tmp" /etc/mlp/env/app.env
/usr/local/sbin/mlp-compose up -d --no-deps --force-recreate caddy cloudflared-a cloudflared-b
for service in app caddy cloudflared-a cloudflared-b; do
  [[ "$(docker inspect "mlp-prod-${service}-1" --format '{{.State.Health.Status}}')" == healthy ]] || exit 1
done
printf 'deployed %s at %s\n' "$image" "$commit"
```

The initial bootstrap uses a reviewed empty-database backup after PostgreSQL first becomes healthy; all later deployments require a real pre-deploy snapshot. Schema rollback is intentionally absent, so every migration must remain compatible with the previous app image.

- [ ] **Step 5: Add root-owned systemd schedules**

Create `infra/systemd/mlp-db-backup.service`:

```ini
[Unit]
Description=MLP PostgreSQL off-VM backup
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
User=root
Group=root
ExecStart=/usr/local/sbin/mlp-backup
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/run/lock
```

Create `infra/systemd/mlp-db-backup.timer`:

```ini
[Unit]
Description=Nightly MLP PostgreSQL backup at 02:17 UTC
[Timer]
OnCalendar=*-*-* 02:17:00 UTC
Persistent=true
RandomizedDelaySec=0
Unit=mlp-db-backup.service
[Install]
WantedBy=timers.target
```

Create `infra/systemd/mlp-db-restore-test.service`:

```ini
[Unit]
Description=MLP monthly isolated PostgreSQL restore test
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
User=root
Group=root
ExecStart=/usr/local/sbin/mlp-restore-test
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/run/lock /var/lib/mlp/restore-reports
```

Create `infra/systemd/mlp-db-restore-test.timer`:

```ini
[Unit]
Description=Monthly MLP PostgreSQL restore test
[Timer]
OnCalendar=*-*-01 03:17:00 UTC
Persistent=true
RandomizedDelaySec=0
Unit=mlp-db-restore-test.service
[Install]
WantedBy=timers.target
```

- [ ] **Step 6: Verify shell behavior and unit syntax**

Run:

```bash
shellcheck ops/backup.sh ops/restore-test.sh ops/deploy.sh ops/contact-mode.sh
node --test tests/infra/backup.test.mjs tests/infra/deploy.test.mjs tests/infra/systemd.test.mjs
systemd-analyze verify infra/systemd/*.service infra/systemd/*.timer
```

Expected: ShellCheck/tests/unit verification all exit 0; fake rollback trace shows the previous image recreated and no down migration.

- [ ] **Step 7: Commit**

```bash
git add ops infra/systemd tests/infra
git commit -m "feat: add backup restore and safe deployment operations"
```

### Task 11: Add CI, Manual GHCR Publishing, and Browser Acceptance Tests

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/fixtures/seed-postgres.ts`
- Create: `tests/integration/db/e2e-seed.test.ts`
- Create: `tests/e2e/public-routes.spec.ts`
- Create: `tests/e2e/service-worker.spec.ts`
- Create: `tests/e2e/assets.spec.ts`
- Create: `tests/infra/workflow-pins.test.mjs`
- Create: `tests/infra/image-gates.test.mjs`
- Create: `scripts/ci/verify-images.sh`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/publish-image.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: all local checks, PostgreSQL migrations, app/backup/migration Dockerfiles, and public API contracts.
- Produces: required CI evidence on push/PR, four manually published immutable GHCR digests with SBOM/provenance, and zero automatic production deployment.

The executed implementation strengthens the initial sketches below: browser tests use stable DOM markers and `domcontentloaded`, require an active service-worker controller, perform the contact POST inside the controlled browser page, run against the standalone production server, and exercise all four hardened images through a fail-closed Linux image harness. The fourth image is a minimal derived Caddy image that preserves the exact pinned upstream base while removing only `cap_net_bind_service=ep`, allowing production to retain UID/GID 65532, `cap_drop: ALL`, and `no-new-privileges`.

- [ ] **Step 1: Write browser and workflow-pin tests first**

Create `tests/e2e/public-routes.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

for (const path of ['/', '/about', '/experience', '/showcases', '/cases', '/contact']) {
  test(`${path} renders without browser or network errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);
    expect(errors).toEqual([]);
  });
}

test('legacy case ID remains routable', async ({ page }) => {
  const response = await page.goto('/cases/64b000000000000000000009', { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
});

test('read APIs retain status and array shape', async ({ request }) => {
  for (const path of ['/api/about','/api/introduction','/api/currentOccupation','/api/languages','/api/list','/api/pageCards','/api/professionalTimeline','/api/projectsAndCases','/api/pursuit','/api/socialmedia']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  }
});
```

Create `tests/e2e/service-worker.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('service worker activates and precaches its complete manifest', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const state = await page.evaluate(() => navigator.serviceWorker.controller?.state);
  expect(['activated', undefined]).toContain(state);
  const missing = await page.evaluate(async () => {
    const urls = await (await fetch('/sw-manifest.json')).json();
    const cache = await caches.open('mlp-shell-v2');
    const checks = await Promise.all(urls.map(async (url: string) => [url, Boolean(await cache.match(url))]));
    return checks.filter(([, present]) => !present);
  });
  expect(missing).toEqual([]);
});

test('contact POST is never served from service-worker cache', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const response = await page.request.post('/api/contact/route', { data: {} });
  expect(response.status()).toBe(400);
});
```

Create `tests/infra/workflow-pins.test.mjs` to parse both workflows and reject every `uses:` value that does not end in exactly 40 lowercase hex characters, every `pull_request_target`, every deployment/SSH command, and any publish trigger other than `workflow_dispatch`.

Run: `node --test tests/infra/workflow-pins.test.mjs && yarn playwright test --list`

Expected: workflow test fails because files are absent; Playwright lists route, case, API, service-worker, and contact tests.

- [ ] **Step 2: Add deterministic browser fixtures and Playwright configuration**

Create `tests/fixtures/seed-postgres.ts` that migrates the configured test database, truncates all ten tables, and inserts at least one valid row per content table. Use ID `64b000000000000000000009` for the project row, valid local `/images/...` paths, complete strict `project_details`, and no contact PII. The fixture exits after `db.destroy()`.

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: {
    command: 'yarn build && yarn start',
    url: 'http://127.0.0.1:3000/api/health/ready',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 3: Add push/PR CI with exact action commits**

Create `.github/workflows/ci.yml` with `permissions: { contents: read }`, cancellation by ref, a PostgreSQL service using the pinned 18.4 digest, and immutable action commits allowlisted by `tests/infra/workflow-pins.test.mjs`. The following block is the original interface sketch; the implemented workflow and allowlist are normative because action releases advanced during execution:

```yaml
name: CI
on: [push, pull_request]
permissions: { contents: read }
concurrency: { group: "ci-${{ github.ref }}", cancel-in-progress: true }
jobs:
  verify:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: postgres }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres -d postgres"
          --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      TEST_DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/postgres
      PGHOST: 127.0.0.1
      PGPORT: "5432"
      PGDATABASE: portfolio_ci
      PGUSER: postgres
      PGPASSWORD_FILE: /tmp/mlp-ci-postgres-password
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with: { node-version: 22.23.1, cache: yarn }
      - run: printf 'postgres\n' >/tmp/mlp-ci-postgres-password
      - run: yarn install --frozen-lockfile
      - run: |
          psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
          create role portfolio_app login password 'ci-app-only';
          create role portfolio_backup login password 'ci-backup-only';
          SQL
          PGPASSWORD=postgres createdb --host=127.0.0.1 --username=postgres portfolio_ci
      - run: yarn build:scripts && node dist/scripts/db/migrate.js && node dist/scripts/db/migrate.js
      - run: yarn lint
      - run: yarn typecheck
      - run: yarn test:unit
      - run: yarn test:integration
      - run: node --test tests/assets/*.test.mjs tests/infra/*.test.mjs
      - run: yarn build:production
      - run: docker build --build-arg COMMIT_SHA="$GITHUB_SHA" --tag mlp:ci .
      - run: docker build --file infra/backup/Dockerfile --tag mlp-backup:ci .
      - run: npx playwright install --with-deps chromium
      - run: yarn tsx tests/fixtures/seed-postgres.ts
      - run: yarn test:e2e
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        if: failure()
        with: { name: playwright-report, path: playwright-report, retention-days: 7 }
```

Add Caddy validate, Compose render, service-worker tests, and the Docker runtime inspections from Tasks 7-10 as explicit steps before Playwright. The Node infrastructure tests validate workflow pins and shell command contracts without downloading floating CI helper tools.

- [ ] **Step 4: Add a manual four-image publication workflow**

Create `.github/workflows/publish-image.yml` with only `workflow_dispatch`, no production credentials, no SSH, and least-privilege per-job permissions. Use the reviewed immutable action pins recorded by `tests/infra/workflow-pins.test.mjs`; install Trivy and GitHub CLI directly from checksum-verified release artifacts.

Build, runtime-test, vulnerability/secret-scan, save, and only then push:

```text
ghcr.io/${{ github.repository_owner }}/mlp:${{ github.sha }}
ghcr.io/${{ github.repository_owner }}/mlp-backup:${{ github.sha }}
ghcr.io/${{ github.repository_owner }}/mlp-caddy:${{ github.sha }}
ghcr.io/${{ github.repository_owner }}/mlp-migration:${{ github.sha }}
```

Pass `COMMIT_SHA=${{ github.sha }}` to all four builds. Preserve the exact scanned image tarballs between jobs, derive each immutable digest from that image's successful `docker push` result rather than a mutable tag lookup, and sign plus attest every digest. Generate SPDX 2.3 JSON SBOMs and upload a `production-images-${{ github.sha }}` artifact containing exactly:

```text
app-image-ref.txt
app-image-digest.txt
backup-image-ref.txt
backup-image-digest.txt
caddy-image-ref.txt
caddy-image-digest.txt
migration-image-ref.txt
migration-image-digest.txt
git-commit.txt
app.spdx.json
backup.spdx.json
caddy.spdx.json
migration.spdx.json
```

The workflow ends after artifact upload and prints the digest-qualified references; it contains no deploy job.

- [ ] **Step 5: Add dependency-review configuration**

Create `.github/dependabot.yml` with weekly Monday updates for `npm`, `github-actions`, and `docker`, all targeting `main`, each limited to five open pull requests. Digest updates are reviewed through pull requests and must pass the full CI workflow.

After the first manual publication, set all four GHCR packages to public read visibility and verify unauthenticated digest pulls, Cosign signatures, provenance, and SBOM attestations from an empty Docker client configuration. This portfolio deployment therefore stores no long-lived GHCR credential on the VM. If repository policy forbids public packages, stop and amend the approved runtime-secret inventory before putting a package read token on the VM.

- [ ] **Step 6: Verify workflows, build, and browser behavior**

Run:

```bash
node --test tests/infra/workflow-pins.test.mjs
node --test tests/infra/image-gates.test.mjs
actionlint .github/workflows/*.yml
rg -n 'uses: [^#[:space:]]+@(main|master|v[0-9]+|latest)' .github/workflows
yarn test:e2e
```

Expected: pin test and actionlint pass; `rg` produces no output; all Playwright tests pass against the seeded PostgreSQL app.

- [ ] **Step 7: Commit**

```bash
git add .github playwright.config.ts scripts/ci tests/e2e tests/fixtures tests/integration/db/e2e-seed.test.ts tests/infra/workflow-pins.test.mjs tests/infra/image-gates.test.mjs
git commit -m "ci: verify and publish self hosted portfolio images"
```

### Task 12: Provision and Harden the Debian 13 Proxmox VM

**Files:**
- Create: `infra/proxmox/provision-vm.sh`
- Create: `infra/proxmox/bootstrap-vm.sh`
- Create: `infra/proxmox/nftables.conf.template`
- Create: `infra/proxmox/README.md`
- Create: `tests/infra/proxmox.test.mjs`

**Interfaces:**
- Consumes: Proxmox administrative shell, existing private bridge/storage, approved SSH public key, protected management CIDR, and reviewed Docker package versions.
- Produces: one `mlp-prod` Debian 13 VM at 4 vCPU/4096 MiB/40 GiB with guest agent, fixed memory, private management, Docker Compose >=2.33.1, root-only operations, and no project ingress ports.

- [ ] **Step 1: Write a failing command-contract test**

Create `tests/infra/proxmox.test.mjs` to run both scripts with fake `qm`, `pvesm`, `curl`, `sha512sum`, `apt-get`, `systemctl`, `nft`, `ss`, and `docker`. Assert: VM values are exact; ballooning is zero; disk is 40 GiB/SCSI/discard; bridge and private address are inputs; QEMU agent/onboot/startup delay are set; Debian image checksum is verified; bootstrap refuses non-Debian-13; Docker has no TCP listener; Compose floor is enforced; normal user is not placed in `docker`; `/etc/mlp` modes are correct; firewall validation occurs before activation.

Run: `node --test tests/infra/proxmox.test.mjs`

Expected: FAIL because the provisioning files are absent.

- [ ] **Step 2: Implement idempotent Proxmox VM creation**

Create executable `infra/proxmox/provision-vm.sh`. It requires these environment values and refuses to guess them:

```bash
: "${VM_ID:?VM_ID is required}"
: "${PROXMOX_STORAGE:?PROXMOX_STORAGE is required}"
: "${PROXMOX_BRIDGE:?PROXMOX_BRIDGE is required}"
: "${SSH_PUBLIC_KEY_FILE:?SSH_PUBLIC_KEY_FILE is required}"
: "${VM_IP_CONFIG:?VM_IP_CONFIG is required; use ip=dhcp or ip=CIDR,gw=ADDRESS}"
```

Use `pvesm status --storage`, `ip link show`, and `qm status` as preflight gates. Download the current Debian 13 genericcloud amd64 image plus `SHA512SUMS` and its signed checksum metadata from `https://cloud.debian.org/images/cloud/trixie/latest/`; verify the image against the exact matching SHA-512 line before import. The creation commands are:

```bash
qm create "$VM_ID" --name mlp-prod --ostype l26 --machine q35 \
  --cpu host --cores 4 --sockets 1 --memory 4096 --balloon 0 \
  --agent enabled=1,fstrim_cloned_disks=1 --onboot 1 --startup order=30,up=60 \
  --scsihw virtio-scsi-single --serial0 socket --vga serial0
qm importdisk "$VM_ID" "$verified_image" "$PROXMOX_STORAGE"
unused_volume="$(qm config "$VM_ID" | sed -n 's/^unused[0-9][0-9]*: //p' | tail -n 1)"
[[ -n "$unused_volume" ]] || { printf 'imported disk not found\n' >&2; exit 1; }
qm set "$VM_ID" --scsi0 "$unused_volume,discard=on,iothread=1,ssd=1"
qm resize "$VM_ID" scsi0 40G
qm set "$VM_ID" --ide2 "$PROXMOX_STORAGE:cloudinit" --boot order=scsi0
qm set "$VM_ID" --net0 "virtio,bridge=$PROXMOX_BRIDGE,firewall=1"
qm set "$VM_ID" --ipconfig0 "$VM_IP_CONFIG" --ciuser mlp-admin --sshkeys "$SSH_PUBLIC_KEY_FILE"
qm set "$VM_ID" --ciupgrade 1
qm start "$VM_ID"
```

The commands derive the actual unused-volume name after import and never assume a storage-specific disk name. On any failure before first boot, stop and print the VM ID; do not automatically destroy an existing VM.

- [ ] **Step 3: Implement Debian bootstrap and root-owned layout**

Create executable `infra/proxmox/bootstrap-vm.sh`. Require root, `MANAGEMENT_CIDR`, `DNS_RESOLVERS`, `DOCKER_CE_VERSION`, and `DOCKER_COMPOSE_VERSION`; reject Compose versions below 2.33.1. Verify:

```bash
. /etc/os-release
[[ "$ID" == debian && "$VERSION_ID" == 13 ]] || { printf 'Debian 13 required\n' >&2; exit 65; }
```

Install `qemu-guest-agent`, `ca-certificates`, `curl`, `gnupg`, `unattended-upgrades`, `nftables`, `git`, and `jq`. Add Docker's official Debian repository using its signed key, install the exact reviewed package versions supplied in the two inputs, and hold `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, and `docker-compose-plugin` until a reviewed upgrade.

Create:

```bash
install -d -o root -g root -m 0755 /opt/mlp /var/lib/mlp /var/lib/mlp/restore-reports
install -d -o root -g root -m 0700 /etc/mlp /etc/mlp/env /etc/mlp/secrets
install -o root -g root -m 0755 ops/compose.sh /usr/local/sbin/mlp-compose
install -o root -g root -m 0755 ops/backup.sh /usr/local/sbin/mlp-backup
install -o root -g root -m 0755 ops/restore-test.sh /usr/local/sbin/mlp-restore-test
install -o root -g root -m 0755 ops/deploy.sh /usr/local/sbin/mlp-deploy
install -o root -g root -m 0755 ops/contact-mode.sh /usr/local/sbin/mlp-contact-mode
```

Do not add `mlp-admin` to the Docker group. Enable guest agent, Docker, nftables, unattended security upgrades, and the two timers only after runtime files are installed. Docker's systemd unit must use only its Unix socket; fail if `systemctl cat docker` or `/etc/docker/daemon.json` contains `tcp://`.

- [ ] **Step 4: Add a management-only nftables policy with safe activation**

Create `infra/proxmox/nftables.conf.template` with loopback/established acceptance, SSH acceptance only from the validated `MANAGEMENT_CIDR`, ICMP/ICMPv6 needed for network operation, default input drop, and forward policy compatible with Docker-managed chains. Host output permits established traffic, DHCP when configured, DNS to the explicitly rendered `DNS_RESOLVERS`, NTP, HTTPS, and Cloudflare Tunnel TCP/UDP 7844; all other new host output is rejected. It must not contain application, PostgreSQL, Caddy, Docker API, or Cloudflare inbound accepts. Container ingress/egress remains constrained by the four Compose networks and the absence of published ports.

The bootstrap renders `/etc/nftables.conf.new`, runs `nft --check --file`, and prints the exact diff. The operator opens a second protected SSH session and runs:

```bash
sudo nft --file /etc/nftables.conf.new
sudo install -o root -g root -m 0644 /etc/nftables.conf.new /etc/nftables.conf
sudo systemctl enable --now nftables
```

If the second session cannot connect from the approved management path, restore the previous rules from the still-open first session. Do not activate the firewall from an unattended remote command.

- [ ] **Step 5: Verify the guest before application deployment**

On the Proxmox host:

```bash
qm config "$VM_ID"
qm guest cmd "$VM_ID" ping
qm guest cmd "$VM_ID" get-osinfo
```

On the VM:

```bash
test "$(stat -c '%U:%G %a' /etc/mlp)" = 'root:root 700'
docker version
docker compose version --short
systemctl is-active qemu-guest-agent docker nftables
systemctl is-enabled unattended-upgrades.service
ss -ltnup
sudo -u mlp-admin docker ps
```

Expected: Proxmox shows 4 cores, 4096 MiB, balloon 0, 40 GiB scsi0/discard, VirtIO net, onboot/agent/startup; guest reports Debian 13; Compose >=2.33.1; only the protected SSH socket is listening; `mlp-admin docker ps` fails with permission denied.

Take one Proxmox-level VM backup to the existing approved backup storage and verify its task log. Record it as additional disaster-recovery evidence only; it never replaces the off-VM PostgreSQL logical backup or restore gate.

- [ ] **Step 6: Verify scripts and commit**

```bash
shellcheck infra/proxmox/*.sh
node --test tests/infra/proxmox.test.mjs
git add infra/proxmox tests/infra/proxmox.test.mjs
git commit -m "ops: provision hardened portfolio vm"
```

### Task 13: Transfer DNS Authority and Configure the Cloudflare Tunnel Safely

**Files:**
- Create: `scripts/acceptance/dns-authority.sh`
- Create: `scripts/acceptance/tunnel-health.sh`
- Create: `tests/infra/cloudflare-gates.test.mjs`
- Create: `runbooks/cloudflare-dns-and-tunnel.md`

**Interfaces:**
- Consumes: Cloudflare account/zone administration, registrar access, Vercel DNS inventory, protected migration identity, running healthy VM stack, and root-only tunnel token.
- Produces: Cloudflare-authoritative complete zone, verified 48-hour authority evidence, remote-managed `mlp-prod` tunnel with two connectors, Access-protected migration hostname, and apex/`www` records ready for gated cutover.

- [ ] **Step 1: Write failing DNS/tunnel gate tests**

Create tests for `dns-authority.sh` using fake `dig`/clock output. It must fail unless: expected Cloudflare nameservers match at `1.1.1.1`, `8.8.8.8`, and `9.9.9.9`; SOA is Cloudflare; the first all-resolver-success timestamp is at least 172800 seconds old; the cloned apex/`www` records still resolve to the Vercel origin during the hold; and inventory comparison reports no missing mail/verification records.

Create tunnel tests that require exactly two healthy connectors, migration host Access redirect for an unauthenticated request, authenticated migration host 200, no public origin port, and a final catch-all 404 route.

Run: `node --test tests/infra/cloudflare-gates.test.mjs`

Expected: FAIL because gate scripts/runbook do not exist.

- [ ] **Step 2: Inventory and clone Vercel DNS without changing application routing**

In `runbooks/cloudflare-dns-and-tunnel.md`, require an export from Vercel plus independent authoritative `dig` capture for every record type. Store redacted machine-readable inventories below ignored `migration-artifacts/dns/`; record names, types, TTLs, priorities, and targets but redact secret verification payloads from any committed report. Create the Cloudflare zone and reproduce every apex, subdomain, MX, TXT, CAA, and verification record.

Keep apex and `www` pointed at their current Vercel target and DNS-only while delegating authority. Set their TTL to exactly 300 seconds at least 24 hours before application cutover. Compare normalized Vercel and Cloudflare record sets; any missing non-NS record blocks the registrar change.

- [ ] **Step 3: Change nameservers and enforce the 48-hour authority gate**

Store the two Cloudflare nameservers in root-only `/etc/mlp/cloudflare-nameservers`, one per line. Change only the registrar delegation. Create `scripts/acceptance/dns-authority.sh` to query all three public resolvers, the zone's SOA, and the current app origin; on the first complete success atomically write epoch seconds to `/var/lib/mlp/cloudflare-authority-start`. Subsequent runs print elapsed seconds and exit 75 until `elapsed >= 172800`.

Run every few hours during the hold:

```bash
sudo EXPECTED_NS_FILE=/etc/mlp/cloudflare-nameservers \
  STATE_FILE=/var/lib/mlp/cloudflare-authority-start \
  scripts/acceptance/dns-authority.sh martin-lindblad.com
curl -fsS https://martin-lindblad.com >/dev/null
```

Expected before 48 hours: DNS checks pass, Vercel serves the app, script exits 75 and prints remaining seconds. Expected after 48 hours: exit 0 and `authority stable for at least 172800 seconds`.

- [ ] **Step 4: Create the remotely managed tunnel and Access-protected migration route**

Create one remote-managed tunnel named exactly `mlp-prod`. Configure ingress in this order:

```yaml
ingress:
  - hostname: migration.martin-lindblad.com
    service: http://caddy:8080
  - hostname: martin-lindblad.com
    service: http://caddy:8080
  - hostname: www.martin-lindblad.com
    service: http://caddy:8080
  - service: http_status:404
```

Protect only `migration.martin-lindblad.com` with a Cloudflare Access self-hosted application and an allow policy for the operator identity. Write the tunnel token directly to `/etc/mlp/secrets/cloudflare-tunnel-token` with root:root `0600`; never paste it into shell history, Git, issue trackers, or logs. Start Caddy and both connectors, then wait until the Cloudflare dashboard/API and both container healthchecks show two distinct connected replicas.

- [ ] **Step 5: Verify the migration hostname and connector failover**

Create `scripts/acceptance/tunnel-health.sh` to assert both local container health states and public migration responses. Perform failover serially:

```bash
sudo /usr/local/sbin/mlp-compose stop cloudflared-a
curl -fsS -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" https://migration.martin-lindblad.com/api/health/ready
sudo /usr/local/sbin/mlp-compose start cloudflared-a
sudo scripts/acceptance/tunnel-health.sh
sudo /usr/local/sbin/mlp-compose stop cloudflared-b
curl -fsS -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" https://migration.martin-lindblad.com/api/health/ready
sudo /usr/local/sbin/mlp-compose start cloudflared-b
sudo scripts/acceptance/tunnel-health.sh
```

Expected: public readiness remains 200 in each single-connector stop; the stopped connector is restored to healthy before the other is stopped.

- [ ] **Step 6: Commit only scripts and redacted runbook evidence**

```bash
node --test tests/infra/cloudflare-gates.test.mjs
shellcheck scripts/acceptance/dns-authority.sh scripts/acceptance/tunnel-health.sh
git add scripts/acceptance tests/infra/cloudflare-gates.test.mjs runbooks/cloudflare-dns-and-tunnel.md
git commit -m "ops: add cloudflare authority and tunnel gates"
```

### Task 14: Rehearse, Cut Over Within 30 Minutes, and Collect Acceptance Evidence

**Files:**
- Create: `scripts/acceptance/production-smoke.sh`
- Create: `scripts/acceptance/log-redaction.sh`
- Create: `tests/infra/cutover-gates.test.mjs`
- Create: `runbooks/rehearsal-and-cutover.md`

**Interfaces:**
- Consumes: Atlas temporary read-only user, encrypted archive recipient, production PostgreSQL, migration CLIs, Cloudflare authority/tunnel gates, Vercel traffic visibility, contact maintenance mode, and tested Restic repository.
- Produces: a complete rehearsal report, verified content preload, final contact delta, a clearly recorded PostgreSQL-write commit point, public smoke/restore reports, and either successful cutover or safe pre-write DNS rollback.

- [ ] **Step 1: Write failing cutover-gate tests**

Create `tests/infra/cutover-gates.test.mjs` to parse the runbook and fake the smoke scripts. It must reject a cutover sequence unless it contains, in order: encrypted source archive; source inventory; strict full rehearsal; off-VM backup and restore; 48-hour DNS authority proof; 24-hour TTL-300 proof; migration-host checks; content preload/hash match; maintenance enable; apex/`www` tunnel switch; 300-second wait; Vercel traffic stop confirmation; final contact transaction/hash match; internal synthetic insert/delete; contact enable; public synthetic insert/delete as commit point; HSTS enable; 24-hour observation. It must also require a rollback branch before, and forbid Mongo rollback after, the commit point.

Run: `node --test tests/infra/cutover-gates.test.mjs`

Expected: FAIL because the runbook and smoke scripts are absent.

- [ ] **Step 2: Perform and document a complete disposable rehearsal**

Create `runbooks/rehearsal-and-cutover.md` with a timestamped operator checklist. The rehearsal requires a temporary Atlas user with read-only access to only the portfolio database, a root-readable `MONGO_URI_FILE`, and no source writes. On the trusted migration operator environment, install MongoDB Database Tools exactly 100.17.0 and `age`, verify `mongodump --version` reports 100.17.0, and keep both tools outside the production app image. Run:

```bash
umask 077
export MONGO_URI_FILE=/etc/mlp/secrets/mongo-readonly-uri
export MONGO_DATABASE=mlp_db
export ARTIFACT_DIR=/var/lib/mlp/migration-artifacts/source
export ARCHIVE_RECIPIENT="$(cat /etc/mlp/age-archive-recipient)"
scripts/migration/export-mongo.sh
yarn migration:rehearsal
```

The target is a newly created empty `portfolio_rehearsal` PostgreSQL database. Apply all Kysely migrations twice, import all ten collections in one transaction, compare source-key inventory to allowed keys, compare counts/sorted IDs/timestamps/canonical hashes, run repository integration tests, and run Playwright against the rehearsal database. Copy encrypted archive plus redacted reports to the off-VM repository, verify their hashes there, and only then drop `portfolio_rehearsal`.

Any uncovered field, invalid nested object, duplicate ID, missing Linux asset, count/ID/timestamp/hash mismatch, or PII in a report blocks cutover and requires an explicit schema/mapping/test change followed by a new complete rehearsal.

- [ ] **Step 3: Preload and verify immutable content while Vercel remains production**

After Tasks 12-13 pass, put the reviewed digest-qualified `APP_IMAGE` and `APP_CADDY_IMAGE` into `/etc/mlp/env/app.env` and `BACKUP_IMAGE` into `/etc/mlp/env/backup.env`. For the one-time empty-volume bootstrap, start PostgreSQL, run a fresh migrator, start app/Caddy/connectors, require every healthcheck, and take the first logical backup:

```bash
sudo /usr/local/sbin/mlp-compose up -d postgres
sudo /usr/local/sbin/mlp-compose run --rm migrator
sudo /usr/local/sbin/mlp-compose up -d app caddy cloudflared-a cloudflared-b
sudo /usr/local/sbin/mlp-compose ps
sudo /usr/local/sbin/mlp-backup
```

All later application releases use `mlp-deploy`. Leave apex/`www` pointed at Vercel and keep only the Access-protected migration hostname on the tunnel. Run:

```bash
sudo /usr/local/sbin/mlp-backup
sudo -E yarn migration:preload
sudo scripts/acceptance/tunnel-health.sh
```

`migration:preload` imports exactly the nine read-only collections and emits source/destination counts, sorted IDs, and hashes. Browse every public page/API and every legacy case ID through `migration.martin-lindblad.com`. Before public cutover, stop PostgreSQL once, require migration-host readiness 503 without leaked error detail, restart it, and require automatic recovery to 200. Confirm static images/video range requests/manifest/service-worker, two-connector failover, and no host port exposure.

- [ ] **Step 4: Implement the public smoke and log-redaction scripts**

Create executable `scripts/acceptance/production-smoke.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
origin="${1:-https://martin-lindblad.com}"
case "$origin" in https://martin-lindblad.com|https://migration.martin-lindblad.com) ;; *) exit 64 ;; esac

for path in / /about /experience /showcases /cases /contact /api/health/live /api/health/ready; do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "$origin$path")"
  [[ "$code" == 200 ]] || { printf '%s returned %s\n' "$path" "$code" >&2; exit 1; }
done
for path in about introduction currentOccupation languages list pageCards professionalTimeline projectsAndCases pursuit socialmedia; do
  body="$(curl -fsS "$origin/api/$path")"
  jq -e 'type == "array"' <<<"$body" >/dev/null
done
redirect="$(curl -sS -o /dev/null -D - 'https://www.martin-lindblad.com/path?q=1' | tr -d '\r')"
grep -Fx 'HTTP/2 308' <<<"$redirect" >/dev/null
grep -Fix 'location: https://martin-lindblad.com/path?q=1' <<<"$redirect" >/dev/null
curl -fsS -H 'Range: bytes=0-1023' "$origin/assets/man.mp4" -o /dev/null
curl -fsS "$origin/manifest.json" | jq -e '.icons | length > 0' >/dev/null
printf 'production smoke passed\n'
```

Create `scripts/acceptance/log-redaction.sh` to inspect bounded `docker compose logs --since` output and fail on email-address patterns, JSON keys `fullName`, `email`, `subject`, `message`, URI credential patterns, `NEXT_ATLAS`, `PGPASSWORD`, tunnel tokens, or stack traces from request handling. It prints counts by service, never matched lines.

- [ ] **Step 5: Execute the pre-write cutover window with a hard rollback branch**

Record UTC start; abort if more than 30 minutes elapse before contact is enabled. Verify authority elapsed >=172800 seconds and TTL 300 has been active >=86400 seconds. Record source counts/IDs/latest contact ID/date and current Cloudflare app-record JSON. Then:

```bash
sudo /usr/local/sbin/mlp-contact-mode maintenance
```

Read the verified tunnel UUID from the Cloudflare API response saved as root-readable `/var/lib/mlp/cloudflare-tunnel.json`, require `jq -er '.name == "mlp-prod" and (.id | test("^[0-9a-f-]{36}$"))'`, and derive `tunnel_target="$(jq -r '.id' /var/lib/mlp/cloudflare-tunnel.json).cfargotunnel.com"`. Change Cloudflare apex and `www` to proxied CNAMEs targeting that exact value. Preserve both prior record JSON documents for rollback. Verify Caddy returns 503 plus `Retry-After: 300` only on the contact POST while pages/read APIs return 200.

Wait one complete 300-second TTL, then require Vercel request analytics/logs to show no new portfolio requests for another five minutes. If DNS, TLS, page/API, Caddy, connector, Vercel-drain, or timing validation fails before PostgreSQL contact writes are enabled:

1. Keep the new Caddy contact endpoint in maintenance.
2. Restore both Cloudflare record documents to their saved Vercel values.
3. Verify Vercel serves pages and contact writes again.
4. Roll back the uncommitted PostgreSQL contact import transaction; retain reports for diagnosis.
5. End the window without modifying or deleting Atlas data.

- [ ] **Step 6: Import the final contact snapshot and cross the explicit commit point**

After Vercel traffic has drained, capture the final contact snapshot, import missing contacts in one transaction, and compare exact count, sorted IDs, ISO timestamps, and canonical hash. Keep maintenance enabled on mismatch and use the rollback branch above.

Before enabling public writes, submit a synthetic contact directly inside the app container, require 201, discover its UUID by the unique synthetic subject through the migrator role, verify the row, then delete exactly that UUID:

```bash
synthetic_subject="migration-internal-$(date -u +%Y%m%dT%H%M%SZ)"
sudo docker exec -e SYNTHETIC_SUBJECT="$synthetic_subject" mlp-prod-app-1 node -e '
fetch("http://127.0.0.1:3000/api/contact/route",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({fullName:"Migration Test",email:"migration-test@example.invalid",subject:process.env.SYNTHETIC_SUBJECT,message:"Synthetic cutover verification"})}).then(async r=>{if(r.status!==201)throw new Error(`status ${r.status}`)})'
synthetic_id="$(sudo /usr/local/sbin/mlp-compose exec -T postgres sh -ec 'PGPASSWORD="$(cat /run/secrets/postgres-migrator-password)" psql -At -U portfolio_migrator -d portfolio -v subject="$1" -c "select id from contact_messages where subject = :'\''subject'\''"' sh "$synthetic_subject")"
[[ "$synthetic_id" =~ ^[0-9a-f-]{36}$ ]]
sudo yarn migration:remove-synthetic "$synthetic_id"
```

When all checks pass:

```bash
sudo /usr/local/sbin/mlp-contact-mode enabled
```

Submit one new uniquely tagged synthetic contact through `https://martin-lindblad.com/api/contact/route`, require 201, query its UUID by the unique subject in PostgreSQL, and remove exactly that UUID. Re-run the final Atlas contact count to prove the synthetic row never appeared there. Record the successful public 201 timestamp as `POSTGRESQL_WRITE_COMMIT_POINT`. From that instant, changing DNS back to stale MongoDB/Vercel is forbidden; failures use PostgreSQL backup restore or a forward application fix.

- [ ] **Step 7: Enable Cloudflare HSTS only after public TLS/redirect checks**

Verify valid Cloudflare TLS at apex/`www`, the exact path/query-preserving `www` 308, no origin ports, and both connectors. Then enable Cloudflare HSTS with `max-age=63072000`; keep preload disabled and do not enable broader subdomain coverage unless the DNS inventory proves every subdomain supports HTTPS. Verify:

```bash
curl -fsSI https://martin-lindblad.com | tr -d '\r' | grep -i '^strict-transport-security:.*max-age=63072000'
scripts/acceptance/production-smoke.sh
```

- [ ] **Step 8: Complete restore and 24-hour acceptance observation**

Immediately take a fresh off-VM backup and run the isolated restore test. For at least 24 hours after `POSTGRESQL_WRITE_COMMIT_POINT`, collect redacted evidence every hour: public smoke, both connectors healthy, app/PostgreSQL readiness, disk/memory, backup state, and log-redaction result. Run all production acceptance checks from the approved design, including every legacy case ID and all ten data comparisons.

Expected final evidence:

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

- [ ] **Step 9: Commit the redacted runbook and acceptance tooling**

```bash
shellcheck scripts/acceptance/production-smoke.sh scripts/acceptance/log-redaction.sh
node --test tests/infra/cutover-gates.test.mjs
git add scripts/acceptance tests/infra/cutover-gates.test.mjs runbooks/rehearsal-and-cutover.md
git commit -m "ops: add rehearsal cutover and acceptance gates"
```

### Task 15: Remove MongoDB and Vercel Only After Acceptance

**Files:**
- Create: `tests/architecture/no-legacy-runtime.test.mjs`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `yarn.lock`
- Modify: `tsconfig.json`
- Delete: `lib/mongodb.ts`
- Delete: `types/mongodb.d.ts`
- Delete: `scripts/setupSchema.ts`
- Delete: `migration/**`
- Delete: `scripts/migration/**`
- Delete: `tests/unit/migration/**`
- Delete: `tests/integration/db/importer.test.ts`
- Delete: `tsconfig.migration.json`
- Delete: `public/vercel.svg`
- Delete externally after code deployment: portfolio Atlas user/database or dedicated project; Vercel domain/environment/project; obsolete credentials; temporary Cloudflare migration hostname/Access app.

**Interfaces:**
- Consumes: every Task 14 acceptance artifact, off-VM final Mongo archive, isolated PostgreSQL restore, and a reviewed PostgreSQL-only image digest.
- Produces: a PostgreSQL-only repository/runtime, no Atlas/Vercel configuration or service dependency, removed temporary migration ingress, revoked credentials, and a 30-day encrypted-archive deletion schedule.

- [ ] **Step 1: Write the legacy-dependency test before deleting anything**

Create `tests/architecture/no-legacy-runtime.test.mjs`:

```js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('runtime has no MongoDB or Vercel platform dependency', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const runtime = tracked.filter((file) => existsSync(file) && /^(src|server|lib|types|scripts|package\.json|tsconfig\.json|README\.md)/.test(file));
  const forbidden = /NEXT_ATLAS|connectToDatabase|from ['"]mongodb['"]|require\(['"]mongodb['"]\)|@vercel\/speed-insights|vercel\.com\/new|setup-db/;
  const matches = runtime.filter((file) => forbidden.test(readFileSync(file, 'utf8')));
  assert.deepEqual(matches, []);
});
```

Run: `node --test tests/architecture/no-legacy-runtime.test.mjs`

Expected: FAIL and list the Mongo connector/types/setup script, dependencies, stale TypeScript includes, and stale README.

- [ ] **Step 2: Require the destructive-action gate explicitly**

Before any deletion, verify and sign off all of these again: 24-hour observation >=86400 seconds; final source/destination report valid for ten collections; final encrypted Mongo archive readable from off-VM storage; fresh PostgreSQL backup and isolated restore passed; public contact 201 persisted in PostgreSQL; no Atlas access in app container; Cloudflare apex/`www` stable; `POSTGRESQL_WRITE_COMMIT_POINT` recorded. If any item is absent, stop with Atlas and Vercel untouched.

- [ ] **Step 3: Remove one-time Mongo/Vercel runtime code and dependencies**

Delete the listed local files and migration-only tooling. Remove MongoDB Database Tools and its temporary Atlas URI file from the trusted migration environment after the final off-VM archive is verified; retain `age` only if another documented backup workflow uses it. Run:

```bash
yarn remove mongodb @vercel/speed-insights
```

Remove `setup-db` and migration-only scripts from `package.json`; delete migration-only tests and `tsconfig.migration.json`; remove Mongo/contact-JS paths from `tsconfig.json`; keep display-only portfolio references to MongoDB technology icons because those describe experience rather than a runtime dependency. Rewrite `README.md` with Node 22.23.1/Yarn 1.22.22 setup, PostgreSQL file-backed variables, unit/integration/build commands, immutable image publication, root-owned VM deployment, backup/restore, and Cloudflare Tunnel architecture. Remove all Vercel deploy buttons and Atlas setup instructions.

- [ ] **Step 4: Prove and deploy the PostgreSQL-only image before external deletion**

Run:

```bash
yarn install --frozen-lockfile
yarn lint
yarn typecheck
yarn test
node --test tests/architecture/no-legacy-runtime.test.mjs tests/assets/*.test.mjs tests/infra/*.test.mjs
yarn build:production
rg -n "NEXT_ATLAS|connectToDatabase|from ['\"]mongodb['\"]|@vercel/speed-insights" --glob '!docs/**' --glob '!yarn.lock' .
```

Expected: all checks pass; final search returns no matches. Publish both images manually, deploy the new app digest with `mlp-deploy`, run production smoke, submit/delete one synthetic PostgreSQL contact, take a backup, and verify app container environment contains no Atlas/Vercel values.

- [ ] **Step 5: Commit the PostgreSQL-only repository**

```bash
git add -A
git commit -m "chore: remove mongodb and vercel dependencies"
```

- [ ] **Step 6: Decommission Atlas with shared-resource protection**

Use the inventory to determine whether the Atlas project/cluster is dedicated to this portfolio. Always delete the temporary portfolio migration user and portfolio database/network rules. Delete the cluster/project only when inventory proves no other database/application uses it; otherwise leave shared infrastructure and remove only portfolio-owned resources. Revoke all Atlas keys/credentials, verify app health and contact persistence, and record resource IDs plus deletion timestamps without secrets.

- [ ] **Step 7: Decommission Vercel after Cloudflare verification**

Reconfirm public NS/Cloudflare proxy/TLS/308/smoke after Atlas removal. In Vercel, remove portfolio environment variables, detach `martin-lindblad.com` and `www`, then delete the portfolio project. Revoke obsolete Vercel credentials. Query public DNS through three resolvers and run production smoke again; any Vercel deletion error is handled in Vercel and never by reverting production DNS to stale MongoDB.

- [ ] **Step 8: Remove temporary Cloudflare migration access and schedule archive expiry**

Delete `migration.martin-lindblad.com` DNS/tunnel ingress, its Access policy/application, and any Access service token used for testing. Keep the apex/`www` tunnel routes and catch-all 404. Retain the encrypted final Mongo archive under the same 30-daily policy, then delete it after 30 days only if another isolated PostgreSQL restore passes on the deletion day.

- [ ] **Step 9: Record the final state**

The closeout report contains only non-secret evidence:

```text
production_origin = Cloudflare Tunnel -> Caddy -> Next.js -> PostgreSQL
vercel_project = deleted
vercel_custom_domains = detached
atlas_portfolio_user = deleted
atlas_portfolio_database = deleted
mongodb_runtime_matches = 0
vercel_runtime_matches = 0
temporary_migration_hostname = deleted
off_vm_backup = passed
isolated_restore = passed
```

Commit the redacted closeout report under `docs/operations/` only after all values are true.

## Final Verification Sequence

Run this sequence from a clean checkout under Node 22.23.1 after Task 15 and before claiming completion:

```bash
test -z "$(git status --porcelain --untracked-files=all)"
test "$(node --version)" = v22.23.1
test "$(yarn --version)" = 1.22.22
yarn install --frozen-lockfile
yarn lint
yarn typecheck
yarn test:unit
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres yarn test:integration
node --test tests/architecture/*.test.mjs tests/assets/*.test.mjs tests/infra/*.test.mjs
yarn build:production
docker build --build-arg COMMIT_SHA="$(git rev-parse HEAD)" --tag mlp:final .
docker build --file infra/backup/Dockerfile --tag mlp-backup:final .
yarn test:e2e
```

Expected: every command exits 0; unit/integration/architecture/asset/infra/browser suites have zero failures; both images build; `git status` is clean. Then on production:

```bash
sudo /usr/local/sbin/mlp-compose ps
sudo scripts/acceptance/tunnel-health.sh
scripts/acceptance/production-smoke.sh
sudo /usr/local/sbin/mlp-backup
sudo /usr/local/sbin/mlp-restore-test
sudo scripts/acceptance/log-redaction.sh --since 24h
sudo ss -ltnup
```

Expected: app/PostgreSQL/Caddy/two connectors are healthy; public smoke passes; backup and isolated restore pass; log scan reports zero secret/PII matches; no app, Caddy, PostgreSQL, Docker API, or new public SSH listener appears.

## Specification Coverage Record

| Approved design section | Implemented by |
| --- | --- |
| Goal/scope and one production environment | Header, Global Constraints, Execution Gates |
| Debian 13 Proxmox VM sizing/agent/startup/private management | Task 12 |
| Seven Compose services, four networks, digest pinning | Tasks 8-10 |
| Cloudflare-only request flow, Caddy trust/redirect/headers/timeouts | Tasks 9 and 13 |
| DNS clone, TTL 300, 48-hour nameserver hold, Access hostname | Task 13 |
| Next standalone runtime, liveness/readiness, ISR | Tasks 4 and 8 |
| PostgreSQL tables, roles, source order, legacy compatibility | Tasks 1-4 |
| Strict ten-collection mapping, encrypted archive, rehearsal/final delta | Tasks 5, 6, and 14 |
| GitHub build authority, GHCR digests, SBOM/provenance, safe deploy | Tasks 8, 10, and 11 |
| Nightly off-VM backup, retention/check, monthly isolated restore | Tasks 8, 10, and 14 |
| No exposed ports, root-only secrets, bounded logs, upgrades/firewall | Tasks 9, 10, and 12 |
| Unit/integration/migration/browser/asset/SW/Compose/Caddy tests | Tasks 1-11 |
| Production acceptance, connector/DB failure tests, 24-hour observation | Task 14 |
| Pre-write rollback, post-write forward recovery, archive retention | Tasks 14 and 15 |
| Atlas/Vercel removal only after all hard gates | Task 15 |
