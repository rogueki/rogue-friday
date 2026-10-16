"use client";

import type { SkillCatalogEntry } from "@friday/sdk";
import { Button, EmptyState, ErrorState, Skeleton, StatusChip } from "@friday/ui";
import { useMemo, useState } from "react";
import { useSession } from "@/lib/session";
import { useSetSkillActivation, useSkillsCatalog } from "@/lib/api/domains/skills";
import { CodingRunsArea } from "./CodingRunsArea";
import { internalSetupLink, officialReference, selectedVisibleSkill, skillState, visibleSkills } from "./skillPresentation";
import "./skills.css";

function SkillDetails({ skill, canToggle, onToggle, busy, error }: { skill: SkillCatalogEntry; canToggle: boolean; onToggle: () => void; busy: boolean; error: string | null }) {
  const state = skillState(skill);
  return <section className="sk-detail" aria-labelledby="sk-detail-title">
    <div className="sk-detail__head"><div><p className="sk-eyebrow">{skill.source === "friday" ? "FRIDAY SKILLS" : "HERMES STANDARD"} · {skill.version ? `v${skill.version}` : "Version unbekannt"}</p><h2 id="sk-detail-title">{skill.name}</h2></div><StatusChip tone={state.tone}>{state.label}</StatusChip></div>
    <p>{skill.description}</p><p className="sk-note">{state.detail}</p>
    {skill.observationError && <p role="status" className="sk-warning">Laufzeitabfrage: {skill.observationError}</p>}
    <dl className="sk-facts"><div><dt>Paket</dt><dd>{skill.packaged ? "Enthalten" : "Nicht Teil des Friday-Pakets"}</dd></div><div><dt>Hermes</dt><dd>{skill.discovered === null ? "Unbekannt" : skill.discovered ? "Gefunden" : "Nicht gefunden"}</dd></div><div><dt>Beobachtet</dt><dd>{skill.observedAt ? new Date(skill.observedAt).toLocaleString("de-DE") : "Noch nie"}</dd></div><div><dt>Quelle</dt><dd>{skill.observationSource || "Unbekannt"}</dd></div><div><dt>Ausführbar</dt><dd>Nicht geprüft</dd></div></dl>
    {skill.requiredCapabilities.length > 0 && <section><h3>Benötigte Fähigkeiten</h3><p>{skill.requiredCapabilities.join(" · ")}</p></section>}
    {skill.conditionalCapabilities.length > 0 && <section><h3>Je nach Nutzung</h3><p>{skill.conditionalCapabilities.join(" · ")}</p></section>}
    {skill.integrationDetails.length > 0 && <section><h3>Konten und Einrichtung</h3><ul className="sk-integrations">{skill.integrationDetails.map((item) => {
      const link = internalSetupLink(item.settingsTarget); const reference = officialReference(item.reference);
      return <li key={item.id}><strong>{item.id.replaceAll("_", " ")}</strong> <span className="sk-muted">{item.required ? "Erforderlich" : "Optional"} · {item.account === "none" ? "Kein externes Konto" : item.account === "required" ? "Konto erforderlich" : "Konto je nach Nutzung"}</span><p>{item.setupDe}</p><p className="sk-muted">Einrichtung: {item.configured === null ? "nicht geprüft" : item.configured ? "konfiguriert" : "nicht konfiguriert"} · Verbindung: {item.connectionChecked === null ? "nicht geprüft" : item.connectionChecked ? "geprüft" : "nicht geprüft"}</p>{link && <a href={link}>Einstellungen öffnen</a>}{reference && <a href={reference} target="_blank" rel="noopener noreferrer">Anleitung öffnen</a>}{!link && item.settingsTarget && <p className="sk-muted">Ort: {item.settingsTarget}</p>}</li>;
    })}</ul></section>}
    {skill.setupRefs.length > 0 && <section><h3>Weitere Hinweise</h3><ul>{skill.setupRefs.map((ref) => <li key={ref}>{officialReference(ref) ? <a href={ref} target="_blank" rel="noopener noreferrer">{ref}</a> : ref}</li>)}</ul></section>}
    {canToggle && <Button type="button" loading={busy} disabled={busy} onClick={onToggle}>{skill.enabled ? "Deaktivieren" : "Aktivieren"}</Button>}
    {error && <p role="alert" className="sk-warning">{error}</p>}
  </section>;
}

export function SkillsPage() {
  const query = useSkillsCatalog(); const activation = useSetSkillActivation(); const session = useSession();
  const [search, setSearch] = useState(""); const [source, setSource] = useState("all"); const [stateFilter, setStateFilter] = useState("all"); const [selectedId, setSelectedId] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const catalog = useMemo(() => {
    const skills = query.data?.data ?? [];
    if (!query.isStale && query.data?.freshness?.state !== "unknown" && query.data?.freshness?.state !== "stale") return skills;
    return skills.map((skill) => ({ ...skill, discovered: null, enabled: null,
      observationError: [skill.observationError, "Katalogdaten sind nicht mehr aktuell"].filter(Boolean).join("; ") }));
  }, [query.data, query.isStale]);
  const filtered = useMemo(() => visibleSkills(catalog, search, source, stateFilter), [catalog, search, source, stateFilter]);
  const selected = selectedVisibleSkill(filtered, selectedId);
  const toggle = async () => { if (!selected || selected.enabled === null) return; setError(null); try { await activation.mutateAsync({ id: selected.id, enabled: !selected.enabled }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Aktivierung fehlgeschlagen."); } };
  return <div className="sk-page"><header className="sk-header"><div><p className="sk-eyebrow">F.R.I.D.A.Y. / FÄHIGKEITEN</p><h1>Skills</h1><p>Friday-Skills erweitern das Framework. Hermes-Standardskills und Friday-Skills erscheinen mit ihrem tatsächlich beobachteten Zustand.</p></div><a className="sk-setup-link" href="/onboarding">Einführung öffnen</a></header>
    {query.isPending ? <div aria-busy="true"><Skeleton variant="row" height={48} label="Skills laden" /><Skeleton variant="row" height={48} label="Skills laden" /></div> : query.isError ? <ErrorState compact title="Skills konnten nicht geladen werden" description={query.error?.message} onRetry={() => void query.refetch()} retryLabel="Erneut versuchen" /> : <>
      <div className="sk-summary" role="status"><strong>{catalog.length}</strong> Skills im Katalog · <strong>{catalog.filter((item) => item.source === "friday").length}</strong> Friday · <strong>{catalog.filter((item) => item.source === "hermes").length}</strong> Hermes · <strong>{catalog.filter((item) => item.enabled === true).length}</strong> aktiviert <span>Aktiviert bedeutet nicht automatisch ausführbar.</span></div>
      {(query.isStale || query.data?.freshness?.state === "unknown" || query.data?.freshness?.state === "stale" || query.data?.catalogError || query.data?.hermesError) && <p className="sk-warning" role="status">{(query.isStale || query.data?.freshness?.state === "unknown" || query.data?.freshness?.state === "stale") && "Katalogdaten sind nicht mehr aktuell. "}{query.data?.catalogError && `Friday-Katalog: ${query.data.catalogError}`} {query.data?.hermesError && `Hermes: ${query.data.hermesError}`} <Button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Jetzt aktualisieren</Button></p>}
      <div className="sk-filters"><label>Suche<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, Beschreibung, Kategorie" /></label><label>Herkunft<select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">Alle</option><option value="friday">Friday</option><option value="hermes">Hermes</option></select></label><label>Status<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="all">Alle</option><option value="enabled">Aktiviert</option><option value="missing">Nicht gefunden</option><option value="unknown">Unbekannt</option></select></label></div>
      {filtered.length === 0 ? <EmptyState title="Keine passenden Skills" description="Suche oder Filter anpassen." /> : <div className="sk-layout"><ul className="sk-list" aria-label="Skills">{filtered.map((skill) => <li key={skill.id}><button type="button" className="sk-list__item" aria-current={selected?.id === skill.id ? "true" : undefined} onClick={() => { setSelectedId(skill.id); setError(null); }}><span><strong>{skill.name}</strong><small>{skill.category} · {skill.source === "friday" ? "Friday" : "Hermes"}</small></span><StatusChip tone={skillState(skill).tone}>{skillState(skill).label}</StatusChip></button></li>)}</ul>{selected && <SkillDetails skill={selected} canToggle={session.role === "owner" && !session.offline && selected.discovered === true && selected.enabled !== null} onToggle={() => void toggle()} busy={activation.isPending} error={error} />}</div>}
      {session.role === "owner" && !session.offline && <CodingRunsArea skills={catalog} />}
    </>}
  </div>;
}
