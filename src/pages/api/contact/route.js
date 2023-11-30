import { NextResponse } from 'next/server';
import { connectToDatabase } from 'src/lib/mongodb';

/**
 * @param {{ json: () => PromiseLike<{ fullname: any; email: any; message: any; }> | { fullname: any; email: any; message: any; }; }} req
 */
export async function POST(req) {
  const { fullname, email, message } = await req.json();

  if (!fullname || !email || !message) {
    return NextResponse.json({
      errorMessage: ['Missing fields'],
      success: false,
    });
  }

  try {
    const { database } = await connectToDatabase();

    await database
      .collection('contact')
      .insertOne({ fullname, email, message });

    return NextResponse.json({
      successMessage: 'Message sent successfully',
      success: true,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({
      errorMessage: ['Unable to send message.'],
      success: false,
    });
  }
}

export default POST;
