import type { StorybookConfig } from '@storybook/react-vite';

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
};

export default config;
