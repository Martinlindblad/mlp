/* eslint-disable no-underscore-dangle */
import { MongoClient, Db } from 'mongodb';

let mongoClient: MongoClient | null = null;
let database: Db | null = null;

interface DatabaseConnection {
  mongoClient: MongoClient;
  database: Db;
}

export async function connectToDatabase(): Promise<DatabaseConnection> {
  const uri = process.env.NEXT_ATLAS_URI;
  const databaseName = process.env.NEXT_ATLAS_DATABASE;

  if (!uri) {
    throw new Error('Please add your Mongo URI to .env.local');
  }
  if (!databaseName) {
    throw new Error('Please define your Mongo database in .env.local');
  }

  if (mongoClient && database) {
    return { mongoClient, database };
  }

  if (process.env.NODE_ENV === 'development') {
    if (!global._mongoClient) {
      mongoClient = new MongoClient(uri);
      await mongoClient.connect();
      global._mongoClient = mongoClient;
    } else {
      mongoClient = global._mongoClient as MongoClient;
    }
  } else {
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
  }

  database = mongoClient.db(databaseName);

  return { mongoClient, database };
}
