import type { Meta } from '@storybook/react-vite';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { domainStories } from './domainStories';

const meta = {
  title: 'Domains/Settings',
  parameters: { layout: 'fullscreen', hudStage: 'bleed' },
  tags: ['domain'],
} satisfies Meta;
export default meta;

/**
 * Settings are not capability-gated but role-gated: only the owner may change them. "Read-only" therefore signs in as
 * `viewer`; "missing capability" removes the system capabilities (adapter matrix, health checks).
 */
const stories = domainStories({
  component: SettingsPage,
  route: '/settings',
  module: 'system',
  category: 'system',
  roles: { readOnly: 'viewer' },
  query: { default: 'area=profile' },
  notes: { readOnly: 'Rolle `viewer`: alle Bereiche sind schreibgeschützt.' },
  // The settings document and themes are what this page is about, so the loading / error states hit them as well.
  keepPaths: /^\/(auth\/|capabilities$|meta$)/,
});

export const Empty = stories.Empty;
export const Loading = stories.Loading;
export const ErrorState = stories.Error;
export const Offline = stories.Offline;
export const Stale = stories.Stale;
export const Normal = stories.Normal;
export const LongData = stories.LongData;
export const LargeData = stories.LargeData;
export const ReadOnly = stories.ReadOnly;
export const MissingCapability = stories.MissingCapability;
