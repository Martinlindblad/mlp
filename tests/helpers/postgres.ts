import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { Client, type Pool } from 'pg';
import {
  createDatabasePool,
  createDatabaseWithPool,
} from '../../server/db/client';
import type { Database } from '../../server/db/database.types';

const localHosts = new Set(['127.0.0.1', 'localhost', 'postgres']);

interface IsolatedDatabase {
  readonly db: Kysely<Database>;
  readonly pool: Pool;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function decodeUrlPart(value: string): string {
  return decodeURIComponent(value);
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('PostgreSQL cleanup failed', { cause: error });
}

export function createIsolatedDatabase(): IsolatedDatabase {
  const connectionString = process.env.TEST_DATABASE_URL?.trim();
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');

  const url = new URL(connectionString);
  if (!localHosts.has(url.hostname)) {
    throw new Error('TEST_DATABASE_URL must point to a local PostgreSQL host');
  }

  const maintenanceDatabase = decodeUrlPart(url.pathname.slice(1));
  if (!maintenanceDatabase) {
    throw new Error('TEST_DATABASE_URL must include a maintenance database');
  }

  const user = decodeUrlPart(url.username);
  const password = decodeUrlPart(url.password);
  const port = Number(url.port || '5432');
  const databaseName = `mlp_test_${process.pid}_${randomUUID().replaceAll(
    '-',
    '',
  )}`;
  const quotedDatabaseName = `"${databaseName}"`;
  const migratorPassword = 'portfolio_migrator_test_password';
  const maintenance = new Client({
    host: url.hostname,
    port,
    database: maintenanceDatabase,
    user,
    password,
  });

  let db: Kysely<Database> | undefined;
  let pool: Pool | undefined;
  let maintenanceConnected = false;
  let databaseCreated = false;

  async function destroyDatabase(): Promise<void> {
    if (!databaseCreated) return;

    let firstError: Error | undefined;
    try {
      await maintenance.query(
        `select pg_terminate_backend(pid)
         from pg_stat_activity
         where datname = $1 and pid <> pg_backend_pid()`,
        [databaseName],
      );
    } catch (error) {
      firstError = asError(error);
    }

    try {
      await maintenance.query(`drop database if exists ${quotedDatabaseName}`);
      databaseCreated = false;
    } catch (error) {
      firstError ??= asError(error);
    }

    if (firstError) throw firstError;
  }

  async function cleanup(
    initialError?: unknown,
    hasInitialError = false,
  ): Promise<void> {
    let firstError = hasInitialError ? asError(initialError) : undefined;
    const remember = (error: unknown): void => {
      firstError ??= asError(error);
    };

    if (db) {
      const activeDatabase = db;
      db = undefined;
      pool = undefined;
      try {
        await activeDatabase.destroy();
      } catch (error) {
        remember(error);
      }
    }

    if (maintenanceConnected) {
      try {
        await destroyDatabase();
      } catch (error) {
        remember(error);
      }

      try {
        await maintenance.end();
      } catch (error) {
        remember(error);
      } finally {
        maintenanceConnected = false;
      }
    }

    if (firstError) throw firstError;
  }

  return {
    get db(): Kysely<Database> {
      if (!db) throw new Error('Isolated PostgreSQL database has not started');
      return db;
    },

    get pool(): Pool {
      if (!pool) throw new Error('Isolated PostgreSQL database has not started');
      return pool;
    },

    async start(): Promise<void> {
      await maintenance.connect();
      maintenanceConnected = true;
      try {
        await maintenance.query(`
          do $$
          begin
            if not exists (select 1 from pg_roles where rolname = 'portfolio_migrator') then
              create role portfolio_migrator login password '${migratorPassword}';
            else
              alter role portfolio_migrator with login password '${migratorPassword}';
            end if;
            if not exists (select 1 from pg_roles where rolname = 'portfolio_app') then
              create role portfolio_app;
            end if;
            if not exists (select 1 from pg_roles where rolname = 'portfolio_backup') then
              create role portfolio_backup;
            end if;
            grant portfolio_app to portfolio_migrator;
            grant portfolio_backup to portfolio_migrator;
          end
          $$;
        `);
        await maintenance.query(
          `create database ${quotedDatabaseName} owner portfolio_migrator`,
        );
        databaseCreated = true;
        pool = createDatabasePool({
          host: url.hostname,
          port,
          database: databaseName,
          user: 'portfolio_migrator',
          password: migratorPassword,
          maxConnections: 5,
          connectionTimeoutMillis: 5_000,
          statementTimeoutMillis: 60_000,
        });
        db = createDatabaseWithPool(pool);
      } catch (error) {
        await cleanup(error, true);
        throw error;
      }
    },

    async stop(): Promise<void> {
      await cleanup();
    },
  };
}
