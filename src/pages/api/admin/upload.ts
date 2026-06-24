import type { APIRoute } from 'astro';
import { adminStorage } from '../../../lib/firebase-admin';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  if (!adminStorage) {
    return new Response(JSON.stringify({ error: 'Firebase Storage is not initialized.' }), { status: 503 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folder = formData.get('folder') as string || 'articles';

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file uploaded' }), { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const bucket = adminStorage.bucket();
    
    // Create unique filename
    const filename = `${folder}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const fileRef = bucket.file(filename);

    // Save buffer to Firebase Storage
    await fileRef.save(buffer, {
      metadata: {
        contentType: file.type || 'image/jpeg',
      },
    });

    // Make the file publicly accessible
    await fileRef.makePublic().catch(err => {
      console.warn('Could not make file public automatically (check storage rules):', err.message);
    });

    // Construct persistent download URL
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media`;

    return new Response(JSON.stringify({ url: publicUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Firebase Storage upload API error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
