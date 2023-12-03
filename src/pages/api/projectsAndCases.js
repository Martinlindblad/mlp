import { connectToDatabase } from 'lib/mongodb';

export default async function handler(request, response) {
  const { database } = await connectToDatabase();
  const collection = database.collection('projects_and_cases');

  const results = await collection.find({}).limit(50).toArray();

  response.status(200).json(results);
}
