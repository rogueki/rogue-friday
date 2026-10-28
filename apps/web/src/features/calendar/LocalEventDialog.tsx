"use client";

import { createIdempotencyKey, type CalendarEvent } from "@friday/sdk";
import { Button, Dialog } from "@friday/ui";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { useRunStagedWrite } from "@/lib/api/stagedWrite";
import { useFormat } from "../memory/kit/hooks";
import { fromLocalInput, toLocalInput } from "./dates";

const calendarKeys = [queryKeys.calendar.events.all] as const;

export function LocalEventDialog({ open, event, onOpenChange }: { open: boolean; event: CalendarEvent | null; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;
  return <Body key={event?.id ?? "new"} event={event} onOpenChange={onOpenChange} />;
}

function Body({ event, onOpenChange }: { event: CalendarEvent | null; onOpenChange: (open: boolean) => void }) {
  const runStagedWrite = useRunStagedWrite();
  const format = useFormat();
  const zone = format.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [title, setTitle] = useState(event?.title ?? "");
  const [start, setStart] = useState(event ? toLocalInput(new Date(event.start), zone) : "");
  const [end, setEnd] = useState(event ? toLocalInput(new Date(event.end), zone) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const startDate = fromLocalInput(start, zone);
    const endDate = fromLocalInput(end, zone);
    if (!startDate || !endDate || endDate <= startDate) { setError("Beginn und Ende müssen gültig sein; das Ende muss später liegen."); return; }
    setBusy(true); setError("");
    const body = { title, start: startDate.toISOString(), end: endDate.toISOString(), timeZone: zone };
    // The key belongs to this save attempt; the confirm repeat must carry the identical request.
    const idempotencyKey = createIdempotencyKey();
    const outcome = await runStagedWrite({
      send: (previewId) => {
        const confirmHeaders = previewId ? { "X-Action-Preview-Id": previewId } : undefined;
        if (event) {
          return call(getApiClient().PUT("/api/v1/calendar/local/events/{id}", { body,
            params: { path: { id: event.id }, header: { "If-Match": String(event.version) } },
            ...(confirmHeaders ? { headers: confirmHeaders } : {}) }));
        }
        return call(getApiClient().POST("/api/v1/calendar/local/events", { body,
          params: { header: { "Idempotency-Key": idempotencyKey } },
          ...(confirmHeaders ? { headers: confirmHeaders } : {}) }));
      },
      successMessage: event ? "Termin aktualisiert." : "Termin eingetragen.",
      subject: title,
      invalidateKeys: calendarKeys,
    });
    setBusy(false);
    // A staged or queued write is confirmed over the shell dialog; only a real failure keeps the editor open.
    if (outcome === "failed") { setError("Der Termin konnte nicht gespeichert werden."); return; }
    onOpenChange(false);
  }

  async function remove() {
    if (!event) return;
    setBusy(true); setError("");
    const outcome = await runStagedWrite({
      send: (previewId) => call(getApiClient().DELETE("/api/v1/calendar/local/events/{id}", {
        params: { path: { id: event.id }, header: { "If-Match": String(event.version) } },
        ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}) })),
      successMessage: "Termin gelöscht.",
      subject: event.title,
      invalidateKeys: calendarKeys,
    });
    setBusy(false);
    if (outcome === "failed") { setError("Der Termin konnte nicht gelöscht werden."); return; }
    onOpenChange(false);
  }

  const saveBlocked = busy ? "Wird gespeichert …" : !title.trim() ? "Zuerst einen Titel eingeben." : !start || !end ? "Beginn und Ende angeben." : undefined;

  return <Dialog open onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title={event ? "Friday-Termin bearbeiten" : "Friday-Termin anlegen"} size="lg" closeLabel="Schließen"
    footer={<Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Schließen</Button>}>
    <p>Dein Termin wird direkt in Friday gespeichert. Eine Verbindung zu Google, Outlook oder CalDAV ist dafür nicht nötig.</p>
    <label>Titel <input value={title} maxLength={120} disabled={busy} onChange={(change) => setTitle(change.target.value)} /></label>
    <label>Beginn <input type="datetime-local" value={start} disabled={busy} onChange={(change) => setStart(change.target.value)} /></label>
    <label>Ende <input type="datetime-local" value={end} disabled={busy} onChange={(change) => setEnd(change.target.value)} /></label>
    <p>Zeitzone: {zone}</p>
    <Button disabled={saveBlocked !== undefined} title={saveBlocked} loading={busy} onClick={() => void save()}>{event ? "Änderung speichern" : "Termin anlegen"}</Button>
    {event && <Button variant="ghost" disabled={busy} onClick={() => void remove()}>Termin löschen</Button>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}
