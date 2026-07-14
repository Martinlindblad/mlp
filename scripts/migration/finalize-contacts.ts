import { importSnapshot } from '../../migration/importer';
import { captureSnapshot } from '../../migration/inventory';
import { withSourceDatabase } from '../../migration/mongo-client';
import { reportPath, writeReport } from '../../migration/report';
import { verifySnapshot } from '../../migration/verification';
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
  await withMigrationTarget(async (target) =>
    withSourceDatabase(async (source) => {
      const snapshot = await captureSnapshot(source, ['contact']);
      const migrated = await importSnapshot(target, snapshot);
      // Verification reads the complete destination contact table; there is no
      // implicit or undefined preload boundary.
      const validated = await verifySnapshot(target, snapshot, {
        publicRoot: migrationPublicRoot(),
      });
      await writeReport(reportPath(`${id}-contacts-migration.json`), migrated);
      await writeReport(
        reportPath(`${id}-contacts-validation.json`),
        validated,
      );
    }),
  );
}

runOperator(main, 'contact finalization failed');
