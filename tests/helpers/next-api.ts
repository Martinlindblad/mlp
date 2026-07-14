import type { NextApiRequest, NextApiResponse } from 'next';

export type MockNextResponse = NextApiResponse & {
  statusCode: number;
  payload: unknown;
  headers: Record<string, string | number | readonly string[]>;
};

export function createMockRequest(
  overrides: Partial<NextApiRequest> = {},
): NextApiRequest {
  return {
    method: 'GET',
    body: undefined,
    query: {},
    cookies: {},
    headers: {},
    ...overrides,
  } as NextApiRequest;
}

export function createMockResponse(): MockNextResponse {
  const response = {
    statusCode: 200,
    payload: undefined,
    headers: {},
    status(this: MockNextResponse, code: number) {
      this.statusCode = code;
      return this;
    },
    json(this: MockNextResponse, value: unknown) {
      this.payload = value;
      return this;
    },
    send(this: MockNextResponse, value: unknown) {
      this.payload = value;
      return this;
    },
    end(this: MockNextResponse, value?: unknown) {
      this.payload = value;
      return this;
    },
    setHeader(
      this: MockNextResponse,
      name: string,
      value: string | number | readonly string[],
    ) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(this: MockNextResponse, name: string) {
      return this.headers[name.toLowerCase()];
    },
  } as unknown as MockNextResponse;

  return response;
}
