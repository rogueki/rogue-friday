"use client";

import type { OnboardingState, OnboardingUpdate } from "@friday/sdk";
import { Button, ErrorState, Skeleton } from "@friday/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useOnboarding, useSkillsCatalog, useUpdateOnboarding } from "@/lib/api/domains/skills";
import { useSession } from "@/lib/session";
import { snoozeOnboarding } from "./onboardingSnooze";
import { visibleSkills } from "./skillPresentation";
import "./skills.css";

const ORDER = ["intro", "profile", "skills", "accounts", "finish"] as const;
type Step = (typeof ORDER)[number];
const TITLES: Record<Step, string> = { intro: "Willkommen", profile: "Dein Profil", skills: "Fähigkeiten", accounts: "Konten", finish: "Fertig" };
const GOALS = ["Alltag organisieren", "Nachrichten und Kalender", "Wissen und Recherche", "Dokumente und Präsentationen", "Smart Home", "Programmieren", "Content erstellen"];
function firstPending(state: OnboardingState): Step { return ORDER.find((step) => state.steps[step] === "pending") ?? "finish"; }

export function OnboardingPage() {
  const router = useRouter(); const session = useSession(); const onboarding = useOnboarding(session.role === "owner" && !session.offline); const catalog = useSkillsCatalog(session.role === "owner" && !session.offline); const save = useUpdateOnboarding();
  const [step, setStep] = useState<Step | null>(null); const [name, setName] = useState(""); const [goals, setGoals] = useState<string[]>([]); const [selectedIds, setSelectedIds] = useState<string[]>([]); const [skillSearch, setSkillSearch] = useState(""); const [error, setError] = useState<string | null>(null);
  const current = onboarding.data?.data;
  useEffect(() => { if (!current) return; setStep((old) => old ?? firstPending(current)); setName(current.preferredName ?? session.displayName ?? ""); setGoals(current.goals); setSelectedIds(current.selectedSkillIds); }, [current?.revision, session.displayName]);
  const chosen = step ?? (current ? firstPending(current) : "intro");
  const availableSkills = useMemo(() => visibleSkills(catalog.data?.data ?? [], skillSearch), [catalog.data, skillSearch]);
  const selectedSkills = (catalog.data?.data ?? []).filter((skill) => selectedIds.includes(skill.id));
  const requiredAccounts = [...new Map(selectedSkills.flatMap((skill) => skill.integrationDetails.filter((item) => item.required)).map((item) => [item.id, item])).values()];
  const changeGoal = (value: string) => setGoals((old) => old.includes(value) ? old.filter((goal) => goal !== value) : [...old, value]);
  const changeSkill = (id: string) => setSelectedIds((old) => old.includes(id) ? old.filter((value) => value !== id) : [...old, id]);
  const persist = async (status: "pending" | "completed" | "skipped", leave = false) => {
    if (!current) return; setError(null);
    const unverifiedStep = chosen === "accounts" || (chosen === "skills" && (catalog.isError || catalog.isPending));
    const update: OnboardingUpdate = { steps: { ...current.steps, [chosen]: unverifiedStep && status === "completed" ? "skipped" : status }, goals, selectedSkillIds: selectedIds, ...(name.trim() ? { preferredName: name.trim() } : {}) };
    try {
      await save.mutateAsync({ revision: current.revision, update });
      const next = ORDER[ORDER.indexOf(chosen) + 1];
      if (leave) snoozeOnboarding();
      if (leave || !next) router.replace("/"); else setStep(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Einführung konnte nicht gespeichert werden. Bitte erneut versuchen."); }
  };
  if (session.role !== "owner" || session.offline) return <div className="sk-onboarding"><h1>Einführung</h1><p>Die Einrichtung ist nur mit einem aktiven Besitzerkonto verfügbar.</p><a href="/skills">Skills ansehen</a></div>;
  if (onboarding.isPending) return <Skeleton variant="row" height={200} label="Einführung laden" />;
  if (onboarding.isError || !current) return <ErrorState compact title="Einführung konnte nicht geladen werden" description={onboarding.error?.message} onRetry={() => void onboarding.refetch()} retryLabel="Erneut versuchen" />;
  return <div className="sk-onboarding"><header><p className="sk-eyebrow">F.R.I.D.A.Y. / ERSTE SCHRITTE</p><h1>Friday kennenlernen</h1><p>Diese Einführung kann jederzeit fortgesetzt werden. Deine Auswahl merkt sich Friday; sie aktiviert noch keine Skills und verbindet keine Konten.</p></header>
    <ol className="sk-onboarding__steps" aria-label="Schritte">{ORDER.map((item) => <li key={item} aria-current={chosen === item ? "step" : undefined}><button type="button" onClick={() => setStep(item)}>{TITLES[item]} · {current.steps[item] === "pending" ? "offen" : current.steps[item] === "completed" ? "fertig" : item === "accounts" ? "ungeprüft" : "übersprungen"}</button></li>)}</ol>
    <section className="sk-onboarding__panel" aria-labelledby="sk-step-title"><h2 id="sk-step-title">{TITLES[chosen]}</h2>
      {chosen === "intro" && <><p>Friday ist dein lokales Assistenz-Framework. Das Dashboard zeigt Aufgaben, Kommunikation, Kalender, Dateien, Automationen und Systemzustand. Das separate Friday-Skills-Paket erweitert Friday um zahlreiche Arbeitsabläufe. Hermes bringt eigene Standardskills mit.</p><p className="sk-note">Ein Skill im Katalog ist noch kein Beweis für ein verbundenes Konto oder eine erfolgreiche Ausführung.</p></>}
      {chosen === "profile" && <><label>Wie soll Friday dich nennen?<input type="text" maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label><fieldset><legend>Wobei soll Friday zuerst helfen?</legend><div className="sk-choice-list">{GOALS.map((goal) => <label key={goal}><input type="checkbox" checked={goals.includes(goal)} onChange={() => changeGoal(goal)} />{goal}</label>)}</div></fieldset><p className="sk-note">Dein Name wird auch als Anzeigename in den Dashboard-Einstellungen gespeichert. Deine Ziele bleiben als Onboarding-Präferenzen gespeichert; sie ändern noch kein Modellrouting.</p></>}
      {chosen === "skills" && <><p>Wähle interessante Friday- und Hermes-Skills. Die Auswahl speichert dein Interesse, aktiviert aber keinen Skill.</p><label>Skills suchen<input type="search" value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder="Name, Beschreibung oder Kategorie" /></label>{catalog.isPending ? <Skeleton variant="row" height={80} label="Skills laden" /> : catalog.isError ? <p role="alert">Skill-Katalog nicht verfügbar. Du kannst diesen Schritt überspringen und später zurückkommen.</p> : <><p role="status">{availableSkills.length} Skills angezeigt · {availableSkills.filter((skill) => skill.source === "friday").length} Friday · {availableSkills.filter((skill) => skill.source === "hermes").length} Hermes · {selectedIds.length} ausgewählt</p><div className="sk-choice-list">{availableSkills.map((skill) => <label key={skill.id}><input type="checkbox" checked={selectedIds.includes(skill.id)} onChange={() => changeSkill(skill.id)} /><span>{skill.name}<small className="sk-muted">{skill.source === "friday" ? "Friday" : "Hermes"} · {skill.enabled === true ? "aktiviert" : skill.enabled === false ? "deaktiviert" : "Status unbekannt"}</small></span></label>)}</div></>}<a href="/skills">Alle Skills und ihren Zustand ansehen</a></>}
      {chosen === "accounts" && <><p>Für manche Fähigkeiten sind Konten, lokale Programme oder Berechtigungen nötig. Richte nur ein, was du nutzen möchtest. Ein Verbindungstest ist hier noch nicht integriert; dieser Schritt wird beim Weitergehen als ungeprüft gespeichert.</p>{requiredAccounts.length ? <ul>{requiredAccounts.map((item) => <li key={item.id}><strong>{item.id.replaceAll("_", " ")}</strong>: {item.setupDe}</li>)}</ul> : <p>Für die Auswahl sind keine erforderlichen Integrationen verzeichnet, oder es wurden noch keine Skills ausgewählt.</p>}<a href="/settings?area=skillAccounts">Alle Skill-Konten und Einrichtungsorte öffnen</a></>}
      {chosen === "finish" && <><p>Friday kennt deine Auswahl und kann dich später weiter durch die Einrichtung führen. Ob ein Skill wirklich funktioniert, siehst du erst nach Prüfung seiner Voraussetzungen und einer konkreten Ausführung.</p><p>Ausgewählt: {selectedIds.length} Skills · Interessen: {goals.length}</p><a href="/skills">Zum Skill-Katalog</a></>}
      {error && <p className="sk-warning" role="alert">{error}</p>}
      <div className="sk-onboarding__actions"><Button type="button" loading={save.isPending} disabled={save.isPending} onClick={() => void persist("completed")}>{chosen === "finish" ? "Einführung abschließen" : chosen === "accounts" ? "Ungeprüft weiter" : "Speichern und weiter"}</Button><Button type="button" variant="ghost" disabled={save.isPending} onClick={() => void persist("skipped")}>Überspringen</Button><Button type="button" variant="ghost" disabled={save.isPending} onClick={() => void persist("pending", true)}>Später fortsetzen</Button></div>
    </section>
  </div>;
}
