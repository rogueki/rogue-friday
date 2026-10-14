import type { StoryObj } from '@storybook/react-vite';
import type { ComponentType } from 'react';
import type { AdapterCategory, Capabilities } from '@jarvis/sdk';
import { DomainStage, type DomainState, type DomainStageProps } from './DomainStage';

export interface DomainConfig {
  component: ComponentType;
  route: string;
  module: keyof Capabilities['modules'];
  category: AdapterCategory;
  /** Initial query string per state (`{ large: 'view=list' }`) or for every state (`default`). */
  query?: Partial<Record<DomainState | 'default', string>>;
  height?: number | string;
  keepPaths?: DomainStageProps['keepPaths'];
  role?: DomainStageProps['role'];
  /** Per-state role override (e.g. `readOnly` for owner-only modules). */
  roles?: Partial<Record<DomainState, NonNullable<DomainStageProps['role']>>>;
  /** What the state shows, for the docs sidebar. */
  notes?: Partial<Record<DomainState, string>>;
}

export const STATE_NAMES: Record<DomainState, string> = {
  empty: 'Leere Liste',
  loading: 'Loading',
  error: 'Error',
  offline: 'Offline',
  stale: 'Stale',
  normal: 'Normale Daten',
  long: 'Lange Daten',
  large: 'Große Datenmenge',
  readOnly: 'Read-only Capability',
  missing: 'Fehlende Capability',
};

const DESCRIPTIONS: Record<DomainState, string> = {
  empty: 'Seed-Profil `empty`: keine Datensätze.',
  loading: 'Anfragen des Moduls bleiben offen: Skeleton-Zustand.',
  error: 'Anfragen des Moduls scheitern mit INTERNAL (500) inklusive Korrelations-ID.',
  offline: 'Adapter-Modus `offline`: ADAPTER_UNAVAILABLE bzw. Offline-Cache.',
  stale: 'Adapter-Modus `degraded`: Freshness `stale` mit Hinweisbanner.',
  normal: 'Seed-Profil `default` (deterministische, fiktive Daten).',
  long: 'Seed-Profil `longGerman`: sehr lange deutsche Titel und Texte mit Umlauten.',
  large: 'Seed-Profil `highLoad`: 1000 Aufgaben, 10 000 Aktivitätsereignisse, 100 Agenten.',
  readOnly: 'Alle Schreib-Capabilities des Moduls sind aus, Lesen bleibt: Aktionen deaktiviert mit Begründung.',
  missing: 'Modul-Capability fehlt vollständig (auch Lesen): Zustand „nicht verfügbar“.',
};

export type DomainStoryMap = Record<
  'Empty' | 'Loading' | 'Error' | 'Offline' | 'Stale' | 'Normal' | 'LongData' | 'LargeData' | 'ReadOnly' | 'MissingCapability',
  StoryObj
>;

const KEY_STATE: Record<keyof DomainStoryMap, DomainState> = {
  Empty: 'empty',
  Loading: 'loading',
  Error: 'error',
  Offline: 'offline',
  Stale: 'stale',
  Normal: 'normal',
  LongData: 'long',
  LargeData: 'large',
  ReadOnly: 'readOnly',
  MissingCapability: 'missing',
};

/** The ten standard states of PLAN §46.2 for one module page. Each story re-mounts the page on its own mock world. */
export function domainStories(config: DomainConfig): DomainStoryMap {
  const entries = (Object.entries(KEY_STATE) as [keyof DomainStoryMap, DomainState][]).map(([key, state]) => {
    const story: StoryObj = {
      name: STATE_NAMES[state],
      parameters: {
        hudStage: 'bleed',
        docs: { description: { story: [DESCRIPTIONS[state], config.notes?.[state]].filter(Boolean).join(' ') } },
      },
      render: () => (
        <DomainStage
          key={state}
          component={config.component}
          state={state}
          route={config.route}
          module={config.module}
          category={config.category}
          query={config.query?.[state] ?? config.query?.default}
          height={config.height}
          keepPaths={config.keepPaths}
          role={config.roles?.[state] ?? config.role}
        />
      ),
    };
    return [key, story] as const;
  });
  return Object.fromEntries(entries) as DomainStoryMap;
}
