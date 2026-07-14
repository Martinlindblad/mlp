import type { SourceCollection } from './source-collections';

export interface MigrationIssue {
  collection: SourceCollection;
  id: string;
  code:
    | 'unknown_field'
    | 'invalid_value'
    | 'duplicate_id'
    | 'hash_mismatch'
    | 'asset_missing';
  path: string;
}

export class MigrationValidationError extends Error {
  constructor(public readonly issues: readonly MigrationIssue[]) {
    super(`migration validation failed with ${issues.length} issue(s)`);
    this.name = 'MigrationValidationError';
  }
}
