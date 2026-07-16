import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadJournalRecoveryConfig,
  loadJournalWriterConfig,
} from '../../../server/journal/config';

const endpoint = 'https://accountid.eu.r2.cloudflarestorage.com';
const bucket = 'mlp-contact-journal';
const activeKeyId = 'journal-2026-01';
const ageRecipient = `age1${'q'.repeat(58)}`;
const macKeyring = JSON.stringify({
  [activeKeyId]: Buffer.alloc(32, 0x33).toString('base64'),
});

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
});

function temporaryRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name));
  roots.push(root);
  return root;
}

function secret(
  root: string,
  relativePath: string,
  value: string,
  mode = 0o400,
) {
  const target = join(root, relativePath);
  mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true });
  writeFileSync(target, value, { mode });
  chmodSync(target, mode);
}

function writerEnvironment(): NodeJS.ProcessEnv {
  return {
    JOURNAL_R2_ENDPOINT: endpoint,
    JOURNAL_R2_BUCKET: bucket,
    JOURNAL_ACTIVE_KEY_ID: activeKeyId,
    JOURNAL_AGE_RECIPIENT: ageRecipient,
    JOURNAL_R2_ACCESS_KEY_ID_FILE: '/run/secrets/journal-r2-access-key-id',
    JOURNAL_R2_SECRET_ACCESS_KEY_FILE:
      '/run/secrets/journal-r2-secret-access-key',
    JOURNAL_MAC_KEYRING_FILE: '/run/secrets/journal-mac-keyring',
    NODE_ENV: 'test',
  };
}

function populateWriterSecrets(root: string) {
  secret(root, 'journal-r2-access-key-id', 'writer-access-key\n');
  secret(root, 'journal-r2-secret-access-key', 'writer-secret-key\n');
  secret(root, 'journal-mac-keyring', macKeyring);
}

function recoveryEnvironment(): NodeJS.ProcessEnv {
  return {
    JOURNAL_R2_ENDPOINT: endpoint,
    JOURNAL_R2_BUCKET: bucket,
    JOURNAL_R2_JURISDICTION: 'eu',
    JOURNAL_R2_LOCK_RULE_ID: 'v1-lock-60d',
    PGHOST: 'postgres',
    PGPORT: '5432',
    PGDATABASE: 'portfolio',
    PGUSER: 'portfolio_migrator',
    PGSTATEMENT_TIMEOUT_MS: '60000',
    RECOVERY_REPORT_DIRECTORY: '/run/recovery-output',
    RECOVERY_DEADLINE_SECONDS: '7200',
    NODE_ENV: 'test',
  };
}

function populateRecoverySecrets(root: string) {
  secret(root, 'r2-access-key-id', 'recovery-access-key\n');
  secret(root, 'r2-secret-access-key', 'recovery-secret-key\n');
  secret(root, 'age-identity', 'AGE-SECRET-KEY-fixture\n');
  secret(root, 'mac-keyring', macKeyring);
  secret(root, 'postgres-password', 'postgres-password\n');
}

describe('journal writer config', () => {
  it('loads canonical non-secret env and strict runtime secret files', () => {
    const appSecretRoot = temporaryRoot('mlp-journal-app-');
    populateWriterSecrets(appSecretRoot);

    const config = loadJournalWriterConfig(writerEnvironment(), {
      appSecretRoot,
    });

    expect(config).toEqual({
      endpoint,
      bucket,
      activeKeyId,
      ageRecipient,
      accessKeyId: 'writer-access-key',
      secretAccessKey: 'writer-secret-key',
      macKeys: expect.any(Map),
    });
    expect(config.macKeys.get(activeKeyId)).toEqual(Buffer.alloc(32, 0x33));
  });

  it('rejects inherited AWS credentials and unsafe endpoint shapes', () => {
    const appSecretRoot = temporaryRoot('mlp-journal-app-');
    populateWriterSecrets(appSecretRoot);

    for (const patch of [
      { AWS_ACCESS_KEY_ID: 'inherited' },
      { AWS_SECRET_ACCESS_KEY: 'inherited' },
      { JOURNAL_R2_ENDPOINT: 'http://accountid.eu.r2.cloudflarestorage.com' },
      {
        JOURNAL_R2_ENDPOINT:
          'https://user@accountid.eu.r2.cloudflarestorage.com',
      },
      {
        JOURNAL_R2_ENDPOINT:
          'https://accountid.eu.r2.cloudflarestorage.com/path',
      },
      { JOURNAL_R2_BUCKET: 'other-bucket' },
    ]) {
      expect(() =>
        loadJournalWriterConfig(
          {
            ...writerEnvironment(),
            ...patch,
          },
          { appSecretRoot },
        ),
      ).toThrow('invalid journal configuration');
    }
  });

  it('rejects non-/run app paths, symlinks, unsafe modes, malformed scalar files, and missing active keys', () => {
    const appSecretRoot = temporaryRoot('mlp-journal-app-');
    populateWriterSecrets(appSecretRoot);

    expect(() =>
      loadJournalWriterConfig(
        {
          ...writerEnvironment(),
          JOURNAL_R2_ACCESS_KEY_ID_FILE: join(appSecretRoot, 'access-key'),
        },
        { appSecretRoot },
      ),
    ).toThrow('invalid journal configuration');

    rmSync(join(appSecretRoot, 'journal-r2-access-key-id'));
    symlinkSync(
      join(appSecretRoot, 'journal-r2-secret-access-key'),
      join(appSecretRoot, 'journal-r2-access-key-id'),
    );
    expect(() =>
      loadJournalWriterConfig(writerEnvironment(), { appSecretRoot }),
    ).toThrow('invalid journal configuration');

    rmSync(join(appSecretRoot, 'journal-r2-access-key-id'));
    secret(
      appSecretRoot,
      'journal-r2-access-key-id',
      'writer-access-key\n',
      0o600,
    );
    expect(() =>
      loadJournalWriterConfig(writerEnvironment(), { appSecretRoot }),
    ).toThrow('invalid journal configuration');

    rmSync(join(appSecretRoot, 'journal-r2-access-key-id'));
    secret(appSecretRoot, 'journal-r2-access-key-id', 'writer\naccess\n');
    expect(() =>
      loadJournalWriterConfig(writerEnvironment(), { appSecretRoot }),
    ).toThrow('invalid journal configuration');

    rmSync(join(appSecretRoot, 'journal-r2-access-key-id'));
    secret(appSecretRoot, 'journal-r2-access-key-id', 'writer-access-key\n');
    rmSync(join(appSecretRoot, 'journal-mac-keyring'));
    secret(
      appSecretRoot,
      'journal-mac-keyring',
      JSON.stringify({ other: Buffer.alloc(32, 0x33).toString('base64') }),
    );
    expect(() =>
      loadJournalWriterConfig(writerEnvironment(), { appSecretRoot }),
    ).toThrow('invalid journal configuration');
  });
});

describe('journal recovery config', () => {
  it('loads canonical recovery env and validates fixed recovery-secret files', () => {
    const recoverySecretRoot = temporaryRoot('mlp-journal-recovery-');
    populateRecoverySecrets(recoverySecretRoot);

    const config = loadJournalRecoveryConfig(recoveryEnvironment(), {
      recoverySecretRoot,
    });

    expect(config).toEqual({
      endpoint,
      bucket,
      jurisdiction: 'eu',
      lockRuleId: 'v1-lock-60d',
      accessKeyId: 'recovery-access-key',
      secretAccessKey: 'recovery-secret-key',
      identityFile: '/run/recovery-secrets/age-identity',
      macKeys: expect.any(Map),
      postgresHost: 'postgres',
      postgresPort: 5432,
      postgresDatabase: 'portfolio',
      postgresUser: 'portfolio_migrator',
      postgresPasswordFile: '/run/recovery-secrets/postgres-password',
      postgresStatementTimeoutMillis: 60_000,
      reportDirectory: '/run/recovery-output',
      recoveryDeadlineSeconds: 7200,
    });
    expect(config.macKeys.get(activeKeyId)).toEqual(Buffer.alloc(32, 0x33));
  });

  it('rejects malformed recovery env without leaking paths or values', () => {
    const recoverySecretRoot = temporaryRoot('mlp-journal-recovery-');
    populateRecoverySecrets(recoverySecretRoot);

    for (const patch of [
      { JOURNAL_R2_JURISDICTION: 'wnam' },
      { PGPORT: '6543' },
      { PGUSER: 'postgres' },
      { PGSTATEMENT_TIMEOUT_MS: '5000' },
      { RECOVERY_REPORT_DIRECTORY: '/tmp/recovery-output' },
      { RECOVERY_DEADLINE_SECONDS: '60' },
    ]) {
      expect(() =>
        loadJournalRecoveryConfig(
          {
            ...recoveryEnvironment(),
            ...patch,
          },
          { recoverySecretRoot },
        ),
      ).toThrow('invalid journal configuration');
    }
  });
});
