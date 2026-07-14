import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

import { setupServiceWorkerRegistration } from '../../src/service-worker-registration.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const workerSource = await readFile(
  path.join(repositoryRoot, 'public', 'sw.js'),
  'utf8',
);
const appSource = await readFile(
  path.join(repositoryRoot, 'src', 'pages', '_app.tsx'),
  'utf8',
);
const origin = 'https://portfolio.test';
const currentCacheName = 'mlp-shell-v2';

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function response(body = 'ok', status = 200, headers = {}) {
  const bodyless = status === 204 || status === 205 || status === 304;
  return new Response(bodyless ? null : body, { headers, status });
}

function jsonResponse(value, status = 200) {
  return response(JSON.stringify(value), status, {
    'content-type': 'application/json',
  });
}

function request(
  pathname,
  { headers = {}, method = 'GET', mode = 'cors', requestOrigin = origin } = {},
) {
  return {
    headers: new Headers(headers),
    method,
    mode,
    url: new URL(pathname, requestOrigin).href,
  };
}

function requestKey(input) {
  return typeof input === 'string' ? input : input.url;
}

function routeKeys(input) {
  const key = requestKey(input);
  try {
    const parsed = new URL(key, origin);
    return [key, `${parsed.pathname}${parsed.search}`, parsed.pathname];
  } catch {
    return [key];
  }
}

function createRegistrationHarness({
  nodeEnv = 'production',
  readyState = 'complete',
  register = async () => ({ active: true }),
  supported = true,
} = {}) {
  const calls = {
    addEventListener: [],
    errors: [],
    register: [],
    removeEventListener: [],
  };
  const listeners = new Map();
  const documentObject = { readyState };
  const windowObject = {
    addEventListener(type, listener, options) {
      calls.addEventListener.push({ listener, options, type });
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      calls.removeEventListener.push({ listener, type });
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const navigatorObject = supported
    ? {
        serviceWorker: {
          register(url, options) {
            calls.register.push({ options, url });
            return register(url, options);
          },
        },
      }
    : {};

  const cleanup = setupServiceWorkerRegistration({
    document: documentObject,
    navigator: navigatorObject,
    nodeEnv,
    onError(error) {
      calls.errors.push(error);
    },
    window: windowObject,
  });

  return { calls, cleanup, listeners };
}

function propertyPath(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = propertyPath(expression.expression);
    return parent ? `${parent}.${expression.name.text}` : expression.name.text;
  }
  return '';
}

function analyzeAppRegistrationWiring(source) {
  const sourceFile = ts.createSourceFile(
    '_app.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let helperLocalName;

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '../service-worker-registration.mjs'
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const helperImport = bindings.elements.find(
      (element) =>
        (element.propertyName?.text ?? element.name.text) ===
        'setupServiceWorkerRegistration',
    );
    helperLocalName = helperImport?.name.text;
  }

  let directServiceWorkerRegistrations = 0;
  let directWindowLoadListeners = 0;
  let helperCallsInsideEffect = 0;

  function visit(node, insideEffect = false) {
    if (ts.isCallExpression(node)) {
      const calledPath = propertyPath(node.expression);
      if (calledPath === 'navigator.serviceWorker.register') {
        directServiceWorkerRegistrations += 1;
      }
      if (
        calledPath === 'window.addEventListener' &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === 'load'
      ) {
        directWindowLoadListeners += 1;
      }
      if (
        insideEffect &&
        helperLocalName !== undefined &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === helperLocalName
      ) {
        helperCallsInsideEffect += 1;
      }

      if (calledPath === 'useEffect' || calledPath.endsWith('.useEffect')) {
        const [effect, ...remainingArguments] = node.arguments;
        if (effect) visit(effect, true);
        visit(node.expression, false);
        remainingArguments.forEach((argument) => visit(argument, false));
        return;
      }
    }

    ts.forEachChild(node, (child) => visit(child, insideEffect));
  }

  visit(sourceFile);
  return {
    directServiceWorkerRegistrations,
    directWindowLoadListeners,
    helperCallsInsideEffect,
    helperImportedFromModule: helperLocalName !== undefined,
  };
}

async function createWorkerHarness({
  cacheNames = [],
  fetch: customFetch,
  onDelete,
  onPut,
  routes = new Map(),
  seed = [],
} = {}) {
  const listeners = new Map();
  const stores = new Map();
  const knownCacheNames = new Set(cacheNames);
  const calls = {
    addAll: [],
    cacheMatch: [],
    claim: 0,
    delete: [],
    fetch: [],
    globalMatch: [],
    open: [],
    put: [],
    respondWith: 0,
    skipWaiting: 0,
  };

  function ensureStore(cacheName) {
    knownCacheNames.add(cacheName);
    if (!stores.has(cacheName)) {
      stores.set(cacheName, new Map());
    }
    return stores.get(cacheName);
  }

  for (const entry of seed) {
    ensureStore(entry.cacheName).set(
      entry.key,
      entry.response.clone ? entry.response.clone() : entry.response,
    );
  }

  async function fetchImplementation(input, init) {
    const key = requestKey(input);
    calls.fetch.push({ init, key });

    let result;
    if (customFetch) {
      result = await customFetch(input, init);
    } else {
      let configured;
      for (const candidate of routeKeys(input)) {
        if (routes.has(candidate)) {
          configured = routes.get(candidate);
          break;
        }
      }
      result =
        typeof configured === 'function'
          ? await configured(input, init)
          : configured ?? response();
    }

    if (result instanceof Error) {
      throw result;
    }
    return result.clone ? result.clone() : result;
  }

  function cacheObject(cacheName) {
    const store = ensureStore(cacheName);
    const cache = {
      async addAll(inputs) {
        calls.addAll.push({ cacheName, inputs: [...inputs] });
        for (const input of inputs) {
          const fetched = await fetchImplementation(input);
          if (!fetched.ok || fetched.status === 206) {
            throw new TypeError(
              `Cache.addAll rejected ${requestKey(input)} (${fetched.status})`,
            );
          }
          await cache.put(input, fetched);
        }
      },
      async match(input) {
        const key = requestKey(input);
        calls.cacheMatch.push({ cacheName, key });
        const cached = store.get(key);
        return cached?.clone ? cached.clone() : cached;
      },
      async put(input, value) {
        const key = requestKey(input);
        calls.put.push({ cacheName, key, status: value.status });
        if (onPut) {
          await onPut({ cacheName, key, value });
        }
        store.set(key, value.clone ? value.clone() : value);
      },
    };
    return cache;
  }

  const caches = {
    async delete(cacheName) {
      calls.delete.push(cacheName);
      if (onDelete) {
        await onDelete(cacheName);
      }
      knownCacheNames.delete(cacheName);
      stores.delete(cacheName);
      return true;
    },
    async keys() {
      return [...knownCacheNames];
    },
    async match(input) {
      const key = requestKey(input);
      calls.globalMatch.push(key);
      for (const cacheName of knownCacheNames) {
        const cached = stores.get(cacheName)?.get(key);
        if (cached) {
          return cached.clone ? cached.clone() : cached;
        }
      }
      return undefined;
    },
    async open(cacheName) {
      calls.open.push(cacheName);
      return cacheObject(cacheName);
    },
  };

  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: {
      async claim() {
        calls.claim += 1;
      },
    },
    location: { origin },
    async skipWaiting() {
      calls.skipWaiting += 1;
    },
  };

  vm.runInNewContext(workerSource, {
    Headers,
    Request,
    Response,
    URL,
    caches,
    console,
    fetch: fetchImplementation,
    location: self.location,
    self,
  });

  function dispatchLifecycle(type) {
    const listener = listeners.get(type);
    assert.ok(listener, `expected a ${type} listener`);
    const pending = [];
    listener({
      waitUntil(value) {
        pending.push(Promise.resolve(value));
      },
    });
    return {
      promise: Promise.all(pending),
      waitUntilCount: pending.length,
    };
  }

  function dispatchFetch(eventRequest) {
    const listener = listeners.get('fetch');
    assert.ok(listener, 'expected a fetch listener');
    let responsePromise;
    let respondWithCount = 0;
    listener({
      request: eventRequest,
      respondWith(value) {
        calls.respondWith += 1;
        respondWithCount += 1;
        responsePromise = Promise.resolve(value);
      },
    });
    return { promise: responsePromise, respondWithCount };
  }

  return { calls, dispatchFetch, dispatchLifecycle };
}

test('install rejects every non-200 manifest response without skipWaiting', async (t) => {
  for (const status of [201, 204, 206, 404]) {
    await t.test(`manifest status ${status}`, async () => {
      const harness = await createWorkerHarness({
        routes: new Map([['/sw-manifest.json', jsonResponse([], status)]]),
      });
      const install = harness.dispatchLifecycle('install');

      assert.equal(install.waitUntilCount, 1);
      await assert.rejects(install.promise);
      assert.equal(harness.calls.skipWaiting, 0);
    });
  }
});

test('install rejects every non-200 precache resource without skipWaiting', async (t) => {
  for (const status of [201, 204, 206, 404]) {
    await t.test(`resource status ${status}`, async () => {
      const harness = await createWorkerHarness({
        routes: new Map([
          ['/sw-manifest.json', jsonResponse(['/broken-resource'], 200)],
          ['/broken-resource', response('broken', status)],
        ]),
      });
      const install = harness.dispatchLifecycle('install');

      await assert.rejects(install.promise);
      assert.equal(harness.calls.skipWaiting, 0);
      assert.deepEqual(
        harness.calls.put.filter(({ key }) => key === '/broken-resource'),
        [],
      );
    });
  }
});

test('install waits for every successful cache write before skipWaiting', async () => {
  const putGate = deferred();
  const harness = await createWorkerHarness({
    onPut: ({ key }) =>
      key === '/deferred.css' ? putGate.promise : Promise.resolve(),
    routes: new Map([
      ['/sw-manifest.json', jsonResponse(['/deferred.css'])],
      ['/deferred.css', response('stylesheet')],
    ]),
  });
  const install = harness.dispatchLifecycle('install');
  let settled = false;
  install.promise.finally(() => {
    settled = true;
  });

  await nextTurn();
  const beforeRelease = {
    fetches: harness.calls.fetch.map(({ key }) => key),
    settled,
    skipWaiting: harness.calls.skipWaiting,
  };
  putGate.resolve();
  await install.promise;

  assert.equal(beforeRelease.settled, false);
  assert.equal(beforeRelease.skipWaiting, 0);
  assert.equal(beforeRelease.fetches[0], '/sw-manifest.json');
  assert.ok(beforeRelease.fetches.includes('/deferred.css'));
  assert.equal(harness.calls.skipWaiting, 1);
});

test('activate retains only the current cache and claims after deletion', async () => {
  const oldA = deferred();
  const oldB = deferred();
  const gates = new Map([
    ['old-a', oldA],
    ['old-b', oldB],
  ]);
  const harness = await createWorkerHarness({
    cacheNames: [currentCacheName, 'old-a', 'old-b'],
    onDelete: (cacheName) => gates.get(cacheName)?.promise,
  });
  const activate = harness.dispatchLifecycle('activate');

  await nextTurn();
  const beforeDeletion = {
    claims: harness.calls.claim,
    deleted: [...harness.calls.delete],
  };
  oldA.resolve();
  await nextTurn();
  const afterOneDeletion = harness.calls.claim;
  oldB.resolve();
  await activate.promise;

  assert.deepEqual(beforeDeletion.deleted, ['old-a', 'old-b']);
  assert.equal(beforeDeletion.claims, 0);
  assert.equal(afterOneDeletion, 0);
  assert.equal(harness.calls.claim, 1);
});

test('bypass categories never call respondWith, fetch, or cache APIs', async (t) => {
  const cases = [
    [
      'cross-origin',
      request('/image.webp', { requestOrigin: 'https://cdn.test' }),
    ],
    ['HEAD', request('/health', { method: 'HEAD' })],
    ['POST', request('/contact', { method: 'POST' })],
    ['PUT', request('/resource', { method: 'PUT' })],
    ['PATCH', request('/resource', { method: 'PATCH' })],
    ['DELETE', request('/resource', { method: 'DELETE' })],
    ['OPTIONS', request('/resource', { method: 'OPTIONS' })],
    ['bare API path', request('/api')],
    ['nested API path', request('/api/contact')],
    [
      'video range request',
      request('/assets/man.mp4', { headers: { Range: 'bytes=0-1023' } }),
    ],
    [
      'unrelated range request',
      request('/images/profilepicture.webp', {
        headers: { Range: 'bytes=0-31' },
      }),
    ],
  ];

  for (const [name, eventRequest] of cases) {
    await t.test(name, async () => {
      const harness = await createWorkerHarness();
      const dispatched = harness.dispatchFetch(eventRequest);
      await nextTurn();

      assert.equal(dispatched.respondWithCount, 0);
      assert.equal(harness.calls.fetch.length, 0);
      assert.equal(harness.calls.globalMatch.length, 0);
      assert.equal(harness.calls.open.length, 0);
    });
  }
});

test('navigations are network-first and cache status-200 responses', async () => {
  const eventRequest = request('/work', { mode: 'navigate' });
  const harness = await createWorkerHarness({
    routes: new Map([[eventRequest.url, response('network')]]),
    seed: [
      {
        cacheName: currentCacheName,
        key: eventRequest.url,
        response: response('cached'),
      },
    ],
  });
  const dispatched = harness.dispatchFetch(eventRequest);
  const result = await dispatched.promise;

  assert.equal(dispatched.respondWithCount, 1);
  assert.equal(await result.text(), 'network');
  assert.deepEqual(
    harness.calls.fetch.map(({ key }) => key),
    [eventRequest.url],
  );
  assert.deepEqual(harness.calls.put, [
    { cacheName: currentCacheName, key: eventRequest.url, status: 200 },
  ]);
});

test('navigation responses await status-200 cache writes', async () => {
  const eventRequest = request('/await-navigation', { mode: 'navigate' });
  const putGate = deferred();
  const harness = await createWorkerHarness({
    onPut: ({ key }) =>
      key === eventRequest.url ? putGate.promise : Promise.resolve(),
    routes: new Map([[eventRequest.url, response('navigation')]]),
  });
  const dispatched = harness.dispatchFetch(eventRequest);
  let settled = false;
  dispatched.promise.finally(() => {
    settled = true;
  });

  await nextTurn();
  const beforeRelease = {
    puts: [...harness.calls.put],
    settled,
  };
  putGate.resolve();
  const result = await dispatched.promise;

  assert.equal(beforeRelease.settled, false);
  assert.deepEqual(beforeRelease.puts, [
    { cacheName: currentCacheName, key: eventRequest.url, status: 200 },
  ]);
  assert.equal(await result.text(), 'navigation');
});

test('navigation responses outside exact status 200 are never cached', async (t) => {
  for (const status of [201, 204, 206, 404, 500]) {
    await t.test(`status ${status}`, async () => {
      const eventRequest = request(`/navigation-${status}`, {
        mode: 'navigate',
      });
      const harness = await createWorkerHarness({
        routes: new Map([
          [eventRequest.url, response(`navigation ${status}`, status)],
        ]),
      });
      const result = await harness.dispatchFetch(eventRequest).promise;

      assert.equal(result.status, status);
      assert.deepEqual(harness.calls.put, []);
    });
  }
});

test('failed navigation fetches fall back to the cache', async () => {
  const eventRequest = request('/offline', { mode: 'navigate' });
  const harness = await createWorkerHarness({
    fetch: async () => {
      throw new Error('offline');
    },
    seed: [
      {
        cacheName: currentCacheName,
        key: eventRequest.url,
        response: response('offline shell'),
      },
    ],
  });
  const result = await harness.dispatchFetch(eventRequest).promise;

  assert.equal(await result.text(), 'offline shell');
  assert.equal(harness.calls.fetch.length, 1);
  assert.deepEqual(harness.calls.globalMatch, [eventRequest.url]);
});

test('Next-data GETs revalidate seeded cache and await exact-200 writes', async () => {
  const eventRequest = request(
    '/_next/data/build-123/cases/64b000000000000000000006.json',
  );
  const putGate = deferred();
  const harness = await createWorkerHarness({
    onPut: ({ key }) =>
      key === eventRequest.url ? putGate.promise : Promise.resolve(),
    routes: new Map([[eventRequest.url, response('fresh Next data')]]),
    seed: [
      {
        cacheName: currentCacheName,
        key: eventRequest.url,
        response: response('stale Next data'),
      },
    ],
  });
  const dispatched = harness.dispatchFetch(eventRequest);
  let settled = false;
  dispatched.promise.finally(() => {
    settled = true;
  });

  await nextTurn();
  const beforeRelease = {
    fetches: harness.calls.fetch.map(({ key }) => key),
    puts: [...harness.calls.put],
    settled,
  };
  putGate.resolve();
  const result = await dispatched.promise;

  assert.deepEqual(beforeRelease.fetches, [eventRequest.url]);
  assert.deepEqual(beforeRelease.puts, [
    { cacheName: currentCacheName, key: eventRequest.url, status: 200 },
  ]);
  assert.equal(beforeRelease.settled, false);
  assert.equal(await result.text(), 'fresh Next data');
});

test('failed exact Next-data fetches fall back to the cache', async () => {
  const eventRequest = request('/_next/data');
  const harness = await createWorkerHarness({
    fetch: async () => {
      throw new Error('offline');
    },
    seed: [
      {
        cacheName: currentCacheName,
        key: eventRequest.url,
        response: response('cached Next data'),
      },
    ],
  });
  const result = await harness.dispatchFetch(eventRequest).promise;

  assert.equal(await result.text(), 'cached Next data');
  assert.deepEqual(
    harness.calls.fetch.map(({ key }) => key),
    [eventRequest.url],
  );
  assert.deepEqual(harness.calls.globalMatch, [eventRequest.url]);
});

test('static GET cache hits avoid the network', async () => {
  const eventRequest = request('/images/profilepicture.webp');
  const harness = await createWorkerHarness({
    fetch: async () => {
      throw new Error('network should not be called');
    },
    seed: [
      {
        cacheName: currentCacheName,
        key: eventRequest.url,
        response: response('portrait'),
      },
    ],
  });
  const result = await harness.dispatchFetch(eventRequest).promise;

  assert.equal(await result.text(), 'portrait');
  assert.equal(harness.calls.fetch.length, 0);
});

test('static cache misses await status-200 cache writes', async () => {
  const eventRequest = request('/images/new.webp');
  const putGate = deferred();
  const harness = await createWorkerHarness({
    onPut: ({ key }) =>
      key === eventRequest.url ? putGate.promise : Promise.resolve(),
    routes: new Map([[eventRequest.url, response('new image')]]),
  });
  const dispatched = harness.dispatchFetch(eventRequest);
  let settled = false;
  dispatched.promise.finally(() => {
    settled = true;
  });

  await nextTurn();
  const beforeRelease = {
    puts: [...harness.calls.put],
    settled,
  };
  putGate.resolve();
  const result = await dispatched.promise;

  assert.equal(beforeRelease.settled, false);
  assert.deepEqual(beforeRelease.puts, [
    { cacheName: currentCacheName, key: eventRequest.url, status: 200 },
  ]);
  assert.equal(await result.text(), 'new image');
});

test('static responses outside exact status 200 are never cached', async (t) => {
  for (const status of [201, 204, 206, 404, 500]) {
    await t.test(`status ${status}`, async () => {
      const eventRequest = request(`/asset-${status}`);
      const harness = await createWorkerHarness({
        routes: new Map([
          [eventRequest.url, response(`status ${status}`, status)],
        ]),
      });
      const result = await harness.dispatchFetch(eventRequest).promise;

      assert.equal(result.status, status);
      assert.deepEqual(harness.calls.put, []);
    });
  }
});

test('_app delegates registration to the tested helper inside its effect', () => {
  assert.deepEqual(analyzeAppRegistrationWiring(appSource), {
    directServiceWorkerRegistrations: 0,
    directWindowLoadListeners: 0,
    helperCallsInsideEffect: 1,
    helperImportedFromModule: true,
  });
});

test('service worker registration does nothing outside production', () => {
  const harness = createRegistrationHarness({ nodeEnv: 'development' });

  assert.equal(typeof harness.cleanup, 'function');
  assert.deepEqual(harness.calls.register, []);
  assert.deepEqual(harness.calls.addEventListener, []);
  harness.cleanup();
  assert.deepEqual(harness.calls.removeEventListener, []);
});

test('service worker registration does nothing when unsupported', () => {
  const harness = createRegistrationHarness({ supported: false });

  assert.equal(typeof harness.cleanup, 'function');
  assert.deepEqual(harness.calls.register, []);
  assert.deepEqual(harness.calls.addEventListener, []);
});

test('ready documents register immediately with root scope and no update cache', () => {
  const harness = createRegistrationHarness({ readyState: 'complete' });

  assert.deepEqual(harness.calls.register, [
    {
      options: { scope: '/', updateViaCache: 'none' },
      url: '/sw.js',
    },
  ]);
  assert.deepEqual(harness.calls.addEventListener, []);
});

test('loading documents use a once-only load listener removed by cleanup', async () => {
  const harness = createRegistrationHarness({ readyState: 'loading' });

  assert.equal(harness.calls.register.length, 0);
  assert.equal(harness.calls.addEventListener.length, 1);
  const added = harness.calls.addEventListener[0];
  assert.equal(added.type, 'load');
  assert.deepEqual(added.options, { once: true });

  await added.listener();
  assert.deepEqual(harness.calls.register, [
    {
      options: { scope: '/', updateViaCache: 'none' },
      url: '/sw.js',
    },
  ]);

  harness.cleanup();
  assert.deepEqual(harness.calls.removeEventListener, [
    { listener: added.listener, type: 'load' },
  ]);
});

test('service worker registration rejections are handled', async () => {
  const failure = new Error('expected registration failure');
  const harness = createRegistrationHarness({
    register: async () => {
      throw failure;
    },
  });

  await nextTurn();
  assert.deepEqual(harness.calls.errors, [failure]);
});
