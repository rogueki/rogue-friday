import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AdapterConfigSettings, SkillCatalogEntry } from "@friday/sdk";
import type { CodingCliStatus } from "./coding-runs";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";

type Json = Record<string, unknown>;
type Integration = SkillCatalogEntry["integrationDetails"][number];
type Permissions = NonNullable<Integration["permissions"]>;
type Cost = NonNullable<Integration["cost"]>;
type Catalog = { skills: SkillCatalogEntry[]; error: string | null };
type Observation = { skills: Map<string, Json>; at: string | null; error: string | null };
type HermesKeyFlags = Readonly<Record<"AIRTABLE_API_KEY" | "NOTION_API_KEY" | "TENOR_API_KEY" | "JINA_API_KEY" | "MSGRAPH_TENANT_ID" | "MSGRAPH_CLIENT_ID" | "MSGRAPH_CLIENT_SECRET", boolean>>;
type VaultFlags = Readonly<{ configured: boolean; readable: boolean }>;
type WikiFlags = Readonly<{ configured: boolean; readable: boolean }>;
type HimalayaFlags = Readonly<{ readyForLocalUse: boolean }>;
type TelegramFlags = Readonly<{ tokenConfigured: boolean; allowedUserIds: string[]; enabled: boolean | null }>;
type DiscordFlags = Readonly<{ tokenConfigured?: boolean; allowedUserIds: string[]; enabled: boolean | null }>;
type WhatsappFlags = Readonly<{ sessionPresent?: boolean; allowedUserIds: string[]; enabled: boolean | null }>;
type TelephonyFlags = Readonly<{ configured: boolean; ready: boolean }>;
type CloudTalkFlags = Readonly<{ configured: boolean; agentId: number | null }>;
const HERMES_KEY_INTEGRATIONS = {
  hermes_airtable: "AIRTABLE_API_KEY", hermes_notion: "NOTION_API_KEY",
  hermes_gif_search: "TENOR_API_KEY", hermes_blocked_page_recovery: "JINA_API_KEY",
} as const;
const CODING_CLI_INTEGRATIONS = {
  hermes_codex: "codex", hermes_opencode: "opencode", hermes_claude_code: "claude-code",
} as const;

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const field = (obj: Json, ...names: string[]): string => {
  for (const name of names) if (typeof obj[name] === "string") return obj[name] as string;
  return "";
};
const UNKNOWN_PERMISSIONS: Permissions = {
  required_prerequisites: [], optional_prerequisites: [], scope_status: "unknown",
  scope_notice: "Benötigte Berechtigungen und Freigaben sind für diese Integration nicht vollständig katalogisiert. Vor der Nutzung die aktuelle Anbieter- oder Skill-Anleitung prüfen.",
};
const UNKNOWN_COST: Cost = { model: "unknown", notice: "Mögliche Anbieter-, Lizenz- oder Betriebskosten sind für diese Integration nicht katalogisiert. Vor der Nutzung beim Anbieter prüfen." };
const prerequisite = (value: unknown, status: "required" | "optional"): Permissions["required_prerequisites"][number] | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Json;
  return typeof item.kind === "string" && item.kind && item.status === status && typeof item.notice === "string" && item.notice
    ? { kind: item.kind, status, notice: item.notice } : null;
};
function permissionMetadata(value: unknown): Permissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return UNKNOWN_PERMISSIONS;
  const item = value as Json;
  if (!Array.isArray(item.required_prerequisites) || !Array.isArray(item.optional_prerequisites)
    || !["unknown", "not_required"].includes(String(item.scope_status)) || typeof item.scope_notice !== "string" || !item.scope_notice) return UNKNOWN_PERMISSIONS;
  const required = item.required_prerequisites.map((entry) => prerequisite(entry, "required"));
  const optional = item.optional_prerequisites.map((entry) => prerequisite(entry, "optional"));
  if (required.some((entry) => !entry) || optional.some((entry) => !entry)) return UNKNOWN_PERMISSIONS;
  return { required_prerequisites: required as Permissions["required_prerequisites"], optional_prerequisites: optional as Permissions["optional_prerequisites"],
    scope_status: item.scope_status as Permissions["scope_status"], scope_notice: item.scope_notice };
}
function costMetadata(value: unknown): Cost {
  if (!value || typeof value !== "object" || Array.isArray(value)) return UNKNOWN_COST;
  const item = value as Json;
  return ["host_resources", "provider_usage", "subscription_license", "none", "unknown"].includes(String(item.model))
    && typeof item.notice === "string" && item.notice ? { model: item.model as Cost["model"], notice: item.notice } : UNKNOWN_COST;
}
const HERMES_FACTS: Record<string, { permissions: Permissions; cost: Cost }> = {
  powerpoint: {
    permissions: { required_prerequisites: [{ kind: "local_execution", status: "required", notice: "Python 3.10+ und python-pptx müssen in der Hermes-Umgebung ausführbar sein; Dateien brauchen einen beschreibbaren Ausgabeort." }], optional_prerequisites: [{ kind: "local_execution", status: "optional", notice: "LibreOffice und Poppler werden nur für Bildvorschau oder PDF-Export benötigt." }], scope_status: "not_required", scope_notice: "Der dokumentierte Offline-Kernablauf benötigt keine Anbieter- oder OAuth-Scopes." },
    cost: { model: "host_resources", notice: "Der dokumentierte Offline-Kernablauf nutzt lokale Rechen- und Speicherressourcen; mögliche Kosten der Modellnutzung sind davon getrennt." },
  },
  "computer-use": {
    permissions: { required_prerequisites: [{ kind: "host_access", status: "required", notice: "Eine zugängliche WSLg-Linux-Desktop-Sitzung muss Bildschirmaufnahme und Eingabe über X11/AT-SPI erlauben." }], optional_prerequisites: [], scope_status: "not_required", scope_notice: "Für den dokumentierten lokalen Desktop-Pfad sind keine Anbieter- oder OAuth-Scopes vorgesehen." },
    cost: { model: "host_resources", notice: "Der dokumentierte Desktop-Pfad benötigt lokale Host-Ressourcen; Modellnutzung kann zusätzlich Kosten verursachen." },
  },
  "llm-wiki": {
    permissions: { required_prerequisites: [{ kind: "filesystem", status: "required", notice: "Hermes benötigt Lesezugriff auf WIKI_PATH oder ~/wiki." }], optional_prerequisites: [{ kind: "provider_account", status: "optional", notice: "Headless Obsidian Sync benötigt ein Obsidian-Sync-Abonnement und eine lokale Anmeldung." }], scope_status: "unknown", scope_notice: "Der lokale Wiki-Pfad benötigt keine Anbieter-Scopes; Rechte des optionalen Sync-Pfads sind hier nicht geprüft." },
    cost: { model: "unknown", notice: "Das lokale Wiki nutzt Host-Ressourcen. Optionaler Obsidian Sync kann ein kostenpflichtiges Abonnement benötigen." },
  },
  airtable: {
    permissions: { required_prerequisites: [{ kind: "provider_account", status: "required", notice: "Ein Airtable Personal Access Token mit Zugriff auf die benötigten Bases ist erforderlich; Schreibrechte nur für gewünschte Änderungen freigeben." }], optional_prerequisites: [], scope_status: "unknown", scope_notice: "Die konkret benötigten Token-Scopes hängen von der Aufgabe ab und sind hier nicht geprüft." },
    cost: UNKNOWN_COST,
  },
  notion: {
    permissions: { required_prerequisites: [{ kind: "provider_account", status: "required", notice: "Notion-Integrationstoken einrichten und die gewünschten Seiten oder Datenbanken ausdrücklich freigeben." }], optional_prerequisites: [], scope_status: "unknown", scope_notice: "Die für die konkrete Aufgabe nötigen Notion-Rechte sind hier nicht geprüft." },
    cost: UNKNOWN_COST,
  },
  codex: {
    permissions: { required_prerequisites: [{ kind: "provider_account", status: "required", notice: "Codex CLI benötigt eine gültige ChatGPT- oder API-Anmeldung im Friday-Ubuntu-Konto." }], optional_prerequisites: [], scope_status: "unknown", scope_notice: "Zugriff auf das Ziel-Repository und Modellberechtigung müssen für den konkreten Auftrag geprüft werden." },
    cost: { model: "unknown", notice: "ChatGPT-Abo und API-Nutzung haben unterschiedliche Abrechnungswege; aktuelle Konditionen beim Anbieter prüfen." },
  },
  "claude-code": {
    permissions: { required_prerequisites: [{ kind: "provider_account", status: "required", notice: "Claude Code benötigt eine gültige Claude-, API- oder SSO-Anmeldung im Friday-Ubuntu-Konto." }], optional_prerequisites: [], scope_status: "unknown", scope_notice: "Zugriff auf das Ziel-Repository und Modellberechtigung müssen für den konkreten Auftrag geprüft werden." },
    cost: { model: "unknown", notice: "Claude-Abo und Console-API-Nutzung haben unterschiedliche Abrechnungswege; aktuelle Konditionen beim Anbieter prüfen." },
  },
};
const hermesFacts = (name: string) => HERMES_FACTS[slug(name)] ?? { permissions: UNKNOWN_PERMISSIONS, cost: UNKNOWN_COST };
const unavailable = (message: string): ApiError => new ApiError({ code: "ADAPTER_UNAVAILABLE", message });

const HERMES_SETUP: Record<string, { account: "none" | "conditional" | "required"; setupDe: string; capability: string }> = {
  "email-inbox-triage": { account: "conditional", setupDe: "Der Triage-Skill verbindet kein Postfach selbst. Richte einen E-Mail-Connector ein: Himalaya mit IMAP/SMTP in `~/.config/himalaya/config.toml` oder Google Workspace über dessen OAuth-Setup. Bei mehreren Postfächern vor jeder Triage Konto, Ordner/Zeitraum und erlaubte Aktionen festlegen. Zugangsdaten nur lokal im Connector einrichten, nie im Chat.", capability: "Funktionierender Himalaya- oder Google-Workspace-Connector mit dem ausdrücklich ausgewählten E-Mail-Konto" },
  "llm-wiki": { account: "conditional", setupDe: "Das Markdown-Wiki läuft lokal ohne Konto; `WIKI_PATH` setzen oder `~/wiki` verwenden. Nur für headless Synchronisierung mit Obsidian Sync sind Node.js 22+, `obsidian-headless`, ein Obsidian-Konto mit aktivem Sync-Abonnement und lokale Anmeldung mit `ob login` erforderlich. Zugangsdaten nicht im Chat hinterlegen.", capability: "Lokaler Markdown-Pfad; optional für headless Obsidian-Sync Node.js 22+, obsidian-headless und ein Obsidian-Konto mit aktivem Sync-Abonnement" },
  "blocked-page-recovery": { account: "conditional", setupDe: "Wayback, archive.today, API-Alternativen und Browser-Fallback benötigen kein Konto. Nur die optionale Jina-Reader-Route braucht `JINA_API_KEY` lokal in Hermes' `.env`; ohne Key wird diese Route übersprungen. Den Key niemals im Chat teilen.", capability: "Python 3 für das Hilfsskript; optional Jina-API-Key für die Jina-Reader-Route" },
  powerpoint: { account: "none", setupDe: "Der Hermes-Skill erstellt, liest und bearbeitet Präsentationen offline mit fünf Skripten im Skill-Ordner. Er benötigt Python 3.10+ und python-pptx. LibreOffice plus Poppler sind nur für Bildvorschau/PDF-Export erforderlich; Erstellen, Lesen und Bearbeiten funktionieren ohne sie.", capability: "Python 3.10+ und python-pptx in der Hermes-Umgebung; für Rendering optional LibreOffice und Poppler" },
  "computer-use": { account: "none", setupDe: "Hermes Computer Use steuert Linux-Anwendungen in einer zugänglichen WSLg-Desktop-Sitzung über cua-driver. Die Linux-Sitzung muss Bildschirmaufnahme und Eingabe über X11/AT-SPI erlauben. Das ist keine Steuerung des beliebigen Windows-Desktops. Vor Änderungen immer zuerst einen aktuellen Bildschirm erfassen und die sichtbare Aktion prüfen.", capability: "WSLg-Linux-Desktop mit cua-driver sowie funktionierendem X11/AT-SPI- und Bildschirm-/Eingabezugriff; kein allgemeiner Windows-Desktopzugriff" },
  obsidian: { account: "none", setupDe: "Im Dashboard unter Einstellungen > Skill-Konten einen vorhandenen Windows-Obsidian-Vault mit .obsidian-Ordner auswaehlen. Friday prueft den Zugriff in Friday-Ubuntu, setzt OBSIDIAN_VAULT_PATH in der lokalen Hermes-.env und startet das Gateway neu. Ohne erreichbaren Vault ist kein Notizzugriff eingerichtet.", capability: "Erreichbarer lokaler Obsidian-Vault unter OBSIDIAN_VAULT_PATH in Friday-Ubuntu" },
  opencode: { account: "conditional", setupDe: "OpenCode kann optional als Linux-CLI für den Friday-Benutzer installiert werden: `& '<FridayRoot>\\installer\\setup-coding-cli.ps1' -Cli opencode -InstallRoot '<FridayRoot>'` in PowerShell ausführen und `<FridayRoot>` durch den Friday-Installationspfad ersetzen. Danach den gewünschten Anbieter anmelden oder dessen Umgebungsvariablen setzen. Ein lokaler Modellanbieter kann ohne externes Konto nutzbar sein; gehostete Modelle können Kosten verursachen. Der Installer prüft nur `--version`, keine Anmeldung und keinen Coding-Auftrag; danach `opencode auth list` und einen kleinen Auftrag im gewünschten Repository prüfen.", capability: "Nativ ausführbare OpenCode-Linux-CLI; bei gehostetem Modell passende Anbieter-Authentifizierung" },
  codex: { account: "conditional", setupDe: "Codex kann optional als Linux-CLI für den Friday-Benutzer installiert werden: `& '<FridayRoot>\\installer\\setup-coding-cli.ps1' -Cli codex -InstallRoot '<FridayRoot>'` in PowerShell ausführen und `<FridayRoot>` durch den Friday-Installationspfad ersetzen. Fuer ein ChatGPT-Plus/Pro-Abo danach `& '<FridayRoot>\\installer\\setup-coding-cli.ps1' -Cli codex -Login -InstallRoot '<FridayRoot>'` ausfuehren; das startet `codex login --device-auth` interaktiv in Friday-Ubuntu. Alternativ kann ein API-Key fuer getrennt abgerechnete API-Nutzung konfiguriert werden. Friday nimmt keine Abo-Zugangsdaten entgegen. Der Installer prüft nur `--version`, keine Anmeldung und keinen Coding-Auftrag. Anschließend Konto und einen kleinen Auftrag im gewünschten Git-Repository prüfen; ein Windows-Shim im WSL-PATH genügt nicht.", capability: "Nativ ausführbare Codex-Linux-CLI und gültige OAuth- oder API-Anmeldung in Friday-Ubuntu" },
  "claude-code": { account: "conditional", setupDe: "Claude Code kann optional als Linux-CLI für den Friday-Benutzer installiert werden: `& '<FridayRoot>\\installer\\setup-coding-cli.ps1' -Cli claude -InstallRoot '<FridayRoot>'` in PowerShell ausführen und `<FridayRoot>` durch den Friday-Installationspfad ersetzen. Fuer ein Claude-Pro/Max-Abo danach `& '<FridayRoot>\\installer\\setup-coding-cli.ps1' -Cli claude -Login -InstallRoot '<FridayRoot>'` ausfuehren; das startet `claude auth login --claudeai` interaktiv in Friday-Ubuntu. Console-API-Zugang ist eine getrennte, nutzungsabhaengig abgerechnete Option. Friday nimmt keine Abo-Zugangsdaten entgegen. Vor Nutzung Tarif und mögliche Kosten beim Anbieter prüfen. Der Installer prüft nur `--version`, keine Anmeldung und keinen Coding-Auftrag; anschließend `claude auth status` und einen kleinen Auftrag im gewünschten Repository prüfen.", capability: "Nativ ausführbare Claude-Code-Linux-CLI und passende OAuth-, API- oder SSO-Anmeldung in Friday-Ubuntu" },
  airtable: { account: "required", setupDe: "Hermes benötigt ein Airtable Personal Access Token mit passenden Leserechten; Schreibrechte nur für gewünschte Änderungen vergeben. Das Token muss für die betroffenen Bases freigeschaltet und in Hermes' lokaler `.env` hinterlegt sein.", capability: "Airtable Personal Access Token und curl; jq optional" },
  box: { account: "required", setupDe: "Box-Zugriff erfolgt mit der Box-CLI und OAuth; Friday handelt mit den Rechten des angemeldeten Box-Kontos. `box login` einrichten und Zugriff auf die gewünschten Ordner begrenzen. Box AI ist optional, muss aktiviert sein und verbraucht AI Units.", capability: "Box-CLI und OAuth-Konto mit Zugriff auf die gewünschten Inhalte" },
  "google-workspace": { account: "required", setupDe: "Für Google-Dienste Google OAuth einmalig über das Setup-Skript im Hermes-Skill einrichten und nur die benötigten Dienste/Berechtigungen auswählen. Client-Credentials und Token verbleiben lokal; für Gmail allein nennt der Skill Himalaya als einfachere Alternative.", capability: "Google-OAuth-Credentials und autorisierte Hermes-Verbindung" },
  himalaya: { account: "required", setupDe: "Himalaya-CLI installieren, `~/.config/himalaya/config.toml` anlegen und IMAP/SMTP-Zugangsdaten über einen sicheren Passwortspeicher konfigurieren. Senden und Lesen vor dem Einsatz getrennt prüfen.", capability: "Himalaya-CLI, E-Mail-Konto sowie IMAP/SMTP-Konfiguration" },
  notion: { account: "required", setupDe: "Ein Notion-Integrationstoken erstellen, lokal in Hermes' `.env` hinterlegen und die gewünschten Seiten/Datenbanken ausdrücklich mit der Integration teilen. Das optionale `ntn`-CLI ist unter Linux/WSL nutzbar; ohne CLI verwendet der Skill curl.", capability: "Notion-Integrationstoken und freigegebene Zielseiten; curl, optional ntn-CLI" },
  "teams-meeting-pipeline": { account: "required", setupDe: "Eine Microsoft Entra-App registrieren und die benötigten Microsoft Graph-Anwendungsrechte durch einen Administrator genehmigen lassen. Unter Einstellungen > Skill-Konten Tenant-ID, Client-ID und Client-Secret für das installierte Hermes-Konto in Friday-Ubuntu speichern. Drei hinterlegte Werte belegen weder ein gültiges Zugriffstoken noch Graph-Berechtigungen oder Zugriff auf Teams-Sitzungen. Der Hermes-Skill ist nur für Teams- und Cron-Sitzungen vorgesehen.", capability: "Microsoft Graph App-Registrierung, genehmigte Berechtigungen und drei lokale MSGRAPH_* Variablen" },
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
  telephony: { account: "conditional", setupDe: "CloudTalk Desktop unter Einstellungen > Skill-Konten mit installierter App, Online-Agent, zugewiesener Rufnummer und aktivierter Auto-Dial-Option. Friday liest die Nummer vor und verlangt ein zweites sprechergeprueftes Ja. Alternativ CloudTalk-API mit gesonderten Zugangsdaten oder Asterisk-SIP einrichten. Friday kann ueber den Desktop-Link keinen Gespraechsstatus oder Audio pruefen.", capability: "CloudTalk Desktop mit Auto-Dial oder CloudTalk-API-Zugang oder bereiter Asterisk-SIP-Rufpfad" },
  "architecture-diagram": { account: "none", setupDe: "Erstellt ein eigenständiges HTML-Diagramm mit eingebettetem SVG. Der Hermes-Skill nennt keine externen Werkzeuge oder API-Schlüssel.", capability: "Schreibbarer Ausgabeordner für HTML und SVG" },
  arxiv: { account: "none", setupDe: "Recherchiert über die frei zugängliche arXiv-API mit curl. Dafür ist Netzwerkzugriff erforderlich; ein arXiv-Konto oder API-Key ist laut Skill nicht nötig.", capability: "curl und Netzwerkzugriff auf die arXiv-API" },
  "ascii-video": { account: "none", setupDe: "Wandelt lokale Videos und Audiodateien mit der dokumentierten FFmpeg-Pipeline in ASCII-Video um. Eingabedatei, FFmpeg und ein beschreibbarer Ausgabeordner müssen vorhanden sein.", capability: "Lokale Mediendatei und FFmpeg für die Video-Pipeline" },
  "baoyu-infographic": { account: "conditional", setupDe: "Layout und Text können lokal geplant werden. Die Bildgenerierung des Hermes-Skills benötigt ein dafür eingerichtetes Bildwerkzeug bzw. dessen Anbieterzugang; vor Nutzung das gewählte Werkzeug und mögliche Kosten prüfen.", capability: "Für gerenderte Infografiken ein verfügbares Bildgenerierungswerkzeug" },
  "claude-design": { account: "none", setupDe: "Erstellt einmalige HTML-Artefakte aus der Beschreibung. Einen vorhandenen Schreibpfad und zur visuellen Prüfung einen Browser bereitstellen; ein Claude-Abonnement ist für diese Skill-Anleitung nicht vorausgesetzt.", capability: "Schreibbarer Projektpfad; Browser für die visuelle Prüfung" },
  "codebase-inspection": { account: "none", setupDe: "Das pygount-CLI in Friday-Ubuntu installieren und den zu analysierenden Repository-Pfad freigeben. Für lokale Repositories ist kein GitHub-Konto nötig.", capability: "pygount-CLI und lesbarer lokaler Codepfad" },
  "competitor-news-monitor": { account: "conditional", setupDe: "Zu beobachtende Unternehmen, Quellen und Rhythmus festlegen. Für wiederkehrende Berichte einen Hermes-Cronjob einrichten; einzelne Quellen können zusätzliche Konten oder Zugangsrechte verlangen.", capability: "Benannte Unternehmen, erreichbare Quellen und optional Hermes-Cronjob" },
  "design-md": { account: "none", setupDe: "Erstellt oder prüft eine DESIGN.md-Datei im gewählten Projekt. Der Skill setzt keine Anbieteranmeldung voraus; für eine konkrete Website werden deren bestehende Designvorgaben benötigt.", capability: "Schreibbarer Projektpfad und vorhandene Designvorgaben, soweit verfügbar" },
  "document-to-action-items": { account: "conditional", setupDe: "Ein lesbares Dokument und für das Dateiformat passende Extraktion bereitstellen, etwa den Hermes-PDF- oder DOCX-Skill. Nur wenn Aufgaben in einem externen Dienst angelegt werden sollen, dessen Connector getrennt einrichten.", capability: "Lesbares Quelldokument und passender Extraktionsweg; optional Ziel-Connector" },
  dogfood: { account: "none", setupDe: "Benötigt ein Browser-Werkzeug und eine erreichbare Testanwendung. Bei geschützten Seiten ist eine gültige Sitzung erforderlich; der Skill selbst richtet kein Konto ein.", capability: "Funktionsfähiges Browser-Werkzeug und erreichbare Testanwendung" },
  "grounded-citations": { account: "conditional", setupDe: "Für belegte Aussagen erreichbare Originalquellen und ein verfügbares Abrufwerkzeug bereitstellen. Gesperrte oder private Quellen können einen eigenen Zugang verlangen; der Skill besitzt keinen universellen Quellenaccount.", capability: "Abrufbare Quellen und Werkzeug für deren Prüfung" },
  "hermes-agent": { account: "none", setupDe: "Beschreibt Konfiguration, Erweiterung und Betrieb der installierten Hermes-Umgebung. Für einzelne optionale Integrationen gelten jeweils eigene Voraussetzungen; die Anleitung allein bestätigt keine aktivierte Verbindung.", capability: "Zugriff auf die lokale Hermes-Installation und deren Konfiguration" },
  "hermes-agent-skill-authoring": { account: "none", setupDe: "Für eigene Hermes-Skills einen beschreibbaren Repository- oder Nutzer-Skill-Ordner wählen und SKILL.md nach dem Hermes-Format anlegen. Externe Konten sind für die lokale Erstellung nicht erforderlich.", capability: "Schreibbarer Skill-Ordner und Hermes-SKILL.md-Format" },
  humanizer: { account: "none", setupDe: "Bearbeitet bereitgestellten Text anhand der Stilhinweise des Skills. Es ist kein externes Konto oder zusätzliches CLI dokumentiert.", capability: "Vorliegender Text zur Bearbeitung" },
  "inspecting-hermes-desktop-dom": { account: "none", setupDe: "Nur für eine laufende Hermes-Desktop-App mit erreichbarem Chrome-DevTools-Protokoll verwenden. Das Dashboard allein stellt keine Desktop-DOM-Sitzung bereit.", capability: "Laufende Hermes-Desktop-App mit freigegebenem CDP-Zugang" },
  "meeting-action-items": { account: "conditional", setupDe: "Ein vorhandenes Meeting-Protokoll oder Transkript bereitstellen. Teams, Google Workspace oder Notion werden nur benötigt, wenn der gewählte Quell- oder Zielablauf diese Dienste nutzt.", capability: "Lesbare Meeting-Notizen oder Transkript; optional eingerichteter Quell- oder Ziel-Connector" },
  "node-inspect-debugger": { account: "none", setupDe: "Eine eigene Node.js-Anwendung mit aktiviertem Inspector starten und den Debug-Port nur lokal erreichbar machen. Der Skill setzt eine aktive Debug-Sitzung voraus, keinen Anbieteraccount.", capability: "Node.js-Prozess mit bewusst aktiviertem lokalem Inspector" },
  p5js: { account: "none", setupDe: "Eine p5.js-Skizze in einem lokalen Webprojekt anlegen und im Browser prüfen. Für zusätzliche Bild- oder Modellwerkzeuge gelten deren eigene Voraussetzungen.", capability: "p5.js im Projekt und Browser zur Anzeige der Skizze" },
  "popular-web-designs": { account: "none", setupDe: "Nutzt die im Skill enthaltenen Designreferenzen für HTML/CSS. Einen beschreibbaren Projektpfad und Browser zur Prüfung bereitstellen; externe Designkonten sind nicht vorausgesetzt.", capability: "Schreibbarer Webprojektpfad und Browser" },
  "product-price-monitor": { account: "conditional", setupDe: "Konkretes Produkt mit Variante, Zielpreis, Währung und erreichbarer Quelle festlegen. Für wiederkehrende Prüfung einen Hermes-Cronjob einrichten; geschützte Shops oder Benachrichtigungskanäle können eigene Konten verlangen.", capability: "Erreichbare Preisquelle und optional Hermes-Cronjob mit Benachrichtigungskanal" },
  "python-debugpy": { account: "none", setupDe: "Für lokales pdb genügt Python; für Remote-Debugging debugpy in der betroffenen Python-Umgebung installieren und den Debug-Port bewusst absichern.", capability: "Python-Prozess; optional debugpy für eine Debug-Adapter-Sitzung" },
  "requesting-code-review": { account: "conditional", setupDe: "Review eines lokalen Codepfads benötigt die vorhandenen Prüfwerkzeuge und Git-Diff. Für einen zusätzlichen unabhängigen Reviewer muss der entsprechende Hermes-Agentenzugang eingerichtet sein.", capability: "Git-Änderungen und lokale Prüfwerkzeuge; optional verfügbarer Reviewer-Agent" },
  "simplify-code": { account: "conditional", setupDe: "Der Skill beschreibt eine parallele Prüfung jüngster Codeänderungen. Git-Diff und verfügbare Hermes-Subagenten werden benötigt; zusätzliche Modellzugänge hängen von der konkreten Agentenkonfiguration ab.", capability: "Git-Änderungen und verfügbare Hermes-Subagenten" },
  "songwriting-and-ai-music": { account: "conditional", setupDe: "Songtext und Musikprompt lassen sich ohne externes Konto ausarbeiten. Für tatsächliche Musikgenerierung beim gewählten Dienst, etwa Suno, einen eigenen Zugang einrichten und dessen Kosten prüfen.", capability: "Für Audioerzeugung ein verfügbarer Musikgenerierungsdienst; Textarbeit ohne Dienst" },
  spike: { account: "none", setupDe: "Für einen begrenzten technischen Versuch einen beschreibbaren Arbeitsordner und die zum konkreten Versuch gehörenden Werkzeuge bereitstellen. Der Skill selbst fordert keinen Anbieteraccount.", capability: "Isolierter Arbeitsordner und Werkzeuge des konkreten Versuchs" },
  "systematic-debugging": { account: "none", setupDe: "Benötigt Zugriff auf den betroffenen Code, reproduzierbares Verhalten und relevante Logs. Externe Zugänge ergeben sich nur aus dem untersuchten System.", capability: "Reproduktionsweg sowie Code- und Logzugriff für das betroffene System" },
  "test-driven-development": { account: "none", setupDe: "Im betroffenen Projekt eine ausführbare Testumgebung und einen kleinen reproduzierbaren Testfall bereitstellen. Der Skill erfordert keinen eigenen Dienstaccount.", capability: "Lauffähiges Testwerkzeug und beschreibbarer Projektpfad" },
  "weekly-review-planning": { account: "conditional", setupDe: "Verbindlichkeiten, Kalender und Aufgabenquellen für den Rückblick auswählen. Externe Dienste nur über deren separat eingerichtete Connectoren nutzen; für regelmäßige Reviews optional einen Hermes-Cronjob anlegen.", capability: "Ausgewählte lesbare Aufgaben- und Kalenderquellen; optional Hermes-Cronjob" },
};

function hermesPrerequisites(name: string) {
  const setup = HERMES_SETUP[slug(name)];
  if (!setup) {
    const id = `hermes_${slug(name).replaceAll("-", "_")}`;
    return { accounts: [], setupRefs: ["Voraussetzungen dieses Hermes-Skills sind noch nicht katalogisiert. Bitte die installierte SKILL.md und benötigte Werkzeuge oder Konten vor der Nutzung prüfen."], integrationRefs: [id],
      integrationDetails: [{ id, account: "conditional" as const, required: false, setupDe: "Voraussetzungen in der installierten Hermes-SKILL.md prüfen.", reference: "", settingsTarget: "Hermes-Einstellungen in Friday-Ubuntu", configured: null, connectionChecked: null, permissions: UNKNOWN_PERMISSIONS, cost: UNKNOWN_COST }], requiredCapabilities: [], conditionalCapabilities: [] };
  }
  const id = `hermes_${slug(name).replaceAll("-", "_")}`;
  if (id === "hermes_llm_wiki") return { accounts: ["hermes_llm_wiki_sync"], setupRefs: [], integrationRefs: [id, "hermes_llm_wiki_sync"],
    integrationDetails: [
      { id, account: "none" as const, required: true, setupDe: "Lokales Markdown-Wiki: WIKI_PATH auf einen vorhandenen, lesbaren Ordner in Friday-Ubuntu setzen oder ~/wiki verwenden. Ein Obsidian-Vault ist hierfür nicht erforderlich.", reference: "", settingsTarget: "/settings?area=skillAccounts#wiki-path-setup-title", configured: null, connectionChecked: null, ...hermesFacts(name) },
      { id: "hermes_llm_wiki_sync", account: "conditional" as const, required: false, setupDe: "Nur für optionalen Obsidian Sync: obsidian-headless installieren, ein Sync-Abonnement besitzen und in Friday-Ubuntu mit ob login anmelden. Die lokale Wiki-Nutzung funktioniert ohne Sync.", reference: "", settingsTarget: "Friday-Ubuntu: ob login", configured: null, connectionChecked: null, permissions: UNKNOWN_PERMISSIONS, cost: { model: "subscription_license" as const, notice: "Für diesen optionalen Pfad ist ein aktives Obsidian-Sync-Abonnement erforderlich; aktuelle Konditionen beim Anbieter prüfen." } },
    ], requiredCapabilities: ["Lesbarer lokaler Markdown-Ordner unter WIKI_PATH oder ~/wiki"], conditionalCapabilities: ["Optional: obsidian-headless und Obsidian Sync"] };
  return { accounts: setup.account === "none" ? [] : [id], setupRefs: [], integrationRefs: [id],
    integrationDetails: [{ id, account: setup.account, required: setup.account !== "conditional", setupDe: setup.setupDe, reference: "", settingsTarget: "Hermes-Einstellungen in Friday-Ubuntu", configured: null, connectionChecked: null, ...hermesFacts(name) }],
    requiredCapabilities: [setup.capability], conditionalCapabilities: [] };
}

/**
 * Origin and trust exactly as the installed CLI reports them. The set is a bounded token, not a fixed list: v0.20.5
 * said `local`, v0.22.2 says `external` for the same skills, and a closed list turned that into "inventory broken".
 */
export type HermesInventoryEntry = Readonly<{ name: string; category: string; origin: string;
  trust: string; state: "enabled" | "disabled" }>;
type Inventory = { entries: Map<string, HermesInventoryEntry>; at: string | null };

/** The registry is package metadata only. A fresh dashboard request owns discovery and activation. */
export class SkillsService {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string | null;
  private readonly catalogPath: string | undefined;
  private readonly configuredIntegrations: (() => Readonly<{ kie: boolean; elevenlabs: boolean }>) | undefined;
  private readonly hermesKeyStatus: (() => Promise<{ configured: HermesKeyFlags }>) | undefined;
  private readonly obsidianVaultStatus: (() => Promise<VaultFlags>) | undefined;
  private readonly wikiPathStatus: (() => Promise<WikiFlags>) | undefined;
  private readonly himalayaAccountStatus: (() => Promise<HimalayaFlags>) | undefined;
  private readonly telegramGatewayStatus: (() => Promise<TelegramFlags>) | undefined;
  private readonly discordGatewayStatus: (() => Promise<DiscordFlags>) | undefined;
  private readonly whatsappGatewayStatus: (() => Promise<WhatsappFlags>) | undefined;
  private readonly telephonyStatus: (() => Promise<TelephonyFlags>) | undefined;
  private readonly cloudTalkStatus: (() => Promise<CloudTalkFlags> | CloudTalkFlags) | undefined;
  private readonly codingCliStatus: (() => Promise<CodingCliStatus[]>) | undefined;
  private readonly localCalendarStatus: (() => boolean) | undefined;
  private readonly calendarAdapterStatus: (() => AdapterConfigSettings[]) | undefined;
  private readonly hermesInventory: (() => Promise<{ entries: HermesInventoryEntry[]; at: string }>) | undefined;
  private token: string | undefined;

  constructor(options: { catalogPath?: string; dashboardUrl?: string; fetcher?: typeof fetch;
    configuredIntegrations?: () => Readonly<{ kie: boolean; elevenlabs: boolean }>;
    hermesKeyStatus?: () => Promise<{ configured: HermesKeyFlags }>;
    obsidianVaultStatus?: () => Promise<VaultFlags>;
    wikiPathStatus?: () => Promise<WikiFlags>;
    himalayaAccountStatus?: () => Promise<HimalayaFlags>;
    telegramGatewayStatus?: () => Promise<TelegramFlags>;
    discordGatewayStatus?: () => Promise<DiscordFlags>;
    whatsappGatewayStatus?: () => Promise<WhatsappFlags>;
    telephonyStatus?: () => Promise<TelephonyFlags>;
    cloudTalkStatus?: () => Promise<CloudTalkFlags> | CloudTalkFlags;
    codingCliStatus?: () => Promise<CodingCliStatus[]>;
    localCalendarStatus?: () => boolean;
    calendarAdapterStatus?: () => AdapterConfigSettings[];
    hermesInventory?: () => Promise<{ entries: HermesInventoryEntry[]; at: string }> }) {
    this.fetcher = options.fetcher ?? fetch;
    this.catalogPath = options.catalogPath;
    this.configuredIntegrations = options.configuredIntegrations;
    this.hermesKeyStatus = options.hermesKeyStatus;
    this.obsidianVaultStatus = options.obsidianVaultStatus;
    this.wikiPathStatus = options.wikiPathStatus;
    this.himalayaAccountStatus = options.himalayaAccountStatus;
    this.telegramGatewayStatus = options.telegramGatewayStatus;
    this.discordGatewayStatus = options.discordGatewayStatus;
    this.whatsappGatewayStatus = options.whatsappGatewayStatus;
    this.telephonyStatus = options.telephonyStatus;
    this.cloudTalkStatus = options.cloudTalkStatus;
    this.codingCliStatus = options.codingCliStatus;
    this.localCalendarStatus = options.localCalendarStatus;
    this.calendarAdapterStatus = options.calendarAdapterStatus;
    this.hermesInventory = options.hermesInventory;
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
      if (![1, 2].includes(Number(setup.schema_version)) || !setupSkills || typeof setupSkills !== "object" || !rawSkills || typeof rawSkills !== "object") throw new Error("Katalogformat ungültig");
      const entries = Array.isArray(rawSkills) ? rawSkills.map((value, index) => [String(index), value] as const) : Object.entries(rawSkills);
      // Read on every list request so a saved or removed key is visible without restarting the API.
      let keyStatus: Readonly<{ kie: boolean; elevenlabs: boolean }> | undefined;
      try { keyStatus = this.configuredIntegrations?.(); } catch { /* Preserve catalog; local setup state is unknown. */ }
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
            settingsTarget: field(integration, "settings_target"), permissions: permissionMetadata(integration.permissions), cost: costMetadata(integration.cost),
            configured: integrationId === "kie_ai" ? keyStatus?.kie ?? null
              : integrationId === "elevenlabs" ? keyStatus?.elevenlabs ?? null : null,
            connectionChecked: null };
        });
        return {
          id: `friday:${id}`, source: "friday", origin: "friday", trust: "unknown", name,
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

  private async inventory(): Promise<Inventory> {
    if (!this.hermesInventory) return { entries: new Map(), at: null };
    try {
      const observed = await this.hermesInventory();
      return { entries: new Map(observed.entries.map((entry) => [slug(entry.name), entry])), at: observed.at };
    } catch {
      // Origin and trust are detail; an unreadable CLI inventory must not hide the catalog.
      return { entries: new Map(), at: null };
    }
  }

  async list(): Promise<{ skills: SkillCatalogEntry[]; fresh: boolean; catalogError: string | null; hermesError: string | null }> {
    const catalog = this.catalog();
    const [observation, inventory] = await Promise.all([this.observe(), this.inventory()]);
    const skills = catalog.skills.map((skill): SkillCatalogEntry => {
      const observed = observation.skills.get(slug(skill.name));
      const inventoryEntry = inventory.entries.get(slug(skill.name));
      const enabled = typeof observed?.enabled === "boolean" ? observed.enabled
        : inventoryEntry ? inventoryEntry.state === "enabled" : null;
      return { ...skill, discovered: observed || inventoryEntry ? true : observation.error ? null : false, enabled,
        observedAt: observed ? observation.at : inventoryEntry ? inventory.at : observation.at,
        observationSource: observed ? "hermes-dashboard" : inventoryEntry ? "hermes-cli"
          : observation.error ? "unavailable" : "hermes-dashboard",
        observationError: observation.error };
    });
    const known = new Set(skills.map((skill) => slug(skill.name)));
    for (const [name, entry] of observation.skills) {
      if (known.has(name)) continue;
      const inventoryEntry = inventory.entries.get(name);
      skills.push({ id: `hermes:${name}`, source: "hermes", origin: inventoryEntry?.origin ?? "unknown",
        trust: inventoryEntry?.trust ?? "unknown", name: field(entry, "name"), category: field(entry, "category") || "Hermes",
        description: field(entry, "description"), version: field(entry, "version") || null, packaged: false, discovered: true,
        enabled: typeof entry.enabled === "boolean" ? entry.enabled
          : inventoryEntry ? inventoryEntry.state === "enabled" : null,
        observedAt: observation.at, observationSource: "hermes-dashboard", observationError: null,
        ...hermesPrerequisites(field(entry, "name")) });
    }
    // Skills the CLI reports but the dashboard does not: shown with CLI origin and state, never as dashboard data.
    for (const [name, entry] of inventory.entries) {
      if (known.has(name) || observation.skills.has(name)) continue;
      skills.push({ id: `hermes:${name}`, source: "hermes", origin: entry.origin, trust: entry.trust, name,
        category: entry.category || "Hermes", description: "", version: null, packaged: false, discovered: true,
        enabled: entry.state === "enabled", observedAt: inventory.at, observationSource: "hermes-cli",
        observationError: null, ...hermesPrerequisites(name) });
    }
    // One local status read per source per request; a broken installer/WSL never hides the catalog.
    const integrationIds = new Set(skills.flatMap((skill) => skill.integrationDetails.map((detail) => detail.id)));
    const needsHermesKeys = Object.keys(HERMES_KEY_INTEGRATIONS).some((id) => integrationIds.has(id)) || integrationIds.has("hermes_teams_meeting_pipeline");
    const needsVault = integrationIds.has("obsidian") || integrationIds.has("hermes_obsidian");
    const needsWiki = integrationIds.has("hermes_llm_wiki");
    const needsHimalaya = integrationIds.has("hermes_himalaya") || integrationIds.has("imap_smtp_mail");
    const needsTelegram = integrationIds.has("telegram_gateway");
    const needsDiscord = integrationIds.has("discord_gateway");
    const needsWhatsapp = integrationIds.has("whatsapp_gateway");
    const needsTelephony = integrationIds.has("telephony");
    const needsCloudTalk = integrationIds.has("cloudtalk_api");
    const needsCodingCli = Object.keys(CODING_CLI_INTEGRATIONS).some((id) => integrationIds.has(id));
    let localCalendar: boolean | null = null;
    if (integrationIds.has("friday_local_calendar") && this.localCalendarStatus) {
      try { localCalendar = this.localCalendarStatus(); } catch { /* Keep the catalog visible when local storage is unavailable. */ }
    }
    let caldav: boolean | null = null;
    if (integrationIds.has("caldav") && this.calendarAdapterStatus) {
      try {
        const adapter = this.calendarAdapterStatus().find((entry) => entry.category === "calendar");
        caldav = Boolean(adapter?.enabled && adapter.provider === "caldav-calendar" && adapter.config.mode === "caldav"
          && adapter.secretFields.calendarUrl?.configured && adapter.secretFields.username?.configured
          && adapter.secretFields.password?.configured);
      } catch { /* A failed adapter status read is unknown, not unconfigured. */ }
    }
    const [hermesKeys, vault, wiki, himalaya, codingClis, telegram, discord, whatsapp, telephony, cloudTalk] = await Promise.all([
      needsHermesKeys && this.hermesKeyStatus ? Promise.resolve().then(() => this.hermesKeyStatus!()).catch(() => null) : Promise.resolve(null),
      needsVault && this.obsidianVaultStatus ? Promise.resolve().then(() => this.obsidianVaultStatus!()).catch(() => null) : Promise.resolve(null),
      needsWiki && this.wikiPathStatus ? Promise.resolve().then(() => this.wikiPathStatus!()).catch(() => null) : Promise.resolve(null),
      needsHimalaya && this.himalayaAccountStatus ? Promise.resolve().then(() => this.himalayaAccountStatus!()).catch(() => null) : Promise.resolve(null),
      needsCodingCli && this.codingCliStatus ? Promise.resolve().then(() => this.codingCliStatus!()).catch(() => null) : Promise.resolve(null),
      needsTelegram && this.telegramGatewayStatus ? Promise.resolve().then(() => this.telegramGatewayStatus!()).catch(() => null) : Promise.resolve(null),
      needsDiscord && this.discordGatewayStatus ? Promise.resolve().then(() => this.discordGatewayStatus!()).catch(() => null) : Promise.resolve(null),
      needsWhatsapp && this.whatsappGatewayStatus ? Promise.resolve().then(() => this.whatsappGatewayStatus!()).catch(() => null) : Promise.resolve(null),
      needsTelephony && this.telephonyStatus ? Promise.resolve().then(() => this.telephonyStatus!()).catch(() => null) : Promise.resolve(null),
      needsCloudTalk && this.cloudTalkStatus ? Promise.resolve().then(() => this.cloudTalkStatus!()).catch(() => null) : Promise.resolve(null),
    ]);
    for (const skill of skills) skill.integrationDetails = skill.integrationDetails.map((detail) => {
      if (detail.id === "friday_local_calendar") return { ...detail, configured: localCalendar };
      if (detail.id === "caldav") return { ...detail, configured: caldav };
      const key = HERMES_KEY_INTEGRATIONS[detail.id as keyof typeof HERMES_KEY_INTEGRATIONS];
      if (key) return { ...detail, configured: typeof hermesKeys?.configured[key] === "boolean" ? hermesKeys.configured[key] : null };
      if (detail.id === "hermes_teams_meeting_pipeline") return { ...detail, configured: hermesKeys
        ? hermesKeys.configured.MSGRAPH_TENANT_ID && hermesKeys.configured.MSGRAPH_CLIENT_ID && hermesKeys.configured.MSGRAPH_CLIENT_SECRET
        : null };
      if (detail.id === "obsidian" || detail.id === "hermes_obsidian") return { ...detail,
        configured: vault ? vault.configured && vault.readable : null };
      if (detail.id === "hermes_llm_wiki") return { ...detail,
        configured: wiki ? wiki.configured && wiki.readable : null };
      if (detail.id === "hermes_himalaya" || detail.id === "imap_smtp_mail") return { ...detail,
        configured: himalaya ? himalaya.readyForLocalUse : null };
      if (detail.id === "telegram_gateway") return { ...detail,
        // Access may come from Hermes pairing approvals, which these flags cannot see; enabling already requires a verified bot.
        configured: telegram ? telegram.tokenConfigured && telegram.enabled === true : null };
      if (detail.id === "discord_gateway") return { ...detail,
        configured: discord ? Boolean(discord.tokenConfigured) && discord.allowedUserIds.length > 0 && discord.enabled === true : null };
      if (detail.id === "whatsapp_gateway") return { ...detail,
        configured: whatsapp ? Boolean(whatsapp.sessionPresent) && whatsapp.allowedUserIds.length > 0 && whatsapp.enabled === true : null };
      if (detail.id === "telephony") return { ...detail,
        configured: typeof telephony?.configured === "boolean" ? telephony.configured : null };
      if (detail.id === "cloudtalk_api") return { ...detail,
        configured: cloudTalk && typeof cloudTalk.configured === "boolean"
          ? cloudTalk.configured && Number.isSafeInteger(cloudTalk.agentId) && Number(cloudTalk.agentId) > 0 : null };
      const cli = CODING_CLI_INTEGRATIONS[detail.id as keyof typeof CODING_CLI_INTEGRATIONS];
      if (cli) {
        const status = codingClis?.find((entry) => entry.cli === cli);
        const configured = !status ? null : !status.installed ? false : status.authState === "unknown" ? null
          : status.authState === "signed_in" || status.authState === "stored_credentials";
        return { ...detail, configured };
      }
      return detail;
    });
    skills.sort((a, b) => a.id.localeCompare(b.id));
    if (catalog.error) for (const skill of skills) skill.observationError = [skill.observationError, catalog.error].filter(Boolean).join("; ");
    return { skills, fresh: observation.error === null && catalog.error === null, catalogError: catalog.error, hermesError: observation.error };
  }

  /** SKILL.md of a Friday package skill, read from the package checkout; null when the id is not a Friday skill. */
  fridayMarkdown(id: string): { id: string; content: string; bytes: number } | null {
    if (!this.catalogPath) return null;
    const path = resolve(this.catalogPath);
    const setupPath = path.endsWith(".json") ? path : join(path, "integration_setup.json");
    const registryPath = join(dirname(setupPath), "skills.json");
    let registry: Json;
    try {
      registry = JSON.parse(readFileSync(registryPath, "utf8")) as Json;
    } catch {
      // catalog() already reports an unreadable register; a markdown lookup only needs to find nothing here.
      return null;
    }
    const rawSkills = (registry.skills ?? registry) as Json;
    if (!rawSkills || typeof rawSkills !== "object") return null;
    const entries = Array.isArray(rawSkills) ? rawSkills.map((value, index) => [String(index), value] as const) : Object.entries(rawSkills);
    let meta: Json | null = null;
    for (const [key, raw] of entries) {
      const entry = (raw ?? {}) as Json;
      if (slug(field(entry, "id", "name", "slug") || key) === id) { meta = entry; break; }
    }
    if (!meta) return null;
    const rel = field(meta, "path");
    // The register lives in <root>/registry and names each SKILL.md relative to <root>.
    const root = dirname(dirname(registryPath));
    const file = resolve(root, rel);
    const fromRoot = relative(root, file);
    if (!rel || fromRoot.startsWith("..") || isAbsolute(fromRoot) || basename(file) !== "SKILL.md")
      throw notFound("Anleitung zum Skill", id);
    let size = 0;
    let regular = false;
    try {
      const stats = lstatSync(file);
      const real = relative(realpathSync(root), realpathSync(file));
      regular = stats.isFile() && !stats.isSymbolicLink() && !real.startsWith("..") && !isAbsolute(real);
      size = stats.size;
    } catch { /* A missing file is a missing Anleitung, not an adapter failure. */ }
    if (!regular) throw notFound("Anleitung zum Skill", id);
    if (size > 65536) throw validationFailed("Die SKILL.md ist größer als 64 KiB und wird nicht angezeigt.");
    const content = readFileSync(file, "utf8");
    return { id, content, bytes: Buffer.byteLength(content, "utf8") };
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
    if (!confirmed || confirmed.enabled !== enabled || confirmed.discovered !== true) {
      // The request was accepted or lost, but the read-back is the truth: name the state that actually holds.
      const observed = confirmed?.enabled ?? null;
      throw conflict(`Hermes hat den neuen Skillzustand nicht bestätigt; beobachtet: ${
        observed === true ? "aktiviert" : observed === false ? "deaktiviert" : "unbekannt"}.`,
      { skillId: id, requested: enabled, observed });
    }
    return confirmed;
  }
}
