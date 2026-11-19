import react from '@vitejs/plugin-react';
import process from 'node:process';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const settings = loadEnv(
    mode,
    fileURLToPath(new URL('.', import.meta.url)),
    'VITE_'
  );
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
    base: process.env.VITE_BASE_PATH || settings.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    build: {
      chunkSizeWarningLimit: 1000,
    },
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      proxy,
      fs: {
        allow: [fileURLToPath(new URL('.', import.meta.url))],
      },
    },
  };
});
