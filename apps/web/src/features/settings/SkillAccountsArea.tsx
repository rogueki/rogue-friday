"use client";

import type { ContentStudioKeysResponse, SkillCatalogEntry } from "@friday/sdk";
import { ErrorState, Skeleton } from "@friday/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { officialReference } from "@/features/skills/skillPresentation";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSkillsCatalog } from "@/lib/api/domains/skills";
import { useSettingsDrafts } from "./SettingsDrafts";
import "@/features/skills/skills.css";

type Integration = SkillCatalogEntry["integrationDetails"][number] & { requiredBy: string[] };
type KeyStatus = ContentStudioKeysResponse["data"] | undefined;

const studioProviders = { kie_ai: "kie", elevenlabs: "elevenlabs" } as const;

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
  hermes_opencode: "Friday-Ubuntu: opencode auth list und Anbieter-Anmeldung",
  hermes_codex: "Friday-Ubuntu: codex login oder OPENAI_API_KEY in Hermes' lokaler Umgebung",
  hermes_claude_code: "Friday-Ubuntu: claude auth status und Anbieter-Anmeldung",
};

export function accountSetupView(item: Integration, keys: KeyStatus): { href: string | null; action: string | null; state: string; location: string | null } {
  const provider = Object.hasOwn(studioProviders, item.id) ? studioProviders[item.id as keyof typeof studioProviders] : undefined;
  if (provider) return {
    href: "/settings?area=contentStudioKeys",
    action: `${provider === "kie" ? "kie.ai" : "ElevenLabs"}-Schlüssel sicher einrichten`,
    state: keys === undefined ? "Schlüsselstatus unbekannt; Anbieterzugriff nicht geprüft" : keys[provider] ? "Schlüssel hinterlegt; Anbieterzugriff nicht geprüft" : "Schlüssel fehlt; Anbieterzugriff nicht geprüft",
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
  const { role } = useSettingsDrafts();
  const query = useSkillsCatalog();
  const [search, setSearch] = useState("");
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
    <label>Integration suchen <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name oder Einrichtung" /></label>
    <p role="status">{filtered.length} von {items.length} Integrationen</p>
    {filtered.map((item) => {
      const setup = accountSetupView(item, keys.data?.data);
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
