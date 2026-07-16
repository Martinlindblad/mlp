import { captureSnapshot, inventorySource } from '../../migration/inventory';
import { withSourceDatabase } from '../../migration/mongo-client';
import { reportPath, writeReport } from '../../migration/report';
import {
  SOURCE_COLLECTIONS,
  type SourceCollection,
} from '../../migration/source-collections';
import { finalizeSnapshot } from '../../migration/verification';
import {
  migrationPublicRoot,
  runId,
  runOperator,
  withMigrationTarget,
} from './operator-runtime';

async function main(): Promise<void> {
  const id = runId();
  const collections = Object.keys(SOURCE_COLLECTIONS) as SourceCollection[];
  await withMigrationTarget(async (target) =>
    withSourceDatabase(async (source) => {
      // Inventory and snapshot are separate discovery reads. Final contact
      // capture is only valid after traffic has been drained.
      const inventory = await inventorySource(source);
      const snapshot = await captureSnapshot(source, collections);
      const { migrated, validated } = await finalizeSnapshot(target, snapshot, {
        publicRoot: migrationPublicRoot(),
      });
      await writeReport(reportPath(`${id}-inventory.json`), inventory);
      await writeReport(reportPath(`${id}-migration.json`), migrated);
      await writeReport(reportPath(`${id}-validation.json`), validated);
    }),
  );
}

runOperator(main, 'migration rehearsal failed');
