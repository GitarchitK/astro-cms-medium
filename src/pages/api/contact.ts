import type { APIRoute } from 'astro';
import { adminDb } from '../../lib/firebase-admin';

export const POST: APIRoute = async ({ request }) => {
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'Database not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const data = await request.json();
    const { name, email, subject, message } = data;

    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields (name, email, message)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Save to Firestore contacts collection
    await adminDb.collection('contacts').add({
      name,
      email,
      subject: subject || 'General Inquiry',
      message,
      submitted_at: new Date()
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    console.error('Contact API submission error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
