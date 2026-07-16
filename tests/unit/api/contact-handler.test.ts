import { describe, expect, it, vi } from 'vitest';
import { createContactHandler } from '../../../server/api/contact-handler';
import {
  ContactConflictError,
  ContactUnavailableError,
} from '../../../server/journal/contact-journal';
import { createContactRepository } from '../../../server/repositories/contact-repository';
import { config as contactRouteConfig } from '../../../src/pages/api/contact/route';
import { createMockRequest, createMockResponse } from '../../helpers/next-api';

const valid = {
  fullName: 'Martin Lindblad',
  email: 'martin@example.com',
  subject: 'Hello',
  message: 'Test message',
};
const generatedKey = '71eb8a54-d43b-45d5-9ea7-77b5834eeed3';
const validHeader = '81eb8a54-d43b-45d5-9ea7-77b5834eeed3';

describe('contact handler', () => {
  it('preserves method, validation, success, and unavailable responses', async () => {
    const acceptContact = vi.fn().mockResolvedValue(undefined);
    const handler = createContactHandler({
      acceptContact,
      randomUUID: () => generatedKey,
    });

    const method = createMockResponse();
    await handler(createMockRequest({ method: 'GET' }), method);
    expect([method.statusCode, method.payload]).toEqual([
      405,
      { errorMessage: 'Method Not Allowed' },
    ]);
    expect(method.getHeader('Idempotency-Key')).toBeUndefined();

    const invalid = createMockResponse();
    await handler(
      createMockRequest({ method: 'POST', body: { ...valid, email: '' } }),
      invalid,
    );
    expect([invalid.statusCode, invalid.payload]).toEqual([
      400,
      { errorMessage: 'Missing fields', success: false },
    ]);
    expect(invalid.getHeader('Idempotency-Key')).toBe(generatedKey);
    expect(acceptContact).not.toHaveBeenCalled();

    const success = createMockResponse();
    await handler(createMockRequest({ method: 'POST', body: valid }), success);
    expect([success.statusCode, success.payload]).toEqual([
      201,
      { successMessage: 'Message sent successfully', success: true },
    ]);
    expect(success.getHeader('Idempotency-Key')).toBe(generatedKey);
    expect(acceptContact).toHaveBeenCalledWith(
      {
        id: generatedKey,
        ...valid,
      },
      expect.any(AbortSignal),
    );

    acceptContact.mockRejectedValueOnce(new Error('postgres host secret'));
    const unavailable = createMockResponse();
    await handler(
      createMockRequest({ method: 'POST', body: valid }),
      unavailable,
    );
    expect([unavailable.statusCode, unavailable.payload]).toEqual([
      503,
      { errorMessage: 'Unable to send message.', success: false },
    ]);
    expect(unavailable.getHeader('Idempotency-Key')).toBe(generatedKey);
    expect(JSON.stringify(unavailable.payload)).not.toContain(
      'postgres host secret',
    );
  });

  it('preserves one canonical idempotency header and passes normalized body', async () => {
    const acceptContact = vi.fn().mockResolvedValue(undefined);
    const randomUUID = vi.fn(() => generatedKey);
    const handler = createContactHandler({
      acceptContact,
      randomUUID,
    });

    const response = createMockResponse();
    await handler(
      createMockRequest({
        method: 'POST',
        headers: { 'idempotency-key': validHeader },
        body: {
          fullName: ' Martin Lindblad ',
          email: ' martin@example.com ',
          subject: ' Hello ',
          message: ' Test message ',
        },
      }),
      response,
    );

    expect(response.statusCode).toBe(201);
    expect(response.getHeader('Idempotency-Key')).toBe(validHeader);
    expect(randomUUID).not.toHaveBeenCalled();
    expect(acceptContact).toHaveBeenCalledWith(
      {
        id: validHeader,
        fullName: 'Martin Lindblad',
        email: 'martin@example.com',
        subject: 'Hello',
        message: 'Test message',
      },
      expect.any(AbortSignal),
    );
  });

  it('rejects malformed idempotency keys without journal access or response echo', async () => {
    const acceptContact = vi.fn().mockResolvedValue(undefined);
    const handler = createContactHandler({
      acceptContact,
      randomUUID: () => generatedKey,
    });

    for (const header of [
      [validHeader],
      `${validHeader},${validHeader}`,
      ` ${validHeader} `,
      validHeader.toUpperCase(),
      '71eb8a54-d43b-55d5-9ea7-77b5834eeed3',
      'not-a-uuid',
    ]) {
      const response = createMockResponse();
      await handler(
        createMockRequest({
          method: 'POST',
          headers: { 'idempotency-key': header },
          body: valid,
        }),
        response,
      );
      expect([response.statusCode, response.payload]).toEqual([
        400,
        { errorMessage: 'Missing fields', success: false },
      ]);
      expect(response.getHeader('Idempotency-Key')).toBeUndefined();
    }

    expect(acceptContact).not.toHaveBeenCalled();
  });

  it('maps journal conflicts to 409 and unavailable paths to the exact 503 body', async () => {
    const acceptContact = vi.fn().mockRejectedValueOnce(
      new ContactConflictError(),
    );
    const handler = createContactHandler({
      acceptContact,
      randomUUID: () => generatedKey,
    });

    const conflict = createMockResponse();
    await handler(createMockRequest({ method: 'POST', body: valid }), conflict);
    expect([conflict.statusCode, conflict.payload]).toEqual([
      409,
      { errorMessage: 'Unable to send message.', success: false },
    ]);
    expect(conflict.getHeader('Idempotency-Key')).toBe(generatedKey);

    for (const error of [
      new ContactUnavailableError('intent_failure'),
      new ContactUnavailableError('marker_failure'),
      new Error('sentinel storage secret'),
    ]) {
      acceptContact.mockRejectedValueOnce(error);
      const unavailable = createMockResponse();
      await handler(
        createMockRequest({ method: 'POST', body: valid }),
        unavailable,
      );
      expect([unavailable.statusCode, unavailable.payload]).toEqual([
        503,
        { errorMessage: 'Unable to send message.', success: false },
      ]);
      expect(unavailable.getHeader('Idempotency-Key')).toBe(generatedKey);
      expect(JSON.stringify(unavailable.payload)).not.toContain('sentinel');
    }
  });

  it('rejects unexpected or whitespace-only fields without persisting', async () => {
    const acceptContact = vi.fn().mockResolvedValue(undefined);
    const handler = createContactHandler({
      acceptContact,
      randomUUID: () => generatedKey,
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
      expect(response.getHeader('Idempotency-Key')).toBe(generatedKey);
    }

    expect(acceptContact).not.toHaveBeenCalled();
  });

  it('aborts journal work after 20 seconds and clears the timer', async () => {
    vi.useFakeTimers();
    try {
      const acceptContact = vi.fn(
        (_input: unknown, signal: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new Error('sentinel timeout secret')),
              { once: true },
            );
          }),
      );
      const handler = createContactHandler({
        acceptContact,
        randomUUID: () => generatedKey,
      });
      const response = createMockResponse();
      const pending = handler(
        createMockRequest({ method: 'POST', body: valid }),
        response,
      );

      const signal = acceptContact.mock.calls[0]?.[1] as AbortSignal;
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(20_000);
      await pending;

      expect(signal.aborted).toBe(true);
      expect([response.statusCode, response.payload]).toEqual([
        503,
        { errorMessage: 'Unable to send message.', success: false },
      ]);
      expect(JSON.stringify(response.payload)).not.toContain('sentinel');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the deadline timer after successful completion', async () => {
    vi.useFakeTimers();
    try {
      const acceptContact = vi.fn().mockResolvedValue(undefined);
      const handler = createContactHandler({
        acceptContact,
        randomUUID: () => generatedKey,
      });
      const response = createMockResponse();

      await handler(createMockRequest({ method: 'POST', body: valid }), response);

      expect(response.statusCode).toBe(201);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
