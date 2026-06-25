import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

// GET: Export all articles as a downloadable JSON file
export const GET: APIRoute = async ({ cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const articlesSnapshot = await adminDb.collection('articles').get();
    const articles = articlesSnapshot.docs.map(doc => {
      const data = doc.data();
      
      // Convert timestamps to ISO string representations
      const publishDate = data.publish_date?.toDate?.()?.toISOString() || 
                          (data.publish_date instanceof Date ? data.publish_date.toISOString() : null);
      const updatedDate = data.updated_date?.toDate?.()?.toISOString() || 
                          (data.updated_date instanceof Date ? data.updated_date.toISOString() : null);

      return {
        title: data.title || '',
        slug: data.slug || '',
        excerpt: data.excerpt || '',
        content: data.content || '',
        category: data.category || 'AI Tools',
        tags: data.tags || [],
        featuredImage: data.featured_image || data.featuredImage || '',
        author: data.author || 'Editor',
        status: data.status || 'published',
        meta_title: data.meta_title || '',
        meta_description: data.meta_description || '',
        wordCount: data.wordCount || 0,
        readingTime: data.readingTime || 1,
        publish_date: publishDate,
        updated_date: updatedDate,
        faq_items: data.faq_items || [],
        isCustomHtml: !!data.isCustomHtml,
        customCss: data.customCss || ''
      };
    });

    const exportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      articles
    };

    const fileName = `mershal-backup-${new Date().toISOString().split('T')[0]}.json`;

    return new Response(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    });

  } catch (error: any) {
    console.error('Failed to export articles:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

// POST: Import articles from JSON backup
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const { articles, mode } = await request.json(); // mode: 'merge' or 'overwrite'

    if (!Array.isArray(articles)) {
      return new Response(JSON.stringify({ error: 'Invalid backup file format' }), { status: 400 });
    }

    const collectionRef = adminDb.collection('articles');

    // If overwrite, wipe existing posts
    if (mode === 'overwrite') {
      const currentDocs = await collectionRef.get();
      const batch = adminDb.batch();
      currentDocs.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }

    let importCount = 0;
    const batchSize = 100;
    let batch = adminDb.batch();

    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];

      // Skip duplicate slugs in merge mode
      if (mode === 'merge' && art.slug) {
        const dup = await collectionRef.where('slug', '==', art.slug).limit(1).get();
        if (!dup.empty) {
          continue; // Skip duplicate slug
        }
      }

      const publishDateObj = art.publish_date ? new Date(art.publish_date) : new Date();
      const updatedDateObj = art.updated_date ? new Date(art.updated_date) : new Date();

      const newDoc = {
        title: art.title || 'Untitled',
        slug: art.slug || art.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        excerpt: art.excerpt || '',
        content: art.content || '',
        category: art.category || 'AI Tools',
        tags: art.tags || [],
        featured_image: art.featuredImage || art.featured_image || '',
        author: art.author || 'Editor',
        status: art.status || 'published',
        meta_title: art.meta_title || art.title || '',
        meta_description: art.meta_description || art.excerpt || '',
        wordCount: art.wordCount || 0,
        readingTime: art.readingTime || 1,
        publish_date: publishDateObj,
        updated_date: updatedDateObj,
        faq_items: art.faq_items || [],
        isCustomHtml: !!art.isCustomHtml,
        customCss: art.customCss || ''
      };

      const docRef = collectionRef.doc();
      batch.set(docRef, newDoc);
      importCount++;

      // Commit batches of 100
      if (importCount % batchSize === 0) {
        await batch.commit();
        batch = adminDb.batch();
      }
    }

    // Commit any leftovers
    if (importCount % batchSize !== 0) {
      await batch.commit();
    }

    return new Response(JSON.stringify({ success: true, count: importCount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Import failed:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
