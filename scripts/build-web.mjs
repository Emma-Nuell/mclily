import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { publicOrigin } from '../shared/publicUrls.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.env.STOREFRONT_CATALOG_MODE || 'preview';
if (!['preview', 'live'].includes(mode))
  throw new Error('Choose preview or live catalog mode.');
const origin = publicOrigin(
  process.env.PUBLIC_SITE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:5000'
);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(directory, args, settings = {}) {
  const result = spawnSync(npm, args, {
    cwd: root + directory,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...settings },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (!process.argv.includes('--skip-install')) {
  for (const directory of ['backend', 'frontend', 'admin'])
    run(directory, ['ci', '--include=dev']);
}
run('frontend', ['run', 'build'], {
  VITE_API_URL: '/api',
  VITE_CATALOG_MODE: mode,
});
run('admin', ['run', 'build'], {
  VITE_API_URL: '/api',
  VITE_BASE_PATH: '/admin/',
  VITE_STOREFRONT_URL: origin,
});
writeFileSync(
  root + 'frontend/dist/deployment.json',
  JSON.stringify({ catalogMode: mode, adminBase: '/admin/' })
);
