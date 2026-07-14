import type { NextApiHandler } from 'next';

const handler: NextApiHandler = (_request, response) =>
  response.status(200).json({ status: 'ok' });

export default handler;
