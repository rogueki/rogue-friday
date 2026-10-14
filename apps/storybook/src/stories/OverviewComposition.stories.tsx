import type { Meta, StoryObj } from '@storybook/react-vite';
import { OverviewDemo } from '../demo/OverviewDemo';

const meta = {
  title: 'Overview/OverviewComposition',
  component: OverviewDemo,
  parameters: { layout: 'fullscreen', hudStage: 'bleed' },
  args: { voice: 'listening', fixedNow: true },
} satisfies Meta<typeof OverviewDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Full-screen proof of the design language: shell + all §27 overview panels (static demo data, ORB SLOT placeholder). */
export const Overview: Story = {};

export const NavCollapsed: Story = { args: { navCollapsed: true } };

export const Speaking: Story = { args: { voice: 'speaking' } };

export const Idle: Story = { args: { voice: 'idle' } };
