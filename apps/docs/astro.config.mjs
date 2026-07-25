import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const demoAppRoot = resolve(root, '.build/site/demo/app');
const demoAppPaths = ['/firebase-desk/demo/app', '/demo/app'];

export default defineConfig({
  base: '/firebase-desk',
  outDir: './.build/site',
  site: 'https://viniciusrmcarneiro.github.io',
  integrations: [
    starlight({
      title: 'Firebase Desk',
      customCss: ['./src/styles/docs.css'],
      editLink: {
        baseUrl: 'https://github.com/viniciusrmcarneiro/firebase-desk/edit/main/apps/docs',
      },
      logo: {
        src: './src/assets/app-icon.png',
        alt: 'Firebase Desk',
      },
      social: [{
        icon: 'github',
        label: 'GitHub',
        href: 'https://github.com/viniciusrmcarneiro/firebase-desk',
      }],
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Overview', slug: 'docs' },
            { label: 'Getting started', slug: 'docs/getting-started' },
            { label: 'Browser demo', link: '/demo/' },
          ],
        },
        {
          label: 'Workflows',
          items: [{ autogenerate: { directory: 'docs/workflows' } }],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Feature reference', slug: 'docs/features' },
            { label: 'Safety', slug: 'docs/safety' },
            { label: 'Troubleshooting', slug: 'docs/troubleshooting' },
            { label: 'Roadmap', slug: 'docs/roadmap' },
          ],
        },
      ],
    }),
  ],
  vite: {
    plugins: [serveDemoAppInDev()],
  },
});

function serveDemoAppInDev() {
  return {
    name: 'firebase-desk-demo-dev-static',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const demoAppPath = demoAppPaths.find((path) => url.pathname.startsWith(path));
        if (!demoAppPath) {
          next();
          return;
        }

        const file = await resolveDemoFile(url.pathname.slice(demoAppPath.length));
        if (!file) {
          response.writeHead(404).end('Demo app not built. Restart docs dev.');
          return;
        }

        response.setHeader('Content-Type', contentType(file));
        createReadStream(file).pipe(response);
      });
    },
  };
}

async function resolveDemoFile(pathname) {
  const normalized = pathname === '' ? '/' : decodeURIComponent(pathname);
  const candidates = [];
  if (normalized.endsWith('/')) {
    candidates.push(safeResolve(`.${normalized}index.html`));
  } else {
    candidates.push(safeResolve(`.${normalized}`));
    candidates.push(safeResolve(`.${normalized}/index.html`));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
}

function safeResolve(pathname) {
  const candidate = resolve(demoAppRoot, pathname);
  return candidate.startsWith(demoAppRoot) ? candidate : null;
}

function contentType(file) {
  switch (extname(file)) {
    case '.css':
      return 'text/css';
    case '.js':
      return 'text/javascript';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json';
    case '.wasm':
      return 'application/wasm';
    case '.ttf':
      return 'font/ttf';
    default:
      return 'text/html';
  }
}
