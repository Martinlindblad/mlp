import { connectToDatabase } from 'lib/mongodb';

export default async function handler(request, response) {
  const { database } = await connectToDatabase();
  const collection = database.collection('languages');

  const results = await collection.find({}).limit(3).toArray();

  response.status(200).json(results);
}
