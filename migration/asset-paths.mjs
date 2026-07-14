import { execFile as execFileCallback } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const supportedExtensions = new Set([
  '.css',
  '.js',
  '.jsx',
  '.json',
  '.ts',
  '.tsx',
  '.xml',
]);
const localUrlPattern =
  /(?<![A-Za-z0-9._~:/-])\/(?:(?:images|assets)\/|(?:favicon|manifest)(?=[./?#\s"'`<>)}\]]|$))[^\s"'`<>)}\]]*/giu;
const encodedUnsafePattern = /%(?:00|2f|5c)/iu;
const safeIdentifierPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

async function trackedPaths(repositoryRoot) {
  const { stdout } = await execFile('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });

  return stdout.toString('utf8').split('\0').filter(Boolean);
}

function assetPathError(message) {
  return new Error(message);
}

function safeIdentifier(row) {
  const candidate = row?._id ?? row?.id;
  let value;
  if (typeof candidate === 'string') {
    value = candidate;
  } else if (candidate && typeof candidate.toHexString === 'function') {
    try {
      value = candidate.toHexString();
    } catch {
      value = undefined;
    }
  }
  return typeof value === 'string' && safeIdentifierPattern.test(value)
    ? value
    : 'unknown';
}

function addReference(references, collection, id, structuralPath, value) {
  if (typeof value !== 'string' || value.length === 0) return;
  references.push({ collection, id, path: structuralPath, url: value });
}

export function normalizeLocalAssetUrl(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    throw assetPathError('local asset URL must be an absolute path');
  }
  const suffixIndex = value.search(/[?#]/u);
  const encodedPath = suffixIndex === -1 ? value : value.slice(0, suffixIndex);
  if (
    encodedPath.includes('\\') ||
    encodedPath.includes('\0') ||
    encodedUnsafePattern.test(encodedPath)
  ) {
    throw assetPathError('local asset URL contains an unsafe separator');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    throw assetPathError('local asset URL contains invalid encoding');
  }
  if (
    decodedPath.includes('\\') ||
    decodedPath.includes('\0') ||
    encodedUnsafePattern.test(decodedPath)
  ) {
    throw assetPathError('local asset URL contains an unsafe decoded value');
  }

  const segments = decodedPath.slice(1).split('/');
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  ) {
    throw assetPathError('local asset URL contains an unsafe path segment');
  }
  return decodedPath;
}

export async function assertExactPath(publicRoot, urlPath) {
  const normalized = normalizeLocalAssetUrl(urlPath);
  const segments = normalized.slice(1).split('/');
  let current = path.resolve(publicRoot);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const entries = await readdir(current, { withFileTypes: true });
    const entry = entries.find(({ name }) => name === segment);
    if (!entry)
      throw assetPathError('asset path has no exact filesystem match');
    const finalSegment = index === segments.length - 1;
    if (entry.isSymbolicLink()) {
      throw assetPathError(
        finalSegment
          ? 'asset path must end in a regular file'
          : 'asset path contains a symbolic link',
      );
    }

    current = path.join(current, segment);
    if (!finalSegment && !entry.isDirectory()) {
      throw assetPathError('asset path has a non-directory segment');
    }
    if (finalSegment) {
      const status = await lstat(current);
      if (status.isSymbolicLink() || !status.isFile()) {
        throw assetPathError('asset path must end in a regular file');
      }
    }
  }

  return current;
}

export async function collectTrackedLocalUrls(repositoryRoot) {
  const urls = new Set();
  const filenames = await trackedPaths(repositoryRoot);

  for (const filename of filenames) {
    if (!supportedExtensions.has(path.extname(filename).toLowerCase()))
      continue;
    const source = await readFile(path.join(repositoryRoot, filename), 'utf8');
    for (const match of source.matchAll(localUrlPattern)) {
      urls.add(normalizeLocalAssetUrl(match[0]));
    }
  }

  return [...urls].sort(compareCodePoints);
}

export async function findGitCaseCollisions(repositoryRoot) {
  const groups = new Map();
  for (const filename of await trackedPaths(repositoryRoot)) {
    const folded = filename.normalize('NFC').toLowerCase();
    const group = groups.get(folded) ?? [];
    group.push(filename);
    groups.set(folded, group);
  }

  return [...groups.values()]
    .filter((group) => new Set(group).size > 1)
    .map((group) => [...new Set(group)].sort(compareCodePoints))
    .sort((left, right) => compareCodePoints(left[0], right[0]));
}

export function collectDatabaseAssetReferences(collection, row) {
  const id = safeIdentifier(row);
  const references = [];

  if (collection === 'about') {
    addReference(references, collection, id, 'imageSource', row?.imageSource);
    addReference(references, collection, id, 'profileImage', row?.profileImage);
  } else if (collection === 'projects_and_cases') {
    addReference(references, collection, id, 'imageSource', row?.imageSource);
    const modern = row?.projectDetails?.imageSources;
    if (Array.isArray(modern)) {
      modern.forEach((value, index) =>
        addReference(
          references,
          collection,
          id,
          `projectDetails.imageSources[${index}]`,
          value,
        ),
      );
    }
    const legacy = row?.projectDetails?.imagesSources;
    if (Array.isArray(legacy)) {
      legacy.forEach((value, index) =>
        addReference(
          references,
          collection,
          id,
          `projectDetails.imagesSources[${index}]`,
          value,
        ),
      );
    }
  } else if (collection === 'pursuit') {
    addReference(
      references,
      collection,
      id,
      'leftImageSource',
      row?.leftImageSource,
    );
    addReference(
      references,
      collection,
      id,
      'rightImageSource',
      row?.rightImageSource,
    );
  }

  return references;
}

export async function findMissingAssetReferences(publicRoot, references) {
  const issues = [];
  for (const reference of references) {
    try {
      await assertExactPath(publicRoot, reference.url);
    } catch {
      issues.push({
        code: 'asset_missing',
        collection: reference.collection,
        id: safeIdentifier(reference),
        path: reference.path,
      });
    }
  }
  return issues;
}
