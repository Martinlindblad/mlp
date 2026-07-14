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

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = (env[name] ?? defaultValue).trim();
  const value = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error(`Invalid database setting: ${name}`);
  }
  return value;
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv): DatabaseConfig {
  const passwordFile = required(env, 'PGPASSWORD_FILE');
  return {
    host: required(env, 'PGHOST'),
    port: positiveInteger(env, 'PGPORT', '5432', 65_535),
    database: required(env, 'PGDATABASE'),
    user: required(env, 'PGUSER'),
    password: fs.readFileSync(passwordFile, 'utf8').trim(),
    maxConnections: positiveInteger(env, 'PGPOOL_MAX', '5'),
    connectionTimeoutMillis: positiveInteger(
      env,
      'PGCONNECT_TIMEOUT_MS',
      '5000',
    ),
  };
}
