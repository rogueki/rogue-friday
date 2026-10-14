import { resolve } from 'node:path';
import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

const repoRoot = resolve(import.meta.dirname, '../../..');
const webSrc = resolve(repoRoot, 'apps/web/src');
const shims = resolve(import.meta.dirname, 'shims');

const config: StorybookConfig = {
  stories: [
    '../src/**/*.stories.@(ts|tsx)',
    // ui stories live in this app; other packages (e.g. @jarvis/orb) may ship colocated stories
    '../../../packages/*/src/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: { name: '@storybook/react-vite', options: {} },
  staticDirs: ['../public'],
  typescript: { reactDocgen: 'react-docgen-typescript' },
  /**
   * Domain stories (PLAN §46.2) render the real feature pages of apps/web. They are written against Next.js, so the
   * Next-only entry points are replaced by in-memory shims and the web `@/` alias is resolved to apps/web/src.
   */
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        alias: [
          { find: /^@\//, replacement: `${webSrc}/` },
          { find: /^next\/navigation$/, replacement: resolve(shims, 'next-navigation.ts') },
          { find: /^next\/dynamic$/, replacement: resolve(shims, 'next-dynamic.tsx') },
          // The Node-only test setup of @jarvis/mock-data imports msw/node lazily; the browser never calls it.
          { find: /^msw\/node$/, replacement: resolve(shims, 'empty.ts') },
        ],
      },
      server: { fs: { allow: [repoRoot] } },
    }),
};

export default config;
