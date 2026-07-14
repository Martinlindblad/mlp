import { runOperator, withMigrationTarget } from './operator-runtime';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mongoIdPattern = /^[0-9a-f]{24}$/i;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (
    args.length !== 1 ||
    mongoIdPattern.test(args[0] ?? '') ||
    !uuidPattern.test(args[0] ?? '')
  ) {
    throw new Error('exact synthetic UUID required');
  }
  const id = args[0] as string;
  await withMigrationTarget(async (target) => {
    const result = await target
      .deleteFrom('contact_messages')
      .where('id', '=', id)
      .executeTakeFirst();
    if (result.numDeletedRows !== BigInt(1)) {
      throw new Error('synthetic contact removal count invalid');
    }
  });
  process.stdout.write('synthetic contact removed\n');
}

runOperator(main, 'synthetic contact removal failed');
