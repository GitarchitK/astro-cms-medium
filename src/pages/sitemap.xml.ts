import type { APIRoute } from 'astro';
import { adminDb } from '../lib/firebase-admin';

async function getSiteUrl() {
  let siteUrl = 'https://mershal.in';
  if (!adminDb) return siteUrl;
  try {
    const settingsDoc = await adminDb.collection('settings').doc('general').get();
    if (settingsDoc.exists) {
      siteUrl = settingsDoc.data()?.siteUrl || 'https://mershal.in';
    }
  } catch (e) {
    console.warn('Could not load siteUrl from settings:', e);
  }
  return siteUrl.replace(/\/$/, ''); // Remove trailing slash if present
}

export const GET: APIRoute = async () => {
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const siteUrl = await getSiteUrl();
    const now = new Date();

    // 1. Fetch all published categories
    const categoriesSnapshot = await adminDb.collection('categories').get();
    const categories = categoriesSnapshot.docs.map(doc => {
      const d = doc.data();
      return d.slug || '';
    }).filter(Boolean);

    // 2. Fetch all published articles (excluding drafts and scheduled posts)
    const articlesSnapshot = await adminDb.collection('articles')
      .where('status', '==', 'published')
      .get();

    const articles = articlesSnapshot.docs
      .map(doc => {
        const d = doc.data();
        const pDate = d.publish_date?.toDate?.() || 
                      (d.publish_date instanceof Date ? d.publish_date : null);
        const uDate = d.updated_date?.toDate?.() || pDate || now;
        
        return {
          slug: d.slug || '',
          categorySlug: (d.category || 'ai-tools').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          publishDate: pDate,
          modifiedDate: uDate
        };
      })
      .filter(art => art.slug && art.publishDate && art.publishDate <= now);

    // 3. Assemble sitemap XML contents
    const urls = [];

    // Homepage
    urls.push(`
      <url>
        <loc>${siteUrl}/</loc>
        <lastmod>${now.toISOString()}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
      </url>
    `);

    // Categories
    categories.forEach(slug => {
      urls.push(`
        <url>
          <loc>${siteUrl}/category/${slug}</loc>
          <lastmod>${now.toISOString()}</lastmod>
          <changefreq>weekly</changefreq>
          <priority>0.7</priority>
        </url>
      `);
    });

    // Articles
    articles.forEach(art => {
      urls.push(`
        <url>
          <loc>${siteUrl}/${art.categorySlug}/${art.slug}</loc>
          <lastmod>${art.modifiedDate.toISOString()}</lastmod>
          <changefreq>monthly</changefreq>
          <priority>0.8</priority>
        </url>
      `);
    });

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.join('').trim()}
</urlset>`;

    return new Response(sitemapXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      }
    });

  } catch (error: any) {
    console.error('Failed to generate sitemap:', error);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
      status: 500,
      headers: { 'Content-Type': 'application/xml' }
    });
  }
};
