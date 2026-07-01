import type { APIRoute } from 'astro';
import { v2 as cloudinary } from 'cloudinary';

// Helper to lazily initialize Cloudinary at request-time
function initCloudinary() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME || import.meta.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY || import.meta.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET || import.meta.env.CLOUDINARY_API_SECRET;

  if (!cloud_name || !api_key || !api_secret) {
    throw new Error(`Missing Cloudinary configuration. cloud_name: ${!!cloud_name}, api_key: ${!!api_key}, api_secret: ${!!api_secret}`);
  }

  cloudinary.config({
    cloud_name,
    api_key,
    api_secret,
    secure: true
  });
}


function isAuthenticated(cookies: any) {
  return cookies.get('admin_session')?.value === 'authenticated';
}

export const GET: APIRoute = async ({ cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    initCloudinary();
    // List uploads from Cloudinary
    const result = await cloudinary.api.resources({
      type: 'upload',
      max_results: 100
    });

    const mediaList = result.resources.map((resource: any) => {
      return {
        name: resource.public_id,
        size: resource.bytes,
        contentType: `image/${resource.format}`,
        updated: resource.created_at,
        url: resource.secure_url
      };
    });

    // Sort files by updated date descending
    mediaList.sort((a: any, b: any) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

    return new Response(JSON.stringify(mediaList), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Failed to list Cloudinary files:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ url, cookies }) => {
  if (!isAuthenticated(cookies)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const name = url.searchParams.get('name');
  if (!name) {
    return new Response(JSON.stringify({ error: 'Missing name param' }), { status: 400 });
  }

  try {
    initCloudinary();
    // Delete file by public ID from Cloudinary
    const result = await cloudinary.uploader.destroy(name);
    
    if (result.result !== 'ok' && result.result !== 'not_found') {
      throw new Error(`Cloudinary delete response: ${result.result}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Failed to delete Cloudinary file:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
