import { importSnapshot } from '../../migration/importer';
import { captureSnapshot } from '../../migration/inventory';
import { withSourceDatabase } from '../../migration/mongo-client';
import { reportPath, writeReport } from '../../migration/report';
import { CONTENT_COLLECTIONS } from '../../migration/source-collections';
import { verifySnapshot } from '../../migration/verification';
import {
  migrationPublicRoot,
  runId,
  runOperator,
  withMigrationTarget,
} from './operator-runtime';

async function main(): Promise<void> {
  const id = runId();
  await withMigrationTarget(async (target) =>
    withSourceDatabase(async (source) => {
      const snapshot = await captureSnapshot(source, CONTENT_COLLECTIONS);
      const migrated = await importSnapshot(target, snapshot);
      const validated = await verifySnapshot(target, snapshot, {
        publicRoot: migrationPublicRoot(),
      });
      await writeReport(reportPath(`${id}-preload-migration.json`), migrated);
      await writeReport(reportPath(`${id}-preload-validation.json`), validated);
    }),
  );
}

runOperator(main, 'content preload failed');
