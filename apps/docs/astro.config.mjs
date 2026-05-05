import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

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
          autogenerate: { directory: 'docs/workflows' },
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
});
