import { chmod, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { MigrationReport } from './importer';
import type { SourceInventory } from './inventory';
import type { ValidationReport } from './verification';

const sourceCollectionNames = [
  'about',
  'current_occupation',
  'hobbys',
  'languages',
  'page_cards',
  'proffessional_timeline',
  'projects_and_cases',
  'pursuit',
  'social_media',
  'contact',
] as const;

const isoTimestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const sourceId = z.string().regex(/^[0-9a-f]{24}$/);
const indexDirection = z.union([
  z.literal(1),
  z.literal(-1),
  z.literal('text'),
  z.literal('hashed'),
]);
function requireSortedMatchingIds(
  value: { count: number; ids: string[] },
  context: z.core.$RefinementCtx,
): void {
  const sortedUnique = value.ids.every(
    (id, index) => index === 0 || (value.ids[index - 1] ?? '') < id,
  );
  if (value.count !== value.ids.length || !sortedUnique) {
    context.addIssue({
      code: 'custom',
      message: 'invalid report identifiers',
      path: ['ids'],
      input: value.ids,
    });
  }
}
const inventoryCollection = z
  .object({
    count: z.number().int().nonnegative(),
    ids: z.array(sourceId),
    keys: z.array(z.string()),
    bsonTypes: z.record(z.string(), z.array(z.string())),
    indexes: z.array(
      z
        .object({
          name: z.string(),
          keys: z.record(z.string(), indexDirection),
          unique: z.boolean(),
        })
        .strict(),
    ),
    validatorHash: sha256,
  })
  .strict()
  .superRefine(requireSortedMatchingIds);
const inventorySchema = z
  .object({
    generatedAt: isoTimestamp,
    collections: z
      .object(
        Object.fromEntries(
          sourceCollectionNames.map((name) => [name, inventoryCollection]),
        ) as Record<
          (typeof sourceCollectionNames)[number],
          typeof inventoryCollection
        >,
      )
      .strict(),
  })
  .strict();
const migrationCollection = z
  .object({
    count: z.number().int().nonnegative(),
    ids: z.array(sourceId),
    canonicalHash: sha256,
  })
  .strict()
  .superRefine(requireSortedMatchingIds);
const migrationSchema = z
  .object({
    generatedAt: isoTimestamp,
    collections: z
      .object(
        Object.fromEntries(
          sourceCollectionNames.map((name) => [
            name,
            migrationCollection.optional(),
          ]),
        ) as Record<
          (typeof sourceCollectionNames)[number],
          z.ZodOptional<typeof migrationCollection>
        >,
      )
      .partial()
      .strict(),
  })
  .strict();
const validationCollection = z
  .object({
    sourceCount: z.number().int().nonnegative(),
    destinationCount: z.number().int().nonnegative(),
    idsMatch: z.literal(true),
    timestampsMatch: z.literal(true),
    hashMatch: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceCount !== value.destinationCount) {
      context.addIssue({
        code: 'custom',
        message: 'invalid validation comparison',
        path: ['destinationCount'],
        input: value.destinationCount,
      });
    }
  });
const validationSchema = z
  .object({
    valid: z.literal(true),
    generatedAt: isoTimestamp,
    collections: z
      .object(
        Object.fromEntries(
          sourceCollectionNames.map((name) => [
            name,
            validationCollection.optional(),
          ]),
        ) as Record<
          (typeof sourceCollectionNames)[number],
          z.ZodOptional<typeof validationCollection>
        >,
      )
      .partial()
      .strict(),
  })
  .strict();
const reportSchema = z.union([
  inventorySchema,
  migrationSchema,
  validationSchema,
]);
const sensitivePattern =
  /mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|"(?:password|token|uri)"\s*:|PII_|FIXTURE/i;

export type ReportPayload =
  | SourceInventory
  | MigrationReport
  | ValidationReport;

export interface ReportFileHandle {
  writeFile(value: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface ReportFileOperations {
  open(filePath: string, flags: 'wx', mode: number): Promise<ReportFileHandle>;
  unlink(filePath: string): Promise<void>;
}

const defaultFileOperations: ReportFileOperations = { open, unlink };

function rootPath(): string {
  return path.resolve(
    process.env.MIGRATION_REPORT_ROOT ?? 'migration-artifacts/reports',
  );
}

export function reportPath(fileName: string): string {
  if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(fileName)) {
    throw new Error('invalid report filename');
  }
  return path.join(rootPath(), fileName);
}

function isMissingPath(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function assertDirectoryPathHasNoSymlinks(
  target: string,
  allowMissing: boolean,
): Promise<void> {
  const parsed = path.parse(target);
  const segments = target
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = parsed.root;
  const paths = [current];
  for (const segment of segments) {
    current = path.join(current, segment);
    paths.push(current);
  }

  for (const candidate of paths) {
    let details;
    try {
      details = await lstat(candidate);
    } catch (error) {
      if (allowMissing && isMissingPath(error)) return;
      throw error;
    }
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error('unsafe report directory');
    }
  }
}

async function ensureSafeRoot(root: string): Promise<void> {
  try {
    await assertDirectoryPathHasNoSymlinks(root, true);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await assertDirectoryPathHasNoSymlinks(root, false);
    if ((await realpath(root)) !== root) {
      throw new Error('non-canonical report root');
    }
    await chmod(root, 0o700);
    await assertDirectoryPathHasNoSymlinks(root, false);
    if ((await realpath(root)) !== root) {
      throw new Error('non-canonical report root');
    }
  } catch {
    throw new Error('report path rejected');
  }
}

export async function writeReport(
  filePath: string,
  value: ReportPayload,
  fileOperations: ReportFileOperations = defaultFileOperations,
): Promise<void> {
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) throw new Error('invalid report payload');
  const json = `${JSON.stringify(parsed.data, null, 2)}\n`;
  if (sensitivePattern.test(json)) throw new Error('invalid report payload');

  const root = rootPath();
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== root) throw new Error('report path rejected');
  await ensureSafeRoot(root);

  let handle: ReportFileHandle | undefined;
  let targetCreated = false;
  try {
    const [actualRoot, actualParent] = await Promise.all([
      realpath(root),
      realpath(path.dirname(resolved)),
    ]);
    if (actualRoot !== root || actualRoot !== actualParent) {
      throw new Error('outside root');
    }
    handle = await fileOperations.open(resolved, 'wx', 0o600);
    targetCreated = true;
    await handle.writeFile(json);
    await handle.close();
    handle = undefined;
  } catch {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Continue to the unlink attempt; the error returned is always redacted.
      }
    }
    if (targetCreated) {
      try {
        await fileOperations.unlink(resolved);
      } catch {
        // Cleanup was attempted; never include the filesystem error in output.
      }
    }
    throw new Error('report write failed');
  }
}
