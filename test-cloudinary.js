import { adminDb } from './src/lib/firebase-admin.js';

async function run() {
  if (!adminDb) {
    console.log('Firebase Admin DB is not initialized.');
    return;
  }
  console.log('Fetching articles...');
  const snapshot = await adminDb.collection('articles').get();
  console.log(`Found ${snapshot.size} articles in Firestore:`);
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    console.log(`- Title: "${data.title}" | Category: "${data.category}" | Slug: "${data.slug}" | Status: "${data.status}"`);
  });
}

run().catch(console.error);

// End of script
