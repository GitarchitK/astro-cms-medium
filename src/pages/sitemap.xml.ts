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

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export const GET: APIRoute = async () => {
  const now = new Date();
  let siteUrl = 'https://mershal.in';
  
  // Static pages list
  const staticPages = [
    { path: '', changefreq: 'daily', priority: '1.0' },
    { path: '/articles', changefreq: 'daily', priority: '0.8' },
    { path: '/about', changefreq: 'monthly', priority: '0.5' },
    { path: '/contact', changefreq: 'monthly', priority: '0.5' },
    { path: '/privacy', changefreq: 'monthly', priority: '0.3' },
    { path: '/terms', changefreq: 'monthly', priority: '0.3' },
    { path: '/disclaimer', changefreq: 'monthly', priority: '0.3' }
  ];

  try {
    siteUrl = await getSiteUrl();

    let articles: any[] = [];
    let activeCategorySlugs = new Set<string>();
    let latestArticleDate = new Date();

    if (adminDb) {
      // 1. Fetch published articles (excluding drafts/scheduled) with field selection
      const articlesSnapshot = await adminDb.collection('articles')
        .where('status', '==', 'published')
        .select('slug', 'category', 'publish_date', 'updated_date')
        .get();

      articles = articlesSnapshot.docs
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

      // Determine active categories and latest update date
      if (articles.length > 0) {
        const dates = articles.map(art => art.modifiedDate).filter(Boolean);
        if (dates.length > 0) {
          latestArticleDate = new Date(Math.max(...dates.map(d => d.getTime())));
        }
        articles.forEach(art => {
          if (art.categorySlug) {
            activeCategorySlugs.add(art.categorySlug);
          }
        });
      }
    }

    const urls: string[] = [];

    // Add static pages
    staticPages.forEach(page => {
      // For index pages, use the latest article update date to notify crawlers of updates
      const isIndex = page.path === '' || page.path === '/articles';
      const lastModDate = isIndex ? latestArticleDate : now;
      
      urls.push(`
  <url>
    <loc>${escapeXml(`${siteUrl}${page.path}`)}</loc>
    <lastmod>${lastModDate.toISOString()}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`);
    });

    // Add active categories
    activeCategorySlugs.forEach(slug => {
      urls.push(`
  <url>
    <loc>${escapeXml(`${siteUrl}/category/${slug}`)}</loc>
    <lastmod>${latestArticleDate.toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`);
    });

    // Add published articles (sorted by modifiedDate desc)
    articles.sort((a, b) => b.modifiedDate.getTime() - a.modifiedDate.getTime());
    articles.forEach(art => {
      urls.push(`
  <url>
    <loc>${escapeXml(`${siteUrl}/${art.categorySlug}/${art.slug}`)}</loc>
    <lastmod>${art.modifiedDate.toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`);
    });

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('').trim()}
</urlset>`;

    return new Response(sitemapXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=3600, s-maxage=18000'
      }
    });

  } catch (error: any) {
    console.error('Failed to generate sitemap:', error);
    
    // Professional fallback when database is down or failed
    const fallbackUrls = staticPages.map(page => `
  <url>
    <loc>${escapeXml(`${siteUrl}${page.path}`)}</loc>
    <lastmod>${now.toISOString()}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('');

    const fallbackXml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${fallbackUrls.trim()}
</urlset>`;

    return new Response(fallbackXml, {
      status: 200, // Return 200 with fallback so search engines don't receive error
      headers: { 
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    });
  }
};
