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
        isCustomHtml: !!d.isCustomHtml,
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
    let { title, slug, excerpt, author, content, featuredImage, status, publishDate, tags, faq_items, isCustomHtml } = data;

    if (!title) {
      return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400 });
    }

    slug = slug || generateSlug(title);
    const wordCount = countWords(content?.replace(/<[^>]*>/g, '') || '');
    const readingTime = Math.ceil(wordCount / 200);

    // Check duplicate slug
    const existing = await adminDb.collection('articles').where('slug', '==', slug).limit(1).get();
    if (!existing.empty) {
      return new Response(JSON.stringify({ error: 'An article with this slug already exists' }), { status: 409 });
    }

    const publishDateObj = publishDate ? new Date(publishDate) : new Date();

    const articleDoc = {
      title,
      slug,
      excerpt: excerpt || '',
      content: content || '',
      category: data.category || 'AI Tools',
      tags: tags || [],
      featured_image: featuredImage || '',
      author: author || 'Editor',
      status: status || 'published',
      meta_title: data.seoTitle || title,
      meta_description: data.seoDescription || excerpt || '',
      wordCount,
      readingTime,
      publish_date: publishDateObj,
      updated_date: new Date(),
      faq_items: faq_items || [],
      isCustomHtml: !!isCustomHtml,
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

    let { title, slug, excerpt, author, content, featuredImage, status, publishDate, tags, faq_items, isCustomHtml } = fields;

    if (!title) {
      return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400 });
    }

    slug = slug || generateSlug(title);
    const wordCount = countWords(content?.replace(/<[^>]*>/g, '') || '');
    const readingTime = Math.ceil(wordCount / 200);

    const publishDateObj = publishDate ? new Date(publishDate) : new Date();

    const articleDoc = {
      title,
      slug,
      excerpt: excerpt || '',
      content: content || '',
      category: fields.category || 'AI Tools',
      tags: tags || [],
      featured_image: featuredImage || '',
      author: author || 'Editor',
      status: status || 'published',
      meta_title: fields.seoTitle || title,
      meta_description: fields.seoDescription || excerpt || '',
      wordCount,
      readingTime,
      publish_date: publishDateObj,
      updated_date: new Date(),
      faq_items: faq_items || [],
      isCustomHtml: !!isCustomHtml,
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
