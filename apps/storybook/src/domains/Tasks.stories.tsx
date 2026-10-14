import type { Meta } from '@storybook/react-vite';
import { TasksPage } from '@/features/tasks/TasksPage';
import { domainStories } from './domainStories';

const meta = {
  title: 'Domains/Tasks',
  parameters: { layout: 'fullscreen', hudStage: 'bleed' },
  tags: ['domain'],
} satisfies Meta;
export default meta;

const stories = domainStories({
  component: TasksPage,
  route: '/tasks',
  module: 'tasks',
  category: 'tasks',
  query: { large: 'view=list' },
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
