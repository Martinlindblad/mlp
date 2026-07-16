import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface AgeProcess {
  encrypt(
    plaintext: Uint8Array,
    recipient: string,
    signal: AbortSignal,
  ): Promise<Buffer>;
  decrypt(
    ciphertext: Uint8Array,
    identityFile: string,
    signal: AbortSignal,
  ): Promise<Buffer>;
}

interface AgeProcessOptions {
  executable?: string;
  operationTimeoutMs?: number;
  killAfterMs?: number;
  ciphertextLimitBytes?: number;
  plaintextLimitBytes?: number;
}

interface RunAgeOptions {
  executable: string;
  args: string[];
  input: Uint8Array;
  inputLimitBytes: number;
  outputLimitBytes: number;
  operationTimeoutMs: number;
  killAfterMs: number;
  signal: AbortSignal;
  errorMessage: string;
}

const DEFAULT_EXECUTABLE = '/usr/local/bin/age';
const DEFAULT_OPERATION_TIMEOUT_MS = 3_000;
const DEFAULT_KILL_AFTER_MS = 500;
const DEFAULT_CIPHERTEXT_LIMIT_BYTES = 65_536;
const DEFAULT_PLAINTEXT_LIMIT_BYTES = 32_768;

function unavailable(message: string): Error {
  return new Error(message);
}

function fixedEnvironment(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LC_ALL: 'C',
  };
}

function runAge(options: RunAgeOptions): Promise<Buffer> {
  const input = Buffer.from(options.input);
  if (input.byteLength > options.inputLimitBytes || options.signal.aborted) {
    return Promise.reject(unavailable(options.errorMessage));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let failed = false;
    let totalOutputBytes = 0;
    const chunks: Buffer[] = [];
    let operationTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    const child = spawn(options.executable, options.args, {
      shell: false,
      windowsHide: true,
      env: fixedEnvironment() as unknown as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    function cleanup() {
      if (operationTimer) {
        clearTimeout(operationTimer);
        operationTimer = null;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      options.signal.removeEventListener('abort', onAbort);
    }

    function rejectUnavailable() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(unavailable(options.errorMessage));
    }

    function terminate() {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
      }

      if (!killTimer) {
        killTimer = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
        }, options.killAfterMs);
      }
    }

    function markFailedAndTerminate() {
      failed = true;
      terminate();
    }

    function onAbort() {
      markFailedAndTerminate();
    }

    operationTimer = setTimeout(() => {
      markFailedAndTerminate();
    }, options.operationTimeoutMs);

    options.signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', () => {
      failed = true;
      rejectUnavailable();
    });

    child.stdout.on('data', (chunk: Buffer) => {
      totalOutputBytes += chunk.byteLength;
      if (totalOutputBytes > options.outputLimitBytes) {
        markFailedAndTerminate();
        return;
      }

      chunks.push(Buffer.from(chunk));
    });

    child.stderr.on('data', () => {});

    child.stdin.on('error', () => {});
    child.stdin.end(input);

    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      if (failed || code !== 0) {
        reject(unavailable(options.errorMessage));
        return;
      }

      resolve(Buffer.concat(chunks, totalOutputBytes));
    });
  });
}

export function createAgeProcess(options: AgeProcessOptions = {}): AgeProcess {
  const executable = options.executable ?? DEFAULT_EXECUTABLE;
  const operationTimeoutMs =
    options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const killAfterMs = options.killAfterMs ?? DEFAULT_KILL_AFTER_MS;
  const ciphertextLimitBytes =
    options.ciphertextLimitBytes ?? DEFAULT_CIPHERTEXT_LIMIT_BYTES;
  const plaintextLimitBytes =
    options.plaintextLimitBytes ?? DEFAULT_PLAINTEXT_LIMIT_BYTES;

  return {
    encrypt(plaintext, recipient, signal) {
      return runAge({
        executable,
        args: ['--encrypt', '--recipient', recipient],
        input: plaintext,
        inputLimitBytes: plaintextLimitBytes,
        outputLimitBytes: ciphertextLimitBytes,
        operationTimeoutMs,
        killAfterMs,
        signal,
        errorMessage: 'journal encryption unavailable',
      });
    },

    decrypt(ciphertext, identityFile, signal) {
      return runAge({
        executable,
        args: ['--decrypt', '--identity', identityFile],
        input: ciphertext,
        inputLimitBytes: ciphertextLimitBytes,
        outputLimitBytes: plaintextLimitBytes,
        operationTimeoutMs,
        killAfterMs,
        signal,
        errorMessage: 'journal decryption unavailable',
      });
    },
  };
}
