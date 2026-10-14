import type { Meta } from '@storybook/react-vite';
import { AgentsPage } from '@/features/agents/AgentsPage';
import { domainStories } from './domainStories';

const meta = {
  title: 'Domains/Agents',
  parameters: { layout: 'fullscreen', hudStage: 'bleed' },
  tags: ['domain'],
} satisfies Meta;
export default meta;

const stories = domainStories({
  component: AgentsPage,
  route: '/agents',
  module: 'agents',
  category: 'agents',
  
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
