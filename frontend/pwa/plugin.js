/* global process */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default function storefrontPwa({
  catalogMode = 'preview',
  apiBase = '/api',
} = {}) {
  let root;
  return {
    name: 'mclily-storefront-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
    },
    writeBundle(options, bundle) {
      const directory = resolve(root, options.dir || 'dist');
      writeFileSync(
        resolve(directory, 'deployment.json'),
        JSON.stringify({ catalogMode, apiBase })
      );
      const template = readFileSync(resolve(root, 'pwa/sw.js'), 'utf8');
      let html = readFileSync(resolve(directory, 'index.html'), 'utf8');
      const staticFiles = [
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon.png',
        'icons/maskable-512.png',
        'offline-image.svg',
      ];
      const assets = Object.keys(bundle).filter(
        (name) =>
          name.startsWith('assets/') && /\.(js|css|svg|woff2?)$/.test(name)
      );
      const hash = createHash('sha256')
        .update(template)
        .update(html)
        .update(process.env.MCL_RELEASE_ID || '');
      for (const name of [...assets, ...staticFiles].sort())
        hash.update(readFileSync(resolve(directory, name)));
      const build = hash.digest('hex').slice(0, 20);
      html = html.replace(
        '</head>',
        `<meta name="mclily-build" content="${build}" />\n  </head>`
      );
      writeFileSync(resolve(directory, 'index.html'), html);
      const precache = [
        '/index.html',
        ...assets.map((name) => '/' + name),
        ...staticFiles.map((name) => '/' + name),
      ];
      writeFileSync(
        resolve(directory, 'sw.js'),
        template
          .replace(
            'const BUILD = __BUILD_ID__;',
            `const BUILD = ${JSON.stringify(build)};`
          )
          .replace(
            'const PRECACHE = __PRECACHE_URLS__;',
            `const PRECACHE = ${JSON.stringify(precache)};`
          )
      );
    },
  };
}
