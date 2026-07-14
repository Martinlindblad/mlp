import type { Kysely } from 'kysely';
import type { Database } from '../db/database.types';

export interface NewContactMessage {
  id: string;
  fullName: string;
  email: string;
  subject: string;
  message: string;
  createdAt: Date;
}

export interface ContactRepository {
  insertContact(message: NewContactMessage): Promise<void>;
}

export function createContactRepository(
  db: Kysely<Database>,
): ContactRepository {
  return {
    async insertContact(message) {
      await db
        .insertInto('contact_messages')
        .values({
          id: message.id,
          full_name: message.fullName,
          email: message.email,
          subject: message.subject,
          message: message.message,
          created_at: message.createdAt,
        })
        .executeTakeFirstOrThrow();
    },
  };
}
