import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgeProcess } from '../../../server/journal/age-process';

const fixturePath = join(process.cwd(), 'tests/fixtures/fake-age.mjs');
const AGE_RECIPIENT = 'age1testrecipient';
const IDENTITY_FILE = '/run/secrets/journal-age-identity';

chmodSync(fixturePath, 0o755);

function createTestAgeProcess(options?: {
  operationTimeoutMs?: number;
  killAfterMs?: number;
  ciphertextLimitBytes?: number;
  plaintextLimitBytes?: number;
}) {
  return createAgeProcess({
    executable: fixturePath,
    operationTimeoutMs: 500,
    killAfterMs: 100,
    ciphertextLimitBytes: 65_536,
    plaintextLimitBytes: 32_768,
    ...options,
  });
}

async function expectUnavailable(
  promise: Promise<Buffer>,
  message: string,
  forbidden: string[],
) {
  let thrown: unknown;

  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  const actual = (thrown as Error).message;
  expect(actual).toBe(message);
  for (const value of forbidden) {
    expect(actual).not.toContain(value);
  }
}

describe('age process adapter', () => {
  it('encrypts with exact argv and stdin/stdout pipes', async () => {
    const age = createTestAgeProcess();

    await expect(
      age.encrypt(
        Buffer.from('canonical'),
        AGE_RECIPIENT,
        new AbortController().signal,
      ),
    ).resolves.toEqual(
      Buffer.from(`encrypt:--encrypt|--recipient|${AGE_RECIPIENT}:canonical`),
    );
  });

  it('decrypts with exact argv and stdin/stdout pipes', async () => {
    const age = createTestAgeProcess();

    await expect(
      age.decrypt(
        Buffer.from('ciphertext'),
        IDENTITY_FILE,
        new AbortController().signal,
      ),
    ).resolves.toEqual(
      Buffer.from(`decrypt:--decrypt|--identity|${IDENTITY_FILE}:ciphertext`),
    );
  });

  it('returns fixed encryption errors without stderr, plaintext, or recipient values', async () => {
    const age = createTestAgeProcess();

    await expectUnavailable(
      age.encrypt(
        Buffer.from('canonical plaintext'),
        'age1failrecipient',
        new AbortController().signal,
      ),
      'journal encryption unavailable',
      ['canonical plaintext', 'martin@example.com', 'age1failrecipient'],
    );
  });

  it('returns fixed decryption errors without stderr, ciphertext, or identity values', async () => {
    const age = createTestAgeProcess();

    await expectUnavailable(
      age.decrypt(
        Buffer.from('ciphertext secret'),
        '/tmp/identity-fail',
        new AbortController().signal,
      ),
      'journal decryption unavailable',
      ['ciphertext secret', 'martin@example.com', '/tmp/identity-fail'],
    );
  });

  it('rejects missing executables with fixed errors', async () => {
    const age = createAgeProcess({
      executable: '/no/such/age',
      operationTimeoutMs: 100,
      killAfterMs: 100,
    });

    await expectUnavailable(
      age.encrypt(
        Buffer.from('canonical'),
        AGE_RECIPIENT,
        new AbortController().signal,
      ),
      'journal encryption unavailable',
      ['/no/such/age', AGE_RECIPIENT, 'canonical'],
    );
  });

  it('rejects timeout and forced kill without leaking values', async () => {
    const age = createTestAgeProcess({
      operationTimeoutMs: 50,
      killAfterMs: 50,
    });
    const startedAt = Date.now();

    await expectUnavailable(
      age.encrypt(
        Buffer.from('canonical timeout'),
        'age1ignore-term',
        new AbortController().signal,
      ),
      'journal encryption unavailable',
      ['canonical timeout', 'age1ignore-term'],
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('rejects output-size overflow during streaming', async () => {
    const age = createTestAgeProcess({ ciphertextLimitBytes: 32 });

    await expectUnavailable(
      age.encrypt(
        Buffer.from('canonical'),
        'age1overflow',
        new AbortController().signal,
      ),
      'journal encryption unavailable',
      ['canonical', 'age1overflow'],
    );
  });

  it('rejects parent aborts and removes child work', async () => {
    const age = createTestAgeProcess({
      operationTimeoutMs: 1_000,
      killAfterMs: 50,
    });
    const controller = new AbortController();
    const promise = age.encrypt(
      Buffer.from('canonical abort'),
      'age1sleep',
      controller.signal,
    );

    controller.abort();

    await expectUnavailable(promise, 'journal encryption unavailable', [
      'canonical abort',
      'age1sleep',
    ]);
  });
});
