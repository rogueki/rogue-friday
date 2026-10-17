"use client";

import { Button, Dialog } from "@friday/ui";
import { useEffect, useRef, useState } from "react";
import { getCsrfToken } from "@/lib/api/client";
import { BrowserAudioResampler } from "@/features/voice/browserAudioResampler";

type Kind = "wake" | "short" | "negatives" | "speech";
type Status = { available: boolean; state: "pending" | "training" | "activating" | "complete" | "failed"; phrase: string; shortPhrase: string | null; counts: Record<Kind, number>; required: Record<Kind, number>; error: string | null };
const labels: Record<Kind, string> = { wake: "Aktivierungsphrase", short: "Kurzform", negatives: "Ähnliche andere Wörter", speech: "Lesetext" };
const samples: Record<Kind, string> = {
  wake: "Sprich die angezeigte Aktivierungsphrase deutlich.",
  short: "Sprich nur die angezeigte Kurzform.",
  negatives: "Sprich ein anderes Wort oder einen ähnlichen Namen, aber nicht die Aktivierungsphrase.",
  speech: "Lies laut: Heute plane ich meinen Tag und bestätige meine Termine mit Friday.",
};

async function request(path: string, body?: unknown): Promise<Status> {
  const csrf = getCsrfToken();
  const response = await fetch(`/api/v1/voice/linux-enrollment${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Einrichtung fehlgeschlagen (HTTP ${response.status}).`);
  return response.json() as Promise<Status>;
}

async function capture(): Promise<string> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error("Mikrofon benötigt HTTPS oder localhost und AudioWorklet.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
  let audio: AudioContext | null = null;
  try {
    audio = new AudioContext();
    await audio.resume();
    await audio.audioWorklet.addModule("/browser-audio-worklet.js");
    const source = audio.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(audio, "friday-capture");
    const silent = audio.createGain(); silent.gain.value = 0;
    source.connect(node).connect(silent).connect(audio.destination);
    const resampler = new BrowserAudioResampler(audio.sampleRate);
    const pcm: number[] = [];
    node.port.onmessage = (event: MessageEvent<Float32Array>) => { pcm.push(...resampler.push(event.data)); };
    await new Promise((resolve) => setTimeout(resolve, 3200));
    node.port.onmessage = null;
    if (pcm.length < 16_000 || pcm.length > 96_000) throw new Error("Aufnahme ist zu kurz oder zu lang.");
    const bytes = new Uint8Array(pcm.length * 2);
    const view = new DataView(bytes.buffer);
    let energy = 0;
    for (let i = 0; i < pcm.length; i++) { const value = Math.max(-1, Math.min(1, pcm[i] ?? 0)); energy += value * value; view.setInt16(i * 2, Math.round(value * 32767), true); }
    if (Math.sqrt(energy / pcm.length) < 0.005) throw new Error("Keine Sprache erkannt. Bitte erneut aufnehmen.");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    await audio?.close();
  }
}

export function LinuxEnrollment() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void request("").then((next) => { if (mounted.current) setStatus(next); }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  if (!status?.available) return null;
  const next = (Object.keys(labels) as Kind[]).find((kind) => status.counts[kind] < status.required[kind]);
  const record = async (kind: Kind) => {
    setBusy(true); setError(null);
    try { const pcmBase64 = await capture(); const result = await request("/samples", { kind, pcmBase64 }); if (mounted.current) setStatus(result); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Aufnahme fehlgeschlagen."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const train = async () => {
    setBusy(true); setError(null);
    try { const result = await request("/train", {}); if (mounted.current) setStatus(result); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Training fehlgeschlagen."); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="vp-enroll" role="region" aria-label="Linux-Sprachaktivierung">
    <div className="mc-row mc-row--between"><strong>Browser-Stimme einrichten</strong><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{status.state === "complete" ? "Ansehen" : "Einrichten"}</Button></div>
    <p className="mc-note">{status.state === "complete" ? "Sprachdienst ist eingerichtet." : status.state === "training" ? "Sprecher- und Aktivierungsmodell werden trainiert." : status.state === "activating" ? "Sprachdienst wird aktiviert. Bitte kurz warten." : "Optional: Stimme direkt über das Browsermikrofon einlernen."}</p>
    <Dialog open={open} onOpenChange={setOpen} title="Friday Stimme einrichten" description="Aufnahmen bleiben auf diesem Server und werden nach dem Training gelöscht.">
      <div className="mc-stack">
        <p className="mc-note">Aktivierungsphrase: <strong>{status.phrase}</strong>{status.shortPhrase ? ` · Kurzform: ${status.shortPhrase}` : ""}</p>
        {(Object.keys(labels) as Kind[]).filter((kind) => status.required[kind] > 0).map((kind) => <p key={kind} className="mc-note">{labels[kind]}: {status.counts[kind]}/{status.required[kind]}</p>)}
        {next && status.state !== "training" && status.state !== "activating" ? <><p className="mc-note">{samples[next]}</p><Button variant="primary" disabled={busy} onClick={() => void record(next)}>{busy ? "Aufnahme läuft …" : `Probe aufnehmen (${labels[next]})`}</Button></> : null}
        {!next && status.state !== "complete" && status.state !== "training" ? <Button variant="primary" disabled={busy} onClick={() => void train()}>{status.state === "activating" ? "Aktivierung erneut versuchen" : "Modelle trainieren"}</Button> : null}
        {error || status.error ? <p className="vp-fail" role="alert">{error ?? status.error}</p> : null}
        <Button variant="ghost" onClick={() => setOpen(false)}>Später</Button>
      </div>
    </Dialog>
  </div>;
}
