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

const HERMES_SETUP: Record<string, { account: "none" | "conditional" | "required"; setupDe: string; capability: string }> = {
  "email-inbox-triage": { account: "conditional", setupDe: "Der Triage-Skill verbindet kein Postfach selbst. Richte einen E-Mail-Connector ein: Himalaya mit IMAP/SMTP in `~/.config/himalaya/config.toml` oder Google Workspace über dessen OAuth-Setup. Bei mehreren Postfächern vor jeder Triage Konto, Ordner/Zeitraum und erlaubte Aktionen festlegen. Zugangsdaten nur lokal im Connector einrichten, nie im Chat.", capability: "Funktionierender Himalaya- oder Google-Workspace-Connector mit dem ausdrücklich ausgewählten E-Mail-Konto" },
  "llm-wiki": { account: "conditional", setupDe: "Das Markdown-Wiki läuft lokal ohne Konto; `WIKI_PATH` setzen oder `~/wiki` verwenden. Nur für headless Synchronisierung mit Obsidian Sync sind Node.js 22+, `obsidian-headless`, ein Obsidian-Konto mit aktivem Sync-Abonnement und lokale Anmeldung mit `ob login` erforderlich. Zugangsdaten nicht im Chat hinterlegen.", capability: "Lokaler Markdown-Pfad; optional für headless Obsidian-Sync Node.js 22+, obsidian-headless und ein Obsidian-Konto mit aktivem Sync-Abonnement" },
  "blocked-page-recovery": { account: "conditional", setupDe: "Wayback, archive.today, API-Alternativen und Browser-Fallback benötigen kein Konto. Nur die optionale Jina-Reader-Route braucht `JINA_API_KEY` lokal in Hermes' `.env`; ohne Key wird diese Route übersprungen. Den Key niemals im Chat teilen.", capability: "Python 3 für das Hilfsskript; optional Jina-API-Key für die Jina-Reader-Route" },
  powerpoint: { account: "none", setupDe: "Der Hermes-Skill erstellt, liest und bearbeitet Präsentationen offline mit fünf Skripten im Skill-Ordner. Er benötigt Python 3.10+ und python-pptx. LibreOffice plus Poppler sind nur für Bildvorschau/PDF-Export erforderlich; Erstellen, Lesen und Bearbeiten funktionieren ohne sie.", capability: "Python 3.10+ und python-pptx in der Hermes-Umgebung; für Rendering optional LibreOffice und Poppler" },
  "computer-use": { account: "none", setupDe: "Hermes Computer Use steuert Linux-Anwendungen in einer zugänglichen WSLg-Desktop-Sitzung über cua-driver. Die Linux-Sitzung muss Bildschirmaufnahme und Eingabe über X11/AT-SPI erlauben. Das ist keine Steuerung des beliebigen Windows-Desktops. Vor Änderungen immer zuerst einen aktuellen Bildschirm erfassen und die sichtbare Aktion prüfen.", capability: "WSLg-Linux-Desktop mit cua-driver sowie funktionierendem X11/AT-SPI- und Bildschirm-/Eingabezugriff; kein allgemeiner Windows-Desktopzugriff" },
  obsidian: { account: "none", setupDe: "OBSIDIAN_VAULT_PATH in der Hermes-Umgebung auf einen lokalen Vault setzen, den Friday-Ubuntu tatsächlich lesen und schreiben darf, zum Beispiel über einen passenden `/mnt/c/...`- oder `/mnt/d/...`-Pfad. Danach den Zugriff auf genau diesen Ordner prüfen. Ohne gesetzten und erreichbaren Pfad ist kein Notizzugriff eingerichtet.", capability: "Erreichbarer lokaler Obsidian-Vault unter OBSIDIAN_VAULT_PATH in Friday-Ubuntu" },
  opencode: { account: "conditional", setupDe: "OpenCode kann optional als Linux-CLI für den Friday-Benutzer installiert werden: `& '<FridayRoot>\\installer\\setup-coding-cli.ps1' -Cli opencode -InstallRoot '<FridayRoot>'` in PowerShell ausführen und `<FridayRoot>` durch den Friday-Installationspfad ersetzen. Danach den gewünschten Anbieter anmelden oder dessen Umgebungsvariablen setzen. Ein lokaler Modellanbieter kann ohne externes Konto nutzbar sein; gehostete Modelle können Kosten verursachen. Der Installer prüft nur `--version`, keine Anmeldung und keinen Coding-Auftrag; danach `opencode auth list` und einen kleinen Auftrag im gewünschten Repository prüfen.", capability: "Nativ ausführbare OpenCode-Linux-CLI; bei gehostetem Modell passende Anbieter-Authentifizierung" },
  codex: { account: "conditional", setupDe: "Codex kann optional als Linux-CLI für den Friday-Benutzer installiert werden: `& '<FridayRoot>\\installer\\setup-coding-cli.ps1' -Cli codex -InstallRoot '<FridayRoot>'` in PowerShell ausführen und `<FridayRoot>` durch den Friday-Installationspfad ersetzen. Danach in Friday-Ubuntu mit Codex OAuth anmelden oder OPENAI_API_KEY lokal bereitstellen. OAuth kann an einen passenden Codex-Tarif gebunden sein; API-Nutzung wird nach dem OpenAI-Konto abgerechnet. Der Installer prüft nur `--version`, keine Anmeldung und keinen Coding-Auftrag. Anschließend Konto und einen kleinen Auftrag im gewünschten Git-Repository prüfen; ein Windows-Shim im WSL-PATH genügt nicht.", capability: "Nativ ausführbare Codex-Linux-CLI und gültige OAuth- oder API-Anmeldung in Friday-Ubuntu" },
  "claude-code": { account: "conditional", setupDe: "Claude Code kann optional als Linux-CLI für den Friday-Benutzer installiert werden: `& '<FridayRoot>\\installer\\setup-coding-cli.ps1' -Cli claude -InstallRoot '<FridayRoot>'` in PowerShell ausführen und `<FridayRoot>` durch den Friday-Installationspfad ersetzen. Danach anmelden: Browser-OAuth mit geeignetem Pro/Max-Zugang, API-Schlüssel mit nutzungsabhängiger Abrechnung oder Enterprise-SSO. Vor Nutzung Tarif und mögliche Kosten beim Anbieter prüfen. Der Installer prüft nur `--version`, keine Anmeldung und keinen Coding-Auftrag; anschließend `claude auth status` und einen kleinen Auftrag im gewünschten Repository prüfen.", capability: "Nativ ausführbare Claude-Code-Linux-CLI und passende OAuth-, API- oder SSO-Anmeldung in Friday-Ubuntu" },
  airtable: { account: "required", setupDe: "Hermes benötigt ein Airtable Personal Access Token mit passenden Leserechten; Schreibrechte nur für gewünschte Änderungen vergeben. Das Token muss für die betroffenen Bases freigeschaltet und in Hermes' lokaler `.env` hinterlegt sein.", capability: "Airtable Personal Access Token und curl; jq optional" },
  box: { account: "required", setupDe: "Box-Zugriff erfolgt mit der Box-CLI und OAuth; Friday handelt mit den Rechten des angemeldeten Box-Kontos. `box login` einrichten und Zugriff auf die gewünschten Ordner begrenzen. Box AI ist optional, muss aktiviert sein und verbraucht AI Units.", capability: "Box-CLI und OAuth-Konto mit Zugriff auf die gewünschten Inhalte" },
  "google-workspace": { account: "required", setupDe: "Für Google-Dienste Google OAuth einmalig über das Setup-Skript im Hermes-Skill einrichten und nur die benötigten Dienste/Berechtigungen auswählen. Client-Credentials und Token verbleiben lokal; für Gmail allein nennt der Skill Himalaya als einfachere Alternative.", capability: "Google-OAuth-Credentials und autorisierte Hermes-Verbindung" },
  himalaya: { account: "required", setupDe: "Himalaya-CLI installieren, `~/.config/himalaya/config.toml` anlegen und IMAP/SMTP-Zugangsdaten über einen sicheren Passwortspeicher konfigurieren. Senden und Lesen vor dem Einsatz getrennt prüfen.", capability: "Himalaya-CLI, E-Mail-Konto sowie IMAP/SMTP-Konfiguration" },
  notion: { account: "required", setupDe: "Ein Notion-Integrationstoken erstellen, lokal in Hermes' `.env` hinterlegen und die gewünschten Seiten/Datenbanken ausdrücklich mit der Integration teilen. Das optionale `ntn`-CLI ist unter Linux/WSL nutzbar; ohne CLI verwendet der Skill curl.", capability: "Notion-Integrationstoken und freigegebene Zielseiten; curl, optional ntn-CLI" },
  "teams-meeting-pipeline": { account: "required", setupDe: "Erfordert eine Microsoft Entra/Azure-Appregistrierung mit administrativ genehmigten Microsoft Graph-Anwendungsrechten. Tenant-ID, Client-ID und Client-Secret lokal in Hermes' `.env` setzen. Der Hermes-Skill ist nur für Teams- und Cron-Sitzungen vorgesehen.", capability: "Microsoft Graph App-Registrierung, genehmigte Berechtigungen und drei lokale MSGRAPH_* Variablen" },
  github: { account: "conditional", setupDe: "Für authentifizierte GitHub-Aktionen die gh-CLI installieren und `gh auth login` ausführen. Öffentliches Lesen bzw. lokale Git-Arbeit kann ohne Anmeldung funktionieren; private Repositories und schreibende/API-Aktionen benötigen passende Rechte. Zugang im gewünschten WSL-Konto prüfen.", capability: "gh-CLI; GitHub-Anmeldung und ausreichende Repository-Rechte für private oder schreibende Aktionen" },
  xurl: { account: "required", setupDe: "Der X-API-Skill benötigt xurl, manuell registrierte X-App-Credentials und OAuth 2.0. Zugangsdaten ausschließlich lokal in `~/.xurl` konfigurieren und `xurl auth status` prüfen. API-Nutzung unterliegt X-Entwicklerlimits und möglichen Tarifkosten; Credentials nicht in Friday-Chat oder Hermes-Kontext einfügen.", capability: "xurl-CLI, X-Developer-App und OAuth-Anmeldung; API-Zugriff und mögliche Kosten beim Anbieter prüfen" },
  "gif-search": { account: "required", setupDe: "Für die Tenor-Suche einen kostenlosen API-Key laut Hermes-Skill erstellen und `TENOR_API_KEY` lokal in Hermes' `.env` setzen. Benötigt außerdem curl und jq.", capability: "Kostenloser Tenor-API-Key sowie curl und jq" },
  docx: { account: "none", setupDe: "Für Word-Dateien Python 3.10+ mit python-docx in der Hermes-Umgebung installieren. Bilder müssen lokal vorliegen; LibreOffice wird nur für PDF-Konvertierung außerhalb der Kernfunktionen gebraucht.", capability: "Python 3.10+ und python-docx; lokal verfügbare Bilder bei Bildinhalten" },
  pdf: { account: "none", setupDe: "Für PDF-Dateien Python 3.10+ mit pypdf, reportlab und pdfplumber in der Hermes-Umgebung installieren. Rastervorschau ist optional und benötigt pypdfium2 oder Poppler; Lesen und Erzeugen funktionieren auch ohne Vorschau.", capability: "Python 3.10+ mit pypdf, reportlab und pdfplumber; optional pypdfium2 oder Poppler für Rastervorschau" },
  xlsx: { account: "none", setupDe: "Für Tabellen Python 3.10+ mit openpyxl in der Hermes-Umgebung installieren. LibreOffice ist nur optional für Neuberechnung und Formatkonvertierung.", capability: "Python 3.10+ und openpyxl; optional LibreOffice für Neuberechnung/Konvertierung" },
  maps: { account: "none", setupDe: "Benötigt Python 3.8+ und Netzwerkzugriff auf OpenStreetMap/Nominatim, Overpass, OSRM und TimeAPI.io. Laut Hermes-Skill sind keine Drittanbieterpakete und kein API-Key nötig.", capability: "Python 3.8+ und ausgehender Netzwerkzugriff zu den dokumentierten Kartendiensten" },
  songsee: { account: "none", setupDe: "Songsee benötigt Go zur Installation. ffmpeg ist optional für Audioformate außer WAV und MP3.", capability: "Go und installierbares songsee-CLI; optional ffmpeg für weitere Audioformate" },
  "manim-video": { account: "none", setupDe: "Für Animationen Python 3.10+, Manim Community Edition 0.20+, LaTeX und ffmpeg installieren. Der Hermes-Skill nennt diese lokalen Programme ausdrücklich als Voraussetzung.", capability: "Python 3.10+, Manim CE 0.20+, LaTeX und ffmpeg" },
  "youtube-content": { account: "none", setupDe: "Der Skill nutzt youtube_transcript_api. Hermes dokumentiert dessen Installation über das optionale `youtube`-Extra in einer PM-vorbereiteten Hermes-Umgebung; nicht ungeprüft in die laufende Hermes-Umgebung pip-installieren. YouTube-Videos müssen öffentlich abrufbare Transkripte bereitstellen.", capability: "Hermes-Python-Umgebung mit youtube extra / youtube_transcript_api und abrufbares YouTube-Transkript" },
  telephony: { account: "conditional", setupDe: "Für Telefonie ist derzeit kein in Friday verifizierter Anrufadapter eingerichtet. Erst einen unterstützten Provider und einen prüfbaren Adapter anbinden; im Dashboard keinen funktionierenden Anruf versprechen.", capability: "Verifizierter Telefonieadapter und Provider" },
};

function hermesPrerequisites(name: string) {
  const setup = HERMES_SETUP[slug(name)];
  if (!setup) return { accounts: [], setupRefs: [], integrationRefs: [], integrationDetails: [], requiredCapabilities: [], conditionalCapabilities: [] };
  const id = `hermes_${slug(name).replaceAll("-", "_")}`;
  return { accounts: setup.account === "none" ? [] : [id], setupRefs: [], integrationRefs: [id],
    integrationDetails: [{ id, account: setup.account, required: true, setupDe: setup.setupDe, reference: "", settingsTarget: "Hermes-Einstellungen in Friday-Ubuntu", configured: null, connectionChecked: null }],
    requiredCapabilities: [setup.capability], conditionalCapabilities: [] };
}

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
        if (name) skills.set(slug(name), entry);
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
      return { ...skill, discovered: observation.error ? null : Boolean(observed), enabled: typeof observed?.enabled === "boolean" ? observed.enabled : null,
        observedAt: observation.at, observationSource: observation.error ? "unavailable" : "hermes-dashboard", observationError: observation.error };
    });
    const known = new Set(skills.map((skill) => slug(skill.name)));
    for (const [name, entry] of observation.skills) {
      if (known.has(name)) continue;
      skills.push({ id: `hermes:${name}`, source: "hermes", name: field(entry, "name"), category: field(entry, "category") || "Hermes",
        description: field(entry, "description"), version: field(entry, "version") || null, packaged: false, discovered: true,
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : null, observedAt: observation.at, observationSource: "hermes-dashboard", observationError: null,
        ...hermesPrerequisites(field(entry, "name")) });
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
