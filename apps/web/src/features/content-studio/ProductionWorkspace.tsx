"use client";

import { Button, HudPanel } from "@friday/ui";
import { createIdempotencyKey, FridayApiError, type ContentIdea, type ContentProductionJob } from "@friday/sdk";
import { useEffect, useMemo, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";

const voiceKey = "friday.content-studio.voice-id";
const pendingKey = "friday.content-studio.pending-production";
const jobKey = "friday.content-studio.production-job-id";
const supported = new Set<ContentIdea["format"]>(["Feed-Post", "LinkedIn-Video", "YouTube-Video", "Story", "Reel", "TikTok-Video", "YouTube-Short"]);
const terminal = new Set<ContentProductionJob["state"]>(["completed", "provider_unknown", "speech_unknown", "failed", "cancelled"]);
const stateLabels: Record<ContentProductionJob["state"], string> = {
  queued: "Eingereiht", submitting: "Medienauftrag wird gesendet", provider_pending: "Medienerzeugung läuft",
  downloading: "Mediendatei wird gesichert", speech_submitting: "Stimme wird erzeugt", editing: "Video wird geschnitten",
  completed: "Fertig", provider_unknown: "Medienauftrag unklar", speech_unknown: "Sprachauftrag unklar", failed: "Fehlgeschlagen", cancelled: "Abgebrochen",
};

type PendingStart = { body: { ideaId: string; voiceId?: string; planRevision: number; confirmed: true }; key: string };

export function ProductionWorkspace({ ideas, revision }: { ideas: ContentIdea[]; revision: number }) {
  const eligible = useMemo(() => ideas.filter((idea) => supported.has(idea.format)), [ideas]);
  const [ideaId, setIdeaId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [preview, setPreview] = useState("");
  const [job, setJob] = useState<ContentProductionJob | null>(null);
  const [pendingAvailable, setPendingAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const idea = eligible.find((item) => item.id === ideaId);
  const fingerprint = JSON.stringify({ idea, voiceId: voiceId.trim(), revision });
  const ideaSelectBlocked = eligible.length === 0 ? "Keine Content-Idee in einem unterstützten Format vorhanden." : undefined;
  const checkBlocked = busy ? "Läuft gerade …" : !idea ? "Zuerst eine Content-Idee wählen." : undefined;
  const activeJobId = job?.id;
  const activeJobState = job?.state;

  useEffect(() => {
    setVoiceId(localStorage.getItem(voiceKey) ?? "");
    setPendingAvailable(Boolean(sessionStorage.getItem(pendingKey)));
    const previousJob = sessionStorage.getItem(jobKey);
    if (previousJob) {
      void call(getApiClient().GET("/api/v1/content-studio/production-jobs/{id}", { params: { path: { id: previousJob } } }))
        .then((response) => setJob(response.data))
        .catch(() => sessionStorage.removeItem(jobKey));
    }
  }, []);

  useEffect(() => { if (!eligible.some((item) => item.id === ideaId)) setIdeaId(eligible[0]?.id ?? ""); }, [eligible, ideaId]);
  useEffect(() => {
    if (!activeJobId || !activeJobState || terminal.has(activeJobState)) return;
    const interval = window.setInterval(() => {
      void call(getApiClient().GET("/api/v1/content-studio/production-jobs/{id}", { params: { path: { id: activeJobId } } }))
        .then((response) => { setJob(response.data); setMessage(""); })
        .catch(() => setMessage("Der Auftragsstatus ist gerade nicht erreichbar. F.R.I.D.A.Y. fragt weiter nach; es wird kein neuer kostenpflichtiger Auftrag gestartet."));
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeJobId, activeJobState]);

  const submit = async (pending: PendingStart): Promise<void> => {
    setBusy(true);
    setMessage("");
    sessionStorage.setItem(pendingKey, JSON.stringify(pending));
    setPendingAvailable(true);
    try {
      const response = await call(getApiClient().POST("/api/v1/content-studio/production-jobs", {
        body: pending.body, headers: { "Idempotency-Key": pending.key },
      }));
      sessionStorage.removeItem(pendingKey);
      setPendingAvailable(false);
      sessionStorage.setItem(jobKey, response.data.id);
      setJob(response.data);
      setPreview("");
      setMessage("F.R.I.D.A.Y. übernimmt Medienerzeugung, Stimme und Schnitt. Der Status aktualisiert sich automatisch.");
    } catch (error) {
      if (error instanceof FridayApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        sessionStorage.removeItem(pendingKey);
        setPendingAvailable(false);
        setMessage(error.status === 409 ? "Der Plan wurde inzwischen geändert. Bitte die Seite neu laden und den Auftrag erneut prüfen." : error.message);
      } else {
        setMessage(error instanceof Error ? `${error.message} Der gleiche Auftragsschlüssel bleibt für eine sichere Statuswiederherstellung erhalten.` : "Auftragsausgang unklar. Der Auftragsschlüssel bleibt erhalten.");
      }
    } finally { setBusy(false); }
  };

  const start = (): void => {
    if (!idea || preview !== fingerprint || busy) return;
    setJob(null);
    void submit({ body: { ideaId: idea.id, ...(voiceId.trim() ? { voiceId: voiceId.trim() } : {}), planRevision: revision, confirmed: true }, key: createIdempotencyKey() });
  };

  const recover = (): void => {
    const raw = sessionStorage.getItem(pendingKey);
    if (!raw || busy) return;
    try { void submit(JSON.parse(raw) as PendingStart); }
    catch { sessionStorage.removeItem(pendingKey); setPendingAvailable(false); setMessage("Der gespeicherte Wiederherstellungsauftrag ist beschädigt."); }
  };

  const cancel = async (): Promise<void> => {
    if (!job || terminal.has(job.state) || busy) return;
    setBusy(true);
    try {
      const response = await call(getApiClient().POST("/api/v1/content-studio/production-jobs/{id}/cancel", { params: { path: { id: job.id } } }));
      setJob(response.data);
      setMessage("Der Auftrag ist gestoppt. Bereits abgesandte Anbieteraufrufe können Kosten verursachen.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Auftrag konnte nicht gestoppt werden."); }
    finally { setBusy(false); }
  };

  const download = async (): Promise<void> => {
    if (!job?.artifactReady || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/content-studio/production-jobs/${encodeURIComponent(job.id)}/artifact`, { credentials: "include" });
      if (!response.ok || !response.headers.get("content-type")?.includes("video/mp4")) throw new Error("Die fertige MP4-Datei ist derzeit nicht abrufbar.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `friday-content-${job.id}.mp4`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Download fehlgeschlagen."); }
    finally { setBusy(false); }
  };

  return <HudPanel title="Automatische Produktion">
    <div className="cs-form">
      <p className="cs-span">Wähle eine Idee. Nach einer einzigen auftragsbezogenen Freigabe erstellt F.R.I.D.A.Y. die Medien, die Stimme und den Schnitt selbst.</p>
      <label>Content-Idee<select value={ideaId} onChange={(event) => { setIdeaId(event.target.value); setPreview(""); }} disabled={ideaSelectBlocked !== undefined} title={ideaSelectBlocked}>{eligible.length === 0 && <option value="">Noch keine unterstützte Idee</option>}{eligible.map((item) => <option key={item.id} value={item.id}>{item.titel} · {item.format}</option>)}</select></label>
      <label>ElevenLabs Voice-ID (optional)<input value={voiceId} maxLength={128} onChange={(event) => { setVoiceId(event.target.value); localStorage.setItem(voiceKey, event.target.value); setPreview(""); }} placeholder="Automatische weibliche Stimme" /></label>
      {idea && <p className="cs-span">Format: {idea.format}. Inhalt: {idea.beschreibung || idea.titel}</p>}
      <Button type="button" disabled={checkBlocked !== undefined} title={checkBlocked} onClick={() => setPreview(fingerprint)}>Auftrag prüfen</Button>
      {(ideaSelectBlocked ?? checkBlocked) && <p className="cs-span" role="note">{ideaSelectBlocked ?? checkBlocked}</p>}
      {preview === fingerprint && idea && <div className="cs-span cs-notice" role="status"><p>F.R.I.D.A.Y. erzeugt „{idea.titel}“ mit kie.ai und ElevenLabs und schneidet die MP4 lokal. Stimme: {voiceId.trim() || "automatisch ausgewählte weibliche Stimme"}. Die Anbieteraufrufe können Kosten verursachen. Planrevision: {revision}.</p><Button type="button" disabled={busy} onClick={start}>Diesen Produktionsauftrag starten</Button><Button type="button" variant="ghost" onClick={() => setPreview("")}>Abbrechen</Button></div>}
      {pendingAvailable && <Button type="button" variant="ghost" disabled={busy} onClick={recover}>Unklaren Auftrag sicher wiederfinden</Button>}
      {job && <div className="cs-span cs-notice" role="status"><p>Auftrag {job.id}: {stateLabels[job.state]}</p>{job.errorCode && <p>Fehlercode: {job.errorCode}</p>}{!terminal.has(job.state) && <Button type="button" variant="ghost" disabled={busy} onClick={() => void cancel()}>Laufenden Auftrag abbrechen</Button>}{job.artifactReady && <Button type="button" disabled={busy} onClick={() => void download()}>Fertiges MP4 herunterladen</Button>}</div>}
      {message && <p className="cs-span cs-notice" role="status">{message}</p>}
      <p className="cs-span">Medienprofile: Feed-Post, LinkedIn-Video, YouTube-Video sowie vertikale Storys, Reels, TikTok-Videos und YouTube-Shorts. Veröffentlichung bleibt bis zur Verbindung der Zielkonten gesperrt.</p>
    </div>
  </HudPanel>;
}
