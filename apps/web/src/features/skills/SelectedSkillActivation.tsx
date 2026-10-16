"use client";

import { Button } from "@friday/ui";
import { useState } from "react";
import { useSetSkillActivation, useSkillsCatalog } from "@/lib/api/domains/skills";
import { isCurrentCatalog, unverifiedSkill } from "./catalogFreshness";
import { skillState } from "./skillPresentation";

export function SelectedSkillActivation({ selectedIds }: { selectedIds: readonly string[] }) {
  const catalog = useSkillsCatalog();
  const activation = useSetSkillActivation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!selectedIds.length) return <p className="sk-muted">Noch keine Skills ausgewählt.</p>;

  const current = isCurrentCatalog(catalog);
  const skills = new Map((catalog.data?.data ?? []).map((skill) => [skill.id, current ? skill : unverifiedSkill(skill)]));
  const toggle = async (id: string) => {
    const skill = skills.get(id);
    if (!isCurrentCatalog(catalog) || busyId || !skill || skill.discovered !== true || skill.enabled === null) return;
    const enabled = !skill.enabled;
    setBusyId(id); setMessage(null); setError(null);
    try {
      await activation.mutateAsync({ id, enabled });
      const refreshed = await catalog.refetch();
      const confirmed = refreshed.data?.data.find((item) => item.id === id);
      if (!isCurrentCatalog(refreshed) || confirmed?.discovered !== true || confirmed.enabled !== enabled) {
        throw new Error(`Der aktuelle Hermes-Status von ${skill.name} konnte nicht bestätigt werden. Bitte Katalog erneut laden.`);
      }
      setMessage(`${skill.name}: ${enabled ? "Aktivierung" : "Deaktivierung"} von Hermes bestätigt. Die Ausführbarkeit ist noch nicht geprüft.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill-Status konnte nicht geändert oder bestätigt werden.");
    } finally {
      setBusyId(null);
    }
  };

  return <section className="sk-selected" aria-label="Ausgewählte Skills und Aktivierung">
    <h3>Ausgewählte Skills</h3>
    {catalog.isPending && <p role="status">Hermes-Status wird geladen.</p>}
    {catalog.isError && <p role="alert">Hermes-Status nicht verfügbar. Die Auswahl bleibt gespeichert; hier wird nichts aktiviert.</p>}
    {!catalog.isPending && !catalog.isError && !current && <p role="status" className="sk-warning">Katalogdaten sind nicht mehr aktuell. Der Aktivierungsstatus ist unbekannt. <Button type="button" disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>Jetzt aktualisieren</Button></p>}
    <ul className="sk-selected__list">{selectedIds.map((id) => {
      const skill = skills.get(id);
      const known = current && skill?.discovered === true && skill.enabled !== null;
      const state = skill ? skillState(skill) : null;
      return <li key={id}>
        <span><strong>{skill?.name ?? id}</strong><small>{!current ? "Status unbekannt" : state?.label ?? "Nicht im Katalog"}</small></span>
        {known && <Button type="button" disabled={busyId !== null} loading={busyId === id} onClick={() => void toggle(id)} aria-label={`${skill.name} ${skill.enabled ? "deaktivieren" : "aktivieren"}`}>{skill.enabled ? "Deaktivieren" : "Aktivieren"}</Button>}
      </li>;
    })}</ul>
    {message && <p role="status" className="sk-note">{message}</p>}
    {error && <p role="alert" className="sk-warning">{error}</p>}
  </section>;
}
