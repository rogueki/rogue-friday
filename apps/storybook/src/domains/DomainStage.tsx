import { createFridayClient, type AdapterCategory, type Capabilities, type FridayClient } from '@friday/sdk';
import { DEFAULT_SEED, MockWorld, handleApiRequest, type ProfileName } from '@friday/mock-data';
import { ToastProvider } from '@friday/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useState, type ComponentType, type CSSProperties } from 'react';
import { setStoryLocation } from '../../.storybook/shims/next-navigation';
import { setApiClient } from '@/lib/api/client';
import { CapabilitiesProvider } from '@/lib/capabilities';
import { useRealtimeStore } from '@/lib/realtime/store';
import { AppSettingsProvider } from '@/lib/settings';

/** The states every domain is shown in (PLAN §46.2). */
export type DomainState = 'empty' | 'loading' | 'error' | 'offline' | 'stale' | 'normal' | 'long' | 'large' | 'readOnly' | 'missing';

export interface DomainStageProps {
  /** Page (or panel) component of apps/web that is rendered. */
  component: ComponentType;
  state: DomainState;
  /** Route the page lives at; feeds `usePathname()`. */
  route: string;
  /** Capability module whose flags are switched for the read-only / missing states. */
  module: keyof Capabilities['modules'];
  /** Adapter category whose availability is switched for the stale / offline states. */
  category: AdapterCategory;
  /** Query string at mount (`view=list`), e.g. to open the list view for the large data set. */
  query?: string;
  /** Height of the "main" area (px or CSS length); pages scroll inside it like inside the shell. */
  height?: number | string;
  /** Role of the signed-in mock user (Settings are owner-only). */
  role?: 'owner' | 'operator' | 'viewer';
  /** Request paths that stay available in the loading / error states (default: bootstrap documents only). */
  keepPaths?: RegExp;
}

const PROFILE: Record<DomainState, ProfileName> = {
  empty: 'empty',
  loading: 'default',
  error: 'default',
  offline: 'default',
  stale: 'default',
  normal: 'default',
  long: 'longGerman',
  large: 'highLoad',
  readOnly: 'default',
  missing: 'default',
};

/** Documents the app shell needs before any module renders: they stay healthy in every state. */
const BOOTSTRAP_PATHS = /^\/(auth\/|capabilities$|settings$|themes|layouts|meta$)/;

export const STORY_API_ORIGIN = 'http://friday.story';

/** Builds the mock world of one story. Seed content is anchored at "now", so relative times read correctly. */
export function createStoryWorld(state: DomainState, props: Pick<DomainStageProps, 'module' | 'category' | 'role'>): MockWorld {
  const world = new MockWorld({ profile: PROFILE[state], seed: DEFAULT_SEED, startTime: new Date().toISOString() });
  world.state.session.role = props.role ?? 'owner';
  if (state === 'stale') world.setAdapterState(props.category, 'degraded', { reason: 'Antworten verzögert, Daten stammen aus dem letzten erfolgreichen Abgleich' });
  if (state === 'offline') world.setAdapterState(props.category, 'offline', { reason: 'Adapter nicht erreichbar' });
  if (state === 'readOnly' || state === 'missing') {
    const flags = world.state.capabilities.modules[props.module] as unknown as Record<string, unknown>;
    for (const [flag, value] of Object.entries(flags)) {
      if (typeof value !== 'boolean') continue;
      if (flag === 'read' && state === 'readOnly') continue;
      world.setCapability(props.module, flag, false);
    }
  }
  return world;
}

/** `fetch` for the SDK client: answers from the world, or hangs / fails for the loading and error states. */
export function createStoryFetch(world: MockWorld, state: DomainState, keepPaths: RegExp = BOOTSTRAP_PATHS): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '');
    if (!keepPaths.test(path)) {
      if (state === 'loading') return new Promise<Response>(() => undefined);
      if (state === 'error') {
        const correlationId = world.correlationId();
        return new Response(
          JSON.stringify({
            error: {
              code: 'INTERNAL',
              message: 'Der Adapter hat eine unerwartete Antwort geliefert.',
              severity: 'error',
              retryable: true,
              correlationId,
              details: {},
            },
          }),
          { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Correlation-Id': correlationId } },
        );
      }
    }
    return handleApiRequest(world, request, { simulateLatency: false });
  };
}

interface StageRuntime {
  client: QueryClient;
  api: FridayClient;
}

function createRuntime(props: DomainStageProps): StageRuntime {
  const world = createStoryWorld(props.state, props);
  const api = createFridayClient({ baseUrl: STORY_API_ORIGIN, fetch: createStoryFetch(world, props.state, props.keepPaths) });
  // The data layer talks to one module-level SDK client; every story swaps in its own, backed by its own world.
  setApiClient(api);
  useRealtimeStore.setState({ state: props.state === 'offline' ? 'offline' : props.state === 'stale' ? 'degraded' : 'online', roundtripMs: 24, lastEventAt: Date.now(), sequence: 1 });
  setStoryLocation(props.route, props.query ?? '');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false } } });
  return { client, api };
}

/**
 * Renders a real feature page of apps/web with the providers of the app (query cache, toasts, settings, capabilities)
 * on top of an in-memory MockWorld. No DTO is hand-written: every response comes from @friday/mock-data's seed profiles
 * (`empty`, `default`, `longGerman`, `highLoad`) through the same REST handler the MSW mock mode uses.
 */
export function DomainStage(props: DomainStageProps) {
  const { component: Page, height = 'max(640px, 100vh)' } = props;
  const [runtime] = useState(() => createRuntime(props));
  const frame: CSSProperties = { height, boxSizing: 'border-box', overflow: 'auto', padding: '14px 18px' };
  return (
    <QueryClientProvider client={runtime.client}>
      <ToastProvider>
        <AppSettingsProvider enabled>
          <CapabilitiesProvider enabled>
            <main className="jv-shell__main" style={frame} aria-label="Hauptbereich">
              <Suspense fallback={null}>
                <Page />
              </Suspense>
            </main>
          </CapabilitiesProvider>
        </AppSettingsProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
