import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';
import { getGoogleAnalyticsReport } from '../../../lib/google-api';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

function generateMockData() {
  const data = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    // Format YYYYMMDD to match GA4 date format
    const formatted = d.toISOString().split('T')[0].replace(/-/g, '');
    data.push({
      date: formatted,
      views: Math.floor(100 + Math.random() * 300)
    });
  }
  return data;
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
      
      // Parse GA4 Report
      const rows = result.rows || [];
      const report = rows.map((row: any) => {
        const dateStr = row.dimensionValues?.[0]?.value || ''; // YYYYMMDD
        const viewsStr = row.metricValues?.[0]?.value || '0';
        return {
          date: dateStr,
          views: parseInt(viewsStr, 10)
        };
      });

      // Sort by date ascending
      report.sort((a: any, b: any) => a.date.localeCompare(b.date));

      return new Response(JSON.stringify({
        configRequired: false,
        report
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (apiErr: any) {
      console.error('Google Analytics API Call Failed:', apiErr);
      return new Response(JSON.stringify({
        configRequired: false,
        error: apiErr.message || 'API Authentication Failed. Check service account credentials and permissions.',
        report: mock // fallback to mock data so chart renders
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

  } catch (error: any) {
    console.error('Analytics GET handler failed:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
