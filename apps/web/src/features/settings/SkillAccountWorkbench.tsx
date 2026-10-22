"use client";

import type { SkillCatalogEntry } from "@friday/sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterSkills,
  sharedWith,
  skillSummaries,
  type SkillFilter,
  type SkillSummary,
} from "./skillAccountPlan";

const stateFilters: Array<{ value: SkillFilter; label: string }> = [
  { value: "alle", label: "Alle Skillkonten" },
  { value: "unvollstaendig", label: "Pflichtkonto fehlt" },
  { value: "unbekannt", label: "Kontostatus unbekannt" },
  { value: "deaktiviert", label: "Deaktiviert" },
  { value: "bereit", label: "Konten bereit" },
];

const sourceLabels = { friday: "Friday", hermes: "Hermes" } as const;

interface SkillAccountWorkbenchProps {
  skills: readonly SkillCatalogEntry[];
  role?: string | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

/**
 * Master-Detail der Skillkonten: links die Skills mit Name, Quelle und Zustand, rechts nur die Konten des gewaehlten
 * Skills. Geteilte Konten werden benannt, damit ein bereits hinterlegter Schluessel nicht erneut eingegeben wird; die
 * Eingabefelder selbst bleiben an einer Stelle weiter unten auf der Seite.
 */
export function SkillAccountWorkbench({ skills, role = null, selectedId = null, onSelect }: SkillAccountWorkbenchProps) {
  const summaries = useMemo(() => skillSummaries(skills), [skills]);
  const [text, setText] = useState("");
  const [state, setState] = useState<SkillFilter>("alle");
  const [selected, setSelected] = useState<string | null>(selectedId);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => { setSelected(selectedId); }, [selectedId]);

  const visible = useMemo(() => filterSkills(summaries, { text, state }), [summaries, text, state]);
  const current: SkillSummary | undefined = visible.find((summary) => summary.id === selected)
    ?? summaries.find((summary) => summary.id === selected);

  function choose(id: string) {
    setSelected(id);
    onSelect?.(id);
    // Tastaturbedienung: nach der Auswahl bleibt der Fokus in der Liste, damit Pfeiltasten weiterlaufen.
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-skill-id]");
    buttons?.forEach((button) => { if (button.dataset.skillId === id) button.focus(); });
  }

  function move(delta: number) {
    if (visible.length === 0) return;
    const index = Math.max(0, visible.findIndex((summary) => summary.id === selected));
    const next = visible[(index + delta + visible.length) % visible.length];
    if (next) choose(next.id);
  }

  if (skills.length === 0) {
    return <p className="sk-muted">Der Skillkatalog ist leer. Konten erscheinen hier, sobald Skills geladen sind.</p>;
  }

  return <div className="sk-workbench">
    <div className="sk-workbench__master">
      <label htmlFor="skill-account-search">Skill suchen (Name, Quelle, Zustand)</label>
      <input
        id="skill-account-search"
        type="search"
        value={text}
        placeholder="z. B. Kalender, hermes, Pflichtkonto fehlt"
        onChange={(event) => setText(event.target.value)}
      />
      <label htmlFor="skill-account-state">Zustand</label>
      <select id="skill-account-state" value={state} onChange={(event) => setState(event.target.value as SkillFilter)}>
        {stateFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
      </select>
      <p role="status" className="sk-muted">{visible.length} von {summaries.length} Skills</p>
      {visible.length === 0
        ? <p role="status">Kein Skill passt zur Suche. Filter löschen, um wieder alle zu sehen.</p>
        : <ul
          className="sk-workbench__list"
          ref={listRef}
          aria-label="Skills mit Kontenbedarf"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
            if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
          }}
        >
          {visible.map((summary) => <li key={summary.id}>
            <button
              type="button"
              data-skill-id={summary.id}
              aria-pressed={summary.id === selected}
              className={summary.id === selected ? "sk-workbench__entry is-selected" : "sk-workbench__entry"}
              onClick={() => choose(summary.id)}
            >
              <span className="sk-workbench__name">{summary.name}</span>
              <span className="sk-workbench__meta">
                <span className={`sk-badge sk-badge--${summary.source}`}>{sourceLabels[summary.source]}</span>
                {" · "}<span className={`sk-state sk-state--${summary.state}`}>{summary.stateLabel}</span>
              </span>
            </button>
          </li>)}
        </ul>}
    </div>
    <div className="sk-workbench__detail" aria-live="polite">
      {!current
        ? <p className="sk-muted">Wähle links einen Skill, um seine Konten und Abhängigkeiten zu sehen.</p>
        : <SkillAccountsDetail summary={current} summaries={summaries} role={role} />}
    </div>
  </div>;
}

function SkillAccountsDetail({ summary, summaries, role }: {
  summary: SkillSummary;
  summaries: readonly SkillSummary[];
  role: string | null;
}) {
  const required = summary.accounts.filter((account) => account.required);
  const optional = summary.accounts.filter((account) => !account.required);

  return <article aria-labelledby="skill-account-detail-title">
    <h3 id="skill-account-detail-title">{summary.name}</h3>
    <p className="sk-muted">
      Quelle: {sourceLabels[summary.source]} · Kategorie: {summary.category} · Zustand: {summary.stateLabel}
    </p>
    {required.length === 0
      ? <p>Dieser Skill braucht kein externes Konto.</p>
      : <>
        <h4>Benötigte Konten</h4>
        <ul className="sk-workbench__accounts">
          {required.map((account) => {
            const others = sharedWith(summaries, summary.id, account.id);
            return <li key={account.id}>
              <strong>{account.id.replaceAll("_", " ")}</strong>
              <span className={`sk-state sk-state--${account.state}`}> {account.state}</span>
              <p>{account.setupDe}</p>
              {others.length > 0 && <p className="sk-muted">
                Geteilt mit {others.slice(0, 5).join(", ")}{others.length > 5 ? ` und ${others.length - 5} weiteren` : ""}.
                Ein bereits hinterlegter Schlüssel wird hier nicht erneut abgefragt.
              </p>}
              {account.settingsTarget && <p className="sk-muted">Einrichtungsort: {account.settingsTarget}</p>}
            </li>;
          })}
        </ul>
      </>}
    {optional.length > 0 && <>
      <h4>Optionale Konten und Abhängigkeiten</h4>
      <ul className="sk-workbench__accounts">
        {optional.map((account) => <li key={account.id}>
          <strong>{account.id.replaceAll("_", " ")}</strong>
          <span className={`sk-state sk-state--${account.state}`}> {account.state}</span>
          <p className="sk-muted">{account.setupDe}</p>
        </li>)}
      </ul>
    </>}
    {role !== null && role !== "owner" && <p className="sk-muted">
      Nur der Owner kann Schlüssel hinterlegen; lesende Rollen sehen hier nur den Zustand.
    </p>}
  </article>;
}