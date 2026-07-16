import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  createJournalObjectStore,
  type S3ClientLike,
} from '../../../server/journal/r2-store';

const bucket = 'mlp-contact-journal';
const intentKey = 'v1/intents/71eb8a54-d43b-45d5-9ea7-77b5834eeed3.json';
const acceptedKey = 'v1/accepted/71eb8a54-d43b-45d5-9ea7-77b5834eeed3.json';

class FakeS3Client implements S3ClientLike {
  readonly calls: Array<{
    command: PutObjectCommand | GetObjectCommand | ListObjectsV2Command;
    abortSignal: AbortSignal | undefined;
  }> = [];

  constructor(
    private readonly handler: (
      command: PutObjectCommand | GetObjectCommand | ListObjectsV2Command,
      abortSignal: AbortSignal | undefined,
    ) => Promise<unknown>,
  ) {}

  async send(
    command: PutObjectCommand | GetObjectCommand | ListObjectsV2Command,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown> {
    this.calls.push({ command, abortSignal: options?.abortSignal });
    return this.handler(command, options?.abortSignal);
  }
}

function storeWith(client: FakeS3Client, operationTimeoutMs = 3_000) {
  return createJournalObjectStore(
    {
      endpoint: 'https://accountid.eu.r2.cloudflarestorage.com',
      bucket,
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    },
    client,
    { operationTimeoutMs },
  );
}

function s3Error(name: string, httpStatusCode?: number): Error {
  const error = new Error(name) as Error & {
    name: string;
    $metadata?: { httpStatusCode?: number };
  };
  error.name = name;
  if (httpStatusCode) {
    error.$metadata = { httpStatusCode };
  }
  return error;
}

describe('journal R2 object store', () => {
  it('conditionally puts immutable JSON objects with exact bucket, key, body, and content type', async () => {
    const client = new FakeS3Client(async () => ({ ETag: '"ignored"' }));
    const store = storeWith(client);

    await expect(
      store.putIfAbsent(
        intentKey,
        Buffer.from('{"ok":true}'),
        65_536,
        new AbortController().signal,
      ),
    ).resolves.toBe('created');

    expect(client.calls).toHaveLength(1);
    const { command, abortSignal } = client.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: bucket,
      Key: intentKey,
      Body: Buffer.from('{"ok":true}'),
      ContentType: 'application/json',
      IfNoneMatch: '*',
    });
    expect(abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('maps conditional and uncertain PUT outcomes without trusting ETags', async () => {
    for (const [error, expected] of [
      [s3Error('PreconditionFailed', 412), 'exists'],
      [s3Error('Conflict', 409), 'ambiguous'],
      [s3Error('AbortError'), 'ambiguous'],
      [new Error('socket hang up'), 'ambiguous'],
    ] as const) {
      const store = storeWith(
        new FakeS3Client(async () => {
          throw error;
        }),
      );

      await expect(
        store.putIfAbsent(
          acceptedKey,
          Buffer.from('body'),
          4_096,
          new AbortController().signal,
        ),
      ).resolves.toBe(expected);
    }
  });

  it('rejects definitive access/config errors and invalid object keys generically', async () => {
    const unavailableStore = storeWith(
      new FakeS3Client(async () => {
        throw s3Error('AccessDenied', 403);
      }),
    );

    await expect(
      unavailableStore.putIfAbsent(
        acceptedKey,
        Buffer.from('body'),
        4_096,
        new AbortController().signal,
      ),
    ).rejects.toThrow('journal object store unavailable');

    await expect(
      unavailableStore.get(
        'v1/intents/not-a-uuid.json',
        65_536,
        new AbortController().signal,
      ),
    ).rejects.toThrow('journal object store unavailable');
  });

  it('gets bounded object bodies, maps 404 to null, and rejects overflow before concatenation', async () => {
    const client = new FakeS3Client(async (command) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      return { Body: Readable.from([Buffer.from('abc'), Buffer.from('def')]) };
    });
    const store = storeWith(client);

    await expect(
      store.get(intentKey, 65_536, new AbortController().signal),
    ).resolves.toEqual(Buffer.from('abcdef'));

    const notFoundStore = storeWith(
      new FakeS3Client(async () => {
        throw s3Error('NoSuchKey', 404);
      }),
    );
    await expect(
      notFoundStore.get(intentKey, 65_536, new AbortController().signal),
    ).resolves.toBeNull();

    const overflowStore = storeWith(
      new FakeS3Client(async () => ({
        Body: Readable.from([Buffer.alloc(10), Buffer.alloc(10)]),
      })),
    );
    await expect(
      overflowStore.get(intentKey, 16, new AbortController().signal),
    ).rejects.toThrow('journal object store unavailable');
  });

  it('keeps the operation deadline armed through stalled body consumption and destroys the stream', async () => {
    let destroyed = false;
    const stalled = new Readable({
      read() {},
      destroy(error, callback) {
        destroyed = true;
        callback(error);
        return this;
      },
    });
    const store = storeWith(
      new FakeS3Client(async () => ({ Body: stalled })),
      50,
    );

    await expect(
      store.get(intentKey, 65_536, new AbortController().signal),
    ).rejects.toThrow('journal object store unavailable');
    expect(destroyed).toBe(true);
  });

  it('lists strict, sorted, prefix-matching pages with advancing continuation tokens', async () => {
    const client = new FakeS3Client(async (command) => {
      expect(command).toBeInstanceOf(ListObjectsV2Command);
      return {
        Contents: [
          { Key: acceptedKey },
          { Key: 'v1/accepted/81eb8a54-d43b-45d5-9ea7-77b5834eeed3.json' },
        ],
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      };
    });
    const store = storeWith(client);

    await expect(
      store.listPage('v1/accepted/', undefined, new AbortController().signal),
    ).resolves.toEqual({
      keys: [
        acceptedKey,
        'v1/accepted/81eb8a54-d43b-45d5-9ea7-77b5834eeed3.json',
      ],
      nextToken: 'next-page',
    });
    expect(client.calls[0].command.input).toEqual({
      Bucket: bucket,
      Prefix: 'v1/accepted/',
      ContinuationToken: undefined,
    });
  });

  it('rejects duplicate, unsorted, wrong-prefix, and non-advancing LIST pages', async () => {
    const badPages = [
      {
        Contents: [{ Key: acceptedKey }, { Key: acceptedKey }],
        IsTruncated: false,
      },
      {
        Contents: [
          { Key: 'v1/accepted/81eb8a54-d43b-45d5-9ea7-77b5834eeed3.json' },
          { Key: acceptedKey },
        ],
        IsTruncated: false,
      },
      {
        Contents: [{ Key: intentKey }],
        IsTruncated: false,
      },
      {
        Contents: [{ Key: acceptedKey }],
        IsTruncated: true,
        NextContinuationToken: '',
      },
      {
        Contents: [{ Key: acceptedKey }],
        IsTruncated: true,
        NextContinuationToken: 'same',
      },
    ];

    for (const page of badPages) {
      const store = storeWith(new FakeS3Client(async () => page));
      await expect(
        store.listPage('v1/accepted/', 'same', new AbortController().signal),
      ).rejects.toThrow('journal object store unavailable');
    }
  });
});
