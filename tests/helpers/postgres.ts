import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { Client } from 'pg';
import { createDatabase } from '../../server/db/client';
import type { Database } from '../../server/db/database.types';

const localHosts = new Set(['127.0.0.1', 'localhost', 'postgres']);

interface IsolatedDatabase {
  readonly db: Kysely<Database>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

function decodeUrlPart(value: string): string {
  return decodeURIComponent(value);
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
  const maintenance = new Client({
    host: url.hostname,
    port,
    database: maintenanceDatabase,
    user,
    password,
  });

  let db: Kysely<Database> | undefined;
  let maintenanceConnected = false;
  let databaseCreated = false;

  async function destroyDatabase(): Promise<void> {
    if (!databaseCreated) return;
    await maintenance.query(
      `select pg_terminate_backend(pid)
       from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
      [databaseName],
    );
    await maintenance.query(`drop database if exists ${quotedDatabaseName}`);
    databaseCreated = false;
  }

  return {
    get db(): Kysely<Database> {
      if (!db) throw new Error('Isolated PostgreSQL database has not started');
      return db;
    },

    async start(): Promise<void> {
      await maintenance.connect();
      maintenanceConnected = true;
      try {
        await maintenance.query(`
          do $$
          begin
            if not exists (select 1 from pg_roles where rolname = 'portfolio_app') then
              create role portfolio_app;
            end if;
            if not exists (select 1 from pg_roles where rolname = 'portfolio_backup') then
              create role portfolio_backup;
            end if;
          end
          $$;
        `);
        await maintenance.query(`create database ${quotedDatabaseName}`);
        databaseCreated = true;
        db = createDatabase({
          host: url.hostname,
          port,
          database: databaseName,
          user,
          password,
          maxConnections: 2,
          connectionTimeoutMillis: 5_000,
        });
      } catch (error) {
        await destroyDatabase();
        await maintenance.end();
        maintenanceConnected = false;
        throw error;
      }
    },

    async stop(): Promise<void> {
      if (db) {
        await db.destroy();
        db = undefined;
      }
      if (!maintenanceConnected) return;
      try {
        await destroyDatabase();
      } finally {
        await maintenance.end();
        maintenanceConnected = false;
      }
    },
  };
}
