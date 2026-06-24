import type { APIRoute } from 'astro';
import { adminAuth } from '../../../lib/firebase-admin';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { idToken } = await request.json();
    
    if (!idToken) {
      return new Response(JSON.stringify({ error: 'ID Token required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!adminAuth) {
      return new Response(JSON.stringify({ error: 'Firebase Admin Auth is not initialized. Please verify environment credentials.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify ID Token on server using Admin SDK
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    
    // Check if the user has an email and is verified (you can also whitelist specific emails here)
    if (!decodedToken.email) {
      return new Response(JSON.stringify({ error: 'Invalid token: Email is required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Enforce admin email whitelist if configured in environment variables
    const adminEmail = process.env.ADMIN_EMAIL || import.meta.env.ADMIN_EMAIL;
    if (adminEmail && decodedToken.email.toLowerCase() !== adminEmail.toLowerCase()) {
      return new Response(JSON.stringify({ error: `Unauthorized: Only the configured admin email (${adminEmail}) is permitted to log in.` }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Set authenticated session cookie
    cookies.set('admin_session', 'authenticated', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 8, // 8 hours
    });

    return new Response(JSON.stringify({ success: true, email: decodedToken.email }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('API Admin Auth verification error:', error);
    return new Response(JSON.stringify({ error: 'Authentication verification failed: ' + error.message }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ cookies }) => {
  cookies.delete('admin_session', { path: '/' });
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
