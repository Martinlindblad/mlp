#!/usr/bin/env node
import process from 'node:process';

const args = process.argv.slice(2);
const chunks = [];

for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const input = Buffer.concat(chunks);
const isEncrypt = args[0] === '--encrypt' && args[1] === '--recipient';
const isDecrypt = args[0] === '--decrypt' && args[1] === '--identity';
const selector = args[2] ?? '';

function leakAndFail() {
  process.stderr.write(
    `leaked-stderr canonical plaintext martin@example.com ${selector} /tmp/identity-secret\n`,
  );
  process.exit(7);
}

function sleepPastDeadline() {
  setTimeout(() => {
    process.stdout.write(Buffer.concat([Buffer.from('late:'), input]));
  }, 2_000);
}

function exceedOutputLimit() {
  process.stdout.write(Buffer.alloc(70_000, 0x61));
}

function ignoreTerm() {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1_000);
}

if (!isEncrypt && !isDecrypt) {
  leakAndFail();
}

if (selector.includes('fail')) {
  leakAndFail();
}
if (selector.includes('sleep')) {
  sleepPastDeadline();
} else if (selector.includes('overflow')) {
  exceedOutputLimit();
} else if (selector.includes('ignore-term')) {
  ignoreTerm();
} else if (isEncrypt) {
  process.stdout.write(
    Buffer.concat([Buffer.from(`encrypt:${args.join('|')}:`), input]),
  );
} else {
  process.stdout.write(
    Buffer.concat([Buffer.from(`decrypt:${args.join('|')}:`), input]),
  );
}
