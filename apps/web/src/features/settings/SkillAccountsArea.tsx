"use client";

import { ErrorState, Skeleton } from "@friday/ui";
import { useMemo, useState } from "react";
import { useSkillsCatalog } from "@/lib/api/domains/skills";
import { internalSetupLink, officialReference } from "@/features/skills/skillPresentation";
import "@/features/skills/skills.css";

export function SkillAccountsArea() {
  const query = useSkillsCatalog(); const [search, setSearch] = useState("");
  const items = useMemo(() => {
    const grouped = new Map<string, { id: string; account: string; setupDe: string; reference: string; settingsTarget: string; requiredBy: string[]; configured: boolean | null; connectionChecked: boolean | null }>();
    for (const skill of query.data?.data ?? []) for (const detail of skill.integrationDetails) {
      const entry = grouped.get(detail.id);
      if (entry) { if (detail.required) entry.requiredBy.push(skill.name); }
      else grouped.set(detail.id, { ...detail, requiredBy: detail.required ? [skill.name] : [] });
    }
    return [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id, "de"));
  }, [query.data]);
  const filtered = items.filter((item) => `${item.id} ${item.setupDe}`.toLowerCase().includes(search.toLowerCase()));
  if (query.isPending) return <Skeleton variant="row" height={100} label="Konten laden" />;
  if (query.isError) return <ErrorState compact title="Skill-Konten konnten nicht geladen werden" description={query.error?.message} onRetry={() => void query.refetch()} retryLabel="Erneut versuchen" />;
  return <div className="sk-accounts"><p>Konten und lokale Voraussetzungen für die Skills. Ein aufgeführter Dienst ist noch keine verbundene Integration. Der Katalog zeigt nur geprüfte Zustände als geprüft an.</p><p className="sk-warning">Telefonie: Friday enthält derzeit keinen verifizierten Anrufadapter. Hier kann noch kein Telefonkonto eingerichtet oder ein Anruf ausgelöst werden.</p><p><a href="/onboarding">Einführung fortsetzen</a> · <a href="/skills">Alle Skills ansehen</a></p><label>Integration suchen <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name oder Einrichtung" /></label><p role="status">{filtered.length} von {items.length} Integrationen</p>{filtered.map((item) => { const link = internalSetupLink(item.settingsTarget); const reference = officialReference(item.reference); return <article key={item.id}><h3>{item.id.replaceAll("_", " ")}</h3><p className="sk-muted">{item.account === "none" ? "Kein externes Konto" : item.account === "required" ? "Konto erforderlich" : "Konto je nach Nutzung"} · Konfiguration: {item.configured === null ? "unbekannt" : item.configured ? "vorhanden" : "fehlt"} · Verbindung: {item.connectionChecked === null ? "nicht geprüft" : item.connectionChecked ? "geprüft" : "nicht geprüft"}</p><p>{item.setupDe}</p>{item.requiredBy.length > 0 && <p className="sk-muted">Benötigt von: {item.requiredBy.slice(0, 8).join(", ")}{item.requiredBy.length > 8 ? ` und ${item.requiredBy.length - 8} weiteren` : ""}</p>}{link && <a href={link}>Passende Einstellungen öffnen</a>}{reference && <> · <a href={reference} target="_blank" rel="noopener noreferrer">Anleitung öffnen</a></>}{!link && item.settingsTarget && <p className="sk-muted">Einrichtungsort: {item.settingsTarget}</p>}</article>; })}</div>;
}
