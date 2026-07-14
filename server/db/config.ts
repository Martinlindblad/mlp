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
