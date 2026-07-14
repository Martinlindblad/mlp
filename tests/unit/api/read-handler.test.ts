import { describe, expect, it } from 'vitest';
import {
  createReadHandler,
  SERVICE_UNAVAILABLE,
} from '../../../server/api/read-handler';
import { createMockRequest, createMockResponse } from '../../helpers/next-api';

describe('read handler', () => {
  it('returns loaded legacy values', async () => {
    const handler = createReadHandler(async () => [
      { _id: '64b000000000000000000001' },
    ]);
    const response = createMockResponse();

    await handler(createMockRequest(), response);

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual([{ _id: '64b000000000000000000001' }]);
  });

  it('hides database errors behind a generic 503', async () => {
    const handler = createReadHandler(async () => {
      throw new Error('password=secret');
    });
    const response = createMockResponse();

    await handler(createMockRequest(), response);

    expect(response.statusCode).toBe(503);
    expect(response.payload).toEqual(SERVICE_UNAVAILABLE);
    expect(JSON.stringify(response.payload)).not.toContain('secret');
  });
});
