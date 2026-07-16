import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

export type ConditionalPutResult = 'created' | 'exists' | 'ambiguous';

export interface JournalObjectStore {
  putIfAbsent(
    key: string,
    body: Uint8Array,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<ConditionalPutResult>;
  get(
    key: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<Buffer | null>;
  listPage(
    prefix: 'v1/accepted/' | 'v1/intents/',
    continuationToken: string | undefined,
    signal: AbortSignal,
  ): Promise<{ keys: string[]; nextToken?: string }>;
}

export type JournalObjectReader = Pick<JournalObjectStore, 'get' | 'listPage'>;

export interface S3ClientLike {
  send(
    command: PutObjectCommand | GetObjectCommand | ListObjectsV2Command,
    options?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

interface StoreConfig {
  endpoint: string;
  bucket: 'mlp-contact-journal';
  accessKeyId: string;
  secretAccessKey: string;
}

interface StoreOptions {
  operationTimeoutMs?: number;
}

const OBJECT_KEY_PATTERN =
  /^v1\/(intents|accepted)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;
const DEFAULT_OPERATION_TIMEOUT_MS = 3_000;

function unavailable(): never {
  throw new Error('journal object store unavailable');
}

function assertObjectKey(key: string) {
  if (!OBJECT_KEY_PATTERN.test(key)) {
    unavailable();
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'AbortError')
  );
}

function httpStatus(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
}

function isTransportUncertainty(error: unknown): boolean {
  return isAbortError(error) || httpStatus(error) === undefined;
}

async function withOperationDeadline<T>(
  operationTimeoutMs: number,
  callerSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (callerSignal.aborted) {
    unavailable();
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, operationTimeoutMs);
  callerSignal.addEventListener('abort', abort, { once: true });

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    callerSignal.removeEventListener('abort', abort);
  }
}

function destroyBody(body: unknown) {
  if (body && typeof (body as { destroy?: unknown }).destroy === 'function') {
    (body as Readable).destroy();
  }
}

async function readBoundedBody(
  body: unknown,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (
    !body ||
    typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !==
      'function'
  ) {
    unavailable();
  }

  const stream = body as AsyncIterable<Uint8Array>;
  const chunks: Buffer[] = [];
  let total = 0;
  const onAbort = () => destroyBody(body);
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    for await (const chunk of stream) {
      if (signal.aborted) {
        unavailable();
      }
      const bytes = Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maximumBytes) {
        destroyBody(body);
        unavailable();
      }
      chunks.push(bytes);
    }
  } catch {
    unavailable();
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  if (signal.aborted) {
    unavailable();
  }

  return Buffer.concat(chunks, total);
}

function validateListPage(
  prefix: 'v1/accepted/' | 'v1/intents/',
  continuationToken: string | undefined,
  response: {
    Contents?: Array<{ Key?: string }>;
    IsTruncated?: boolean;
    NextContinuationToken?: string;
  },
): { keys: string[]; nextToken?: string } {
  const keys: string[] = [];
  let previous = '';
  const seen = new Set<string>();

  for (const { Key: key } of response.Contents ?? []) {
    if (!key || !key.startsWith(prefix)) {
      unavailable();
    }
    assertObjectKey(key);
    if (seen.has(key) || key <= previous) {
      unavailable();
    }
    seen.add(key);
    keys.push(key);
    previous = key;
  }

  if (!response.IsTruncated) {
    return { keys };
  }

  if (
    !response.NextContinuationToken ||
    response.NextContinuationToken === continuationToken
  ) {
    unavailable();
  }

  return { keys, nextToken: response.NextContinuationToken };
}

export function createJournalObjectStore(
  config: StoreConfig,
  client: S3ClientLike = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 1,
  }),
  options: StoreOptions = {},
): JournalObjectStore {
  if (config.bucket !== 'mlp-contact-journal') {
    unavailable();
  }

  const operationTimeoutMs =
    options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;

  return {
    async putIfAbsent(key, body, maximumBytes, signal) {
      assertObjectKey(key);
      if (body.byteLength > maximumBytes) {
        unavailable();
      }

      try {
        await withOperationDeadline(
          operationTimeoutMs,
          signal,
          (operationSignal) =>
            client.send(
              new PutObjectCommand({
                Bucket: config.bucket,
                Key: key,
                Body: Buffer.from(body),
                ContentType: 'application/json',
                IfNoneMatch: '*',
              }),
              { abortSignal: operationSignal },
            ),
        );
        return 'created';
      } catch (error) {
        if (httpStatus(error) === 412) {
          return 'exists';
        }
        if (httpStatus(error) === 409 || isTransportUncertainty(error)) {
          return 'ambiguous';
        }
        unavailable();
      }
    },

    async get(key, maximumBytes, signal) {
      assertObjectKey(key);

      try {
        return await withOperationDeadline(
          operationTimeoutMs,
          signal,
          async (operationSignal) => {
            const response = (await client.send(
              new GetObjectCommand({
                Bucket: config.bucket,
                Key: key,
              }),
              { abortSignal: operationSignal },
            )) as { Body?: unknown };
            return readBoundedBody(
              response.Body,
              maximumBytes,
              operationSignal,
            );
          },
        );
      } catch (error) {
        if (httpStatus(error) === 404) {
          return null;
        }
        unavailable();
      }
    },

    async listPage(prefix, continuationToken, signal) {
      try {
        return await withOperationDeadline(
          operationTimeoutMs,
          signal,
          async (operationSignal) => {
            const response = (await client.send(
              new ListObjectsV2Command({
                Bucket: config.bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
              }),
              { abortSignal: operationSignal },
            )) as {
              Contents?: Array<{ Key?: string }>;
              IsTruncated?: boolean;
              NextContinuationToken?: string;
            };
            return validateListPage(prefix, continuationToken, response);
          },
        );
      } catch {
        unavailable();
      }
    },
  };
}
