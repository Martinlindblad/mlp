import { describe, expect, it, vi } from 'vitest';
import { createContactHandler } from '../../../server/api/contact-handler';
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
  it('calls the journal function with parameterized SQL', async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({ rows: [{ outcome: 'inserted' }] });
    const connect = vi.fn(
      (
        callback: (
          error: Error | undefined,
          client: { query: typeof query; release: typeof release },
        ) => void,
      ) => callback(undefined, { query, release }),
    );
    const repository = createContactRepository({ connect } as never);
    const message = {
      id: '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
      ...valid,
      createdAt: new Date('2026-07-14T12:00:00.000Z'),
      journalSchema: 'mlp.contact.v1' as const,
      journalKeyId: 'journal-2026-01',
      journalMac: 'ERERERERERERERERERERERERERERERERERERERERERE',
    };

    await expect(
      repository.ensureJournalContact(message, new AbortController().signal),
    ).resolves.toBe('inserted');

    expect(query).toHaveBeenCalledWith({
      text: expect.stringContaining('ensure_journal_contact'),
      values: [
        message.id,
        message.fullName,
        message.email,
        message.subject,
        message.message,
        message.createdAt,
        message.journalSchema,
        message.journalKeyId,
        message.journalMac,
      ],
    });
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('contact route', () => {
  it('limits parsed request bodies to 32kb', () => {
    expect(contactRouteConfig).toEqual({
      api: { bodyParser: { sizeLimit: '32kb' } },
    });
  });
});
