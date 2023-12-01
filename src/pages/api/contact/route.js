import { connectToDatabase } from 'src/lib/mongodb';

/**
 * @param {{ method: string; body: { fullName: string; email: string; subject: string; message: string; }; }} req
 * @param {{ status: (arg0: number) => { (): any; new (): any; json: { (arg0: { errorMessage?: string; success?: boolean; successMessage?: string; }): void; new (): any; }; }; }} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ errorMessage: 'Method Not Allowed' });
    return;
  }

  try {
    const { fullName, email, subject, message } = req.body;

    console.log('req.body:', req.body);

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
