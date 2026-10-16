"use client";

import type { ContentStudioKeysResponse, HermesSkillKeyCheckResponse, HermesSkillKeysResponse, ObsidianVaultResponse, SkillCatalogEntry } from "@friday/sdk";
import { ErrorState, Skeleton } from "@friday/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { officialReference } from "@/features/skills/skillPresentation";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSkillsCatalog } from "@/lib/api/domains/skills";
import { queryKeys } from "@/lib/api/queryKeys";
import { useSettingsDrafts } from "./SettingsDrafts";
import "@/features/skills/skills.css";

type Integration = SkillCatalogEntry["integrationDetails"][number] & { requiredBy: string[] };
type KeyStatus = ContentStudioKeysResponse["data"] | undefined;
type HermesStatus = HermesSkillKeysResponse["data"] | undefined;

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
  hermes_blocked_page_recovery: "Friday-Ubuntu: optional JINA_API_KEY in ~/.hermes/.env",
  hermes_opencode: "Friday-Ubuntu: opencode auth list und Anbieter-Anmeldung",
  hermes_codex: "Friday-Ubuntu: codex login oder OPENAI_API_KEY in Hermes' lokaler Umgebung",
  hermes_claude_code: "Friday-Ubuntu: claude auth status und Anbieter-Anmeldung",
};

export function accountSetupView(item: Integration, keys: KeyStatus, hermes: HermesStatus = undefined): { href: string | null; action: string | null; state: string; location: string | null } {
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
  const queryClient = useQueryClient();
  const { role } = useSettingsDrafts();
  const query = useSkillsCatalog();
  const [search, setSearch] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [vaultSaving, setVaultSaving] = useState(false);
  const [vaultMessage, setVaultMessage] = useState("");
  const [hermesValues, setHermesValues] = useState<Partial<Record<HermesKey, string>>>({});
  const [hermesBusy, setHermesBusy] = useState<HermesKey | null>(null);
  const [hermesMessage, setHermesMessage] = useState("");
  const [hermesChecks, setHermesChecks] = useState<Partial<Record<HermesKey, HermesSkillKeyCheckResponse["data"]>>>({});
  const hermesKeys = useQuery({
    queryKey: ["settings", "hermes-skill-keys"],
    queryFn: (): Promise<HermesSkillKeysResponse> => call(getApiClient().GET("/api/v1/settings/hermes-skill-keys")),
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
      setHermesMessage(`${hermesKeyLabels[key]}: ${value ? "Schlüssel gespeichert" : "Schlüssel entfernt"}. ${result.data.applied ? "Hermes-Gateway neu gestartet." : "Gateway-Neustart nicht bestätigt; Änderung möglicherweise erst nach Neustart aktiv."} Anbieterzugriff nicht geprüft.`);
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
    <p className="sk-warning">Telefonie: Friday enthält derzeit keinen verifizierten Anrufadapter. Hier kann noch kein Telefonkonto eingerichtet oder ein Anruf ausgelöst werden.</p>
    <p><a href="/onboarding">Einführung fortsetzen</a> · <a href="/skills">Alle Skills ansehen</a></p>
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
      <p>Diese vier Schlüssel speichert Friday im installierten Hermes-Konto in Friday-Ubuntu. Der Prüfknopf testet bei Airtable und Notion nur, ob der Anbieter den Token an einem Lese-Endpunkt akzeptiert; Zugriff auf Bases oder Seiten bleibt ungeprüft. Das Ergebnis gilt nur für diese Abfrage und wird nicht gespeichert.</p>
      {role === "owner" ? <>
        {hermesKeys.isError && <p role="alert">Hermes-Schlüsselstatus konnte nicht gelesen werden.</p>}
        {hermesKeys.isPending && <p role="status">Hermes-Schlüsselstatus wird geladen.</p>}
        {hermesKeys.data && (Object.keys(hermesKeyLabels) as HermesKey[]).map((key) => <div className="sk-accounts__key" key={key}>
          <label htmlFor={`hermes-key-${key}`}>{hermesKeyLabels[key]} ({key})</label>
          <input id={`hermes-key-${key}`} type="password" autoComplete="off" value={hermesValues[key] ?? ""}
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
    <p role="status">{filtered.length} von {items.length} Integrationen</p>
    {filtered.map((item) => {
      const setup = accountSetupView(item, keys.data?.data, hermesKeys.data?.data);
      const reference = officialReference(item.reference);
      return <article key={item.id}>
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
