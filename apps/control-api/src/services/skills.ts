import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SkillCatalogEntry } from "@friday/sdk";
import { ApiError, notFound, validationFailed } from "../util/errors";

type Json = Record<string, unknown>;
type Catalog = { skills: SkillCatalogEntry[]; error: string | null };
type Observation = { skills: Map<string, Json>; at: string | null; error: string | null };

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const field = (obj: Json, ...names: string[]): string => {
  for (const name of names) if (typeof obj[name] === "string") return obj[name] as string;
  return "";
};
const unavailable = (message: string): ApiError => new ApiError({ code: "ADAPTER_UNAVAILABLE", message });

/** The registry is package metadata only. A fresh dashboard request owns discovery and activation. */
export class SkillsService {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string | null;
  private readonly catalogPath: string | undefined;
  private token: string | undefined;

  constructor(options: { catalogPath?: string; dashboardUrl?: string; fetcher?: typeof fetch }) {
    this.fetcher = options.fetcher ?? fetch;
    this.catalogPath = options.catalogPath;
    if (options.dashboardUrl) {
      const url = new URL(options.dashboardUrl);
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
        throw new Error("Hermes skills dashboard URL must be plain loopback HTTP");
      }
      this.baseUrl = url.origin;
    } else this.baseUrl = null;
  }

  private catalog(): Catalog {
    if (!this.catalogPath) return { skills: [], error: "Skills-Katalogpfad nicht konfiguriert" };
    try {
      const path = resolve(this.catalogPath);
      const setupPath = path.endsWith(".json") ? path : join(path, "integration_setup.json");
      const registryPath = join(dirname(setupPath), "skills.json");
      const setup = JSON.parse(readFileSync(setupPath, "utf8")) as Json;
      const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Json;
      const setupSkills = setup.skills as Json | undefined;
      const integrationMetadata = (setup.integrations ?? {}) as Json;
      const rawSkills = (registry.skills ?? registry) as Json;
      if (setup.schema_version !== 1 || !setupSkills || typeof setupSkills !== "object" || !rawSkills || typeof rawSkills !== "object") throw new Error("Katalogformat ungültig");
      const entries = Array.isArray(rawSkills) ? rawSkills.map((value, index) => [String(index), value] as const) : Object.entries(rawSkills);
      const skills: SkillCatalogEntry[] = entries.map(([key, raw]) => {
        const meta = raw as Json;
        const name = field(meta, "id", "name", "slug") || key;
        const id = slug(name);
        if (!id || !Object.hasOwn(setupSkills, name)) throw new Error(`Metadaten für Skill ${name} fehlen`);
        const detail = setupSkills[name] as Json;
        const required = strings(detail.required_integrations);
        const conditional = strings(detail.conditional_integrations);
        const integrationRefs = [...new Set([...required, ...conditional])];
        const integrationDetails = integrationRefs.map((integrationId) => {
          const integration = (integrationMetadata[integrationId] ?? {}) as Json;
          const account = field(integration, "account");
          return { id: integrationId, account: (account === "required" || account === "conditional" ? account : "none") as "none" | "required" | "conditional",
            required: required.includes(integrationId), setupDe: field(integration, "setup_de"), reference: field(integration, "reference"),
            settingsTarget: field(integration, "settings_target"), configured: null, connectionChecked: null };
        });
        return {
          id: `friday:${id}`, source: "friday", name,
          category: field(meta, "category") || "Allgemein",
          description: field(meta, "description", "summary", "trigger"),
          version: field(meta, "version") || null,
          packaged: true, discovered: null, enabled: null,
          observedAt: null, observationSource: "registry", observationError: null,
          accounts: integrationDetails.filter((entry) => entry.account !== "none").map((entry) => entry.id),
          setupRefs: field(detail, "setup_de") ? [field(detail, "setup_de")] : [],
          integrationRefs, integrationDetails,
          requiredCapabilities: strings(detail.required_capabilities), conditionalCapabilities: strings(detail.conditional_capabilities),
        };
      });
      if (entries.length !== Number(setup.inventory_count) || Object.keys(setupSkills).length !== entries.length) throw new Error("Skills-Inventar und Setup-Metadaten weichen ab");
      return { skills, error: null };
    } catch {
      return { skills: [], error: "Skills-Katalog nicht lesbar oder inkonsistent" };
    }
  }

  private async request(path: string, method = "GET", body?: Json): Promise<Response> {
    if (!this.baseUrl) throw unavailable("Hermes-Dashboard nicht konfiguriert");
    const send = (token: string) => this.fetcher(`${this.baseUrl}${path}`, {
      method, headers: { "x-hermes-session-token": token, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    if (!this.token) await this.refreshToken();
    let response = await send(this.token!);
    if (response.status === 401 || response.status === 403) {
      await this.refreshToken();
      response = await send(this.token!);
    }
    if (!response.ok) throw unavailable(`Hermes-Skills-Anfrage fehlgeschlagen (HTTP ${response.status})`);
    return response;
  }

  private async refreshToken(): Promise<void> {
    if (!this.baseUrl) throw unavailable("Hermes-Dashboard nicht konfiguriert");
    const page = await this.fetcher(`${this.baseUrl}/`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(8000) });
    if (!page.ok) throw unavailable("Hermes-Dashboard nicht erreichbar");
    const token = /window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]{8,})"/.exec(await page.text())?.[1];
    if (!token) throw unavailable("Hermes-Dashboard-Token nicht verfügbar");
    this.token = token;
  }

  private async observe(): Promise<Observation> {
    if (!this.baseUrl) return { skills: new Map(), at: null, error: "Hermes-Dashboard nicht konfiguriert" };
    try {
      const payload = await (await this.request("/api/skills")).json() as unknown;
      const list = Array.isArray(payload) ? payload : (payload as Json)?.skills;
      if (!Array.isArray(list)) throw new Error("Hermes-Skills-Antwort ungültig");
      const skills = new Map<string, Json>();
      for (const raw of list) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Json;
        const name = field(entry, "name");
        if (name && typeof entry.enabled === "boolean") skills.set(slug(name), entry);
      }
      return { skills, at: new Date().toISOString(), error: null };
    } catch {
      return { skills: new Map(), at: null, error: "Hermes-Skills-Status nicht verfügbar" };
    }
  }

  async list(): Promise<{ skills: SkillCatalogEntry[]; fresh: boolean; catalogError: string | null; hermesError: string | null }> {
    const catalog = this.catalog();
    const observation = await this.observe();
    const skills = catalog.skills.map((skill): SkillCatalogEntry => {
      const observed = observation.skills.get(slug(skill.name));
      return { ...skill, discovered: observation.error ? null : Boolean(observed), enabled: observed ? observed.enabled as boolean : null,
        observedAt: observation.at, observationSource: observation.error ? "unavailable" : "hermes-dashboard", observationError: observation.error };
    });
    const known = new Set(skills.map((skill) => slug(skill.name)));
    for (const [name, entry] of observation.skills) {
      if (known.has(name)) continue;
      skills.push({ id: `hermes:${name}`, source: "hermes", name: field(entry, "name"), category: field(entry, "category") || "Hermes",
        description: field(entry, "description"), version: field(entry, "version") || null, packaged: false, discovered: true,
        enabled: entry.enabled as boolean, observedAt: observation.at, observationSource: "hermes-dashboard", observationError: null,
        accounts: [], setupRefs: [], integrationRefs: [], integrationDetails: [], requiredCapabilities: [], conditionalCapabilities: [] });
    }
    skills.sort((a, b) => a.id.localeCompare(b.id));
    if (catalog.error) for (const skill of skills) skill.observationError = [skill.observationError, catalog.error].filter(Boolean).join("; ");
    return { skills, fresh: observation.error === null && catalog.error === null, catalogError: catalog.error, hermesError: observation.error };
  }

  async toggle(id: string, enabled: boolean): Promise<SkillCatalogEntry> {
    if (!/^(friday|hermes):[a-z0-9][a-z0-9_-]*$/.test(id)) throw validationFailed("Skill-ID ungültig");
    const before = await this.list();
    const skill = before.skills.find((item) => item.id === id);
    if (!skill) throw notFound("Skill", id);
    if (skill.discovered !== true || skill.enabled === null) throw unavailable("Skill ist in Hermes nicht bestätigt");
    if (skill.enabled === enabled) return skill;
    await this.request("/api/skills/toggle", "PUT", { name: skill.name, enabled });
    const after = await this.list();
    const confirmed = after.skills.find((item) => item.id === id);
    if (!confirmed || confirmed.enabled !== enabled || confirmed.discovered !== true) throw unavailable("Hermes hat den neuen Skillzustand nicht bestätigt");
    return confirmed;
  }
}
