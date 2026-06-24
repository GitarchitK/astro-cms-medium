import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

function generateSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function countWords(text: string) {
  return text.trim().split(/\s+/).length;
}

// GET - list all articles or single article
export const GET: APIRoute = async ({ url, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  const id = url.searchParams.get('id');

  try {
    if (id) {
      const doc = await adminDb.collection('articles').doc(id).get();
      if (!doc.exists) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      
      const d = doc.data() || {};
      return new Response(JSON.stringify({
        id: doc.id,
        title: d.title,
        slug: d.slug,
        excerpt: d.excerpt,
        content: d.content,
        category: d.category,
        tags: d.tags || [],
        featuredImage: d.featured_image || d.featuredImage || '',
        author: d.author,
        status: d.status,
        meta_title: d.meta_title || d.seoTitle || '',
        meta_description: d.meta_description || d.seoDescription || '',
        publishDate: d.publish_date?.toDate?.()?.toISOString() || null,
        faq_items: d.faq_items || [],
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // List all articles
    const snapshot = await adminDb.collection('articles').orderBy('publish_date', 'desc').limit(100).get();
    const posts = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title,
        slug: d.slug,
        category: d.category,
        status: d.status,
        author: d.author,
        publishedAt: d.publish_date?.toDate?.()?.toISOString() || null,
        wordCount: d.wordCount || 0,
      };
    });

    return new Response(JSON.stringify(posts), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

// POST - create new article
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const data = await request.json();
    const slug = data.slug || generateSlug(data.title);
    const wordCount = countWords(data.content?.replace(/<[^>]*>/g, '') || '');
    const readingTime = Math.ceil(wordCount / 200);

    // Check duplicate slug
    const existing = await adminDb.collection('articles').where('slug', '==', slug).limit(1).get();
    if (!existing.empty) {
      return new Response(JSON.stringify({ error: 'An article with this slug already exists' }), { status: 409 });
    }

    const publishDate = data.publishDate ? new Date(data.publishDate) : new Date();

    const articleDoc = {
      title: data.title,
      slug,
      excerpt: data.excerpt || '',
      content: data.content || '',
      category: data.category || 'AI Tools',
      tags: data.tags || [],
      featured_image: data.featuredImage || '',
      author: data.author || 'Editor',
      status: data.status || 'published',
      meta_title: data.seoTitle || data.title,
      meta_description: data.seoDescription || data.excerpt || '',
      wordCount,
      readingTime,
      publish_date: publishDate,
      updated_date: new Date(),
      faq_items: data.faq_items || [],
    };

    const ref = await adminDb.collection('articles').add(articleDoc);

    return new Response(JSON.stringify({ id: ref.id, slug }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

// PUT - update article
export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const data = await request.json();
    const { id, ...fields } = data;
    if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

    const wordCount = countWords(fields.content?.replace(/<[^>]*>/g, '') || '');
    const readingTime = Math.ceil(wordCount / 200);

    const publishDate = fields.publishDate ? new Date(fields.publishDate) : new Date();

    const articleDoc = {
      title: fields.title,
      slug: fields.slug,
      excerpt: fields.excerpt || '',
      content: fields.content || '',
      category: fields.category || 'AI Tools',
      tags: fields.tags || [],
      featured_image: fields.featuredImage || '',
      author: fields.author || 'Editor',
      status: fields.status || 'published',
      meta_title: fields.seoTitle || fields.title,
      meta_description: fields.seoDescription || fields.excerpt || '',
      wordCount,
      readingTime,
      publish_date: publishDate,
      updated_date: new Date(),
      faq_items: fields.faq_items || [],
    };

    await adminDb.collection('articles').doc(id).update(articleDoc);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

// DELETE - delete article
export const DELETE: APIRoute = async ({ url, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

  try {
    await adminDb.collection('articles').doc(id).delete();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
