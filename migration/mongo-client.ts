import { lstatSync, readFileSync } from 'node:fs';
import { MongoClient, type Db } from 'mongodb';

export async function withSourceDatabase<T>(
  run: (db: Db) => Promise<T>,
): Promise<T> {
  const uriFile = process.env.MONGO_URI_FILE?.trim();
  const databaseName = process.env.MONGO_DATABASE?.trim();
  if (!uriFile || !databaseName) {
    throw new Error('migration source configuration missing');
  }
  let uri: string;
  try {
    const file = lstatSync(uriFile);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
      throw new Error('invalid secret file');
    }
    uri = readFileSync(uriFile, 'utf8').trim();
    if (/[\r\n]/.test(uri)) throw new Error('invalid secret file');
  } catch {
    throw new Error('migration source configuration invalid');
  }
  if (!uri) throw new Error('migration source configuration invalid');
  let client: MongoClient;
  try {
    client = new MongoClient(uri, {
      appName: 'mlp-read-only-migration',
      serverSelectionTimeoutMS: 5_000,
    });
  } catch {
    throw new Error('migration source configuration invalid');
  }
  try {
    try {
      await client.connect();
    } catch {
      throw new Error('migration source connection failed');
    }
    return await run(client.db(databaseName));
  } finally {
    try {
      await client.close();
    } catch {
      throw new Error('migration source cleanup failed');
    }
  }
}
