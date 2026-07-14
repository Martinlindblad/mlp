import { createServer } from 'node:http';

const records = [];

function writeJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json',
  });
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture.invalid');
  if (request.method === 'GET' && url.pathname === '/__fixture/state') {
    writeJson(response, 200, records);
    return;
  }

  const record = {
    aborted: false,
    bodyLength: 0,
    complete: false,
    headers: request.headers,
    method: request.method,
    url: request.url,
  };
  records.push(record);
  request.on('data', (chunk) => {
    record.bodyLength += chunk.length;
  });
  request.on('aborted', () => {
    record.aborted = true;
  });
  request.on('end', () => {
    record.complete = true;

    if (url.pathname === '/large') {
      const body = 'x'.repeat(4096);
      response.writeHead(200, {
        'content-length': Buffer.byteLength(body),
        'content-type': 'text/plain; charset=utf-8',
      });
      response.end(body);
      return;
    }
    if (url.pathname === '/sw.js') {
      const body = 'self.addEventListener("fetch", () => {});';
      response.writeHead(200, {
        'content-length': Buffer.byteLength(body),
        'content-type': 'text/javascript; charset=utf-8',
      });
      response.end(body);
      return;
    }
    writeJson(response, 200, record);
  });
});

server.on('clientError', (_error, socket) => socket.destroy());
server.listen(3000, '0.0.0.0');
