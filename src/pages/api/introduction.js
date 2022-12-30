import { connectToDatabase } from '../../../lib/mongodb';

export default async function handler(request, response) {
  const { database } = await connectToDatabase();
  const collection = database.collection('about');

  const results = await collection.find({}).limit(10).toArray();

  response.status(200).json(results);
}
