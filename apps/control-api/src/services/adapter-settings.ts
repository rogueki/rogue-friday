import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { AdapterInfo, AdapterConfigPatch, AdapterConfigSettings, AdapterTestResult, SecretStatus } from "@friday/sdk";
import type { AdapterCategory } from "@friday/config";
import type { AdapterOverrideStore } from "../db/stores";
import type { AdapterWiring, RuntimeSecrets } from "../runtime/adapter-wiring";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";
import { createCorrelationId } from "../util/ids";
import { manifest as icsManifest, validateFeedUrl } from "@friday/adapter-calendar-placeholder";

interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

const ajv = new Ajv2020({ strict: false, allErrors: true, useDefaults: true });
(typeof addFormats === "function" ? addFormats : (addFormats as unknown as { default: typeof addFormats }).default)(ajv);

const MASK = "••••••";

/**
 * Settings view of the adapters (PLAN §42.2): the form is generated from each adapter's JSON Schema, secrets are
 * write-only (`{ configured, maskedHint }`), "Test connection" runs server-side. Changes are persisted (non-secret
 * values only), applied by restarting the adapter and audited by the caller.
 */
export class AdapterSettingsService {
  private readonly lastTests = new Map<string, { at: string; success: boolean }>();

  constructor(
    private readonly wiring: AdapterWiring,
    private readonly overrides: AdapterOverrideStore,
    private readonly secrets: RuntimeSecrets,
    private readonly dataMode: "mock" | "hybrid" | "live",
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): AdapterConfigSettings[] {
    return this.wiring.registry.listAdapters().map((info) => this.describe(info));
  }

  get(adapterId: string): AdapterConfigSettings {
    const info = this.wiring.registry.listAdapters().find((candidate) => candidate.manifest.id === adapterId);
    if (!info) throw notFound("Adapter", adapterId);
    return this.describe(info);
  }

  private describe(info: AdapterInfo): AdapterConfigSettings {
    const { manifest } = info;
    const category = manifest.category as AdapterCategory;
    const entry = this.wiring.entries.get(category);
    const factory = this.wiring.factories.get(info.provider);
    const secretFields: Record<string, SecretStatus> = {};
    for (const field of manifest.secretFields) {
      const configured = this.wiring.isSecretConfigured(category, manifest.id, field);
      secretFields[field] = configured ? { configured, maskedHint: MASK } : { configured };
    }
    const test = this.lastTests.get(manifest.id);
    return {
      adapterId: manifest.id,
      category: manifest.category,
      provider: info.provider,
      enabled: info.enabled,
      version: this.overrides.version(manifest.id),
      config: structuredClone(entry?.config ?? {}),
      configSchema: structuredClone(factory?.configSchema ?? {}) as AdapterConfigSettings["configSchema"],
      secretFields,
      ...(test ? { lastTestAt: test.at, lastTestResult: test.success ? ("success" as const) : ("failure" as const) } : {}),
    };
  }

  /** Validates `config` against the adapter's schema; secret properties are not part of the form payload. */
  private validateConfig(schema: JsonSchemaObject, secretFields: string[], config: Record<string, unknown>): Record<string, unknown> {
    const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key]) => !secretFields.includes(key)));
    const narrowed = {
      ...schema,
      $id: undefined,
      properties,
      required: (schema.required ?? []).filter((key) => !secretFields.includes(key)),
    };
    delete (narrowed as Record<string, unknown>).$id;
    const candidate = structuredClone(config);
    const validate = ajv.compile(narrowed);
    if (!validate(candidate)) {
      throw validationFailed(
        "Die Adapter-Konfiguration entspricht nicht dem Schema.",
        (validate.errors ?? []).map((error) => ({ path: `config${error.instancePath}`, message: error.message ?? "ungültig" })),
      );
    }
    return candidate;
  }

  /**
   * Applies a patch (owner only, checked by the caller) and restarts the adapter so the change takes effect. `ifMatch`
   * is compared with `AdapterConfigSettings.version`; a stale value yields CONFLICT and changes nothing.
   */
  async patch(adapterId: string, patch: AdapterConfigPatch, ifMatch?: number): Promise<{ settings: AdapterConfigSettings; changed: string[] }> {
    const info = this.wiring.registry.listAdapters().find((candidate) => candidate.manifest.id === adapterId);
    if (!info) throw notFound("Adapter", adapterId);
    const currentVersion = this.overrides.version(adapterId);
    if (ifMatch !== undefined && ifMatch !== currentVersion) {
      throw conflict(`Die Adapter-Konfiguration wurde zwischenzeitlich geändert (erwartet Version ${ifMatch}, aktuell ${currentVersion}).`, {
        expectedVersion: ifMatch,
        currentVersion,
        id: adapterId,
      });
    }
    const { manifest } = info;
    const category = manifest.category as AdapterCategory;
    const entry = this.wiring.entries.get(category);
    if (!entry) throw notFound("Adapter", adapterId);
    const factory = this.wiring.factories.get(info.provider);
    const changed: string[] = [];
    const switchingCalendar = category === "calendar" && patch.provider === icsManifest.id && manifest.id !== icsManifest.id;
    const effectiveManifest = switchingCalendar ? icsManifest : manifest;
    const effectiveAdapterId = effectiveManifest.id;
    if (effectiveAdapterId === icsManifest.id && patch.secrets?.feedUrl) {
      try { validateFeedUrl(patch.secrets.feedUrl); } catch { throw validationFailed("Ungueltige private Kalender-URL.", [{ path: "secrets.feedUrl", message: "oeffentliche HTTPS-ICS-URL erforderlich" }]); }
    }

    if (patch.provider !== undefined && patch.provider !== entry.provider) {
      const target = this.wiring.factories.get(patch.provider);
      if (!target || target.category !== manifest.category) {
        throw validationFailed(`Der Provider ${patch.provider} ist nicht erlaubt oder gehört zu einer anderen Kategorie.`, [
          { path: "provider", message: "nicht in der Allowlist" },
        ]);
      }
      if (this.dataMode === "mock") {
        throw new ApiError({ code: "CONFLICT", message: "Im Mock-Modus kann der Provider nicht gewechselt werden.", details: { dataMode: this.dataMode } });
      }
      entry.provider = patch.provider;
      if (switchingCalendar) entry.config = {};
      changed.push("provider");
    }
    if (patch.enabled !== undefined && patch.enabled !== entry.enabled) {
      entry.enabled = patch.enabled;
      changed.push("enabled");
    }
    let mergedConfig = entry.config ?? {};
    if (patch.config) {
      const schema = (this.wiring.factories.get(entry.provider)?.configSchema ?? factory?.configSchema ?? {}) as JsonSchemaObject;
      const unknownKeys = Object.keys(patch.config).filter((key) => effectiveManifest.secretFields.includes(key));
      if (unknownKeys.length > 0) {
        throw validationFailed(`Secrets gehören nicht in config: ${unknownKeys.join(", ")}.`, unknownKeys.map((key) => ({ path: `config.${key}`, message: "nur über secrets setzbar" })));
      }
      mergedConfig = this.validateConfig(schema, effectiveManifest.secretFields, { ...mergedConfig, ...patch.config });
      entry.config = mergedConfig;
      changed.push(...Object.keys(patch.config).map((key) => `config.${key}`));
    }
    if (patch.secrets) {
      const unknownSecrets = Object.keys(patch.secrets).filter((key) => !effectiveManifest.secretFields.includes(key));
      if (unknownSecrets.length > 0) {
        throw validationFailed(`Unbekannte Secret-Felder: ${unknownSecrets.join(", ")}.`, unknownSecrets.map((key) => ({ path: `secrets.${key}`, message: "kein Secret-Feld" })));
      }
      for (const [field, value] of Object.entries(patch.secrets)) {
        this.secrets.set(effectiveAdapterId, field, value);
        changed.push(`secrets.${field}`);
      }
    }
    if (changed.length > 0) {
      this.overrides.replaceCategory({
        adapterId: effectiveAdapterId,
        category,
        provider: entry.provider === this.wiring.resolved.get(category)?.provider ? null : entry.provider,
        enabled: entry.enabled,
        config: entry.config ?? {},
      });
      await this.wiring.registry.restart(adapterId);
    }
    return { settings: this.get(effectiveAdapterId), changed };
  }

  /** "Test connection": forces a real health check through the registry. Never returns secret material. */
  async test(adapterId: string, correlationId: string = createCorrelationId()): Promise<AdapterTestResult> {
    const info = this.wiring.registry.listAdapters().find((candidate) => candidate.manifest.id === adapterId);
    if (!info) throw notFound("Adapter", adapterId);
    const testedAt = this.now().toISOString();
    if (!info.enabled) {
      this.lastTests.set(adapterId, { at: testedAt, success: false });
      return { adapterId, success: false, latencyMs: null, message: "Adapter ist deaktiviert.", testedAt, correlationId };
    }
    const health = await this.wiring.registry.checkHealth(adapterId);
    const success = health.status === "online";
    this.lastTests.set(adapterId, { at: testedAt, success });
    return {
      adapterId,
      success,
      latencyMs: health.latencyMs,
      message: success
        ? "Verbindung erfolgreich getestet."
        : health.lastError?.message
          ? `Verbindung eingeschränkt: ${health.lastError.message}`
          : `Adapter nicht erreichbar (${health.status}).`,
      testedAt,
      correlationId,
    };
  }
}
