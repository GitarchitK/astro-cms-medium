import admin from 'firebase-admin';

// Use process.env or import.meta.env for compatibility
const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || import.meta.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || import.meta.env.FIREBASE_ADMIN_CLIENT_EMAIL;
let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || import.meta.env.FIREBASE_ADMIN_PRIVATE_KEY;

// Fix private key formatting to handle literal and escaped newlines
if (privateKey) {
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
  }
}

const hasValidCredentials = projectId && clientEmail && privateKey;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.PUBLIC_FIREBASE_STORAGE_BUCKET || import.meta.env.FIREBASE_STORAGE_BUCKET || import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET;

if (!admin.apps.length && hasValidCredentials) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      }),
      storageBucket
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization failed:', error);
  }
}

export const adminDb = admin.apps.length > 0 ? admin.firestore() : null;
export const adminAuth = admin.apps.length > 0 ? admin.auth() : null;
export const adminStorage = admin.apps.length > 0 ? admin.storage() : null;
export default admin;
