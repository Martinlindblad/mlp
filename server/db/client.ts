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
