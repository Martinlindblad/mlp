import NextResponse from 'next/server';

export async function contactForm(req) {
  const { name, email, message } = req.json();

  if (!name || !email || !message) {
    return NextResponse.json({ errorMessage: 'Missing fields' });
  }

  // Send email
  return NextResponse.json({ successMessage: 'Email sent successfully' });
}
