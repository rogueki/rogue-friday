import type { AdapterManifest } from "@jarvis/sdk";
import { AdapterError } from "./errors";
import { methodsOf } from "./port-spec";
import type { PortCategory } from "./ports";
import type { AdapterContext, AdapterHealthReport, CapabilitySet, JarvisAdapter, PortAdapter } from "./types";

export interface PlaceholderOptions<C extends PortCategory> {
  manifest: AdapterManifest & { category: C };
  /** German name of the foreign system for messages, e.g. "Hermes". */
  systemName: string;
  /** Decides from the validated config whether the integration has been set up. */
  isConfigured: (config: Readonly<Record<string, unknown>>, hasSecret: (field: string) => boolean) => boolean;
}

/**
 * Adapter for an integration that is planned but not implemented: reports `offline` ("Nicht konfiguriert"),
 * advertises no capabilities, and fails every port call with a clear ADAPTER_UNAVAILABLE. The control API keeps
 * running and the UI shows the module as "Nicht verbunden" (PLAN §9.3).
 */
export function createPlaceholderAdapter<C extends PortCategory>(
  options: PlaceholderOptions<C>,
): PortAdapter<C> {
  let context: AdapterContext | undefined;
  const { manifest, systemName } = options;

  const configured = (): boolean =>
    context !== undefined &&
    options.isConfigured(context.config, (field) => context?.getSecret(field) !== undefined);

  const unavailable = (): never => {
    throw new AdapterError({
      code: "ADAPTER_UNAVAILABLE",
      message: configured()
        ? `Die Anbindung an ${systemName} ist konfiguriert, aber noch nicht implementiert.`
        : `${systemName}: Nicht konfiguriert.`,
      retryable: false,
      details: { adapterId: manifest.id, configured: configured() },
    });
  };

  const adapter: JarvisAdapter = {
    manifest: { ...manifest, capabilities: [] },
    async initialize(ctx) {
      context = ctx;
    },
    async healthCheck(): Promise<AdapterHealthReport> {
      return {
        status: "offline",
        latencyMs: null,
        errorCode: "NOT_CONFIGURED",
        message: configured()
          ? `${systemName}: konfiguriert, Integration noch nicht implementiert`
          : "Nicht konfiguriert",
      };
    },
    async getCapabilities(): Promise<CapabilitySet> {
      return { capabilities: [] };
    },
    async shutdown() {
      context = undefined;
    },
  };

  // Only the mandatory (read) methods exist, so no optional method is implemented without a matching capability.
  for (const [name, spec] of methodsOf(manifest.category)) {
    if (spec.required) (adapter as unknown as Record<string, unknown>)[name] = async () => unavailable();
  }
  return adapter as PortAdapter<C>;
}
