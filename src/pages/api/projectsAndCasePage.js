import { connectToDatabase } from 'lib/mongodb';

export default async function handler(request, response) {
  const { database } = await connectToDatabase();

  const cases = await database
    .collection('projects_and_cases')
    .find({}, { projection: { _id: 1 } })
    .toArray();

  // Map over the cases and return just the IDs
  const ids = cases.map((c) => c._id.toString());

  response.status(200).json(ids);
}
