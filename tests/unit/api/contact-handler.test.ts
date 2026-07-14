import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { createContactHandler } from '../../../server/api/contact-handler';
import type { Database } from '../../../server/db/database.types';
import { createContactRepository } from '../../../server/repositories/contact-repository';
import { config as contactRouteConfig } from '../../../src/pages/api/contact/route';
import { createMockRequest, createMockResponse } from '../../helpers/next-api';

const valid = {
  fullName: 'Martin Lindblad',
  email: 'martin@example.com',
  subject: 'Hello',
  message: 'Test message',
};

describe('contact handler', () => {
  it('preserves method, validation, success, and unavailable responses', async () => {
    const insertContact = vi.fn().mockResolvedValue(undefined);
    const handler = createContactHandler({
      insertContact,
      randomUUID: () => '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    });

    const method = createMockResponse();
    await handler(createMockRequest({ method: 'GET' }), method);
    expect([method.statusCode, method.payload]).toEqual([
      405,
      { errorMessage: 'Method Not Allowed' },
    ]);

    const invalid = createMockResponse();
    await handler(
      createMockRequest({ method: 'POST', body: { ...valid, email: '' } }),
      invalid,
    );
    expect([invalid.statusCode, invalid.payload]).toEqual([
      400,
      { errorMessage: 'Missing fields', success: false },
    ]);

    const success = createMockResponse();
    await handler(createMockRequest({ method: 'POST', body: valid }), success);
    expect([success.statusCode, success.payload]).toEqual([
      201,
      { successMessage: 'Message sent successfully', success: true },
    ]);
    expect(insertContact).toHaveBeenCalledWith({
      id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
      ...valid,
      createdAt: new Date('2026-07-14T12:00:00.000Z'),
    });

    insertContact.mockRejectedValueOnce(new Error('postgres host secret'));
    const unavailable = createMockResponse();
    await handler(
      createMockRequest({ method: 'POST', body: valid }),
      unavailable,
    );
    expect([unavailable.statusCode, unavailable.payload]).toEqual([
      503,
      { errorMessage: 'Unable to send message.', success: false },
    ]);
    expect(JSON.stringify(unavailable.payload)).not.toContain(
      'postgres host secret',
    );
  });

  it('rejects unexpected or whitespace-only fields without persisting', async () => {
    const insertContact = vi.fn().mockResolvedValue(undefined);
    const handler = createContactHandler({
      insertContact,
      randomUUID: () => 'unused',
      now: () => new Date(0),
    });

    for (const body of [
      { ...valid, fullName: ' ' },
      { ...valid, unexpected: 'field' },
    ]) {
      const response = createMockResponse();
      await handler(createMockRequest({ method: 'POST', body }), response);
      expect([response.statusCode, response.payload]).toEqual([
        400,
        { errorMessage: 'Missing fields', success: false },
      ]);
    }

    expect(insertContact).not.toHaveBeenCalled();
  });
});

describe('contact repository', () => {
  it('maps a contact message to the PostgreSQL columns', async () => {
    const executeTakeFirstOrThrow = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ executeTakeFirstOrThrow }));
    const insertInto = vi.fn(() => ({ values }));
    const repository = createContactRepository({
      insertInto,
    } as unknown as Kysely<Database>);
    const message = {
      id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
      ...valid,
      createdAt: new Date('2026-07-14T12:00:00.000Z'),
    };

    await repository.insertContact(message);

    expect(insertInto).toHaveBeenCalledWith('contact_messages');
    expect(values).toHaveBeenCalledWith({
      id: message.id,
      full_name: message.fullName,
      email: message.email,
      subject: message.subject,
      message: message.message,
      created_at: message.createdAt,
    });
    expect(executeTakeFirstOrThrow).toHaveBeenCalledOnce();
  });
});

describe('contact route', () => {
  it('limits parsed request bodies to 32kb', () => {
    expect(contactRouteConfig).toEqual({
      api: { bodyParser: { sizeLimit: '32kb' } },
    });
  });
});
