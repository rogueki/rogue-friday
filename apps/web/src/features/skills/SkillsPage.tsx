"use client";

import type { SkillCatalogEntry } from "@friday/sdk";
import { Button, EmptyState, ErrorState, Skeleton, StatusChip } from "@friday/ui";
import { useMemo, useState } from "react";
import { SkillMarkdown } from "./SkillMarkdown";
import { useSession } from "@/lib/session";
import { useSetSkillActivation, useSkillsCatalog } from "@/lib/api/domains/skills";
import { CodingRunsArea } from "./CodingRunsArea";
import { isCurrentCatalog, unverifiedSkill } from "./catalogFreshness";
import { PowerPointCreator } from "./PowerPointCreator";
import { IntegrationRequirements } from "./IntegrationRequirements";
import { integrationSetupLink, officialReference, originLabel, selectedVisibleSkill, skillState, trustLabel, visibleSkills } from "./skillPresentation";
import "./skills.css";

/** Bounds the rendered rows; the catalog can hold hundreds of skills, the detail pane still opens any of them. */
const PAGE_SIZE = 60;

function skillMarkdownId(skill: SkillCatalogEntry): string {
  return skill.source === "hermes" && skill.id.startsWith("hermes:") ? skill.id.slice("hermes:".length) : skill.id;
}

function SkillDetails({ skill, canToggle, onToggle, busy, error, canCreate, showCreator }: { skill: SkillCatalogEntry; canToggle: boolean; onToggle: () => void; busy: boolean; error: string | null; canCreate: boolean; showCreator: boolean }) {
  const state = skillState(skill);
  return <section className="sk-detail" aria-labelledby="sk-detail-title">
    <div className="sk-detail__head"><div><p className="sk-eyebrow">{skill.source === "friday" ? "FRIDAY SKILLS" : "HERMES STANDARD"} · {skill.version ? `v${skill.version}` : "Version unbekannt"}</p><h2 id="sk-detail-title">{skill.name}</h2></div><StatusChip tone={state.tone}>{state.label}</StatusChip></div>
    <p>{skill.description}</p><p className="sk-note">{state.detail}</p>
    <section aria-label="Anleitung"><h3>Anleitung</h3><SkillMarkdown id={skillMarkdownId(skill)} /></section>
    {skill.observationError && <p role="status" className="sk-warning">Laufzeitabfrage: {skill.observationError}</p>}
    <dl className="sk-facts"><div><dt>Herkunft</dt><dd>{originLabel(skill.origin)}</dd></div><div><dt>Trust</dt><dd>{trustLabel(skill.trust)}</dd></div><div><dt>Kategorie</dt><dd>{skill.category}</dd></div><div><dt>Paket</dt><dd>{skill.packaged ? "Enthalten" : "Nicht Teil des Friday-Pakets"}</dd></div><div><dt>Hermes</dt><dd>{skill.discovered === null ? "Unbekannt" : skill.discovered ? "Gefunden" : "Nicht gefunden"}</dd></div><div><dt>Beobachtet</dt><dd>{skill.observedAt ? new Date(skill.observedAt).toLocaleString("de-DE") : "Noch nie"}</dd></div><div><dt>Quelle</dt><dd>{skill.observationSource || "Unbekannt"}</dd></div><div><dt>Ausführbar</dt><dd>Nicht geprüft</dd></div></dl>
    {skill.requiredCapabilities.length > 0 && <section><h3>Benötigte Fähigkeiten</h3><p>{skill.requiredCapabilities.join(" · ")}</p></section>}
    {skill.conditionalCapabilities.length > 0 && <section><h3>Je nach Nutzung</h3><p>{skill.conditionalCapabilities.join(" · ")}</p></section>}
    {skill.integrationDetails.length > 0 && <section><h3>Konten und Einrichtung</h3><ul className="sk-integrations">{skill.integrationDetails.map((item) => {
      const link = integrationSetupLink(item); const reference = officialReference(item.reference);
      return <li key={item.id}><strong>{item.id.replaceAll("_", " ")}</strong> <span className="sk-muted">{item.required ? "Erforderlich" : "Optional"} · {item.account === "none" ? "Kein externes Konto" : item.account === "required" ? "Konto erforderlich" : "Konto je nach Nutzung"}</span><p>{item.setupDe}</p><IntegrationRequirements item={item} /><p className="sk-muted">Einrichtung: {item.configured === null ? "nicht geprüft" : item.configured ? "konfiguriert" : "nicht konfiguriert"} · Verbindung: {item.connectionChecked === null ? "nicht geprüft" : item.connectionChecked ? "geprüft" : "nicht geprüft"}</p>{link && <a href={link}>Einstellungen öffnen</a>}{reference && <a href={reference} target="_blank" rel="noopener noreferrer">Anleitung öffnen</a>}{!link && item.settingsTarget && <p className="sk-muted">Ort: {item.settingsTarget}</p>}</li>;
    })}</ul></section>}
    {skill.setupRefs.length > 0 && <section><h3>Weitere Hinweise</h3><ul>{skill.setupRefs.map((ref) => <li key={ref}>{officialReference(ref) ? <a href={ref} target="_blank" rel="noopener noreferrer">{ref}</a> : ref}</li>)}</ul></section>}
    {canToggle && <Button type="button" loading={busy} disabled={busy} onClick={onToggle}>{skill.enabled ? "Deaktivieren" : "Aktivieren"}</Button>}
    {skill.id === "hermes:powerpoint" && showCreator && <PowerPointCreator canCreate={canCreate} />}
    {error && <p role="alert" className="sk-warning">{error}</p>}
  </section>;
}

export function SkillsPage() {
  const query = useSkillsCatalog(); const activation = useSetSkillActivation(); const session = useSession();
  const [search, setSearch] = useState(""); const [source, setSource] = useState("all"); const [stateFilter, setStateFilter] = useState("all"); const [origin, setOrigin] = useState("all"); const [category, setCategory] = useState("all"); const [selectedId, setSelectedId] = useState<string | null>(null); const [limit, setLimit] = useState(PAGE_SIZE); const [error, setError] = useState<string | null>(null);
  const catalog = useMemo(() => {
    const skills = query.data?.data ?? [];
    return isCurrentCatalog(query) ? skills : skills.map(unverifiedSkill);
  }, [query.data, query.isStale, query.isPending, query.isError]);
  const filtered = useMemo(() => visibleSkills(catalog, search, source, stateFilter, category, origin), [catalog, search, source, stateFilter, category, origin]);
  const page = filtered.slice(0, limit);
  const selected = selectedVisibleSkill(filtered, selectedId);
  const toggle = async () => { if (!isCurrentCatalog(query) || !selected || selected.enabled === null) return; setError(null); try { await activation.mutateAsync({ id: selected.id, enabled: !selected.enabled }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Aktivierung fehlgeschlagen."); } };
  return <div className="sk-page"><header className="sk-header"><div><p className="sk-eyebrow">F.R.I.D.A.Y. / FÄHIGKEITEN</p><h1>Skills</h1><p>Friday-Skills erweitern das Framework. Hermes-Standardskills und Friday-Skills erscheinen mit ihrem tatsächlich beobachteten Zustand.</p></div><a className="sk-setup-link" href="/onboarding">Einführung öffnen</a></header>
    {query.isPending ? <div aria-busy="true"><Skeleton variant="row" height={48} label="Skills laden" /><Skeleton variant="row" height={48} label="Skills laden" /></div> : query.isError ? <ErrorState compact title="Skills konnten nicht geladen werden" description={query.error?.message} onRetry={() => void query.refetch()} retryLabel="Erneut versuchen" /> : <>
      <div className="sk-summary" role="status"><strong>{catalog.length}</strong> Skills im Katalog · <strong>{catalog.filter((item) => item.source === "friday").length}</strong> Friday · <strong>{catalog.filter((item) => item.source === "hermes").length}</strong> Hermes · <strong>{catalog.filter((item) => item.enabled === true).length}</strong> aktiviert <span>Aktiviert bedeutet nicht automatisch ausführbar.</span></div>
      {(!isCurrentCatalog(query) || query.data?.catalogError || query.data?.hermesError) && <p className="sk-warning" role="status">{!isCurrentCatalog(query) && "Katalogdaten sind nicht mehr aktuell. "}{query.data?.catalogError && `Friday-Katalog: ${query.data.catalogError}`} {query.data?.hermesError && `Hermes: ${query.data.hermesError}`} <Button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Jetzt aktualisieren</Button></p>}
      <div className="sk-filters"><label>Suche<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, Beschreibung, Kategorie" /></label><label>Quelle<select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">Alle</option><option value="friday">Friday</option><option value="hermes">Hermes</option></select></label><label>Herkunft<select aria-label="Herkunft" value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="all">Alle</option><option value="friday">Friday-Paket</option><option value="builtin">Hermes mitgeliefert</option><option value="local">Lokal installiert</option><option value="hub">Hub-Installation</option><option value="unknown">Unbekannt</option></select></label><label>Kategorie<select aria-label="Kategorie" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Alle</option>{[...new Set(catalog.map((skill) => skill.category))].sort().map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Status<select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="all">Alle</option><option value="enabled">Aktiviert</option><option value="missing">Nicht gefunden</option><option value="unknown">Unbekannt</option></select></label></div>
      {filtered.length === 0 ? <EmptyState title="Keine passenden Skills" description="Suche oder Filter anpassen." /> : <><div className="sk-layout"><ul className="sk-list" aria-label="Skills">{page.map((skill) => <li key={skill.id}><button type="button" className="sk-list__item" aria-current={selected?.id === skill.id ? "true" : undefined} onClick={() => { setSelectedId(skill.id); setError(null); }}><span><strong>{skill.name}</strong><small>{skill.category} · {skill.source === "friday" ? "Friday" : "Hermes"} · {originLabel(skill.origin)}</small></span><StatusChip tone={skillState(skill).tone}>{skillState(skill).label}</StatusChip></button></li>)}</ul>{selected && <SkillDetails skill={selected} canToggle={session.role === "owner" && !session.offline && selected.discovered === true && selected.enabled !== null} canCreate={session.role === "owner" && !session.offline && selected.enabled === true} showCreator={session.role === "owner" && !session.offline} onToggle={() => void toggle()} busy={activation.isPending} error={error} />}</div>{filtered.length > page.length && <p className="sk-more"><span className="sk-muted">{page.length} von {filtered.length} Skills sichtbar.</span> <Button type="button" onClick={() => setLimit(limit + PAGE_SIZE)}>Weitere {Math.min(PAGE_SIZE, filtered.length - page.length)} Skills anzeigen</Button></p>}</>}
      {session.role === "owner" && !session.offline && <CodingRunsArea skills={catalog} />}
    </>}
  </div>;
}
