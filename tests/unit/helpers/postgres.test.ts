import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  destroy: vi.fn(),
  createDatabase: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class {
    connect = doubles.connect;

    query = doubles.query;

    end = doubles.end;
  },
}));

vi.mock('../../../server/db/client', () => ({
  createDatabase: doubles.createDatabase,
}));

import { createIsolatedDatabase } from '../../helpers/postgres';

const originalDatabaseUrl = process.env.TEST_DATABASE_URL;

describe('isolated PostgreSQL cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TEST_DATABASE_URL = 'postgres://tester@127.0.0.1:5432/postgres';
    doubles.connect.mockResolvedValue(undefined);
    doubles.query.mockResolvedValue({ rows: [] });
    doubles.end.mockResolvedValue(undefined);
    doubles.destroy.mockResolvedValue(undefined);
    doubles.createDatabase.mockReturnValue({ destroy: doubles.destroy });
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.TEST_DATABASE_URL;
    } else {
      process.env.TEST_DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('preserves a startup error while attempting every cleanup step', async () => {
    const startupError = new Error('startup failed');
    const cleanupError = new Error('database cleanup failed');
    doubles.createDatabase.mockImplementationOnce(() => {
      throw startupError;
    });
    doubles.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(cleanupError);
    doubles.end.mockRejectedValueOnce(new Error('maintenance end failed'));

    await expect(createIsolatedDatabase().start()).rejects.toBe(startupError);

    expect(
      doubles.query.mock.calls.some(([statement]) =>
        String(statement).startsWith('drop database if exists'),
      ),
    ).toBe(true);
    expect(doubles.end).toHaveBeenCalledOnce();
  });

  it('preserves a destroy error while attempting database and client cleanup', async () => {
    const isolated = createIsolatedDatabase();
    await isolated.start();

    const destroyError = new Error('pool destroy failed');
    doubles.destroy.mockRejectedValueOnce(destroyError);
    doubles.query.mockRejectedValueOnce(new Error('database cleanup failed'));
    doubles.end.mockRejectedValueOnce(new Error('maintenance end failed'));

    await expect(isolated.stop()).rejects.toBe(destroyError);

    expect(
      doubles.query.mock.calls.some(([statement]) =>
        String(statement).startsWith('drop database if exists'),
      ),
    ).toBe(true);
    expect(doubles.end).toHaveBeenCalledOnce();
  });
});
