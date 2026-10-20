"use client";

import { Button } from "@friday/ui";
import { useEffect, useState } from "react";
import { getCsrfToken } from "@/lib/api/client";

type Status = {
  localMode: boolean;
  models: Array<{ id: string; cached: boolean; downloadable: boolean }>;
  job: { id: string; model: string; state: "downloading" | "cancelling" | "ready" | "failed" | "cancelled"; error: string | null } | null;
};

async function request(path: string, body?: object): Promise<Status> {
  const csrf = getCsrfToken();
  const response = await fetch(`/api/v1/voice/stt-models${path}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    headers: body ? { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Modellbestand nicht erreichbar (HTTP ${response.status}).`);
  return response.json() as Promise<Status>;
}

export function SttModelsControl({ selected, language, readOnly, onSelect }: {
  selected: string | null; language: "de" | "en"; readOnly: boolean; onSelect: (model: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void request("").then((next) => { if (alive) { setStatus(next); setError(null); } })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Modellbestand nicht erreichbar."); }); };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const run = async (path: string, body: object) => {
    setBusy(true); setError(null);
    try { setStatus(await request(path, body)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Modellaktion fehlgeschlagen."); }
    finally { setBusy(false); }
  };
  return <div role="region" aria-label="Lokale Whisper-Modelle">
    <p>Ein Download erfolgt nur nach Auswahl hier. Er nutzt Netzwerk und Speicherplatz, aktiviert das Modell aber nicht. Erst Speichern wendet die Modellauswahl an.</p>
    {error ? <p role="alert">{error}</p> : null}
    {!status ? <p role="status">Modellbestand wird geprüft…</p> : !status.localMode ?
      <p role="status">Cloud-Erkennung ist aktiv. Lokale Whisper-Modelle können in diesem Modus nicht gewechselt werden.</p> : <>
        <ul>{status.models.map((model) => <li key={model.id}>
          {model.id}: {model.cached ? "lokal vorhanden" : "nicht lokal vorhanden"}
          {model.cached && selected !== model.id ? <Button type="button" size="sm" variant="ghost"
            disabled={readOnly || busy || status.job?.state === "downloading" || status.job?.state === "cancelling" || model.id.endsWith(".en") && language !== "en"}
            onClick={() => onSelect(model.id)}>Auswählen</Button> : null}
          {!model.cached && model.downloadable ? <Button type="button" size="sm" variant="ghost" disabled={readOnly || busy || status.job?.state === "downloading" || status.job?.state === "cancelling"}
            onClick={() => void run("/download", { model: model.id })}>Herunterladen</Button> : null}
        </li>)}</ul>
        {selected && !status.models.some((model) => model.id === selected && model.cached) ?
          <p role="alert">Das ausgewählte Modell ist nicht im lokalen Bestand. Laden Sie es zuerst herunter oder wählen Sie ein vorhandenes Modell.</p> : null}
        {status.job?.state === "downloading" ? <p role="status">Download von {status.job.model} läuft. Das bisherige Modell bleibt aktiv.
          <Button type="button" size="sm" variant="ghost" disabled={busy || readOnly}
            onClick={() => void run("/cancel", { jobId: status.job?.id })}>Abbrechen</Button></p> : null}
        {status.job?.state === "cancelling" ? <p role="status">Download wird beendet. Ein neuer Auftrag ist erst danach möglich.</p> : null}
        {status.job?.state === "ready" ? <p role="status">{status.job.model} ist lokal vorhanden. Wählen und speichern Sie es zur Aktivierung.</p> : null}
        {status.job?.state === "failed" ? <p role="alert">{status.job.error ?? "Download fehlgeschlagen."} Erneut versuchen.</p> : null}
      </>}
  </div>;
}
