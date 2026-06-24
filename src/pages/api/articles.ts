import type { APIRoute } from 'astro';
import { adminDb } from '../../lib/firebase-admin';

export const GET: APIRoute = async ({ url }) => {
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'Firebase not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const category = url.searchParams.get('category');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    
    let query = adminDb.collection('articles')
      .where('status', '==', 'published')
      .orderBy('publish_date', 'desc');
      
    if (category) {
      query = query.where('category', '==', category);
    }
    
    const snapshot = await query.limit(limit).get();
    const now = new Date();
    
    const articles = snapshot.docs
      .map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          slug: d.slug || doc.id,
          title: d.title || '',
          excerpt: d.excerpt || '',
          content: d.content || '',
          category: d.category || 'AI Tools',
          tags: d.tags || [],
          publishDate: d.publish_date?.toDate?.() || null
        };
      })
      // Filter out scheduled articles in memory to avoid index creation issues in Firestore
      .filter(art => art.publishDate && art.publishDate <= now);
    
    return new Response(JSON.stringify(articles), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Public articles fetch API error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
