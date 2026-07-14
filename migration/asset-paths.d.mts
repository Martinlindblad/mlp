import type { MigrationIssue } from './errors';
import type { SourceCollection } from './source-collections';

export interface DatabaseAssetReference {
  collection: SourceCollection;
  id: string;
  path: string;
  url: string;
}

export function normalizeLocalAssetUrl(value: string): string;
export function assertExactPath(
  publicRoot: string,
  urlPath: string,
): Promise<string>;
export function collectTrackedLocalUrls(
  repositoryRoot: string,
): Promise<string[]>;
export function findGitCaseCollisions(
  repositoryRoot: string,
): Promise<string[][]>;
export function collectDatabaseAssetReferences(
  collection: SourceCollection,
  row: unknown,
): DatabaseAssetReference[];
export function findMissingAssetReferences(
  publicRoot: string,
  references: readonly DatabaseAssetReference[],
): Promise<MigrationIssue[]>;
