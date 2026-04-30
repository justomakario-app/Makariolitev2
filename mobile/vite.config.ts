import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  base: '/m/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Macario Lite',
        short_name: 'Macario',
        description: 'Sistema de gestión de producción de Justo Makario',
        theme_color: '#0a0a0a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/m/',
        start_url: '/m/',
        // TODO: reemplazar por íconos PNG 192/512 con el logo real de Justo Makario.
        // Mientras tanto, usamos el SVG placeholder con sizes 'any'.
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        runtimeCaching: [
          {
            // Supabase REST: network-first (datos frescos, fallback al cache)
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts: cache-first (cambian poco)
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
  },
});
