"use client";

import { Button, Dialog } from "@friday/ui";
import { useEffect, useRef, useState } from "react";
import { getCsrfToken } from "@/lib/api/client";
import { captureEnrollmentPcm } from "@/features/voice-page/LinuxEnrollment";

type Kind = "wake" | "short" | "negatives" | "speech";
type Status = { state: "idle" | "capturing" | "training" | "ready" | "failed" | "cancelled";
  jobId: string | null; phrase: string | null; shortPhrase: string | null; required: Record<Kind, number>;
  counts: Record<Kind, number>; quality: string | null; error: string | null };
const kinds: Kind[] = ["wake", "short", "negatives", "speech"];
const labels: Record<Kind, string> = { wake: "Aktivierungsphrase", short: "Kurzform", negatives: "andere ähnliche Wörter", speech: "Lesetext" };

async function request(path: string, body?: object): Promise<Status> {
  const csrf = getCsrfToken();
  const response = await fetch(`/api/v1/voice/wake-enrollment${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Wake-Training fehlgeschlagen (HTTP ${response.status}).`);
  return response.json() as Promise<Status>;
}

export function WakeEnrollment({ phrase, activePhrase, readOnly }: { phrase: string; activePhrase: string; readOnly: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void request("").then((next) => { if (mounted.current) setStatus(next); }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  const run = async (path: string, body: object) => {
    setBusy(true); setError(null);
    try { const next = await request(path, body); if (mounted.current) setStatus(next); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Wake-Training fehlgeschlagen."); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (!status || (phrase === activePhrase && status.state === "idle")) return null;
  const nextKind = kinds.find((kind) => status.counts[kind] < status.required[kind]);
  const matches = status.phrase === phrase;
  const pretrained = phrase.trim().replace(/\s+/g, " ").toLowerCase() === "hey jarvis";
  const startable = status.state === "idle" && phrase !== activePhrase && !pretrained && phrase.trim().length >= 3;
  const record = async (kind: Kind) => {
    setBusy(true); setError(null);
    try {
      const pcmBase64 = await captureEnrollmentPcm();
      const next = await request("/samples", { jobId: status.jobId, kind, pcmBase64 });
      if (mounted.current) setStatus(next);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Aufnahme fehlgeschlagen."); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div role="region" aria-label="Aktivierungsphrase einlernen">
    {pretrained && status.state === "idle" ? <p>„Hey Jarvis“ nutzt das vorhandene Modell und kann direkt gespeichert werden.</p> :
      <Button variant="ghost" disabled={readOnly} onClick={() => setOpen(true)}>Aktivierungsphrase einlernen</Button>}
    {status.state === "training" ? <p role="status">Das private Modell wird trainiert. Die bisherige Phrase bleibt aktiv.</p> : null}
    {status.state === "cancelled" ? <p role="status">Training wird beendet und die Aufnahmen werden gelöscht.</p> : null}
    {status.state === "ready" && matches ? <p role="status">Training abgeschlossen{status.quality ? ` (Qualität: ${status.quality})` : ""}. Jetzt die Einstellungen speichern, um die neue Phrase zu aktivieren.</p> : null}
    <Dialog open={open} onOpenChange={setOpen} title="Neue Aktivierungsphrase einlernen" description="Aufnahmen bleiben lokal und werden nach dem Training oder Verwerfen gelöscht. Das bestehende Modell bleibt bis zum Speichern aktiv.">
      <div className="mc-stack">
        <p>Ausgewählte Phrase: <strong>{phrase}</strong></p>
        {status.jobId && !matches ? <p role="alert">Ein Training für „{status.phrase}“ ist offen. Bitte zuerst verwerfen oder die Phrase im Formular wiederherstellen.</p> : null}
        {startable ? <Button variant="primary" disabled={busy || readOnly} onClick={() => void run("/start", { phrase })}>Aufnahme starten</Button> : null}
        {status.jobId ? <>
          {kinds.filter((kind) => status.required[kind] > 0).map((kind) =>
            <p key={kind}>{labels[kind]}: {status.counts[kind]}/{status.required[kind]}</p>)}
          {nextKind && matches && ["capturing", "failed"].includes(status.state) ? <>
            <p>{nextKind === "wake" ? `Sprich „${phrase}“ deutlich.` : nextKind === "short" ? `Sprich nur „${status.shortPhrase}“.` :
              nextKind === "negatives" ? "Sprich ein ähnliches anderes Wort ohne die Aktivierungsphrase." :
              "Lies laut: Heute plane ich meinen Tag und bestätige meine Termine mit Friday."}</p>
            <Button variant="primary" disabled={busy || readOnly} onClick={() => void record(nextKind)}>
              {busy ? "Aufnahme läuft…" : `Probe aufnehmen (${labels[nextKind]})`}</Button>
          </> : null}
          {!nextKind && matches && ["capturing", "failed"].includes(status.state) ?
            <Button variant="primary" disabled={busy || readOnly} onClick={() => void run("/train", { jobId: status.jobId })}>
              {status.state === "failed" ? "Training erneut versuchen" : "Modell trainieren"}</Button> : null}
          <Button variant="ghost" disabled={busy || readOnly || status.state === "cancelled"} onClick={() => void run("/discard", { jobId: status.jobId })}>
            Aufnahmen und vorbereitetes Modell verwerfen</Button>
        </> : null}
        {status.error || error ? <p role="alert">{error ?? status.error}</p> : null}
        <Button variant="ghost" onClick={() => setOpen(false)}>Schließen</Button>
      </div>
    </Dialog>
  </div>;
}
