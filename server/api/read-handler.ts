import type { NextApiHandler } from 'next';
import { SERVICE_UNAVAILABLE } from './contracts';

export { SERVICE_UNAVAILABLE } from './contracts';

export function createReadHandler<T>(
  load: () => Promise<readonly T[]>,
): NextApiHandler {
  return async (_request, response) => {
    try {
      response.status(200).json(await load());
    } catch {
      response.status(503).json(SERVICE_UNAVAILABLE);
    }
  };
}
