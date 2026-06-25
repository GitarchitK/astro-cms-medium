import { google } from 'googleapis';

/**
 * Normalizes the Google Private Key from environment variables.
 */
function getGoogleCredentials() {
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || import.meta.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || import.meta.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (privateKey && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  if (privateKey && !privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
  }

  return { clientEmail, privateKey };
}

/**
 * Submits a URL to the Google Indexing API.
 * @param url The URL of the published/deleted page
 * @param action 'URL_UPDATED' or 'URL_DELETED'
 */
export async function submitToGoogleIndexing(url: string, action: 'URL_UPDATED' | 'URL_DELETED') {
  const { clientEmail, privateKey } = getGoogleCredentials();

  if (!clientEmail || !privateKey) {
    throw new Error('Google Indexing API credentials are not configured. Check Firebase private key environment settings.');
  }

  const jwtClient = new google.auth.JWT(
    clientEmail,
    undefined,
    privateKey,
    ['https://www.googleapis.com/auth/indexing'],
    undefined
  );

  await jwtClient.authorize();

  const indexing = google.indexing({
    version: 'v3',
    auth: jwtClient
  });

  const response = await indexing.urlNotifications.publish({
    requestBody: {
      url,
      type: action
    }
  });

  return response.data;
}

/**
 * Retrieves the screen page views over the last 30 days from Google Analytics 4.
 * @param propertyId GA4 Property ID
 */
export async function getGoogleAnalyticsReport(propertyId: string) {
  const { clientEmail, privateKey } = getGoogleCredentials();

  if (!clientEmail || !privateKey) {
    throw new Error('Google Analytics credentials are not configured. Check Firebase private key environment settings.');
  }

  const jwtClient = new google.auth.JWT(
    clientEmail,
    undefined,
    privateKey,
    ['https://www.googleapis.com/auth/analytics.readonly'],
    undefined
  );

  await jwtClient.authorize();

  const analyticsdata = google.analyticsdata({
    version: 'v1beta',
    auth: jwtClient
  });

  const response = await analyticsdata.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      metrics: [{ name: 'screenPageViews' }],
      dimensions: [{ name: 'date' }]
    }
  });

  return response.data;
}
