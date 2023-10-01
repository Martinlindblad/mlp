/* eslint-disable no-underscore-dangle */
import { MongoClient, Db } from 'mongodb';

const uri = process.env.NEXT_ATLAS_URI;

let mongoClient: MongoClient | null = null;
let database: Db | null = null;

if (!uri) {
  throw new Error('Please add your Mongo URI to .env.local');
}

interface DatabaseConnection {
  mongoClient: MongoClient;
  database: Db;
}

export async function connectToDatabase(): Promise<DatabaseConnection> {
  try {
    if (mongoClient && database) {
      return { mongoClient, database };
    }

    if (process.env.NODE_ENV === 'development') {
      if (!global._mongoClient && uri) {
        mongoClient = new MongoClient(uri);
        await mongoClient.connect();
        global._mongoClient = mongoClient;
      } else {
        mongoClient = global._mongoClient as MongoClient;
      }
    } else if (uri) {
      mongoClient = new MongoClient(uri);
      await mongoClient.connect();
    }

    if (!process.env.NEXT_ATLAS_DATABASE) {
      throw new Error('Please define your Mongo database in .env.local');
    }
    if (!mongoClient) {
      throw new Error('Failed to connect to Mongo database');
    }
    database = mongoClient.db(process.env.NEXT_ATLAS_DATABASE);

    return { mongoClient, database };
  } catch (e) {
    console.error(e);
    throw e;
  }
}
