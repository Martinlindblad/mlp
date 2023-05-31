import { connectToDatabase } from 'public/lib/mongodb';

export default async function handler(request, response) {
  const { database } = await connectToDatabase();
  const collection = database.collection('social_media');

  const results = await collection.find({}).limit(10).toArray();

  response.status(200).json(results);
}
