import type { NextApiHandler } from 'next';
import { getDatabase } from '../../../../server/db/client';
import { checkReadiness } from '../../../../server/health/readiness';

const handler: NextApiHandler = async (_request, response) => {
  let ready = false;
  try {
    ready = await checkReadiness(getDatabase(), '002_runtime_grants');
  } catch {
    ready = false;
  }

  response
    .status(ready ? 200 : 503)
    .json({ status: ready ? 'ready' : 'unavailable' });
};

export default handler;
