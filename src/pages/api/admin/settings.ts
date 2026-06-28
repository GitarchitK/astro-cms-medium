import type { APIRoute } from 'astro';
import { adminDb } from '../../../lib/firebase-admin';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

const DEFAULT_SETTINGS = {
  title: 'Mershal',
  tagline: 'Authority Publisher Console',
  adminEmail: 'editorial@mershal.in',
  siteUrl: 'https://mershal.in',
  postsPerPage: '10',
  seoTitle: 'Mershal — Human Stories & Expert Tech Blueprints',
  seoDescription: 'Discover deep-dive blueprints and hands-on reviews about AI Tools, Web Development, Productivity, SEO, Freelancing, and Remote Work written by digital builders.',
  ga4PropertyId: '',
  geminiApiKey: '',
  openaiApiKey: ''
};

export const GET: APIRoute = async ({ cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || import.meta.env.FIREBASE_ADMIN_CLIENT_EMAIL || '';
  if (!adminDb) {
    return new Response(JSON.stringify({ ...DEFAULT_SETTINGS, envEmail: clientEmail }), { status: 200 });
  }

  try {
    const doc = await adminDb.collection('settings').doc('general').get();
    if (!doc.exists) {
      return new Response(JSON.stringify({ ...DEFAULT_SETTINGS, envEmail: clientEmail }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = doc.data() || {};
    // Mask sensitive keys
    const maskedSettings = {
      ...DEFAULT_SETTINGS,
      ...data,
      geminiApiKey: data.geminiApiKey ? '••••••••••••' : '',
      openaiApiKey: data.openaiApiKey ? '••••••••••••' : '',
      envEmail: clientEmail
    };

    return new Response(JSON.stringify(maskedSettings), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminDb) {
    return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 503 });
  }

  try {
    const data = await request.json();
    
    // Fetch current settings to preserve keys if unchanged (masked)
    const doc = await adminDb.collection('settings').doc('general').get();
    const currentData = doc.exists ? doc.data() : {};

    let geminiApiKey = data.geminiApiKey !== undefined ? data.geminiApiKey : '';
    if (geminiApiKey === '••••••••••••') {
      geminiApiKey = currentData?.geminiApiKey || '';
    }

    let openaiApiKey = data.openaiApiKey !== undefined ? data.openaiApiKey : '';
    if (openaiApiKey === '••••••••••••') {
      openaiApiKey = currentData?.openaiApiKey || '';
    }

    const newSettings = {
      title: data.title || DEFAULT_SETTINGS.title,
      tagline: data.tagline || DEFAULT_SETTINGS.tagline,
      adminEmail: data.adminEmail || DEFAULT_SETTINGS.adminEmail,
      siteUrl: data.siteUrl || DEFAULT_SETTINGS.siteUrl,
      postsPerPage: data.postsPerPage || DEFAULT_SETTINGS.postsPerPage,
      seoTitle: data.seoTitle || DEFAULT_SETTINGS.seoTitle,
      seoDescription: data.seoDescription || DEFAULT_SETTINGS.seoDescription,
      ga4PropertyId: data.ga4PropertyId || '',
      geminiApiKey,
      openaiApiKey,
      updatedAt: new Date().toISOString()
    };

    await adminDb.collection('settings').doc('general').set(newSettings, { merge: true });

    // Return response with masked keys
    const maskedSettings = {
      ...newSettings,
      geminiApiKey: geminiApiKey ? '••••••••••••' : '',
      openaiApiKey: openaiApiKey ? '••••••••••••' : ''
    };

    return new Response(JSON.stringify({ success: true, settings: maskedSettings }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
