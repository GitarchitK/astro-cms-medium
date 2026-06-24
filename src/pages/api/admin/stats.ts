import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

export const GET: APIRoute = async ({ cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const snapshot = await adminDb.collection('articles').get();
    
    let total = 0;
    let published = 0;
    let drafts = 0;
    let scheduled = 0;

    const now = new Date();

    snapshot.docs.forEach(doc => {
      total++;
      const data = doc.data();
      const status = data.status || 'published';
      const publishDate = data.publish_date?.toDate?.() || data.publishedAt?.toDate?.() || null;

      if (status === 'draft') {
        drafts++;
      } else if (status === 'published') {
        if (publishDate && publishDate > now) {
          scheduled++;
        } else {
          published++;
        }
      }
    });

    return new Response(JSON.stringify({
      total,
      published,
      drafts,
      scheduled
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
