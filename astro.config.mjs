import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
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
        'firebase/storage'
      ]
    },
    ssr: {
      external: ['firebase-admin', 'googleapis']
    },
    plugins: [tailwindcss()]
  }
});
