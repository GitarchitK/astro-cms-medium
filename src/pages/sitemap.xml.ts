import type { APIRoute } from 'astro';
import { adminDb } from '../lib/firebase-admin';

export const GET: APIRoute = async () => {
  const baseUrl = 'https://mershal.in';
  const now = new Date();

  // 1. Static Pages
  const staticPages = [
    { path: '', changefreq: 'daily', priority: '1.0', lastmod: now.toISOString() },
    { path: '/articles', changefreq: 'daily', priority: '0.9', lastmod: now.toISOString() },
    { path: '/about', changefreq: 'weekly', priority: '0.7', lastmod: now.toISOString() },
    { path: '/contact', changefreq: 'monthly', priority: '0.6', lastmod: now.toISOString() },
    { path: '/privacy', changefreq: 'monthly', priority: '0.5', lastmod: now.toISOString() },
    { path: '/terms', changefreq: 'monthly', priority: '0.5', lastmod: now.toISOString() },
    { path: '/disclaimer', changefreq: 'monthly', priority: '0.5', lastmod: now.toISOString() }
  ];

  // 2. Default Built-in Categories
  const defaultCategories = [
    'ai-tools',
    'technology-guides',
    'software-reviews',
    'seo-blogging',
    'web-development',
    'productivity',
    'freelancing',
    'side-hustles',
    'remote-work',
    'startup-stories'
  ];

  let categorySlugs = [...defaultCategories];
  let articleUrls: { path: string; lastmod: string; changefreq: string; priority: string }[] = [];

  if (adminDb) {
    try {
      // Fetch custom categories dynamically from Firestore
      const categoriesSnap = await adminDb.collection('categories').get();
      if (!categoriesSnap.empty) {
        categoriesSnap.docs.forEach(doc => {
          const slug = doc.data().slug;
          if (slug && !categorySlugs.includes(slug)) {
            categorySlugs.push(slug);
          }
        });
      }

      // Fetch published articles
      const snapshot = await adminDb.collection('articles')
        .where('status', '==', 'published')
        .orderBy('publish_date', 'desc')
        .get();

      articleUrls = snapshot.docs
        .map(doc => {
          const d = doc.data();
          let pDate = null;
          if (d.publish_date) {
            if (typeof d.publish_date.toDate === 'function') {
              pDate = d.publish_date.toDate();
            } else {
              pDate = new Date(d.publish_date);
            }
          }

          let uDate = pDate;
          if (d.updated_date) {
            if (typeof d.updated_date.toDate === 'function') {
              uDate = d.updated_date.toDate();
            } else {
              uDate = new Date(d.updated_date);
            }
          }

          return {
            slug: d.slug || doc.id,
            categorySlug: (d.category || 'ai-tools').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            publishDate: pDate,
            modifiedDate: uDate || pDate || now
          };
        })
        // Filter out drafts/future scheduled in memory
        .filter(art => art.publishDate && art.publishDate <= now)
        .map(art => ({
          path: `/${art.categorySlug}/${art.slug}`,
          lastmod: art.modifiedDate.toISOString(),
          changefreq: 'weekly',
          priority: '0.8'
        }));
    } catch (e) {
      console.error('Sitemap dynamic generation firestore error:', e);
    }
  }

  // Combine categories
  const categoryPages = categorySlugs.map(slug => ({
    path: `/category/${slug}`,
    changefreq: 'weekly',
    priority: '0.7',
    lastmod: now.toISOString()
  }));

  // Combine all sitemap entries
  const allUrls = [...staticPages, ...categoryPages, ...articleUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${allUrls
    .map(
      url => `
  <url>
    <loc>${baseUrl}${url.path}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`
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
