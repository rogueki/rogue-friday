"use client";

import { Button } from "@friday/ui";
import { useState } from "react";
import { useModifiedSkills, useSkillDiff, useSkillHubSearch } from "@/lib/api/domains/skills";

/**
 * Registry search and the locally modified bundled skills. Both are read-only: installing a
 * registry hit stays a separate confirmed step (DASH-10.07), so the panel states that instead of
 * offering a button that would do nothing.
 *
 * A modified skill can be inspected as a diff. The API forwards the CLI text unchanged - including
 * its refusal, which is the interesting part when the CLI cannot produce a diff at all.
 */
export function SkillRegistryPanel() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const search = useSkillHubSearch(query);
  const modified = useModifiedSkills();
  const names = modified.data?.data.names ?? [];
  const [diffName, setDiffName] = useState<string | null>(null);
  return <section className="sk-registry" aria-labelledby="sk-registry-title">
    <div className="sk-registry__head">
      <h2 id="sk-registry-title">Registry durchsuchen</h2>
      <p className="sk-muted">Sucht in den eingerichteten Skill-Quellen über die Hermes-CLI. Ergebnisse sind Angebote,
        keine Installation.</p>
    </div>
    <form className="sk-registry__form" onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); }}>
      <label htmlFor="sk-registry-query">Suchbegriff</label>
      <input id="sk-registry-query" type="search" value={draft} maxLength={120}
        placeholder="z. B. calendar" onChange={(event) => setDraft(event.target.value)} />
      <Button type="submit" disabled={draft.trim().length === 0 || search.isFetching}>
        {search.isFetching ? "Suche läuft" : "Suchen"}
      </Button>
    </form>
    {query === "" ? <p className="sk-muted" role="status">Noch keine Suche ausgeführt.</p>
      : search.isError ? <p role="alert" className="sk-warning">{search.error instanceof Error ? search.error.message : "Die Suche ist fehlgeschlagen."}</p>
      : search.isPending ? <p className="sk-muted" role="status">Suche läuft …</p>
      : (search.data?.data.results.length ?? 0) === 0 ? <p className="sk-muted" role="status">Keine Treffer für „{query}“.</p>
      : <ul className="sk-registry__hits" aria-label="Registry-Treffer">{search.data?.data.results.map((hit) => <li key={hit.identifier}>
        <div><strong>{hit.name}</strong> <span className="sk-muted">{hit.source} · Trust {hit.trustLevel}</span></div>
        <p>{hit.description || "Keine Beschreibung hinterlegt."}</p>
        <code>{hit.identifier}</code>
      </li>)}</ul>}
    <p className="sk-muted">Installieren oder Aktualisieren ist hier bewusst nicht angeboten: beide Schritte brauchen
      den Bestätigungs- und Wiederherstellungsweg aus DASH-10.07.</p>
    <section aria-labelledby="sk-modified-title">
      <h3 id="sk-modified-title">Lokal geänderte Skills</h3>
      {modified.isError ? <p role="alert" className="sk-warning">Die Liste lokal geänderter Skills ist nicht lesbar.</p>
        : modified.isPending ? <p className="sk-muted" role="status">Liste wird gelesen …</p>
        : names.length === 0 ? <p className="sk-muted" role="status">Keine mitgelieferten Skills wurden lokal geändert.</p>
        : <><p className="sk-warning" role="status">{names.length} mitgelieferte Skills weichen lokal ab; ein Update
          überspringt sie, bis sie zurückgesetzt oder bewusst überschrieben werden. Lokale Änderungen an
          Hub-Skills erscheinen hier nicht, sie werden aber beim Update ebenso erkannt.</p><ul className="sk-diff-list">{names.map((name) => <li key={name}>
            <code>{name}</code>
            <Button type="button" variant="ghost" aria-expanded={diffName === name}
              onClick={() => setDiffName(diffName === name ? null : name)}>
              {diffName === name ? "Diff schließen" : "Diff anzeigen"}
            </Button>
            {diffName === name ? <SkillDiff name={name} /> : null}
          </li>)}</ul></>}
    </section>
  </section>;
}

/** One diff, as the CLI printed it. A refusal is shown verbatim; it is the reason the operator came for. */
function SkillDiff({ name }: { name: string }) {
  const diff = useSkillDiff(name);
  if (diff.isPending) return <p className="sk-muted" role="status">Diff wird gelesen …</p>;
  if (diff.isError)
    return <p role="alert" className="sk-warning">{diff.error instanceof Error && diff.error.message.trim() !== ""
      ? diff.error.message : "Für diesen Skill ist kein Diff verfügbar."}</p>;
  const { text, truncated, bytes } = diff.data.data;
  return <div className="sk-diff">
    <div className="sk-diff__meta">{bytes.toLocaleString("de-DE")} Byte{truncated ? ", gekürzt" : ""}</div>
    <pre className="sk-diff__text" tabIndex={0} aria-label={`Diff für ${name}`}>{text}</pre>
  </div>;
}
