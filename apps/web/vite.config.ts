import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.VITE_DEV_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The app shell is cached so it opens fast and can be installed (also the iPhone option, D12).
      // Data is never cached or written offline: stalls need the internet (D13).
      workbox: { navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//, /^\/rt\//, /^\/app\//], globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      manifest: {
        name: 'Bookstall',
        short_name: 'Bookstall',
        description: 'Second-hand book inventory and sales',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': API, '/rt': { target: API, ws: true } },
  },
  preview: {
    proxy: { '/api': API, '/rt': { target: API, ws: true } },
  },
  build: {
    rollupOptions: { output: {} },
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
  },
});
