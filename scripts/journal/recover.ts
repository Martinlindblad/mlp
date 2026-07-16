import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabasePool } from '../../server/db/client';
import { createAgeProcess } from '../../server/journal/age-process';
import { loadJournalRecoveryConfig } from '../../server/journal/config';
import { readStableAcceptedSet } from '../../server/journal/recovery';
import { withRecoverySession } from '../../server/journal/recovery-staging';
import { createJournalObjectStore } from '../../server/journal/r2-store';

interface JournalRecoveryReport {
  status: 'passed';
  startedAt: string;
  completedAt: string;
  resticSnapshotId: string;
  r2BucketJurisdiction: 'eu';
  r2LockRuleId: string;
  acceptedSetCount: number;
  acceptedSetSha256: string;
  schemas: string[];
  keyIds: string[];
  preExisting: number;
  inserted: number;
  final: number;
  pending: number;
  mismatch: 0;
}

const SNAPSHOT_PATTERN = /^[0-9a-f]{64}$/;

function fail(): never {
  throw new Error('journal recovery failed');
}

function requiredSnapshotId(env: NodeJS.ProcessEnv): string {
  const value = env.RESTIC_SNAPSHOT_ID;
  if (!value || !SNAPSHOT_PATTERN.test(value)) fail();
  return value;
}

function writePassedReport(
  directory: '/run/recovery-output',
  report: JournalRecoveryReport,
): void {
  const target = join(directory, 'journal-recovery-report.json');
  const temporary = join(
    directory,
    `.journal-recovery-report.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(report)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, target);
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const resticSnapshotId = requiredSnapshotId(process.env);
  const config = loadJournalRecoveryConfig(process.env);
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort(),
    config.recoveryDeadlineSeconds * 1000,
  );
  const pool = createDatabasePool({
    host: config.postgresHost,
    port: config.postgresPort,
    database: config.postgresDatabase,
    user: config.postgresUser,
    password: readFileSync(config.postgresPasswordFile, 'utf8').trim(),
    maxConnections: 1,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: config.postgresStatementTimeoutMillis,
  });

  try {
    const store = createJournalObjectStore({
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    const age = createAgeProcess();

    const report = await withRecoverySession(pool, async (session) => {
      const acceptedSet = await readStableAcceptedSet({
        store,
        age,
        identityFile: config.identityFile,
        macKeys: config.macKeys,
        staging: session,
        signal: abort.signal,
      });
      const reconciled = await session.reconcileAcceptedContacts();
      await session.proveExactRowsAfterCommit();

      return {
        status: 'passed' as const,
        startedAt,
        completedAt: new Date().toISOString(),
        resticSnapshotId,
        r2BucketJurisdiction: config.jurisdiction,
        r2LockRuleId: config.lockRuleId,
        acceptedSetCount: acceptedSet.watermark.count,
        acceptedSetSha256: acceptedSet.watermark.sha256,
        schemas: acceptedSet.watermark.schemas,
        keyIds: acceptedSet.watermark.keyIds,
        preExisting: reconciled.preExisting,
        inserted: reconciled.inserted,
        final: reconciled.final,
        pending: acceptedSet.pendingIntentCount,
        mismatch: 0 as const,
      } satisfies JournalRecoveryReport;
    });

    writePassedReport(config.reportDirectory, report);
  } finally {
    clearTimeout(timer);
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write('journal recovery failed\n');
  process.exit(1);
});
