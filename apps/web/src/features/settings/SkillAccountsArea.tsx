"use client";

import type { CodingCliStatusResponse, ContentStudioKeysResponse, HermesSkillKeyCheckResponse, HermesSkillKeysResponse, ObsidianVaultResponse, WikiPathResponse, SkillCatalogEntry } from "@friday/sdk";
import { ErrorState, Skeleton } from "@friday/ui";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { officialReference } from "@/features/skills/skillPresentation";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSkillsCatalog } from "@/lib/api/domains/skills";
import { queryKeys } from "@/lib/api/queryKeys";
import { useSettingsDrafts } from "./SettingsDrafts";
import { HimalayaAccountSetup } from "./HimalayaAccountSetup";
import { TelegramGatewaySetup } from "./TelegramGatewaySetup";
import { MessagingGatewaySetup } from "./MessagingGatewaySetup";
import { TelephonySetup } from "./TelephonySetup";
import "@/features/skills/skills.css";

type Integration = SkillCatalogEntry["integrationDetails"][number] & { requiredBy: string[] };
type KeyStatus = ContentStudioKeysResponse["data"] | undefined;
type HermesStatus = HermesSkillKeysResponse["data"] | undefined;
type CliStatus = CodingCliStatusResponse["data"][number];
const codingCliNames = { codex: "Codex", opencode: "OpenCode", "claude-code": "Claude Code" } as const;

function codingCliState(item: CliStatus): string {
  if (!item.installed) return "CLI in Friday-Ubuntu nicht erkannt";
  if (item.authState === "signed_in") return "Lokale Anmeldung gemeldet; Modellzugriff nicht geprüft";
  if (item.authState === "stored_credentials") return "Anbieter-Zugangsdaten gespeichert; Gültigkeit nicht geprüft";
  if (item.authState === "signed_out") return item.cli === "opencode"
    ? "Keine gespeicherten Anbieter-Zugangsdaten; lokale Modelle können trotzdem funktionieren"
    : "Keine lokale Anmeldung gemeldet; Umgebungsvariablen nicht geprüft";
  return "Anmeldestatus unbekannt; CLI-Zugriff nicht geprüft";
}

const studioProviders = { kie_ai: "kie", elevenlabs: "elevenlabs" } as const;
const hermesIntegrationKeys = {
  hermes_airtable: "AIRTABLE_API_KEY", hermes_notion: "NOTION_API_KEY",
  hermes_gif_search: "TENOR_API_KEY", hermes_blocked_page_recovery: "JINA_API_KEY",
} as const;
const hermesKeyLabels = {
  AIRTABLE_API_KEY: "Airtable",
  NOTION_API_KEY: "Notion",
  TENOR_API_KEY: "Tenor (GIF-Suche)",
  JINA_API_KEY: "Jina (optionale Seitenwiederherstellung)",
  MSGRAPH_TENANT_ID: "Microsoft Entra Tenant-ID",
  MSGRAPH_CLIENT_ID: "Microsoft Entra Client-ID",
  MSGRAPH_CLIENT_SECRET: "Microsoft Entra Client-Secret",
} as const;
type HermesKey = keyof typeof hermesKeyLabels;

// These paths belong to Hermes running as the Friday-Ubuntu user, not to the browser or Friday's encrypted key store.
const hermesLocations: Record<string, string> = {
  hermes_airtable: "Friday-Ubuntu: ~/.hermes/.env (Airtable-Token)",
  hermes_notion: "Friday-Ubuntu: ~/.hermes/.env (Notion-Token)",
  hermes_teams_meeting_pipeline: "Friday-Ubuntu: ~/.hermes/.env (MSGRAPH_*-Werte)",
  hermes_gif_search: "Friday-Ubuntu: ~/.hermes/.env (TENOR_API_KEY)",
  hermes_box: "Friday-Ubuntu: box login (Box-CLI)",
  hermes_github: "Friday-Ubuntu: gh auth login (GitHub-CLI)",
  hermes_himalaya: "Friday-Ubuntu: ~/.config/himalaya/config.toml (Passwortspeicher verwenden)",
  hermes_google_workspace: "Friday-Ubuntu: OAuth-Setup-Skript im Hermes-Skill google-workspace",
  hermes_xurl: "Friday-Ubuntu: ~/.xurl (xurl auth status prüfen)",
  hermes_email_inbox_triage: "Friday-Ubuntu: Himalaya-Konfiguration oder Google-Workspace-OAuth für das gewählte Postfach",
  hermes_llm_wiki: "Friday-Ubuntu: lokaler WIKI_PATH; optional ob login für Obsidian Sync",
  hermes_llm_wiki_sync: "Friday-Ubuntu: optional obsidian-headless und ob login für Obsidian Sync",
  hermes_blocked_page_recovery: "Friday-Ubuntu: optional JINA_API_KEY in ~/.hermes/.env",
  hermes_opencode: "Friday-Ubuntu: opencode auth list und Anbieter-Anmeldung",
  hermes_codex: "Friday-Ubuntu: codex login oder OPENAI_API_KEY in Hermes' lokaler Umgebung",
  hermes_claude_code: "Friday-Ubuntu: claude auth status und Anbieter-Anmeldung",
};

export function accountSetupView(item: Integration, keys: KeyStatus, hermes: HermesStatus = undefined, cliStatuses: CliStatus[] = []): { href: string | null; action: string | null; state: string; location: string | null } {
  if (item.id === "caldav") return {
    href: "/settings?area=adapters#calendar-setup-title",
    action: "Kalender im Dashboard einrichten",
    state: "Zugang und Kalenderabfrage hier nicht geprüft; Skill-Adapter benötigt eigene Host-Bindung",
    location: null,
  };
  if (item.id === "gmx") return {
    href: "/settings?area=skillAccounts#himalaya-account-title",
    action: "IMAP/SMTP-Postfach im Dashboard einrichten",
    state: "Friday-Postfachstatus im Formular; GMX-Skill-Adapter separat und nicht geprüft",
    location: null,
  };
  if (item.id === "coding_cli") return {
    href: "/settings?area=skillAccounts#coding-cli-setup-title",
    action: "Coding-CLI-Einrichtung ansehen",
    state: "Installation, Anmeldung und Modellzugriff je CLI prüfen",
    location: null,
  };
  if (item.id === "telephony") return {
    href: "/settings?area=skillAccounts#telephony-setup-title",
    action: "SIP-Telefonie im Dashboard einrichten",
    state: "Asterisk-ARI, SIP-Registrierung und Owner-Nebenstelle im Telefoniebereich prüfen",
    location: null,
  };
  const cliIds = { hermes_codex: "codex", hermes_opencode: "opencode", hermes_claude_code: "claude-code" } as const;
  const cliId = Object.hasOwn(cliIds, item.id) ? cliIds[item.id as keyof typeof cliIds] : undefined;
  if (cliId) {
    const status = cliStatuses.find((entry) => entry.cli === cliId);
    return { href: "/settings?area=skillAccounts#coding-cli-setup-title", action: "Coding-CLI-Status ansehen",
      state: status ? codingCliState(status) : "CLI-Status noch nicht gelesen", location: hermesLocations[item.id] ?? null };
  }
  if (item.id === "hermes_llm_wiki") return {
    href: "/settings?area=skillAccounts#wiki-path-setup-title",
    action: "Lokalen Wiki-Pfad im Dashboard einrichten",
    state: item.configured === null ? "Wiki-Pfadstatus unbekannt" : item.configured ? "Lokaler Wiki-Ordner lesbar; Schreibaktion nicht geprüft" : "Lokaler Wiki-Ordner fehlt oder ist nicht lesbar",
    location: null,
  };
  if (item.id === "hermes_himalaya") return {
    href: "/settings?area=skillAccounts#himalaya-account-title",
    action: "E-Mail-Postfach im Dashboard einrichten",
    state: item.configured === null ? "Himalaya-Status unbekannt" : item.configured
      ? "Profil und CLI vorhanden; Lesen und Senden nicht geprüft" : "Himalaya noch nicht einsatzbereit",
    location: "Friday-Ubuntu: ~/.config/himalaya/config.toml",
  };
  if (item.id === "imap_smtp_mail") return {
    href: "/settings?area=skillAccounts#himalaya-account-title",
    action: "IMAP/SMTP-Postfach im Dashboard einrichten",
    state: item.configured === null ? "Lokaler Postfachstatus unbekannt; Verbindung nicht geprüft"
      : item.configured ? "Postfachprofil und Himalaya-CLI lokal bereit; IMAP/SMTP-Verbindung nicht geprüft"
        : "Postfachprofil oder Himalaya-CLI noch nicht lokal bereit; Verbindung nicht geprüft",
    location: null,
  };
  if (item.id === "telegram_gateway") return {
    href: "/settings?area=skillAccounts#telegram-gateway-setup-title",
    action: "Telegram-Bot im Dashboard einrichten",
    state: item.configured === null ? "Lokaler Telegram-Konfigurationsstatus unbekannt; Bot-Verbindung nicht geprüft"
      : item.configured ? "Bot-Token, Owner-ID und Gateway-Schalter lokal eingerichtet; Bot-Verbindung nicht geprüft"
        : "Bot-Token, Owner-ID oder Gateway-Schalter noch nicht lokal eingerichtet; Bot-Verbindung nicht geprüft",
    location: null,
  };
  if (item.id === "discord_gateway" || item.id === "whatsapp_gateway") {
    const name = item.id === "discord_gateway" ? "Discord" : "WhatsApp";
    const anchor = item.id === "discord_gateway" ? "discord" : "whatsapp";
    return { href: `/settings?area=skillAccounts#${anchor}-gateway-setup-title`,
      action: `${name}-Gateway im Dashboard einrichten`,
      state: item.configured === null ? "Lokaler Gateway-Status unbekannt; Verbindung nicht geprüft"
        : item.configured ? "Gateway lokal eingerichtet; Verbindung und Nachrichten nicht geprüft"
          : "Gateway oder erlaubte Nutzer noch nicht eingerichtet; Verbindung nicht geprüft", location: null };
  }
  if (item.id === "obsidian" || item.id === "hermes_obsidian") return {
    href: "/settings?area=skillAccounts#obsidian-setup-title",
    action: "Obsidian-Vault im Dashboard einrichten",
    state: item.configured === null ? "Vault-Status unbekannt; Zugriff nicht geprüft"
      : item.configured ? "Vault in Friday-Ubuntu erreichbar; Notizaktion nicht geprüft" : "Vault fehlt oder ist nicht erreichbar",
    location: null,
  };
  const provider = Object.hasOwn(studioProviders, item.id) ? studioProviders[item.id as keyof typeof studioProviders] : undefined;
  if (provider) return {
    href: "/settings?area=contentStudioKeys",
    action: `${provider === "kie" ? "kie.ai" : "ElevenLabs"}-Schlüssel sicher einrichten`,
    state: keys === undefined ? "Schlüsselstatus unbekannt; Anbieterzugriff nicht geprüft" : keys[provider] ? "Schlüssel hinterlegt; Anbieterzugriff nicht geprüft" : "Schlüssel fehlt; Anbieterzugriff nicht geprüft",
    location: null,
  };
  const hermesKey = Object.hasOwn(hermesIntegrationKeys, item.id) ? hermesIntegrationKeys[item.id as keyof typeof hermesIntegrationKeys] : undefined;
  if (hermesKey) return {
    href: "/settings?area=skillAccounts#hermes-key-setup-title",
    action: `${hermesKey} im Dashboard einrichten`,
    state: hermes === undefined ? "Schlüsselstatus unbekannt; Anbieterzugriff nicht geprüft" : hermes.configured[hermesKey] ? "Schlüssel hinterlegt; Anbieterzugriff nicht geprüft" : "Schlüssel fehlt; Anbieterzugriff nicht geprüft",
    location: null,
  };
  if (item.id === "hermes_teams_meeting_pipeline") {
    const graphKeys = ["MSGRAPH_TENANT_ID", "MSGRAPH_CLIENT_ID", "MSGRAPH_CLIENT_SECRET"] as const;
    const present = graphKeys.filter((key) => hermes?.configured[key]).length;
    return {
      href: "/settings?area=skillAccounts#hermes-key-setup-title",
      action: "Microsoft Graph im Dashboard einrichten",
      state: hermes === undefined ? "Wertestatus unbekannt; Microsoft Graph und Teams nicht geprüft"
        : `${present} von 3 Werten hinterlegt; Microsoft Graph und Teams nicht geprüft`,
      location: null,
    };
  }
  if (item.id.startsWith("hermes_")) return {
    href: null,
    action: null,
    state: "Hermes-Einrichtung und Anmeldung nicht durch Friday geprüft",
    location: hermesLocations[item.id] ?? "Friday-Ubuntu: Hermes-Skill-Anleitung und lokale Hermes-Konfiguration prüfen",
  };
  return {
    href: null,
    action: null,
    state: "Keine bestätigte Dashboard-Einrichtung oder Verbindung vorhanden",
    location: item.settingsTarget || null,
  };
}

export function SkillAccountsArea() {
  const params = useSearchParams();
  const selectedIntegration = params.get("integration");
  const queryClient = useQueryClient();
  const { role } = useSettingsDrafts();
  const query = useSkillsCatalog();
  const [search, setSearch] = useState(selectedIntegration ?? "");
  useEffect(() => { setSearch(selectedIntegration ?? ""); }, [selectedIntegration]);
  const [vaultPath, setVaultPath] = useState("");
  const [vaultSaving, setVaultSaving] = useState(false);
  const [vaultMessage, setVaultMessage] = useState("");
  const [wikiPath, setWikiPath] = useState("");
  const [wikiSaving, setWikiSaving] = useState(false);
  const [wikiMessage, setWikiMessage] = useState("");
  const [hermesValues, setHermesValues] = useState<Partial<Record<HermesKey, string>>>({});
  const [hermesBusy, setHermesBusy] = useState<HermesKey | null>(null);
  const [hermesMessage, setHermesMessage] = useState("");
  const [hermesChecks, setHermesChecks] = useState<Partial<Record<HermesKey, HermesSkillKeyCheckResponse["data"]>>>({});
  const hermesKeys = useQuery({
    queryKey: ["settings", "hermes-skill-keys"],
    queryFn: (): Promise<HermesSkillKeysResponse> => call(getApiClient().GET("/api/v1/settings/hermes-skill-keys")),
    enabled: role === "owner",
  });
  const codingClis = useQuery({
    queryKey: ["settings", "coding-cli-status"],
    queryFn: (): Promise<CodingCliStatusResponse> => call(getApiClient().GET("/api/v1/coding-runs/cli-status")),
    enabled: role === "owner",
  });
  async function updateHermesKey(key: HermesKey, value: string) {
    setHermesBusy(key);
    setHermesMessage("");
    setHermesChecks((current) => ({ ...current, [key]: undefined }));
    try {
      const result: HermesSkillKeysResponse = await call(getApiClient().PATCH("/api/v1/settings/hermes-skill-keys", { body: { key, value } }));
      setHermesValues((current) => ({ ...current, [key]: "" }));
      await hermesKeys.refetch();
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      setHermesMessage(`${hermesKeyLabels[key]}: ${value ? "Wert gespeichert" : "Wert entfernt"}. ${result.data.applied ? "Hermes-Gateway neu gestartet." : "Gateway-Neustart nicht bestätigt; Änderung möglicherweise erst nach Neustart aktiv."} Anbieterzugriff nicht geprüft.`);
    } catch (error) {
      setHermesMessage(error instanceof Error ? error.message : "Hermes-Schlüssel konnte nicht geändert werden.");
    } finally { setHermesBusy(null); }
  }
  async function checkHermesKey(key: "AIRTABLE_API_KEY" | "NOTION_API_KEY") {
    setHermesBusy(key);
    setHermesMessage("");
    setHermesChecks((current) => ({ ...current, [key]: undefined }));
    try {
      const result: HermesSkillKeyCheckResponse = await call(getApiClient().POST("/api/v1/settings/hermes-skill-keys/{key}/check", { params: { path: { key } } }));
      setHermesChecks((current) => ({ ...current, [key]: result.data }));
    } catch (error) {
      setHermesMessage(error instanceof Error ? error.message : "Anbieterprüfung nicht verfügbar.");
    } finally { setHermesBusy(null); }
  }
  const vault = useQuery({
    queryKey: ["settings", "obsidian-vault"],
    queryFn: (): Promise<ObsidianVaultResponse> => call(getApiClient().GET("/api/v1/settings/obsidian-vault")),
    enabled: role === "owner",
  });
  const wiki = useQuery({
    queryKey: ["settings", "wiki-path"],
    queryFn: (): Promise<WikiPathResponse> => call(getApiClient().GET("/api/v1/settings/wiki-path")),
    enabled: role === "owner",
  });
  useEffect(() => { if (wiki.data) setWikiPath(wiki.data.data.customized ? wiki.data.data.path : ""); }, [wiki.data]);
  async function saveWikiPath(path: string) {
    if (!wiki.data) return;
    setWikiSaving(true);
    setWikiMessage("");
    try {
      const result: WikiPathResponse = await call(getApiClient().PUT("/api/v1/settings/wiki-path", {
        params: { header: { "If-Match": String(wiki.data.data.revision) } }, body: { path },
      }));
      await wiki.refetch();
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      setWikiMessage(`${path ? "Wiki-Pfad gespeichert" : "Auf ~/wiki zurückgesetzt"}. ${result.data.readable ? "Ordner in Friday-Ubuntu lesbar." : "Ordner fehlt oder ist nicht lesbar."} ${result.data.applied ? "Hermes-Gateway neu gestartet." : "Gateway-Neustart nicht bestätigt."}`);
    } catch (error) { setWikiMessage(error instanceof Error ? error.message : "Wiki-Pfad konnte nicht geändert werden."); }
    finally { setWikiSaving(false); }
  }
  useEffect(() => {
    if (!vault.data) return;
    const path = vault.data.data.path;
    const match = /^\/mnt\/([a-z])\/(.*)$/i.exec(path);
    setVaultPath(match ? `${match[1]?.toUpperCase()}:\\${match[2]?.replaceAll("/", "\\")}` : path);
  }, [vault.data]);
  async function saveVault() {
    if (!vault.data || !vaultPath.trim()) return;
    setVaultSaving(true);
    setVaultMessage("");
    try {
      const result: ObsidianVaultResponse = await call(getApiClient().PUT("/api/v1/settings/obsidian-vault", {
        params: { header: { "If-Match": String(vault.data.data.revision) } }, body: { path: vaultPath.trim() },
      }));
      await vault.refetch();
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      setVaultMessage(result.data.applied ? "Vault gespeichert und Hermes-Gateway neu gestartet." : "Vault gespeichert; Hermes-Gateway-Neustart nicht bestätigt. Bitte Dienststatus prüfen.");
    } catch (error) {
      setVaultMessage(error instanceof Error ? error.message : "Vault konnte nicht eingerichtet werden.");
    } finally { setVaultSaving(false); }
  }
  const items = useMemo(() => {
    const grouped = new Map<string, Integration>();
    for (const skill of query.data?.data ?? []) for (const detail of skill.integrationDetails) {
      const entry = grouped.get(detail.id);
      if (entry) { if (detail.required) entry.requiredBy.push(skill.name); }
      else grouped.set(detail.id, { ...detail, requiredBy: detail.required ? [skill.name] : [] });
    }
    return [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id, "de"));
  }, [query.data]);
  const hasStudio = items.some((item) => item.id === "kie_ai" || item.id === "elevenlabs");
  const keys = useQuery({
    queryKey: ["content-studio", "keys"],
    queryFn: (): Promise<ContentStudioKeysResponse> => call(getApiClient().GET("/api/v1/settings/content-studio-keys")),
    enabled: role === "owner" && hasStudio,
  });
  const filtered = items.filter((item) => `${item.id} ${item.setupDe}`.toLowerCase().includes(search.toLowerCase()));
  if (query.isPending) return <Skeleton variant="row" height={100} label="Konten laden" />;
  if (query.isError) return <ErrorState compact title="Skill-Konten konnten nicht geladen werden" description={query.error?.message} onRetry={() => void query.refetch()} retryLabel="Erneut versuchen" />;
  return <div className="sk-accounts">
    <p>Konten und lokale Voraussetzungen für die Skills. Ein gespeicherter Schlüssel oder aktivierter Skill belegt noch keine erfolgreiche Anmeldung beim Anbieter.</p>
    <p className="sk-warning">Telefonie lässt sich mit einem passenden Anbieter und einem personalisierten Adapter ergänzen. Für diese Installation ist noch kein Anrufadapter eingerichtet; deshalb sind Kontoeinrichtung und Anrufe derzeit nicht verfügbar. Die unten verzeichneten Anforderungen helfen bei der späteren Anbindung.</p>
    <p><a href="/onboarding">Einführung fortsetzen</a> · <a href="/skills">Alle Skills ansehen</a></p>
    <section aria-labelledby="coding-cli-setup-title">
      <h3 id="coding-cli-setup-title">Coding-CLIs in Friday-Ubuntu</h3>
      <p>ChatGPT Plus/Pro kann Codex CLI anmelden; Claude Pro/Max kann Claude Code anmelden. PowerShell im Friday-Installationsordner: <code>.\installer\setup-coding-cli.ps1 -Cli codex -Login -InstallRoot 'C:\Friday'</code> oder <code>.\installer\setup-coding-cli.ps1 -Cli claude -Login -InstallRoot 'C:\Friday'</code>. Den tatsächlichen Installationspfad einsetzen. Die Anmeldung erfolgt interaktiv beim Anbieter; Friday fragt kein Abo-Passwort ab. Diese CLI-Anmeldung gilt für Coding-Skills, nicht automatisch für Fridays allgemeinen Modellanbieter.</p>
      <p>Friday prüft hier nur die lokalen Programme und deren eigene Anmeldehinweise. Ein grüner Anmeldestatus bestätigt weder Modellzugriff noch Budget oder Berechtigungen im gewählten Repository. OpenCode kann auch mit einem lokalen Modell ohne externes Konto arbeiten.</p>
      {role === "owner" ? <>
        {codingClis.isPending && <p role="status">CLI-Status wird gelesen.</p>}
        {codingClis.isError && <p role="alert">CLI-Status nicht erreichbar. <button type="button" onClick={() => void codingClis.refetch()}>Erneut prüfen</button></p>}
        {codingClis.data?.data.map((item) => <p key={item.cli}><strong>{codingCliNames[item.cli]}</strong>{item.version ? ` ${item.version}` : ""}: {codingCliState(item)}. {item.cli === "codex" ? "ChatGPT-Abo: codex login --device-auth in Friday-Ubuntu." : item.cli === "opencode" ? "Anbieter mit opencode auth login einrichten; für lokale Modelle ist das optional." : "Claude-Abo: claude auth login --claudeai in Friday-Ubuntu."}</p>)}
      </> : <p>Nur der Owner kann den lokalen CLI-Status sehen.</p>}
    </section>
    <HimalayaAccountSetup owner={role === "owner"} />
    <TelegramGatewaySetup owner={role === "owner"} />
    <MessagingGatewaySetup owner={role === "owner"} platform="discord" />
    <MessagingGatewaySetup owner={role === "owner"} platform="whatsapp" />
    <TelephonySetup owner={role === "owner"} />
    <section aria-labelledby="wiki-path-setup-title">
      <h3 id="wiki-path-setup-title">Lokales Markdown-Wiki für Hermes</h3>
      <p>Der Skill llm-wiki liest Markdown in Friday-Ubuntu. Ohne eigenen Pfad verwendet er <code>~/wiki</code>. Gib einen vorhandenen absoluten Linux-Pfad ein; ein Windows-Ordner liegt dort unter <code>/mnt/c/...</code>. Das separate Obsidian-Vault-Feld gilt nicht für diesen Skill. Obsidian Sync ist optional und erfordert obsidian-headless und <code>ob login</code>.</p>
      {role === "owner" ? <>
        <label>WIKI_PATH <input type="text" value={wikiPath} onChange={(event) => setWikiPath(event.target.value)} placeholder="/home/RogueKI/wiki" /></label>
        <button type="button" disabled={wikiSaving || wiki.isPending || !wikiPath.trim()} onClick={() => void saveWikiPath(wikiPath.trim())}>Pfad speichern</button>{" "}
        <button type="button" disabled={wikiSaving || wiki.isPending || !wiki.data?.data.customized} onClick={() => void saveWikiPath("")}>Auf ~/wiki zurücksetzen</button>
        {wiki.isError && <p role="alert">Wiki-Pfadstatus konnte nicht gelesen werden.</p>}
        {wiki.data && <p role="status">{wiki.data.data.readable ? "Wiki-Ordner in Friday-Ubuntu lesbar" : "Wiki-Ordner fehlt oder ist nicht lesbar"} · {wiki.data.data.customized ? "Eigener Pfad" : "Standardpfad ~/wiki"}</p>}
        {wikiMessage && <p role="status">{wikiMessage}</p>}
      </> : <p>Nur der Owner kann den Wiki-Pfad einrichten.</p>}
    </section>
    <section aria-labelledby="obsidian-setup-title">
      <h3 id="obsidian-setup-title">Obsidian-Vault für Hermes</h3>
      <p>Wähle einen vorhandenen Windows-Ordner mit <code>.obsidian</code>. Friday prüft den Zugriff in Friday-Ubuntu und trägt den Pfad in Hermes ein.</p>
      {role === "owner" ? <>
        <label>Vault-Ordner <input type="text" value={vaultPath} onChange={(event) => setVaultPath(event.target.value)} placeholder="C:\\Users\\Name\\Documents\\Mein Vault" /></label>
        <button type="button" disabled={vaultSaving || vault.isPending || !vaultPath.trim()} onClick={() => void saveVault()}>Vault verbinden</button>
        {vault.isError && <p role="alert">Vault-Status konnte nicht gelesen werden.</p>}
        {vault.data && <p role="status">{vault.data.data.configured ? vault.data.data.readable ? "Vault in WSL erreichbar" : "Vault konfiguriert, derzeit nicht erreichbar" : "Noch kein Vault konfiguriert"}</p>}
        {vaultMessage && <p role="status">{vaultMessage}</p>}
      </> : <p>Nur der Owner kann den Vault einrichten.</p>}
    </section>
    <section aria-labelledby="hermes-key-setup-title">
      <h3 id="hermes-key-setup-title">Hermes-Skill-Schlüssel</h3>
      <p>Friday speichert diese Skill-Werte im installierten Hermes-Konto in Friday-Ubuntu. Für Teams brauchst du eine Microsoft Entra-Appregistrierung und administrativ genehmigte Microsoft Graph-Anwendungsrechte. Tenant-ID und Client-ID sind Kennungen; das Client-Secret ist vertraulich. Die drei Werte allein bestätigen weder Graph-Berechtigungen noch Teams-Zugriff. Der Prüfknopf testet bei Airtable und Notion nur, ob der Anbieter den Token an einem Lese-Endpunkt akzeptiert; Zugriff auf Bases oder Seiten bleibt ungeprüft. Das Ergebnis gilt nur für diese Abfrage und wird nicht gespeichert.</p>
      {role === "owner" ? <>
        {hermesKeys.isError && <p role="alert">Hermes-Schlüsselstatus konnte nicht gelesen werden.</p>}
        {hermesKeys.isPending && <p role="status">Hermes-Schlüsselstatus wird geladen.</p>}
        {hermesKeys.data && (Object.keys(hermesKeyLabels) as HermesKey[]).map((key) => <div className="sk-accounts__key" key={key}>
          <label htmlFor={`hermes-key-${key}`}>{hermesKeyLabels[key]} ({key})</label>
          <input id={`hermes-key-${key}`} type={key === "MSGRAPH_TENANT_ID" || key === "MSGRAPH_CLIENT_ID" ? "text" : "password"} autoComplete="off" value={hermesValues[key] ?? ""}
            onChange={(event) => setHermesValues((current) => ({ ...current, [key]: event.target.value }))}
            aria-describedby={`hermes-state-${key}`} />
          <span id={`hermes-state-${key}`} className="sk-muted">{hermesKeys.data.data.configured[key] ? "Hinterlegt" : "Fehlt"}; {hermesChecks[key] ? "letzte Anbieterabfrage unten" : "Anbieterzugriff nicht geprüft"}</span>{" "}
          <button type="button" disabled={hermesBusy !== null || !hermesValues[key]} onClick={() => void updateHermesKey(key, hermesValues[key] ?? "")}>Speichern</button>{" "}
          <button type="button" disabled={hermesBusy !== null || !hermesKeys.data.data.configured[key]} onClick={() => void updateHermesKey(key, "")}>Entfernen</button>
          {(key === "AIRTABLE_API_KEY" || key === "NOTION_API_KEY") && <>
            {" "}<button type="button" disabled={hermesBusy !== null || !hermesKeys.data.data.configured[key] || Boolean(hermesValues[key])} onClick={() => void checkHermesKey(key)}>Verbindung prüfen</button>
            {hermesChecks[key] && <span role="status"> {hermesChecks[key].state === "verified" ? "Token akzeptiert" : hermesChecks[key].state === "missing" ? "Schlüssel fehlt" : hermesChecks[key].state === "rejected" ? "Token abgelehnt" : hermesChecks[key].state === "permission-limited" ? "Zugriff verweigert oder Berechtigung fehlt" : "Anbieter derzeit nicht erreichbar"} ({new Date(hermesChecks[key].checkedAt).toLocaleTimeString("de-DE")}). {key === "AIRTABLE_API_KEY" ? "Zugriff auf Bases ist damit nicht geprüft." : "Zugriff auf Seiten ist damit nicht geprüft."}</span>}
          </>}
        </div>)}
        {hermesMessage && <p role="status">{hermesMessage}</p>}
      </> : <p>Nur der Owner kann Hermes-Schlüssel verwalten.</p>}
    </section>
    <label>Integration suchen <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name oder Einrichtung" /></label>
    {selectedIntegration && !items.some((item) => item.id === selectedIntegration) && <p role="status">Die angefragte Integration ist im aktuellen Skill-Katalog nicht vorhanden. Bitte Katalog aktualisieren oder eine andere Integration wählen.</p>}
    <p role="status">{filtered.length} von {items.length} Integrationen</p>
    {filtered.map((item) => {
      const setup = accountSetupView(item, keys.data?.data, hermesKeys.data?.data, codingClis.data?.data);
      const reference = officialReference(item.reference);
      return <article key={item.id}>
        {item.id === selectedIntegration && <p><mark>Ausgewählte Integration</mark></p>}
        <h3>{item.id.replaceAll("_", " ")}</h3>
        <p className="sk-muted">{item.account === "none" ? "Kein externes Konto" : item.account === "required" ? "Konto erforderlich" : "Konto je nach Nutzung"} · {setup.state}</p>
        <p>{item.setupDe}</p>
        {item.requiredBy.length > 0 && <p className="sk-muted">Benötigt von: {item.requiredBy.slice(0, 8).join(", ")}{item.requiredBy.length > 8 ? ` und ${item.requiredBy.length - 8} weiteren` : ""}</p>}
        {setup.href && role === "owner" && <a href={setup.href}>{setup.action}</a>}
        {setup.href && role !== "owner" && <p className="sk-muted">Nur der Owner kann diesen Schlüssel im Dashboard einrichten.</p>}
        {reference && <> · <a href={reference} target="_blank" rel="noopener noreferrer">Anleitung öffnen</a></>}
        {setup.location && <p className="sk-muted">Einrichtungsort: {setup.location}</p>}
        {item.settingsTarget && item.id.startsWith("hermes_") && <p className="sk-muted">Friday-Ziel: {item.settingsTarget}</p>}
      </article>;
    })}
  </div>;
}
