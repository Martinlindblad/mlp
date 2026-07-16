import { randomUUID } from 'node:crypto';
import {
  createContactHandler,
  type ContactSubmission,
} from '../../../../server/api/contact-handler';
import { getDatabasePool } from '../../../../server/db/client';
import { createAgeProcess } from '../../../../server/journal/age-process';
import { loadJournalWriterConfig } from '../../../../server/journal/config';
import {
  createContactJournal,
  type ContactJournal,
} from '../../../../server/journal/contact-journal';
import { createJournalObjectStore } from '../../../../server/journal/r2-store';
import { createContactRepository } from '../../../../server/repositories/contact-repository';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

let journalSingleton: ContactJournal | undefined;

function getContactJournal(): ContactJournal {
  if (!journalSingleton) {
    const writerConfig = loadJournalWriterConfig(process.env);
    journalSingleton = createContactJournal({
      store: createJournalObjectStore(writerConfig),
      age: createAgeProcess(),
      contacts: createContactRepository(getDatabasePool()),
      activeKeyId: writerConfig.activeKeyId,
      ageRecipient: writerConfig.ageRecipient,
      macKeys: writerConfig.macKeys,
      now: () => new Date(),
      emitMetricLine: (line) => {
        process.stdout.write(line);
      },
    });
  }

  return journalSingleton;
}

export default createContactHandler({
  acceptContact: async (input: ContactSubmission, signal: AbortSignal) => {
    await getContactJournal().accept(input, signal);
  },
  randomUUID,
});
