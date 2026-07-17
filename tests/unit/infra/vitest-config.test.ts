import { describe, expect, it } from 'vitest';
import config from '../../../vitest.config';

describe('vitest config', () => {
  it('excludes ignored local worktrees without removing Vitest defaults', () => {
    const configObject = config as {
      test?: { exclude?: string[] };
    };

    expect(configObject.test?.exclude).toEqual(
      expect.arrayContaining([
        '**/node_modules/**',
        '**/.git/**',
        '**/.worktrees/**',
      ]),
    );
  });
});
