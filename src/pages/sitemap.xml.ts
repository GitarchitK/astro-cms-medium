import type { APIRoute } from 'astro';
import { adminDb } from '../lib/firebase-admin';

export const GET: APIRoute = async () => {
  const baseUrl = 'https://mershal.in';
  
  // 1. Static URLs
  const staticPages = [
    '',
    '/articles',
    '/about',
    '/contact',
    '/privacy',
    '/terms',
    '/disclaimer'
  ];

  // 2. Category Hubs
  const categories = [
    '/category/ai-tools',
    '/category/technology-guides',
    '/category/software-reviews',
    '/category/seo-blogging',
    '/category/web-development',
    '/category/productivity',
    '/category/freelancing',
    '/category/side-hustles',
    '/category/remote-work',
    '/category/startup-stories'
  ];

  let articleUrls: string[] = [];

  if (adminDb) {
    try {
      const snapshot = await adminDb.collection('articles')
        .where('status', '==', 'published')
        .orderBy('publish_date', 'desc')
        .get();

      const now = new Date();
      articleUrls = snapshot.docs
        .map(doc => {
          const d = doc.data();
          const pDate = d.publish_date?.toDate?.() || null;
          return {
            slug: d.slug || doc.id,
            categorySlug: (d.category || 'ai-tools').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            publishDate: pDate
          };
        })
        // Filter out drafts/future scheduled in memory
        .filter(art => art.publishDate && art.publishDate <= now)
        .map(art => `/${art.categorySlug}/${art.slug}`);
    } catch (e) {
      console.error('Sitemap generation firestore error:', e);
    }
  }

  // Combine all URLs
  const allUrls = [...staticPages, ...categories, ...articleUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${allUrls
    .map(
      url => {
        const isArticle = articleUrls.includes(url);
        return `
  <url>
    <loc>${baseUrl}${url}</loc>
    <changefreq>${url === '' || url === '/articles' ? 'daily' : 'weekly'}</changefreq>
    <priority>${url === '' ? '1.0' : isArticle ? '0.8' : '0.5'}</priority>
  </url>`;
      }
    )
    .join('')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600, s-maxage=18000'
    }
  });
};
