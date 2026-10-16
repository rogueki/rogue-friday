"use client";

import { createIdempotencyKey, isFridayApiError, type CalDavEventCreateResponse, type CalDavEventPreviewResponse } from "@friday/sdk";
import { Button, Dialog } from "@friday/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { useFormat } from "../memory/kit/hooks";
import { fromLocalInput } from "./dates";

export function CalDavCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;
  return <Body onOpenChange={onOpenChange} />;
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const format = useFormat();
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [preview, setPreview] = useState<CalDavEventPreviewResponse["data"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"created" | "unknown" | null>(null);
  const [error, setError] = useState("");
  const key = useRef(createIdempotencyKey());

  function edit(setter: (value: string) => void, value: string) {
    setter(value);
    setPreview(null);
    setError("");
    key.current = createIdempotencyKey();
  }

  async function check() {
    setError("");
    const startDate = fromLocalInput(start, format.timeZone);
    const endDate = fromLocalInput(end, format.timeZone);
    if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
      setError("Beginn und Ende müssen gültig sein; das Ende muss nach dem Beginn liegen.");
      return;
    }
    setBusy(true);
    try {
      const response: CalDavEventPreviewResponse = await call(getApiClient().POST("/api/v1/calendar/caldav/preview", {
        body: { title, start: startDate.toISOString(), end: endDate.toISOString() },
        params: { header: { "Idempotency-Key": key.current } },
      }));
      setPreview(response.data);
    } catch (failure) {
      setError(isFridayApiError(failure) ? failure.message : "Die Vorschau konnte nicht erstellt werden.");
    } finally { setBusy(false); }
  }

  async function create() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const response: CalDavEventCreateResponse = await call(getApiClient().POST("/api/v1/calendar/caldav/events", {
        body: { title: preview.title, start: preview.start, end: preview.end, confirmationToken: preview.confirmationToken },
        params: { header: { "Idempotency-Key": key.current } },
      }));
      setOutcome(response.data.state);
      if (response.data.state === "created") await queryClient.invalidateQueries({ queryKey: queryKeys.calendar.events.all });
    } catch (failure) {
      if (isFridayApiError(failure) && [400, 401, 403, 409, 422].includes(failure.status)) setError(failure.message);
      else setOutcome("unknown");
    } finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title="CalDAV-Termin anlegen" size="lg" closeLabel="Schließen"
    footer={<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Schließen</Button>}>
    <p>Ein Termin wird erst nach deiner Bestätigung in der eingerichteten CalDAV-Kalendersammlung gespeichert. Die allgemeine Freigabeseite ist für diesen Livepfad noch nicht verbunden.</p>
    <label>Titel <input value={title} maxLength={120} disabled={busy || outcome !== null} onChange={(event) => edit(setTitle, event.target.value)} /></label>
    <label>Beginn <input type="datetime-local" value={start} disabled={busy || outcome !== null} onChange={(event) => edit(setStart, event.target.value)} /></label>
    <label>Ende <input type="datetime-local" value={end} disabled={busy || outcome !== null} onChange={(event) => edit(setEnd, event.target.value)} /></label>
    <p>Zeitzone: {format.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
    {!preview && !outcome && <Button disabled={busy || !title.trim() || !start || !end} loading={busy} onClick={() => void check()}>Termin prüfen</Button>}
    {preview && !outcome && <div role="group" aria-label="CalDAV-Termin bestätigen">
      <p><strong>{preview.title}</strong><br />{format.dateTime(preview.start)} – {format.dateTime(preview.end)} ({format.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone})</p>
      <Button disabled={busy} loading={busy} onClick={() => void create()}>Genau diesen Termin anlegen</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>Zurück</Button>
    </div>}
    {outcome === "created" && <p role="status">CalDAV hat die Terminanlage bestätigt.</p>}
    {outcome === "unknown" && <p role="alert">Der Schreibstatus ist unbekannt. Prüfe den Kalender beim Anbieter. Friday wiederholt diesen Versuch nicht.</p>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}
