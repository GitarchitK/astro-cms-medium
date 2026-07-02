import admin from 'firebase-admin';
import fs from 'fs';
import { google } from 'googleapis';

// Load .env file manually from project directory
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  });
}

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

if (privateKey) {
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
  }
}

if (projectId && clientEmail && privateKey) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      })
    });
    console.log('Firebase Admin initialized successfully');
    
    const db = admin.firestore();
    console.log('Fetching GA4 settings...');
    const doc = await db.collection('settings').doc('general').get();
    
    if (!doc.exists) {
      console.log('No settings/general document found in database!');
    } else {
      const settings = doc.data();
      const ga4PropertyId = settings?.ga4PropertyId;
      console.log('GA4 Property ID in database:', ga4PropertyId);
      
      if (!ga4PropertyId) {
        console.log('Error: ga4PropertyId is empty or not configured in settings/general!');
      } else {
        console.log('Attempting to call Google Analytics API with Property ID:', ga4PropertyId);
        
        const jwtClient = new google.auth.JWT(
          clientEmail,
          undefined,
          privateKey,
          ['https://www.googleapis.com/auth/analytics.readonly'],
          undefined
        );

        console.log('Authorizing JWT client...');
        await jwtClient.authorize();
        console.log('JWT client authorized successfully!');

        const analyticsdata = google.analyticsdata({
          version: 'v1beta',
          auth: jwtClient
        });

        console.log('Running report...');
        const response = await analyticsdata.properties.runReport({
          property: `properties/${ga4PropertyId}`,
          requestBody: {
            dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
            metrics: [{ name: 'screenPageViews' }],
            dimensions: [{ name: 'date' }]
          }
        });
        
        console.log('API call succeeded! Response row count:', response.data.rows?.length || 0);
        console.log('First few rows of response:', response.data.rows?.slice(0, 3));
      }
    }
  } catch (error) {
    console.error('Failed to initialize or query:', error);
  }
} else {
  console.error('Missing credentials in .env. Project ID:', projectId, 'Client Email:', clientEmail);
}
process.exit(0);
