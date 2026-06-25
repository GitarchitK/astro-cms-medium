import type { APIRoute } from 'astro';
import { adminStorage } from '../../../lib/firebase-admin';

function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

export const GET: APIRoute = async ({ cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminStorage) {
    return new Response(JSON.stringify({ error: 'Firebase Storage is not initialized.' }), { status: 503 });
  }

  try {
    const bucket = adminStorage.bucket();
    const [files] = await bucket.getFiles();
    
    // Process list to exclude virtual directory placeholders or non-files
    const mediaList = files
      .filter(file => !file.name.endsWith('/')) // skip folders
      .map(file => {
        const meta = file.metadata;
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media`;
        return {
          name: file.name,
          size: parseInt(String(meta.size || '0'), 10),
          contentType: meta.contentType || 'image/jpeg',
          updated: meta.updated || meta.timeCreated || new Date().toISOString(),
          url: publicUrl
        };
      });

    // Sort files by updated date descending
    mediaList.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

    return new Response(JSON.stringify(mediaList), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Failed to list storage files:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ url, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  if (!adminStorage) {
    return new Response(JSON.stringify({ error: 'Firebase Storage is not initialized.' }), { status: 503 });
  }

  const name = url.searchParams.get('name');
  if (!name) {
    return new Response(JSON.stringify({ error: 'Missing name param' }), { status: 400 });
  }

  try {
    const bucket = adminStorage.bucket();
    const file = bucket.file(name);
    const [exists] = await file.exists();
    if (!exists) {
      return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
    }

    await file.delete();
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Failed to delete storage file:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
