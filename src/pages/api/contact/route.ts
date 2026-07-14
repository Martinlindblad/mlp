import { randomUUID } from 'node:crypto';
import { createContactHandler } from '../../../../server/api/contact-handler';
import { getDatabase } from '../../../../server/db/client';
import { createContactRepository } from '../../../../server/repositories/contact-repository';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

export default createContactHandler({
  insertContact: (message) =>
    createContactRepository(getDatabase()).insertContact(message),
  randomUUID,
  now: () => new Date(),
});
