import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  const robots = `User-agent: *
Allow: /

# Admin and API exclusions
Disallow: /admin
Disallow: /admin/
Disallow: /api/
Disallow: /api

Sitemap: https://mershal.in/sitemap.xml
`;

  return new Response(robots, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800'
    }
  });
};
