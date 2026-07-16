import { captureSnapshot } from '../../migration/inventory';
import { withSourceDatabase } from '../../migration/mongo-client';
import { reportPath, writeReport } from '../../migration/report';
import { finalizeContactSnapshot } from '../../migration/verification';
import {
  migrationPublicRoot,
  runId,
  runOperator,
  withMigrationTarget,
} from './operator-runtime';

async function main(): Promise<void> {
  if (process.env.CONTACT_TRAFFIC_DRAINED !== 'yes') {
    throw new Error('contact traffic drain confirmation missing');
  }
  const id = runId();
  const snapshot = await withSourceDatabase((source) =>
    captureSnapshot(source, ['contact']),
  );
  await withMigrationTarget(async (target) => {
    // Import and complete-destination verification share one serializable
    // transaction. A mismatch throws before commit and rolls back inserts.
    const { migrated, validated } = await finalizeContactSnapshot(
      target,
      snapshot,
      {
        publicRoot: migrationPublicRoot(),
      },
    );
    await writeReport(reportPath(`${id}-contacts-migration.json`), migrated);
    await writeReport(reportPath(`${id}-contacts-validation.json`), validated);
  });
}

runOperator(main, 'contact finalization failed');
