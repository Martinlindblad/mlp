import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseMacKeyring } from './contracts';

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

interface LoaderRoots {
  appSecretRoot?: string;
  recoverySecretRoot?: string;
}

const BUCKET = 'mlp-contact-journal';
const APP_SECRET_PREFIX = '/run/secrets/';
const RECOVERY_SECRET_PREFIX = '/run/recovery-secrets/';
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const AGE_RECIPIENT_PATTERN = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;
const LOCK_RULE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SCALAR_LIMIT_BYTES = 4_096;
const MATERIAL_LIMIT_BYTES = 65_536;

function invalid(): never {
  throw new Error('invalid journal configuration');
}

function requireValue(value: string | undefined): string {
  if (!value) {
    return invalid();
  }

  return value;
}

function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !/^[a-z0-9-]+\.eu\.r2\.cloudflarestorage\.com$/.test(url.hostname)
  ) {
    return invalid();
  }

  return value;
}

function validateBucket(value: string | undefined): 'mlp-contact-journal' {
  if (value !== BUCKET) {
    return invalid();
  }

  return BUCKET;
}

function validateKeyId(value: string | undefined): string {
  if (!value || !KEY_ID_PATTERN.test(value)) {
    return invalid();
  }

  return value;
}

function validateAgeRecipient(value: string | undefined): string {
  if (!value || !AGE_RECIPIENT_PATTERN.test(value)) {
    return invalid();
  }

  return value;
}

function validateSecretPath(path: string | undefined, prefix: string): string {
  if (!path || !path.startsWith(prefix)) {
    return invalid();
  }

  const relative = path.slice(prefix.length);
  if (
    relative.length === 0 ||
    relative.startsWith('/') ||
    relative.split('/').some((segment) => segment === '' || segment === '..')
  ) {
    return invalid();
  }

  return path;
}

function materialPath(
  canonicalPath: string,
  prefix: string,
  root?: string,
): string {
  if (!root) {
    return canonicalPath;
  }

  return join(root, canonicalPath.slice(prefix.length));
}

function readRuntimeFile(
  canonicalPath: string,
  prefix: string,
  root: string | undefined,
  limitBytes: number,
): Buffer {
  const actualPath = materialPath(canonicalPath, prefix, root);
  let fd: number | undefined;

  try {
    const before = lstatSync(actualPath);
    if (
      !before.isFile() ||
      before.uid !== (process.getuid?.() ?? before.uid) ||
      before.nlink !== 1 ||
      (before.mode & 0o777) !== 0o400 ||
      before.size > limitBytes
    ) {
      return invalid();
    }

    fd = openSync(
      actualPath,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        ((constants as { O_CLOEXEC?: number }).O_CLOEXEC ?? 0),
    );
    const after = fstatSync(fd);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      !after.isFile() ||
      after.uid !== (process.getuid?.() ?? after.uid) ||
      after.nlink !== 1 ||
      (after.mode & 0o777) !== 0o400 ||
      after.size > limitBytes
    ) {
      return invalid();
    }

    return readFileSync(fd);
  } catch {
    return invalid();
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

function readScalarSecret(
  canonicalPath: string,
  prefix: string,
  root?: string,
): string {
  const text = readRuntimeFile(
    canonicalPath,
    prefix,
    root,
    SCALAR_LIMIT_BYTES,
  ).toString('utf8');

  if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) {
    return invalid();
  }

  const value = text.slice(0, -1);
  if (value.length === 0) {
    return invalid();
  }

  return value;
}

function readMacKeyring(
  canonicalPath: string,
  prefix: string,
  root?: string,
): ReadonlyMap<string, Buffer> {
  const bytes = readRuntimeFile(
    canonicalPath,
    prefix,
    root,
    MATERIAL_LIMIT_BYTES,
  );
  return parseMacKeyring(bytes);
}

function validateAwsEnvironment(env: NodeJS.ProcessEnv) {
  if (
    env.AWS_ACCESS_KEY_ID ||
    env.AWS_SECRET_ACCESS_KEY ||
    env.AWS_SESSION_TOKEN ||
    env.AWS_PROFILE
  ) {
    return invalid();
  }
}

export function loadJournalWriterConfig(
  env: NodeJS.ProcessEnv,
  roots: LoaderRoots = {},
): JournalWriterConfig {
  validateAwsEnvironment(env);
  const endpoint = validateEndpoint(requireValue(env.JOURNAL_R2_ENDPOINT));
  const bucket = validateBucket(env.JOURNAL_R2_BUCKET);
  const activeKeyId = validateKeyId(env.JOURNAL_ACTIVE_KEY_ID);
  const ageRecipient = validateAgeRecipient(env.JOURNAL_AGE_RECIPIENT);
  const accessKeyPath = validateSecretPath(
    env.JOURNAL_R2_ACCESS_KEY_ID_FILE,
    APP_SECRET_PREFIX,
  );
  const secretKeyPath = validateSecretPath(
    env.JOURNAL_R2_SECRET_ACCESS_KEY_FILE,
    APP_SECRET_PREFIX,
  );
  const macKeyringPath = validateSecretPath(
    env.JOURNAL_MAC_KEYRING_FILE,
    APP_SECRET_PREFIX,
  );
  const macKeys = readMacKeyring(
    macKeyringPath,
    APP_SECRET_PREFIX,
    roots.appSecretRoot,
  );
  if (!macKeys.has(activeKeyId)) {
    return invalid();
  }

  return {
    endpoint,
    bucket,
    activeKeyId,
    ageRecipient,
    accessKeyId: readScalarSecret(
      accessKeyPath,
      APP_SECRET_PREFIX,
      roots.appSecretRoot,
    ),
    secretAccessKey: readScalarSecret(
      secretKeyPath,
      APP_SECRET_PREFIX,
      roots.appSecretRoot,
    ),
    macKeys,
  };
}

export function loadJournalRecoveryConfig(
  env: NodeJS.ProcessEnv,
  roots: LoaderRoots = {},
): JournalRecoveryConfig {
  validateAwsEnvironment(env);
  const endpoint = validateEndpoint(requireValue(env.JOURNAL_R2_ENDPOINT));
  const bucket = validateBucket(env.JOURNAL_R2_BUCKET);
  if (env.JOURNAL_R2_JURISDICTION !== 'eu') {
    return invalid();
  }
  if (
    !env.JOURNAL_R2_LOCK_RULE_ID ||
    !LOCK_RULE_ID_PATTERN.test(env.JOURNAL_R2_LOCK_RULE_ID)
  ) {
    return invalid();
  }
  if (
    env.PGPORT !== '5432' ||
    env.PGUSER !== 'portfolio_migrator' ||
    env.PGSTATEMENT_TIMEOUT_MS !== '60000' ||
    env.RECOVERY_REPORT_DIRECTORY !== '/run/recovery-output'
  ) {
    return invalid();
  }
  const recoveryDeadlineSeconds = Number(env.RECOVERY_DEADLINE_SECONDS);
  if (
    !Number.isInteger(recoveryDeadlineSeconds) ||
    recoveryDeadlineSeconds < 7_200 ||
    recoveryDeadlineSeconds > 604_800
  ) {
    return invalid();
  }

  const accessKeyPath = `${RECOVERY_SECRET_PREFIX}r2-access-key-id`;
  const secretKeyPath = `${RECOVERY_SECRET_PREFIX}r2-secret-access-key`;
  const identityFile = `${RECOVERY_SECRET_PREFIX}age-identity`;
  const macKeyringPath = `${RECOVERY_SECRET_PREFIX}mac-keyring`;
  const postgresPasswordFile = `${RECOVERY_SECRET_PREFIX}postgres-password`;
  readRuntimeFile(
    identityFile,
    RECOVERY_SECRET_PREFIX,
    roots.recoverySecretRoot,
    MATERIAL_LIMIT_BYTES,
  );
  readRuntimeFile(
    postgresPasswordFile,
    RECOVERY_SECRET_PREFIX,
    roots.recoverySecretRoot,
    SCALAR_LIMIT_BYTES,
  );

  return {
    endpoint,
    bucket,
    jurisdiction: 'eu',
    lockRuleId: env.JOURNAL_R2_LOCK_RULE_ID,
    accessKeyId: readScalarSecret(
      accessKeyPath,
      RECOVERY_SECRET_PREFIX,
      roots.recoverySecretRoot,
    ),
    secretAccessKey: readScalarSecret(
      secretKeyPath,
      RECOVERY_SECRET_PREFIX,
      roots.recoverySecretRoot,
    ),
    identityFile,
    macKeys: readMacKeyring(
      macKeyringPath,
      RECOVERY_SECRET_PREFIX,
      roots.recoverySecretRoot,
    ),
    postgresHost: requireValue(env.PGHOST),
    postgresPort: 5432,
    postgresDatabase: requireValue(env.PGDATABASE),
    postgresUser: 'portfolio_migrator',
    postgresPasswordFile,
    postgresStatementTimeoutMillis: 60_000,
    reportDirectory: '/run/recovery-output',
    recoveryDeadlineSeconds,
  };
}
