import { MongoClient } from 'mongodb';

declare global {
  const mongoClientPromise: Promise<MongoClient>;
}
