import type { APIRoute } from 'astro';
import { adminDb } from '../lib/firebase-admin';

export const GET: APIRoute = async () => {
  const baseUrl = 'https://mershal.in';
  let itemsXml = '';

  if (adminDb) {
    try {
      const snapshot = await adminDb.collection('articles')
        .where('status', '==', 'published')
        .orderBy('publish_date', 'desc')
        .limit(20)
        .get();

      const now = new Date();
      const articles = snapshot.docs
        .map(doc => {
          const d = doc.data();
          return {
            title: d.title || '',
            slug: d.slug || doc.id,
            categorySlug: (d.category || 'ai-tools').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            excerpt: d.excerpt || '',
            publishDate: d.publish_date?.toDate?.() || null,
            author: d.author || 'Mershal Editorial Team'
          };
        })
        .filter(art => art.publishDate && art.publishDate <= now);

      itemsXml = articles.map(art => `
    <item>
      <title><![CDATA[${art.title}]]></title>
      <link>${baseUrl}/${art.categorySlug}/${art.slug}</link>
      <guid isPermaLink="true">${baseUrl}/${art.categorySlug}/${art.slug}</guid>
      <pubDate>${art.publishDate!.toUTCString()}</pubDate>
      <author>${art.author}</author>
      <description><![CDATA[${art.excerpt}]]></description>
    </item>`).join('');

    } catch (e) {
      console.error('RSS feed Firestore fetch error:', e);
    }
  }

  const rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Mershal</title>
    <link>${baseUrl}</link>
    <description>Authority blueprints, technology guides, side hustles and software reviews for digital builders.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml" />
    ${itemsXml}
  </channel>
</rss>`;

  return new Response(rssFeed, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600, s-maxage=18000'
    }
  });
};
