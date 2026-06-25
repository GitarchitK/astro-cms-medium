import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  security: {
    checkOrigin: false,
  },
  image: {
    remotePatterns: [
      {
        protocol: 'https',
      },
    ],
  },
  build: {
    inlineStylesheets: 'always',
  },
  vite: {
    optimizeDeps: {
      include: [
        'firebase/app',
        'firebase/auth',
        'firebase/firestore',
        'firebase/storage',
        '@tiptap/core',
        '@tiptap/starter-kit',
        '@tiptap/extension-link',
        '@tiptap/extension-image',
        '@tiptap/extension-underline',
        '@tiptap/extension-placeholder'
      ]
    },
    ssr: {
      external: ['firebase-admin', 'googleapis']
    },
    plugins: [tailwindcss()]
  }
});
