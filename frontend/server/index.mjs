import { createServer } from 'node:http';
import { createStorefront } from './app.mjs';
import { publicOrigin } from '../vendor/publicUrls.mjs';

const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a valid TCP port.');
const siteOrigin = publicOrigin(
  process.env.PUBLIC_SITE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${port}`
);
const apiOrigin = publicOrigin(
  process.env.API_ORIGIN || 'http://127.0.0.1:5000'
);
if (
  process.env.NODE_ENV === 'production' &&
  [siteOrigin, apiOrigin].some((value) => !value.startsWith('https://'))
)
  throw new Error('Production requires HTTPS PUBLIC_SITE_URL and API_ORIGIN.');
const app = await createStorefront({
  siteOrigin,
  apiOrigin,
  catalogMode: process.env.STOREFRONT_CATALOG_MODE,
});
createServer(app).listen(port, '0.0.0.0', () =>
  console.log(`McLily storefront listening on port ${port}`)
);
