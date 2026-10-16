"use client";

import { useState } from "react";
import { Button } from "@friday/ui";
import { useCreatePowerPointDeck } from "@/lib/api/domains/skills";

export function PowerPointCreator() {
  const create = useCreatePowerPointDeck();
  const [title, setTitle] = useState("");
  const [slides, setSlides] = useState([{ title: "", bullets: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  const submit = async () => {
    setError(null); setDownload(null);
    try {
      const result = await create.mutateAsync({ title, slides: slides.map((slide) => ({ title: slide.title,
        bullets: slide.bullets.split("\n").map((line) => line.trim()).filter(Boolean) })) });
      setDownload(result.data.downloadUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Präsentation konnte nicht erstellt werden."); }
  };
  return <section className="sk-powerpoint" aria-labelledby="sk-powerpoint-title">
    <h3 id="sk-powerpoint-title">Präsentation erstellen</h3>
    <p>Hermes erstellt die PowerPoint-Datei lokal. Titel und Stichpunkte bleiben auf diesem Gerät.</p>
    <label>Präsentationstitel<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
    {slides.map((slide, index) => <div className="sk-powerpoint__slide" key={index}>
      <label>Folie {index + 1}: Titel<input value={slide.title} maxLength={120} onChange={(event) => setSlides((current) => current.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} /></label>
      <label>Stichpunkte, eine Zeile je Punkt<textarea rows={4} value={slide.bullets} onChange={(event) => setSlides((current) => current.map((item, i) => i === index ? { ...item, bullets: event.target.value } : item))} /></label>
      {slides.length > 1 && <Button type="button" onClick={() => setSlides((current) => current.filter((_, i) => i !== index))}>Folie entfernen</Button>}
    </div>)}
    <div className="sk-powerpoint__actions">
      <Button type="button" disabled={slides.length >= 12 || create.isPending} onClick={() => setSlides((current) => [...current, { title: "", bullets: "" }])}>Folie hinzufügen</Button>
      <Button type="button" loading={create.isPending} disabled={create.isPending || !title.trim() || slides.some((slide) => !slide.title.trim())} onClick={() => void submit()}>PowerPoint erstellen</Button>
    </div>
    {error && <p className="sk-warning" role="alert">{error}</p>}
    {download && <p role="status"><a href={download}>PowerPoint herunterladen</a></p>}
  </section>;
}
