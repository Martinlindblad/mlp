import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const runbookPath = path.join(
  repositoryRoot,
  'runbooks/postgresql-disaster-recovery.md',
);

test('PostgreSQL recovery requires an exact proven snapshot and full security validation', async () => {
  const source = await readFile(runbookPath, 'utf8');

  assert.match(source, /64-character lowercase hexadecimal snapshot ID/iu);
  assert.match(
    source,
    /\/var\/lib\/mlp\/backup-reports\/latest-success\.json/u,
  );
  assert.match(source, /\/usr\/local\/sbin\/mlp-restore-test/u);
  assert.match(source, /ten application tables/iu);
  assert.match(source, /twelve tables are owned by `portfolio_migrator`/iu);
  assert.match(source, /002_runtime_grants/u);
  assert.match(source, /complete table ACL privilege matrix/iu);
  assert.match(source, /all nine content tables are populated/iu);
  assert.match(source, /representative contact insert[\s\S]*rolled back/iu);
  assert.match(
    source,
    /\/var\/lib\/mlp\/restore-reports\/latest-success\.json/u,
  );
});

test('PostgreSQL recovery preserves evidence and forbids stale-origin rollback after writes', async () => {
  const source = await readFile(runbookPath, 'utf8');

  assert.match(source, /preserve[\s\S]*restore-work\/<run-id>/iu);
  assert.match(
    source,
    /never remove an unlabeled or[\s\S]*mismatched resource/iu,
  );
  assert.match(
    source,
    /After that point, stale MongoDB[\s\S]*not a recovery target/iu,
  );
  assert.match(source, /second operator/iu);

  for (const destructivePattern of [
    /drop\s+database/iu,
    /compose\s+down[^\n]*-v/iu,
    /docker\s+volume\s+rm/iu,
    /restic\s+restore\s+latest/iu,
    /restic\s+unlock/iu,
    /rm\s+-[A-Za-z]*r[A-Za-z]*f/iu,
  ]) {
    assert.doesNotMatch(source, destructivePattern);
  }
});
