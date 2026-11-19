import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Commit these copies so a Render Root Directory can contain the complete app.
// Change the canonical source, run this command, then commit all affected copies.
const mappings = [
  ...['backend', 'frontend', 'admin'].flatMap((app) => [
    ['shared/localApi.mjs', `${app}/vendor/localApi.mjs`],
    ['shared/publicUrls.mjs', `${app}/vendor/publicUrls.mjs`],
    ['shared/requestId.mjs', `${app}/vendor/requestId.mjs`],
    ['.node-version', `${app}/.node-version`],
  ]),
  ...['backend', 'frontend'].map((app) => [
    'shared/publicPages.mjs',
    `${app}/vendor/publicPages.mjs`,
  ]),
  [
    'frontend/src/data/preview-catalog.json',
    'backend/data/preview-catalog.json',
  ],
];
const root = new URL('../', import.meta.url);
let different = false;
for (const [source, target] of mappings) {
  const sourceBytes = await readFile(new URL(source, root));
  const targetUrl = new URL(target, root);
  const existing = await readFile(targetUrl).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing?.equals(sourceBytes)) continue;
  if (process.argv.includes('--check')) {
    console.error(`Outdated deployment copy: ${target}`);
    different = true;
  } else {
    await mkdir(new URL('./', targetUrl), { recursive: true });
    await writeFile(targetUrl, sourceBytes);
    console.log(`Updated ${target}`);
  }
}
if (different) process.exitCode = 1;
else console.log('Shared deployment files are synchronized.');
