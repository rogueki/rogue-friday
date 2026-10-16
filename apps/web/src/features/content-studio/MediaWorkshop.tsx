"use client";

import { Button, HudPanel } from "@friday/ui";
import { createIdempotencyKey, type KieTask } from "@friday/sdk";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient, getCsrfToken } from "@/lib/api/client";

const apiPath = "/api/v1/content-studio/elevenlabs/speech";

export function MediaWorkshop() {
  const [kind, setKind] = useState<"image" | "video">("image");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "16:9">("1:1");
  const [prompt, setPrompt] = useState("");
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState<KieTask | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [script, setScript] = useState("");
  const [confirmMedia, setConfirmMedia] = useState(false);
  const [confirmSpeech, setConfirmSpeech] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const createMedia = async (): Promise<void> => {
    if (!confirmMedia || !prompt.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await call(getApiClient().POST("/api/v1/content-studio/kie/tasks", {
        body: { kind, aspectRatio, prompt: prompt.trim(), confirmed: true },
        headers: { "Idempotency-Key": createIdempotencyKey() },
      }));
      setTask(result.data); setTaskId(result.data.taskId); setConfirmMedia(false);
      setMessage("Auftrag angenommen. Die ID bleibt hier sichtbar; notiere sie für spätere Statusabfragen.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Medienauftrag fehlgeschlagen."); }
    finally { setBusy(false); }
  };

  const readStatus = async (): Promise<void> => {
    if (!taskId.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await call(getApiClient().GET("/api/v1/content-studio/kie/tasks/{id}", { params: { path: { id: taskId.trim() } } }));
      setTask(result.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Statusabfrage fehlgeschlagen."); }
    finally { setBusy(false); }
  };

  const createSpeech = async (): Promise<void> => {
    if (!confirmSpeech || !voiceId.trim() || !script.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(apiPath, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createIdempotencyKey(), "X-CSRF-Token": getCsrfToken() ?? "" },
        body: JSON.stringify({ text: script.trim(), voiceId: voiceId.trim(), confirmed: true }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(failure?.error?.message ?? `Sprachauftrag fehlgeschlagen (HTTP ${response.status}).`);
      }
      if (!response.headers.get("content-type")?.includes("audio/mpeg")) throw new Error("Der Server hat keine MP3-Datei geliefert.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = "friday-speech.mp3"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setConfirmSpeech(false); setMessage("MP3 heruntergeladen. Bitte anhören und prüfen.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sprachauftrag fehlgeschlagen."); }
    finally { setBusy(false); }
  };

  return <section className="cs-workshop" aria-label="Medienproduktion">
    <HudPanel title="Bild oder Video mit kie.ai"><div className="cs-form">
      <label>Medium<select value={kind} onChange={(event) => setKind(event.target.value as "image" | "video")}><option value="image">Bild</option><option value="video">Video · 5 Sekunden</option></select></label>
      <label>Seitenverhältnis<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as "1:1" | "16:9")}><option value="1:1">1:1</option><option value="16:9">16:9</option></select></label>
      <label className="cs-span">Prompt<textarea value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} /></label>
      <label className="cs-span cs-confirm"><input type="checkbox" checked={confirmMedia} onChange={(event) => setConfirmMedia(event.target.checked)} /> Ich bestätige diesen kostenpflichtigen Auftrag. Kosten und Rechte habe ich geprüft.</label>
      <Button type="button" disabled={busy || !confirmMedia || !prompt.trim()} onClick={() => void createMedia()}>Auftrag starten</Button>
      <label>Auftrags-ID<input value={taskId} onChange={(event) => setTaskId(event.target.value)} /></label>
      <Button type="button" variant="ghost" disabled={busy || !taskId.trim()} onClick={() => void readStatus()}>Status abrufen</Button>
      {task && <div className="cs-span" role="status"><p>Status: {task.state} · ID: {task.taskId}</p>{task.creditsConsumed !== null && <p>Verbrauch: {task.creditsConsumed} Credits</p>}{task.resultUrls.map((url) => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">Ergebnis öffnen</a></p>)}</div>}
    </div></HudPanel>
    <HudPanel title="Sprechertext mit ElevenLabs"><div className="cs-form">
      <label className="cs-span">Voice-ID<input value={voiceId} maxLength={128} onChange={(event) => setVoiceId(event.target.value)} /></label>
      <label className="cs-span">Text<textarea value={script} maxLength={2500} onChange={(event) => setScript(event.target.value)} /></label>
      <label className="cs-span cs-confirm"><input type="checkbox" checked={confirmSpeech} onChange={(event) => setConfirmSpeech(event.target.checked)} /> Ich bestätige diesen kostenpflichtigen Auftrag und die Nutzungsrechte der Stimme.</label>
      <Button type="button" disabled={busy || !confirmSpeech || !voiceId.trim() || !script.trim()} onClick={() => void createSpeech()}>MP3 erzeugen</Button>
      <p className="cs-span">Die Datei wird heruntergeladen; prüfe Aussprache, Dauer und Ton vor Verwendung. CapCut-Schnitt erfolgt manuell.</p>
    </div></HudPanel>
    {message && <p className="cs-notice" role="status">{message}</p>}
  </section>;
}
