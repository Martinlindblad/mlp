import { describe, expect, it } from 'vitest';
import {
  contactPayloadJson,
  selectAttempt,
  type ContactFormValues,
} from '../../../src/contact/idempotency';

const values: ContactFormValues = {
  fullName: ' Martin Lindblad ',
  email: ' martin@example.com ',
  subject: ' Hello ',
  message: ' Message ',
};

describe('contact idempotency key selection', () => {
  it('serializes trimmed fields in a deterministic order', () => {
    expect(contactPayloadJson(values)).toBe(
      '{"fullName":"Martin Lindblad","email":"martin@example.com","subject":"Hello","message":"Message"}',
    );
  });

  it('reuses a key only while the normalized payload is unchanged', () => {
    const first = selectAttempt(null, values, () =>
      '71eb8a54-d43b-45d5-9ea7-77b5834eeed3',
    );
    const reused = selectAttempt(first, { ...values }, () => {
      throw new Error('must not generate');
    });
    const changed = selectAttempt(
      first,
      { ...values, message: 'Changed' },
      () => '81eb8a54-d43b-45d5-9ea7-77b5834eeed3',
    );

    expect(reused).toBe(first);
    expect(changed).toEqual({
      key: '81eb8a54-d43b-45d5-9ea7-77b5834eeed3',
      canonicalPayload:
        '{"fullName":"Martin Lindblad","email":"martin@example.com","subject":"Hello","message":"Changed"}',
    });
  });

  it.each([
    '71eb8a54-d43b-55d5-9ea7-77b5834eeed3',
    '71EB8A54-D43B-45D5-9EA7-77B5834EEED3',
    'not-a-uuid',
  ])('rejects non-canonical randomUUID output %s', (key) => {
    expect(() => selectAttempt(null, values, () => key)).toThrow(
      'invalid contact idempotency key',
    );
  });
});
