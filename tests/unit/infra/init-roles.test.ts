import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PostgreSQL role bootstrap', () => {
  it('wraps role creation and grants in one transaction', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '../../../infra/postgres/init-roles.sh'),
      'utf8',
    );
    const sqlBody = script.match(/<<'SQL'\n([\s\S]*?)\nSQL/)?.[1];

    expect(sqlBody).toBeDefined();
    const begin = sqlBody?.indexOf('begin;') ?? -1;
    const createRole = sqlBody?.indexOf('create role portfolio_app') ?? -1;
    const grant = sqlBody?.indexOf('grant connect on database') ?? -1;
    const commit = sqlBody?.indexOf('commit;') ?? -1;

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(createRole).toBeGreaterThan(begin);
    expect(grant).toBeGreaterThan(createRole);
    expect(commit).toBeGreaterThan(grant);
  });
});
