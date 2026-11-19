import { fileURLToPath } from 'node:url';

// Keep backend .env resolution consistent during local production-build checks.
process.chdir(fileURLToPath(new URL('../backend/', import.meta.url)));
process.env.HOST_WEB_APPS ??= 'true';
await import('../backend/server.js');
