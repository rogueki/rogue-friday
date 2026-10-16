"use client";

import { createIdempotencyKey, isFridayApiError, type CalendarEvent, type CalendarEventResponse } from "@friday/sdk";
import { Button, Dialog } from "@friday/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { useFormat } from "../memory/kit/hooks";
import { fromLocalInput, toLocalInput } from "./dates";

export function LocalEventDialog({ open, event, onOpenChange }: { open: boolean; event: CalendarEvent | null; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;
  return <Body key={event?.id ?? "new"} event={event} onOpenChange={onOpenChange} />;
}

function Body({ event, onOpenChange }: { event: CalendarEvent | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const format = useFormat();
  const zone = format.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [title, setTitle] = useState(event?.title ?? "");
  const [start, setStart] = useState(event ? toLocalInput(new Date(event.start), zone) : "");
  const [end, setEnd] = useState(event ? toLocalInput(new Date(event.end), zone) : "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const startDate = fromLocalInput(start, zone);
    const endDate = fromLocalInput(end, zone);
    if (!startDate || !endDate || endDate <= startDate) { setError("Beginn und Ende müssen gültig sein; das Ende muss später liegen."); return; }
    setBusy(true); setError("");
    const body = { title, start: startDate.toISOString(), end: endDate.toISOString(), timeZone: zone };
    try {
      if (event) {
        await call(getApiClient().PUT("/api/v1/calendar/local/events/{id}", { body, params: { path: { id: event.id }, header: { "If-Match": String(event.version) } } }));
      } else {
        await call(getApiClient().POST("/api/v1/calendar/local/events", { body, params: { header: { "Idempotency-Key": createIdempotencyKey() } } }));
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.calendar.events.all });
      onOpenChange(false);
    } catch (failure) { setError(isFridayApiError(failure) ? failure.message : "Der Termin konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!event || !confirmDelete) return;
    setBusy(true); setError("");
    try {
      const _: CalendarEventResponse = await call(getApiClient().DELETE("/api/v1/calendar/local/events/{id}", { params: { path: { id: event.id }, header: { "If-Match": String(event.version) } } }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.calendar.events.all });
      onOpenChange(false);
    } catch (failure) { setError(isFridayApiError(failure) ? failure.message : "Der Termin konnte nicht gelöscht werden."); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title={event ? "Friday-Termin bearbeiten" : "Friday-Termin anlegen"} size="lg" closeLabel="Schließen"
    footer={<Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Schließen</Button>}>
    <p>Dein Termin wird direkt in Friday gespeichert. Eine Verbindung zu Google, Outlook oder CalDAV ist dafür nicht nötig.</p>
    <label>Titel <input value={title} maxLength={120} disabled={busy} onChange={(change) => setTitle(change.target.value)} /></label>
    <label>Beginn <input type="datetime-local" value={start} disabled={busy} onChange={(change) => setStart(change.target.value)} /></label>
    <label>Ende <input type="datetime-local" value={end} disabled={busy} onChange={(change) => setEnd(change.target.value)} /></label>
    <p>Zeitzone: {zone}</p>
    <Button disabled={busy || !title.trim() || !start || !end} loading={busy} onClick={() => void save()}>{event ? "Änderung speichern" : "Termin anlegen"}</Button>
    {event && !confirmDelete && <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>Termin löschen</Button>}
    {event && confirmDelete && <div role="group" aria-label="Löschen bestätigen"><p>Diesen Termin wirklich dauerhaft löschen?</p>
      <Button disabled={busy} loading={busy} onClick={() => void remove()}>Ja, Termin löschen</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>Abbrechen</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}
