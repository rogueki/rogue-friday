/** Adapter categories, PLAN §10.4. */
export const ADAPTER_CATEGORIES = [
  'tasks',
  'activity',
  'memory',
  'agents',
  'approvals',
  'communication',
  'calendar',
  'automations',
  'research',
  'files',
  'voice',
  'notifications',
  'system',
  'audit',
  'commands',
] as const;
export type AdapterCategory = (typeof ADAPTER_CATEGORIES)[number];

export const DATA_MODES = ['mock', 'hybrid', 'live'] as const;
export type DataMode = (typeof DATA_MODES)[number];

export const MOCK_ADAPTER_PACKAGE = '@friday/adapter-mock';

export function mockProviderId(category: AdapterCategory): string {
  return `mock-${category}`;
}

export function isMockProvider(providerId: string): boolean {
  return providerId.startsWith('mock-');
}

/** Built-in allowlist: all mock providers ship in one package and cannot be re-pointed by config. */
export function builtinAllowlist(): Record<string, string> {
  return Object.fromEntries(ADAPTER_CATEGORIES.map((category) => [mockProviderId(category), MOCK_ADAPTER_PACKAGE]));
}
