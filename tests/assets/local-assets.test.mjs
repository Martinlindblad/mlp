import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertExactPath,
  collectDatabaseAssetReferences,
  collectTrackedLocalUrls,
  findGitCaseCollisions,
  findMissingAssetReferences,
  normalizeLocalAssetUrl,
} from '../../migration/asset-paths.mjs';

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const publicRoot = path.join(repositoryRoot, 'public');

function compareByCodePoint(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) =>
    character.codePointAt(0),
  );
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }

  return leftPoints.length - rightPoints.length;
}

async function withTemporaryPublicTree(callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'mlp-assets-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function runGit(cwd, arguments_) {
  return execFile('git', arguments_, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function withTemporaryGitRepository(callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'mlp-assets-git-'));
  try {
    await runGit(root, ['init', '--quiet']);
    await runGit(root, ['config', 'core.ignorecase', 'false']);
    return await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function trackedFiles(root = repositoryRoot) {
  const { stdout } = await execFile('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.toString('utf8').split('\0').filter(Boolean);
}

async function trackedTextFiles() {
  return (await trackedFiles()).filter((filename) =>
    /\.(?:css|js|jsx|json|ts|tsx|xml)$/u.test(filename),
  );
}

test('URL normalization preserves spelling, strips suffixes, then decodes', () => {
  assert.equal(
    normalizeLocalAssetUrl('/Images/Hero%20Portrait.webp?width=800#crop'),
    '/Images/Hero Portrait.webp',
  );
  assert.equal(
    normalizeLocalAssetUrl('/images/cases/mackmyra.webp#overview?ignored'),
    '/images/cases/mackmyra.webp',
  );
});

test('URL normalization rejects traversal, separators, backslashes, and NUL', () => {
  const unsafeUrls = [
    '/images/../secret.txt',
    '/images/%2e%2e/secret.txt',
    '/images/%2E%2E/secret.txt',
    '/images/cases%2fsecret.webp',
    '/images/cases%2Fsecret.webp',
    '/images/cases%5csecret.webp',
    '/images/cases\\secret.webp',
    '/images/null\0byte.webp',
    '/images/null%00byte.webp',
  ];

  for (const unsafeUrl of unsafeUrls) {
    assert.throws(
      () => normalizeLocalAssetUrl(unsafeUrl),
      undefined,
      `expected ${JSON.stringify(unsafeUrl)} to be rejected`,
    );
  }
});

test('exact validation compares every segment and requires a regular file', async () => {
  await withTemporaryPublicTree(async (root) => {
    await mkdir(path.join(root, 'images', 'cases'), { recursive: true });
    await writeFile(
      path.join(root, 'images', 'cases', 'Hero Portrait.webp'),
      'ok',
    );
    await mkdir(path.join(root, 'images', 'directory.webp'));
    await symlink(
      path.join(root, 'images', 'cases', 'Hero Portrait.webp'),
      path.join(root, 'images', 'linked.webp'),
    );
    await symlink(
      path.join(root, 'images', 'cases'),
      path.join(root, 'images', 'linked-cases'),
    );

    await assert.doesNotReject(
      assertExactPath(
        root,
        '/images/cases/Hero%20Portrait.webp?width=400#crop',
      ),
    );
    await assert.rejects(
      assertExactPath(root, '/images/Cases/Hero%20Portrait.webp'),
      /case|exact|segment/iu,
    );
    await assert.rejects(
      assertExactPath(root, '/images/directory.webp'),
      /regular file/iu,
    );
    await assert.rejects(
      assertExactPath(root, '/images/linked.webp'),
      /regular file/iu,
    );
    await assert.rejects(
      assertExactPath(root, '/images/linked-cases/Hero%20Portrait.webp'),
    );
  });
});

test('tracked local URL collection is deterministic, unique, and Linux-exact', async () => {
  const urls = await collectTrackedLocalUrls(repositoryRoot);

  assert.deepEqual(urls, [...urls].sort(compareByCodePoint));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.length > 0, 'expected at least one tracked local asset URL');

  for (const urlPath of urls) {
    await assertExactPath(publicRoot, urlPath);
  }
});

test('tracked scanner honors the Git index, supported extensions, decoding, and ordering', async () => {
  await withTemporaryGitRepository(async (root) => {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'notes'), { recursive: true });
    const trackedSources = new Map([
      [
        'src/a.ts',
        "const first = '/Images/Hero%20One.webp?width=800#crop';\n" +
          "const duplicate = '/Images/Hero%20One.webp?other=1';\n",
      ],
      ['src/b.tsx', "export const asset = '/images/A.webp';\n"],
      ['src/c.js', "export const asset = '/images/Z.webp';\n"],
      ['src/d.jsx', "export const asset = '/images/%C3%85.webp#hero';\n"],
      [
        'src/line\nbreak.ts',
        "export const asset = '/images/newline-filename.webp';\n",
      ],
      [
        'src/e.css',
        "@font-face { src: url('/assets/font%20one.woff2?v=1'); }\n",
      ],
      [
        'src/f.json',
        '{"icon":"/favicon","shortcut":"/favicon.ico#shortcut"}\n',
      ],
      [
        'src/g.xml',
        '<root manifest="/manifest" versioned="/manifest.json?version=1" />\n',
      ],
      [
        'notes/ignored.md',
        '![ignored](/images/tracked-but-unsupported.webp)\n',
      ],
    ]);

    for (const [filename, contents] of trackedSources) {
      await writeFile(path.join(root, filename), contents);
    }
    await runGit(root, ['add', 'src', 'notes/ignored.md']);
    await writeFile(
      path.join(root, 'src', 'untracked.ts'),
      "export const ignored = '/images/untracked.webp';\n",
    );

    assert.deepEqual(await collectTrackedLocalUrls(root), [
      '/Images/Hero One.webp',
      '/assets/font one.woff2',
      '/favicon',
      '/favicon.ico',
      '/images/A.webp',
      '/images/Z.webp',
      '/images/newline-filename.webp',
      '/images/Å.webp',
      '/manifest',
      '/manifest.json',
    ]);
  });
});

test('case-collision detection reads distinct paths from an isolated Git index', async () => {
  await withTemporaryGitRepository(async (root) => {
    const blobPath = path.join(root, 'fixture-blob');
    await writeFile(blobPath, 'same blob');
    const { stdout } = await runGit(root, ['hash-object', '-w', blobPath]);
    const blob = stdout.trim();
    await runGit(root, [
      'update-index',
      '--add',
      '--cacheinfo',
      `100644,${blob},public/Images/Duplicate.webp`,
    ]);
    await runGit(root, [
      'update-index',
      '--add',
      '--cacheinfo',
      `100644,${blob},public/images/duplicate.webp`,
    ]);

    assert.deepEqual(await findGitCaseCollisions(root), [
      ['public/Images/Duplicate.webp', 'public/images/duplicate.webp'],
    ]);
  });
});

test('the Git index contains no paths that collide by case', async () => {
  assert.deepEqual(await findGitCaseCollisions(repositoryRoot), []);
});

test('the final Git index contains no legacy uppercase asset directories', async () => {
  const legacyPaths = (await trackedFiles()).filter(
    (filename) =>
      filename.startsWith('public/Images/') ||
      filename.startsWith('public/images/Cases/'),
  );

  assert.deepEqual(legacyPaths, []);
});

test('tracked sources contain no stale asset spellings or build-hashed precache URLs', async () => {
  const staleRules = [
    ['uppercase-images-root', /\/Images\//u],
    ['uppercase-cases-segment', /\/images\/Cases\//u],
    ['misspelled-social-media', /socail-media/u],
    [
      'wrong-social-extension',
      /\/images\/(?:facebook|github|instagram|linkedin)\.webp/u,
    ],
    ['hard-coded-next-static', /\/_next\/static\//u],
  ];
  const matches = [];

  for (const filename of await trackedTextFiles()) {
    const source = await readFile(path.join(repositoryRoot, filename), 'utf8');
    source.split(/\r?\n/u).forEach((line, index) => {
      for (const [rule, pattern] of staleRules) {
        if (pattern.test(line)) {
          matches.push({ filename, line: index + 1, rule });
        }
      }
    });
  }

  assert.deepEqual(matches, []);
});

test('the service-worker manifest is minimal and every asset resolves exactly', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(publicRoot, 'sw-manifest.json'), 'utf8'),
  );

  assert.deepEqual(manifest, [
    '/',
    '/favicon.ico',
    '/manifest.json',
    '/images/profilepicture.webp',
  ]);

  for (const urlPath of manifest.filter((entry) => entry !== '/')) {
    await assertExactPath(publicRoot, urlPath);
  }
});

test('the web manifest either omits the portrait icon or declares its true dimensions', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(publicRoot, 'manifest.json'), 'utf8'),
  );
  const profileDeclarations = (manifest.icons ?? []).filter((icon) => {
    const sourcePath = String(icon.src ?? '').split(/[?#]/u, 1)[0];
    return sourcePath.toLowerCase() === '/images/profilepicture.webp';
  });

  for (const icon of profileDeclarations) {
    assert.deepEqual(
      { sizes: icon.sizes, type: icon.type },
      { sizes: '1080x1440', type: 'image/webp' },
    );
  }
});

test('database asset fields retain structural paths and missing issues are redacted', async () => {
  await withTemporaryPublicTree(async (root) => {
    await mkdir(path.join(root, 'images'), { recursive: true });
    for (const filename of [
      'about.webp',
      'profile.webp',
      'project.webp',
      'modern.webp',
      'legacy.webp',
      'left.webp',
    ]) {
      await writeFile(path.join(root, 'images', filename), filename);
    }

    const references = [
      ...collectDatabaseAssetReferences('about', {
        _id: 'about-1',
        imageSource: '/images/about.webp',
        profileImage: '/images/profile.webp',
      }),
      ...collectDatabaseAssetReferences('projects_and_cases', {
        _id: 'project-1',
        imageSource: '/images/project.webp',
        projectDetails: {
          imageSources: ['/images/modern.webp'],
          imagesSources: ['/images/legacy.webp'],
        },
      }),
      ...collectDatabaseAssetReferences('pursuit', {
        _id: 'pursuit-1',
        leftImageSource: '/images/left.webp',
        rightImageSource: '/images/Missing.webp?width=400',
      }),
    ];

    assert.deepEqual(references, [
      {
        collection: 'about',
        id: 'about-1',
        path: 'imageSource',
        url: '/images/about.webp',
      },
      {
        collection: 'about',
        id: 'about-1',
        path: 'profileImage',
        url: '/images/profile.webp',
      },
      {
        collection: 'projects_and_cases',
        id: 'project-1',
        path: 'imageSource',
        url: '/images/project.webp',
      },
      {
        collection: 'projects_and_cases',
        id: 'project-1',
        path: 'projectDetails.imageSources[0]',
        url: '/images/modern.webp',
      },
      {
        collection: 'projects_and_cases',
        id: 'project-1',
        path: 'projectDetails.imagesSources[0]',
        url: '/images/legacy.webp',
      },
      {
        collection: 'pursuit',
        id: 'pursuit-1',
        path: 'leftImageSource',
        url: '/images/left.webp',
      },
      {
        collection: 'pursuit',
        id: 'pursuit-1',
        path: 'rightImageSource',
        url: '/images/Missing.webp?width=400',
      },
    ]);

    const issues = await findMissingAssetReferences(root, references);
    assert.deepEqual(issues, [
      {
        code: 'asset_missing',
        collection: 'pursuit',
        id: 'pursuit-1',
        path: 'rightImageSource',
      },
    ]);
    assert.equal(JSON.stringify(issues).includes('/images/'), false);
  });
});
