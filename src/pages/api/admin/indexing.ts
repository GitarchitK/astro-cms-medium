import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';
import { submitToGoogleIndexing } from '../../../lib/google-api';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

export const GET: APIRoute = async ({ cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const hasCredentials = !!(
    (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || import.meta.env.FIREBASE_ADMIN_CLIENT_EMAIL) &&
    (process.env.FIREBASE_ADMIN_PRIVATE_KEY || import.meta.env.FIREBASE_ADMIN_PRIVATE_KEY)
  );

  if (!adminDb) {
    return new Response(JSON.stringify({
      hasCredentials,
      logs: []
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const snapshot = await adminDb
      .collection('indexing_logs')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    const logs = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        url: d.url || '',
        action: d.action || 'publish',
        timestamp: d.timestamp || new Date().toISOString(),
        status: d.status || 'success',
        response: d.response || ''
      };
    });

    return new Response(JSON.stringify({
      hasCredentials,
      logs
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('Failed to get indexing logs:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const { url, action } = await request.json();

    if (!url || !url.startsWith('http')) {
      return new Response(JSON.stringify({ error: 'Valid URL is required' }), { status: 400 });
    }

    const typeAction = action === 'delete' ? 'URL_DELETED' : 'URL_UPDATED';

    try {
      const result = await submitToGoogleIndexing(url, typeAction);
      
      const logEntry = {
        url,
        action: action || 'publish',
        timestamp: new Date().toISOString(),
        status: 'success',
        response: JSON.stringify(result)
      };

      await adminDb.collection('indexing_logs').add(logEntry);

      return new Response(JSON.stringify({ success: true, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (apiErr: any) {
      console.error('Manual indexing API notification failed:', apiErr);

      const logEntry = {
        url,
        action: action || 'publish',
        timestamp: new Date().toISOString(),
        status: 'failed',
        response: apiErr.message || 'API Call Failed'
      };

      await adminDb.collection('indexing_logs').add(logEntry);

      return new Response(JSON.stringify({
        error: apiErr.message || 'Auto-Indexing submission request failed.'
      }), { status: 422, headers: { 'Content-Type': 'application/json' } });
    }

  } catch (error: any) {
    console.error('Indexing POST handler failed:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
