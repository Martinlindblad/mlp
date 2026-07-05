import { connectToDatabase } from 'src/lib/mongodb';

/**
 * @param {import('next').NextApiRequest} req
 * @param {import('next').NextApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ errorMessage: 'Method Not Allowed' });
    return;
  }

  try {
    const { fullName, email, subject, message } = req.body;

    if (!fullName || !email || !subject || !message) {
      res.status(400).json({
        errorMessage: 'Missing fields',
        success: false,
      });
      return;
    }

    const { database } = await connectToDatabase();

    await database.collection('contact').insertOne({
      fullName,
      email,
      subject,
      message,
      date: new Date(),
    });

    res.status(201).json({
      successMessage: 'Message sent successfully',
      success: true,
    });
  } catch (error) {
    console.error('Insertion error:', error);
    res.status(500).json({
      errorMessage: 'Unable to send message.',
      success: false,
    });
  }
}
