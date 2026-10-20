"use client";

import { Button, HudPanel } from "@friday/ui";
import { FridayApiError } from "@friday/sdk";
import { useEffect, useRef, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useAppSettings } from "@/lib/settings";
import { registerCommandSelection } from "@/features/palette/commandContext";
import { ideaTargets, parseStudioPlan, platforms, postingTargets, type ContentIdea, type ContentFormat, type Platform, type Posting, type StudioPlan } from "./plan";
import { MediaWorkshop } from "./MediaWorkshop";
import { SocialPublishingOnboarding } from "./SocialPublishingOnboarding";
import { PostingCalendar } from "./PostingCalendar";
import { StudioGuide } from "./StudioGuide";
import { IdeaKanban } from "./IdeaKanban";
import { ProductionWorkspace } from "./ProductionWorkspace";
import "./content-studio.css";

const STORAGE_KEY = "friday.content-studio.plan.v1";
const emptyPlan = (): StudioPlan => ({ version: 1, exportiert_am: new Date().toISOString(), content: [], postings: [] });
const formats: ContentFormat[] = ["Reel", "Feed-Post", "Story", "Karussell", "LinkedIn-Video", "LinkedIn-Karussell", "TikTok-Video", "YouTube-Video", "YouTube-Short"];

function downloadPlan(plan: StudioPlan, filename: string): void {
  const blob = new Blob([JSON.stringify({ ...plan, exportiert_am: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ContentStudioPage() {
  const { settings, isLoading } = useAppSettings();
  const [plan, setPlan] = useState<StudioPlan>(emptyPlan);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const [legacyPlan, setLegacyPlan] = useState<StudioPlan | null>(null);
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(["LinkedIn"]);
  const [metaTogether, setMetaTogether] = useState(true);
  const [format, setFormat] = useState<ContentFormat>("Feed-Post");
  const [date, setDate] = useState("");
  const [ideaStatus, setIdeaStatus] = useState<ContentIdea["status"]>("idee");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [postingTitle, setPostingTitle] = useState("");
  const [postingDate, setPostingDate] = useState("");
  const [postingTime, setPostingTime] = useState("09:00");
  const [postingPlatform, setPostingPlatform] = useState<Platform>("LinkedIn");
  const [postingFormat, setPostingFormat] = useState<ContentFormat>("Feed-Post");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => registerCommandSelection("/content-studio",
    loaded && settings?.dashboard.contentStudioEnabled === true && editingId ? [editingId] : []),
  [editingId, loaded, settings?.dashboard.contentStudioEnabled]);

  useEffect(() => {
    if (isLoading || settings?.dashboard.contentStudioEnabled !== true) return;
    let active = true;
    void (async () => {
      try {
        const response = await call(getApiClient().GET("/api/v1/content-studio/plan"));
        if (!active) return;
        setRevision(response.data.revision);
        if (response.data.plan) setPlan(parseStudioPlan(response.data.plan));
        else {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
              const previous = parseStudioPlan(JSON.parse(raw) as unknown);
              if (previous.content.length > 0 || previous.postings.length > 0) {
                setLegacyPlan(previous);
                setNotice("Ein bisheriger Browserplan ist vorhanden. Prüfe und übernimm ihn bei Bedarf. Das Browser-Original bleibt als Sicherung erhalten.");
              }
            }
          } catch {
            setNotice("Der bisherige Browserplan kann nicht gelesen werden. Der Browser-Speicher bleibt unangetastet; bitte vor Änderungen manuell sichern.");
          }
        }
        setLoaded(true);
      } catch (error) {
        if (active) {
          setLoadError(true);
          setNotice(error instanceof Error ? `Plan konnte nicht geladen werden: ${error.message}` : "Plan konnte nicht geladen werden.");
        }
      }
    })();
    return () => { active = false; };
  }, [isLoading, settings?.dashboard.contentStudioEnabled]);

  const persist = async (next: StudioPlan, expectedRevision = revision): Promise<boolean> => {
    if (!loaded || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await call(getApiClient().PUT("/api/v1/content-studio/plan", {
        body: parseStudioPlan(next),
        headers: { "If-Match": String(expectedRevision) },
      }));
      setPlan(parseStudioPlan(response.data.plan));
      setRevision(response.data.revision);
      setLegacyPlan(null);
      setNotice("Plan gespeichert.");
      return true;
    } catch (error) {
      setNotice(error instanceof FridayApiError && error.status === 409
        ? "Plan-Konflikt: Ein anderer Client hat inzwischen gespeichert. Deine Änderung wurde nicht übernommen. Lade die Seite neu und gleiche die Stände ab."
        : error instanceof Error ? `Plan nicht gespeichert: ${error.message}` : "Plan nicht gespeichert.");
      return false;
    } finally { savingRef.current = false; setSaving(false); }
  };
  const updatePlan = (change: (current: StudioPlan) => StudioPlan): void => { void persist(change(plan)); };

  if (isLoading || !settings) return <div className="cs-page" role="status">Content Studio wird geladen …</div>;
  if (settings.dashboard.contentStudioEnabled !== true) return <div className="cs-page"><h1>Content Studio</h1><p>Das Modul ist deaktiviert. Aktiviere es unter Einstellungen → Dashboard.</p></div>;
  if (loadError) return <div className="cs-page"><h1>Content Studio</h1><p className="cs-notice" role="alert">{notice}</p><Button type="button" onClick={() => window.location.reload()}>Erneut laden</Button></div>;
  if (!loaded) return <div className="cs-page" role="status">Content Studio wird geladen …</div>;
  if (legacyPlan) return <main className="cs-page"><h1>Content Studio</h1><p className="cs-notice" role="status">{notice}</p><p>Browserplan: {legacyPlan.content.length} Ideen, {legacyPlan.postings.length} Postings. Der Serverplan ist leer.</p><div className="cs-actions"><Button type="button" disabled={saving} onClick={() => { void persist(legacyPlan, 0); }}>Browserplan übernehmen</Button><Button type="button" variant="ghost" onClick={() => downloadPlan(legacyPlan, "friday-browserplan-backup.json")}>Browserplan sichern</Button><Button type="button" variant="ghost" onClick={() => { setLegacyPlan(null); setNotice("Leerer Serverplan gewählt. Der Browserplan bleibt als Sicherung erhalten."); }}>Leeren Plan verwenden</Button></div></main>;

  const togglePlatform = (target: Platform): void => {
    const group: Platform[] = metaTogether && (target === "Instagram" || target === "Facebook") ? ["Instagram", "Facebook"] : [target];
    setSelectedPlatforms((current) => current.includes(target) ? current.filter((entry) => !group.includes(entry)) : platforms.filter((entry) => current.includes(entry) || group.includes(entry)));
  };
  const resetIdeaForm = (): void => { setEditingId(null); setTitle(""); setDescription(""); setDate(""); setIdeaStatus("idee"); setFormat("Feed-Post"); setSelectedPlatforms(["LinkedIn"]); };
  const editIdea = (item: ContentIdea): void => { setEditingId(item.id); setTitle(item.titel); setDescription(item.beschreibung); setDate(item.zieldatum); setIdeaStatus(item.status); setFormat(item.format); setSelectedPlatforms(ideaTargets(item)); document.getElementById("cs-idea-title")?.focus(); };
  const addIdea = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!title.trim() || selectedPlatforms.length === 0) return;
    const item: ContentIdea = { id: editingId ?? crypto.randomUUID(), titel: title.trim(), plattform: selectedPlatforms[0]!, ziele: selectedPlatforms, format, beschreibung: description.trim(), zieldatum: date, status: ideaStatus };
    const content = editingId ? plan.content.map((entry) => entry.id === editingId ? item : entry) : [...plan.content, item];
    if (await persist({ ...plan, content })) resetIdeaForm();
  };
  const addPosting = (idea: ContentIdea): void => {
    if (!idea.zieldatum) { setNotice("Für einen Posting-Entwurf braucht die Idee ein Zieldatum."); return; }
    const ziele = ideaTargets(idea);
    const posting: Posting = { id: crypto.randomUUID(), titel: idea.titel, datum: idea.zieldatum, uhrzeit: "09:00", plattform: ziele[0]!, ziele, format: idea.format, status: "geplant" };
    updatePlan((current) => ({ ...current, postings: [...current.postings, posting] }));
  };
  const addManualPosting = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!postingTitle.trim() || !postingDate) return;
    const posting: Posting = { id: crypto.randomUUID(), titel: postingTitle.trim(), datum: postingDate, uhrzeit: postingTime || "09:00", plattform: postingPlatform, ziele: [postingPlatform], format: postingFormat, status: "geplant" };
    if (await persist({ ...plan, postings: [...plan.postings, posting] })) { setPostingTitle(""); setPostingDate(""); setPostingTime("09:00"); }
  };
  const importPlan = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > 2_000_000) { setNotice("Import abgelehnt: Datei größer als 2 MB."); return; }
    try {
      const imported = parseStudioPlan(JSON.parse(await file.text()) as unknown);
      downloadPlan(plan, `friday-content-studio-backup-${new Date().toISOString().slice(0, 10)}.json`);
      if (await persist(imported)) setNotice(`${imported.content.length} Ideen und ${imported.postings.length} Postings importiert. Der vorherige Plan wurde als Backup heruntergeladen.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Import fehlgeschlagen."); }
  };

  return <main className="cs-page">
    <header className="cs-header"><div><p className="cs-eyebrow">F.R.I.D.A.Y. · Produktion</p><h1>Content Studio</h1><p>Ideen entwickeln, Veröffentlichungen planen und Produktionsschritte vorbereiten.</p></div><div className="cs-actions"><Button type="button" variant="ghost" onClick={() => downloadPlan(plan, "plan.json")}>Plan exportieren</Button><Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>Plan importieren</Button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => { void importPlan(event.target.files?.[0]); event.target.value = ""; }} /></div></header>
    {notice && <p className="cs-notice" role="status">{notice}</p>}
    <nav className="cs-section-nav" aria-label="Content-Studio-Bereiche"><a href="#cs-production">Produktionshilfe</a><a href="#cs-planning">Content-Planer</a><a href="#cs-postings">Posting-Planer</a><a href="#cs-media">Medien-Workshop</a><a href="#cs-publishing">Veröffentlichung</a></nav>
    <div id="cs-production"><StudioGuide /></div>
    <section id="cs-planning" className="cs-grid" aria-label="Contentplanung">
      <HudPanel title={editingId ? "Idee bearbeiten" : "Neue Idee"}><form className="cs-form" onSubmit={addIdea}><label>Titel<input id="cs-idea-title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Format<select value={format} onChange={(event) => setFormat(event.target.value as ContentFormat)}>{formats.map((name) => <option key={name}>{name}</option>)}</select></label><div className="cs-span"><span>Zielplattformen</span><div className="cs-platforms">{platforms.map((name) => <button key={name} type="button" aria-pressed={selectedPlatforms.includes(name)} onClick={() => togglePlatform(name)}>{name}</button>)}</div><button className="cs-meta-toggle" type="button" aria-pressed={metaTogether} onClick={() => setMetaTogether((value) => !value)}>Instagram und Facebook gemeinsam auswählen: {metaTogether ? "an" : "aus"}</button></div><label>Zieldatum<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Status<select value={ideaStatus} onChange={(event) => setIdeaStatus(event.target.value as ContentIdea["status"])}><option value="idee">Idee</option><option value="in-arbeit">In Arbeit</option><option value="fertig">Fertig</option></select></label><label className="cs-span">Beschreibung<textarea maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="cs-actions"><Button type="submit" disabled={saving || selectedPlatforms.length === 0}>{editingId ? "Änderungen speichern" : "Idee anlegen"}</Button>{editingId && <Button type="button" variant="ghost" onClick={resetIdeaForm}>Abbrechen</Button>}</div></form></HudPanel>
      <IdeaKanban ideas={plan.content} disabled={saving} onEdit={editIdea} onPlan={addPosting} onStatus={(id, status) => updatePlan((current) => ({ ...current, content: current.content.map((entry) => entry.id === id ? { ...entry, status } : entry) }))} onRemove={(id) => updatePlan((current) => ({ ...current, content: current.content.filter((entry) => entry.id !== id) }))} />
    </section>
    <section aria-label="Automatische Content-Produktion"><ProductionWorkspace ideas={plan.content} revision={revision} /></section>
    <section id="cs-postings" className="cs-posting-section" aria-label="Posting-Planer">
      <HudPanel title="Post einplanen"><form className="cs-form" onSubmit={addManualPosting}><label className="cs-span">Titel / Notiz<input required maxLength={200} value={postingTitle} onChange={(event) => setPostingTitle(event.target.value)} /></label><label>Datum<input required type="date" value={postingDate} onChange={(event) => setPostingDate(event.target.value)} /></label><label>Uhrzeit<input required type="time" value={postingTime} onChange={(event) => setPostingTime(event.target.value)} /></label><label>Plattform<select value={postingPlatform} onChange={(event) => setPostingPlatform(event.target.value as Platform)}>{platforms.map((name) => <option key={name}>{name}</option>)}</select></label><label>Format<select value={postingFormat} onChange={(event) => setPostingFormat(event.target.value as ContentFormat)}>{formats.map((name) => <option key={name}>{name}</option>)}</select></label><Button type="submit" disabled={saving}>Post einplanen</Button></form></HudPanel>
      <PostingCalendar postings={plan.postings} disabled={saving} onStatus={(id, status) => updatePlan((current) => ({ ...current, postings: current.postings.map((entry) => entry.id === id ? { ...entry, status } : entry) }))} />
    </section>
      <HudPanel title={`Postingplan · ${plan.postings.length}`}><div className="cs-list">{plan.postings.length === 0 ? <p>Noch keine Postings geplant.</p> : [...plan.postings].sort((a, b) => `${a.datum}${a.uhrzeit}`.localeCompare(`${b.datum}${b.uhrzeit}`)).map((post) => <article key={post.id} className="cs-card"><div><strong>{post.titel}</strong><p>{post.datum} · {post.uhrzeit} · {postingTargets(post).join(" + ")} · {post.format}</p></div><div className="cs-card-actions"><label>Status<select value={post.status} onChange={(event) => updatePlan((current) => ({ ...current, postings: current.postings.map((entry) => entry.id === post.id ? { ...entry, status: event.target.value as Posting["status"] } : entry) }))}><option value="geplant">Geplant</option><option value="gepostet">Gepostet</option><option value="verpasst">Verpasst</option></select></label><Button type="button" variant="ghost" onClick={() => updatePlan((current) => ({ ...current, postings: current.postings.filter((entry) => entry.id !== post.id) }))}>Entfernen</Button></div></article>)}</div></HudPanel>
    <div id="cs-media"><MediaWorkshop /></div>
    <div id="cs-publishing"><SocialPublishingOnboarding /></div>
    <p className="cs-footnote">Der Plan liegt auf diesem F.R.I.D.A.Y.-Server (Revision {revision}). Export und Import verwenden plan.json. Hier wird nichts automatisch veröffentlicht.</p>
  </main>;
}
