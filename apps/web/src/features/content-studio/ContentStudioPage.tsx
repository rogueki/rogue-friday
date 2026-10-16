"use client";

import { Button, HudPanel } from "@friday/ui";
import { useEffect, useRef, useState } from "react";
import { useAppSettings } from "@/lib/settings";
import { ideaTargets, parseStudioPlan, platforms, postingTargets, type ContentIdea, type ContentFormat, type Platform, type Posting, type StudioPlan } from "./plan";
import { MediaWorkshop } from "./MediaWorkshop";
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
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(["LinkedIn"]);
  const [metaTogether, setMetaTogether] = useState(true);
  const [format, setFormat] = useState<ContentFormat>("Feed-Post");
  const [date, setDate] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPlan(parseStudioPlan(JSON.parse(raw) as unknown));
    } catch {
      setNotice("Der gespeicherte Plan ist beschädigt. Er wurde nicht überschrieben; exportiere ihn vor einer Änderung manuell aus dem Browser-Speicher.");
      return;
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  }, [loaded, plan]);

  if (isLoading || !settings) return <div className="cs-page" role="status">Content Studio wird geladen …</div>;
  if (settings.dashboard.contentStudioEnabled !== true) return <div className="cs-page"><h1>Content Studio</h1><p>Das Modul ist deaktiviert. Aktiviere es unter Einstellungen → Dashboard.</p></div>;

  const togglePlatform = (target: Platform): void => {
    const group: Platform[] = metaTogether && (target === "Instagram" || target === "Facebook") ? ["Instagram", "Facebook"] : [target];
    setSelectedPlatforms((current) => current.includes(target) ? current.filter((entry) => !group.includes(entry)) : platforms.filter((entry) => current.includes(entry) || group.includes(entry)));
  };
  const addIdea = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!title.trim() || selectedPlatforms.length === 0) return;
    const item: ContentIdea = { id: crypto.randomUUID(), titel: title.trim(), plattform: selectedPlatforms[0]!, ziele: selectedPlatforms, format, beschreibung: description.trim(), zieldatum: date, status: "idee" };
    setPlan((current) => ({ ...current, content: [...current.content, item] }));
    setTitle(""); setDescription(""); setDate("");
  };
  const addPosting = (idea: ContentIdea): void => {
    if (!idea.zieldatum) { setNotice("Für einen Posting-Entwurf braucht die Idee ein Zieldatum."); return; }
    const ziele = ideaTargets(idea);
    const posting: Posting = { id: crypto.randomUUID(), titel: idea.titel, datum: idea.zieldatum, uhrzeit: "09:00", plattform: ziele[0]!, ziele, format: idea.format, status: "geplant" };
    setPlan((current) => ({ ...current, postings: [...current.postings, posting] }));
  };
  const importPlan = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > 2_000_000) { setNotice("Import abgelehnt: Datei größer als 2 MB."); return; }
    try {
      const imported = parseStudioPlan(JSON.parse(await file.text()) as unknown);
      downloadPlan(plan, `friday-content-studio-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setPlan(imported);
      setNotice(`${imported.content.length} Ideen und ${imported.postings.length} Postings importiert. Der vorherige Plan wurde als Backup heruntergeladen.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Import fehlgeschlagen."); }
  };

  return <main className="cs-page">
    <header className="cs-header"><div><p className="cs-eyebrow">F.R.I.D.A.Y. · Produktion</p><h1>Content Studio</h1><p>Ideen entwickeln, Veröffentlichungen planen und Produktionsschritte vorbereiten.</p></div><div className="cs-actions"><Button type="button" variant="ghost" onClick={() => downloadPlan(plan, "plan.json")}>Plan exportieren</Button><Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>Plan importieren</Button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => { void importPlan(event.target.files?.[0]); event.target.value = ""; }} /></div></header>
    {notice && <p className="cs-notice" role="status">{notice}</p>}
    <section className="cs-grid" aria-label="Contentplanung">
      <HudPanel title="Neue Idee"><form className="cs-form" onSubmit={addIdea}><label>Titel<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Format<select value={format} onChange={(event) => setFormat(event.target.value as ContentFormat)}>{formats.map((name) => <option key={name}>{name}</option>)}</select></label><div className="cs-span"><span>Zielplattformen</span><div className="cs-platforms">{platforms.map((name) => <button key={name} type="button" aria-pressed={selectedPlatforms.includes(name)} onClick={() => togglePlatform(name)}>{name}</button>)}</div><button className="cs-meta-toggle" type="button" aria-pressed={metaTogether} onClick={() => setMetaTogether((value) => !value)}>Instagram und Facebook gemeinsam auswählen: {metaTogether ? "an" : "aus"}</button></div><label>Zieldatum<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="cs-span">Beschreibung<textarea maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><Button type="submit" disabled={selectedPlatforms.length === 0}>Idee anlegen</Button></form></HudPanel>
      <HudPanel title={`Ideen · ${plan.content.length}`}><div className="cs-list">{plan.content.length === 0 ? <p>Noch keine Ideen. Beginne mit einem Titel.</p> : plan.content.map((item) => <article key={item.id} className="cs-card"><div><strong>{item.titel}</strong><p>{ideaTargets(item).join(" + ")} · {item.format}{item.zieldatum ? ` · ${item.zieldatum}` : ""}</p>{item.beschreibung && <p>{item.beschreibung}</p>}</div><div className="cs-card-actions"><label>Status<select value={item.status} onChange={(event) => setPlan((current) => ({ ...current, content: current.content.map((entry) => entry.id === item.id ? { ...entry, status: event.target.value as ContentIdea["status"] } : entry) }))}><option value="idee">Idee</option><option value="in-arbeit">In Arbeit</option><option value="fertig">Fertig</option></select></label><Button type="button" variant="ghost" onClick={() => addPosting(item)}>Posting planen</Button><Button type="button" variant="ghost" onClick={() => setPlan((current) => ({ ...current, content: current.content.filter((entry) => entry.id !== item.id) }))}>Entfernen</Button></div></article>)}</div></HudPanel>
    </section>
      <HudPanel title={`Postingplan · ${plan.postings.length}`}><div className="cs-list">{plan.postings.length === 0 ? <p>Noch keine Postings geplant.</p> : [...plan.postings].sort((a, b) => `${a.datum}${a.uhrzeit}`.localeCompare(`${b.datum}${b.uhrzeit}`)).map((post) => <article key={post.id} className="cs-card"><div><strong>{post.titel}</strong><p>{post.datum} · {post.uhrzeit} · {postingTargets(post).join(" + ")} · {post.format}</p></div><div className="cs-card-actions"><label>Status<select value={post.status} onChange={(event) => setPlan((current) => ({ ...current, postings: current.postings.map((entry) => entry.id === post.id ? { ...entry, status: event.target.value as Posting["status"] } : entry) }))}><option value="geplant">Geplant</option><option value="gepostet">Gepostet</option><option value="verpasst">Verpasst</option></select></label><Button type="button" variant="ghost" onClick={() => setPlan((current) => ({ ...current, postings: current.postings.filter((entry) => entry.id !== post.id) }))}>Entfernen</Button></div></article>)}</div></HudPanel>
    <MediaWorkshop />
    <p className="cs-footnote">Der Plan liegt lokal in diesem Browser. Exportiere ihn für die bestehende Content-Studio-Engine. Hier wird nichts automatisch veröffentlicht.</p>
  </main>;
}
