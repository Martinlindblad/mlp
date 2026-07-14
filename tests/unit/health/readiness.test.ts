import type {
  CompiledQuery,
  DatabaseConnection,
  Driver,
  Kysely,
  QueryResult,
} from 'kysely';
import {
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  Kysely as KyselyDatabase,
} from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../../server/db/client';
import type { Database } from '../../../server/db/database.types';
import { checkReadiness } from '../../../server/health/readiness';
import liveHandler from '../../../src/pages/api/health/live';
import readyHandler from '../../../src/pages/api/health/ready';
import { createMockRequest, createMockResponse } from '../../helpers/next-api';

vi.mock('../../../server/db/client', () => ({ getDatabase: vi.fn() }));

const REQUIRED_MIGRATION = '002_runtime_grants';

type QueryHandler = (
  query: CompiledQuery,
) => Promise<QueryResult<Record<string, unknown>>>;

function createTestDatabase(handler: QueryHandler): Kysely<Database> {
  const connection = {
    executeQuery: handler,
    async *streamQuery() {
      // Readiness never streams queries.
    },
  } as unknown as DatabaseConnection;
  const driver = {
    async init() {
      return undefined;
    },
    async acquireConnection() {
      return connection;
    },
    async beginTransaction() {
      return undefined;
    },
    async commitTransaction() {
      return undefined;
    },
    async rollbackTransaction() {
      return undefined;
    },
    async releaseConnection() {
      return undefined;
    },
    async destroy() {
      return undefined;
    },
  } as Driver;

  return new KyselyDatabase<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

function createReadinessDatabase(options?: {
  ping?: () => Promise<void>;
  migration?: () => Promise<string | undefined>;
}) {
  const ping = options?.ping ?? (() => Promise.resolve());
  const migration =
    options?.migration ?? (() => Promise.resolve(REQUIRED_MIGRATION));
  const statements: string[] = [];
  const database = createTestDatabase(async (query) => {
    statements.push(query.sql);
    if (query.sql === 'select 1') {
      await ping();
      return { rows: [] };
    }
    if (query.sql.includes('from "kysely_migration"')) {
      const name = await migration();
      return { rows: name === undefined ? [] : [{ name }] };
    }
    throw new Error(`Unexpected SQL: ${query.sql}`);
  });

  return { database, statements };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('readiness check', () => {
  it('returns true only after the ping and required migration succeed', async () => {
    vi.useFakeTimers();
    const { database, statements } = createReadinessDatabase();

    await expect(checkReadiness(database, REQUIRED_MIGRATION)).resolves.toBe(
      true,
    );
    expect(statements).toEqual([
      'select 1',
      'select "name" from "kysely_migration" where "name" = $1',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns false when the required migration is absent', async () => {
    vi.useFakeTimers();
    const { database } = createReadinessDatabase({
      migration: () => Promise.resolve(undefined),
    });

    await expect(checkReadiness(database, REQUIRED_MIGRATION)).resolves.toBe(
      false,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      name: 'ping',
      options: { ping: () => Promise.reject(new Error('ping secret')) },
    },
    {
      name: 'migration lookup',
      options: {
        migration: () => Promise.reject(new Error('migration secret')),
      },
    },
  ])(
    'returns false and clears its timer when the $name rejects',
    async ({ options }) => {
      vi.useFakeTimers();
      const { database } = createReadinessDatabase(options);

      await expect(checkReadiness(database, REQUIRED_MIGRATION)).resolves.toBe(
        false,
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('returns false within 2,000ms when a query never settles', async () => {
    vi.useFakeTimers();
    const { database } = createReadinessDatabase({
      ping: () => new Promise<void>(() => {}),
    });
    let result: boolean | undefined;
    const readiness = checkReadiness(database, REQUIRED_MIGRATION).then(
      (value) => {
        result = value;
        return value;
      },
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    await expect(readiness).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('health routes', () => {
  it('reports liveness without touching the database', async () => {
    const response = createMockResponse();

    await liveHandler(createMockRequest(), response);

    expect([response.statusCode, response.payload]).toEqual([
      200,
      { status: 'ok' },
    ]);
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it('reports readiness only when the database check succeeds', async () => {
    vi.mocked(getDatabase).mockReturnValueOnce(
      createReadinessDatabase().database,
    );
    const response = createMockResponse();

    await readyHandler(createMockRequest(), response);

    expect([response.statusCode, response.payload]).toEqual([
      200,
      { status: 'ready' },
    ]);
  });

  it('hides database configuration errors behind a generic 503', async () => {
    vi.mocked(getDatabase).mockImplementationOnce(() => {
      throw new Error('postgres password=secret');
    });
    const response = createMockResponse();

    await readyHandler(createMockRequest(), response);

    expect([response.statusCode, response.payload]).toEqual([
      503,
      { status: 'unavailable' },
    ]);
    expect(JSON.stringify(response.payload)).not.toContain('secret');
  });
});
