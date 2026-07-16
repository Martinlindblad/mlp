import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './database.types';
import { loadDatabaseConfig, type DatabaseConfig } from './config';

export function createDatabasePool(config: DatabaseConfig): Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
    ssl: false,
  });
}

export function createDatabaseWithPool(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool,
    }),
  });
}

export function createDatabase(config: DatabaseConfig): Kysely<Database> {
  return createDatabaseWithPool(createDatabasePool(config));
}

let singletonPool: Pool | undefined;
let singleton: Kysely<Database> | undefined;

export function getDatabasePool(): Pool {
  singletonPool ??= createDatabasePool(loadDatabaseConfig(process.env));
  return singletonPool;
}

export function getDatabase(): Kysely<Database> {
  singleton ??= createDatabaseWithPool(getDatabasePool());
  return singleton;
}
