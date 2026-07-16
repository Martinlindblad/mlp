import { randomUUID } from 'node:crypto';
import { createContactHandler } from '../../../../server/api/contact-handler';
import { getDatabasePool } from '../../../../server/db/client';
import { createContactRepository } from '../../../../server/repositories/contact-repository';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

export default createContactHandler({
  insertContact: (message) =>
    createContactRepository(getDatabasePool()).insertContact(message),
  randomUUID,
  now: () => new Date(),
});
