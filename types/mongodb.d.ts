/* eslint-disable no-var */
import { MongoClient } from 'mongodb';

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention, no-underscore-dangle
  var _mongoClient: MongoClient | undefined;
}
