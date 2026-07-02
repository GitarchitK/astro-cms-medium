import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';
import { getGoogleAnalyticsReport } from '../../../lib/google-api';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

function generateMockData() {
  const now = new Date();
  
  // 1. Daily views & users (30 days)
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
    const views = Math.floor(100 + Math.random() * 300);
    const users = Math.floor(views * 0.45 + Math.random() * 30); // ~45% views are unique active users
    daily.push({ date: dateStr, views, users });
  }

  // 2. Top performing page paths
  const pages = [
    { path: '/', title: 'Mershal — Human Stories & Expert Tech Blueprints', views: 2450 },
    { path: '/category/ai-tools', title: 'AI Tools Articles — Mershal', views: 1210 },
    { path: '/ai-tools/v0-by-vercel-guide', title: 'V0 by Vercel: The Future of Web Development', views: 980 },
    { path: '/category/web-development', title: 'Web Development — Mershal', views: 820 },
    { path: '/productivity/chatgpt-mac-app', title: 'How to Install and Setup ChatGPT Mac App', views: 760 },
    { path: '/about', title: 'About Us — Mershal', views: 420 },
    { path: '/category/remote-work', title: 'Remote Work Tips & Tools — Mershal', views: 350 },
    { path: '/category/freelancing', title: 'Freelancing Blueprint Guides — Mershal', views: 310 },
    { path: '/contact', title: 'Contact Us — Mershal', views: 180 }
  ];

  // 3. Traffic acquisition channels (Sources)
  const sources = [
    { source: 'Organic Search', users: 1450, percentage: 55 },
    { source: 'Direct', users: 660, percentage: 25 },
    { source: 'Organic Social', users: 310, percentage: 12 },
    { source: 'Referral', users: 215, percentage: 8 }
  ];

  // 4. Visitor countries
  const countries = [
    { country: 'United States', users: 1056, percentage: 40 },
    { country: 'India', users: 660, percentage: 25 },
    { country: 'United Kingdom', users: 396, percentage: 15 },
    { country: 'Canada', users: 264, percentage: 10 },
    { country: 'Germany', users: 264, percentage: 10 }
  ];

  // 5. Visitor device category profiles
  const devices = [
    { device: 'Mobile', users: 1584, percentage: 60 },
    { device: 'Desktop', users: 924, percentage: 35 },
    { device: 'Tablet', users: 132, percentage: 5 }
  ];

  return { daily, pages, sources, countries, devices };
}

export const GET: APIRoute = async ({ cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const mock = generateMockData();

  if (!adminDb) {
    return new Response(JSON.stringify({
      configRequired: true,
      error: 'Database not initialized',
      report: mock
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const doc = await adminDb.collection('settings').doc('general').get();
    const settings = doc.exists ? doc.data() : null;
    const ga4PropertyId = settings?.ga4PropertyId || '';

    if (!ga4PropertyId) {
      return new Response(JSON.stringify({
        configRequired: true,
        report: mock
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    try {
      const result = await getGoogleAnalyticsReport(ga4PropertyId);
      
      // Parse Daily Report
      const dailyRows = result.daily.rows || [];
      const daily = dailyRows.map((row: any) => {
        const date = row.dimensionValues?.[0]?.value || '';
        const views = parseInt(row.metricValues?.[0]?.value || '0', 10);
        const users = parseInt(row.metricValues?.[1]?.value || '0', 10);
        return { date, views, users };
      });
      daily.sort((a: any, b: any) => a.date.localeCompare(b.date));

      // Parse Top Pages
      const pagesRows = result.pages.rows || [];
      const pages = pagesRows.map((row: any) => {
        const path = row.dimensionValues?.[0]?.value || '';
        const title = row.dimensionValues?.[1]?.value || '';
        const views = parseInt(row.metricValues?.[0]?.value || '0', 10);
        return { path, title, views };
      });

      // Parse Sources (Channels)
      const sourcesRows = result.sources.rows || [];
      const totalSourceUsers = sourcesRows.reduce((acc: number, row: any) => acc + parseInt(row.metricValues?.[0]?.value || '0', 10), 0) || 1;
      const sources = sourcesRows.map((row: any) => {
        const source = row.dimensionValues?.[0]?.value || 'Unknown';
        const users = parseInt(row.metricValues?.[0]?.value || '0', 10);
        const percentage = Math.round((users / totalSourceUsers) * 100);
        return { source, users, percentage };
      });

      // Parse Countries
      const countriesRows = result.countries.rows || [];
      const totalCountryUsers = countriesRows.reduce((acc: number, row: any) => acc + parseInt(row.metricValues?.[0]?.value || '0', 10), 0) || 1;
      const countries = countriesRows.map((row: any) => {
        const country = row.dimensionValues?.[0]?.value || 'Unknown';
        const users = parseInt(row.metricValues?.[0]?.value || '0', 10);
        const percentage = Math.round((users / totalCountryUsers) * 100);
        return { country, users, percentage };
      });

      // Parse Devices
      const devicesRows = result.devices.rows || [];
      const totalDeviceUsers = devicesRows.reduce((acc: number, row: any) => acc + parseInt(row.metricValues?.[0]?.value || '0', 10), 0) || 1;
      const devices = devicesRows.map((row: any) => {
        const device = row.dimensionValues?.[0]?.value || 'Unknown';
        const users = parseInt(row.metricValues?.[0]?.value || '0', 10);
        const percentage = Math.round((users / totalDeviceUsers) * 100);
        return { device, users, percentage };
      });

      return new Response(JSON.stringify({
        configRequired: false,
        report: { daily, pages, sources, countries, devices }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (apiErr: any) {
      console.error('Google Analytics API Call Failed:', apiErr);
      return new Response(JSON.stringify({
        configRequired: false,
        error: apiErr.message || 'API Authentication Failed. Check service account credentials and permissions.',
        report: mock // fallback to mock data
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

  } catch (error: any) {
    console.error('Analytics GET handler failed:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
