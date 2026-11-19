import react from '@vitejs/plugin-react';
import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import storefrontPwa from './pwa/plugin.js';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const settings = loadEnv(
    mode,
    fileURLToPath(new URL('.', import.meta.url)),
    'VITE_'
  );
  const catalogMode =
    process.env.STOREFRONT_CATALOG_MODE ||
    process.env.VITE_CATALOG_MODE ||
    settings.VITE_CATALOG_MODE ||
    'preview';
  if (!['preview', 'live'].includes(catalogMode))
    throw new Error('Choose preview or live catalog mode.');
  const apiBase = process.env.VITE_API_URL || settings.VITE_API_URL || '/api';
  const proxy = {
    '/api': {
      target:
        process.env.VITE_DEV_API_TARGET ||
        settings.VITE_DEV_API_TARGET ||
        'http://127.0.0.1:5000',
      changeOrigin: true,
    },
  };
  return {
    plugins: [react(), tailwindcss(), storefrontPwa({ catalogMode, apiBase })],
    define: {
      'import.meta.env.VITE_CATALOG_MODE': JSON.stringify(catalogMode),
      'import.meta.env.VITE_API_URL': JSON.stringify(apiBase),
    },
    build: {
      chunkSizeWarningLimit: 1000,
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy,
      fs: {
        allow: [fileURLToPath(new URL('.', import.meta.url))],
      },
    },
    preview: { host: '0.0.0.0', port: 4173, strictPort: true, proxy },
  };
});
