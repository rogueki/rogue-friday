"use client";

import type { CalendarAccountAction } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";

interface Collection { id: string; name: string; color: string | null; timeZone: string | null; canRead: boolean; canWrite: boolean; selected: boolean }
interface Account { id: string; kind: "caldav" | "ics"; displayName: string; baseUrl: string; username: string;
  syncMinutes: number; revision: number; defaultCalendarId: string | null; calendars: Collection[];
  secretState: { password: boolean } }
interface List { revision: number; defaultAccountId: string | null; accounts: Account[] }
interface Item { id: string; etag: string; calendarId: string; recurring: boolean; hasExceptions: boolean;
  masterStart: string; masterEnd: string; recurrenceId: string | null;
  event: { title: string; start: string; end: string; allDay: boolean; description?: string; location?: string } }

const empty: NonNullable<CalendarAccountAction["account"]> = { kind: "caldav", displayName: "", baseUrl: "", username: "", syncMinutes: 15 };
const invoke = async (body: CalendarAccountAction) => (await call(getApiClient().POST("/api/v1/integrations/calendar/accounts/actions", {
  body, params: { header: { "Idempotency-Key": crypto.randomUUID() } },
}))).data;

export function CalendarAccounts() {
  const query = useQuery({ queryKey: ["calendar-accounts"], queryFn: async (): Promise<List> =>
    (await call(getApiClient().GET("/api/v1/integrations/calendar/accounts"))).data as unknown as List });
  const [id, setId] = useState("");
  const [form, setForm] = useState<NonNullable<CalendarAccountAction["account"]>>(empty);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [itemCalendar, setItemCalendar] = useState("");
  const [event, setEvent] = useState({ title: "", start: "", end: "", allDay: false, description: "", location: "", rrule: "" });
  const [edit, setEdit] = useState<Item | null>(null);
  const [editScope, setEditScope] = useState<"single" | "series" | "occurrence">("single");
  const list = query.data;
  const current = list?.accounts.find((account) => account.id === id);
  const selected = current?.calendars.filter((calendar) => calendar.selected) ?? [];
  const writable = selected.filter((calendar) => calendar.canWrite);
  const run = async (body: CalendarAccountAction, ok: string | ((data: Record<string, unknown>) => string), after?: (data: Record<string, unknown>) => void) => {
    setBusy(true); setMessage("");
    try { const data = await invoke(body); after?.(data); await query.refetch(); setMessage(typeof ok === "string" ? ok : ok(data)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Kalenderaktion fehlgeschlagen."); }
    finally { setBusy(false); }
  };
  const choose = (accountId: string) => {
    const account = list?.accounts.find((entry) => entry.id === accountId);
    setId(accountId); setItems([]); setEdit(null); setPassword("");
    setForm(account ? { kind: account.kind, displayName: account.displayName, baseUrl: account.baseUrl,
      username: account.username, syncMinutes: account.syncMinutes } : empty);
    setItemCalendar(account?.defaultCalendarId ?? "ics");
  };
  const read = (calendarId: string) => {
    const from = new Date(); from.setDate(from.getDate() - 7);
    const to = new Date(); to.setDate(to.getDate() + 60);
    void run({ action: "events", accountId: id, calendarId, from: from.toISOString(), to: to.toISOString() },
      "Termine geladen.", (data) => { setItems((data.items as Item[]) ?? []); setItemCalendar(calendarId); });
  };
  return <section className="mk-panel" aria-label="Verbundene Kalender">
    <h2>Verbundene Kalender</h2>
    <p>CalDAV-Konten mit erkannten Leserechten und Schreibrechten. ICS-Feeds bleiben lesbar. Private Feed-URLs und Passwörter werden nicht angezeigt.</p>
    {query.isError && <p role="alert">Kalenderkonten konnten nicht geladen werden.</p>}
    <label>Konto <select value={id} onChange={(e) => choose(e.target.value)} disabled={busy}>
      <option value="">Neues Konto</option>{list?.accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} ({account.kind})</option>)}
    </select></label>
    {current && <p>{list?.defaultAccountId === id ? "Standardkonto · " : ""}Revision {current.revision} · Zugangsdaten {current.secretState.password ? "gespeichert" : "fehlen"}</p>}
    <form onSubmit={(e) => { e.preventDefault(); void run({ action: "upsert", account: { ...form, ...(id ? { id } : {}) },
      ...(password ? { password } : {}), expectedRevision: current?.revision ?? null }, "Konto gespeichert. Bitte Kalender suchen.",
      (data) => { setId(String(data.id)); setPassword(""); }); }}>
      <div className="st-grid">
        <label>Typ <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "caldav" | "ics", baseUrl: "" })}>
          <option value="caldav">CalDAV</option><option value="ics">ICS, nur lesen</option></select></label>
        <label>Name <input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
        <label>{form.kind === "ics" ? "Private HTTPS-Feed-URL" : "CalDAV-HTTPS-Start-URL"}<input type="url" required={!current || form.kind === "caldav"} value={form.baseUrl} autoComplete="off"
          placeholder="https://…" onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></label>
        {form.kind === "caldav" && <><label>Benutzername <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label>App-Passwort <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label></>}
        <label>Abfrageintervall (Minuten) <input type="number" min={1} max={1440} value={form.syncMinutes} onChange={(e) => setForm({ ...form, syncMinutes: Number(e.target.value) })} /></label>
      </div>
      <button type="submit" disabled={busy}>Konto speichern</button>
    </form>
    {current && <div>
      {current.kind === "caldav" && <button disabled={busy} onClick={() => void run({ action: "discover", accountId: id, expectedRevision: current.revision }, "Kalender und Rechte aktualisiert.")}>Kalender suchen</button>}
      <button disabled={busy} onClick={() => void run({ action: "default", accountId: id, expectedRevision: current.revision }, "Standardkonto gesetzt.")}>Als Standardkonto</button>
      <button disabled={busy} onClick={() => void run({ action: "delete", accountId: id, expectedRevision: current.revision }, "Konto lokal entfernt.", () => choose(""))}>Konto entfernen</button>
      {current.calendars.map((calendar) => <div key={calendar.id}>
        <label><input type="checkbox" checked={calendar.selected} disabled={busy} onChange={(e) => void run({ action: "select", accountId: id,
          expectedRevision: current.revision, selectedIds: current.calendars.filter((entry) => entry.id === calendar.id ? e.target.checked : entry.selected).map((entry) => entry.id),
          defaultCalendarId: current.defaultCalendarId }, "Auswahl gespeichert.")} />{calendar.name}</label>
        <span> · {calendar.canWrite ? "Schreiben" : "Nur lesen"}{calendar.timeZone ? ` · ${calendar.timeZone}` : ""}
          {calendar.color ? <span style={{ color: calendar.color }}> ● </span> : null}</span>
        {!calendar.canWrite && <small>Schreibrecht bitte beim Kalenderanbieter freigeben und danach erneut suchen.</small>}
        <button disabled={busy} onClick={() => void run({ action: "check", accountId: id, calendarId: calendar.id },
          (data) => data.canRead ? data.canWrite ? "Verbindung geprüft: lesen und schreiben möglich." : "Verbindung geprüft: nur lesen. Schreibrecht beim Anbieter freigeben." : "Keine Leseberechtigung beim Anbieter.")}>Verbindung prüfen</button>
        {calendar.canWrite && calendar.selected && <button disabled={busy} onClick={() => void run({ action: "select", accountId: id, expectedRevision: current.revision,
          selectedIds: selected.map((entry) => entry.id), defaultCalendarId: calendar.id }, "Standardkalender gesetzt.")}>Als Standardkalender</button>}
        {calendar.selected && <button disabled={busy} onClick={() => read(calendar.id)}>Termine anzeigen</button>}
      </div>)}
      {current.kind === "ics" && <button disabled={busy} onClick={() => read("ics")}>Feed anzeigen</button>}
    </div>}
    {items.length > 0 && <ul>{items.map((item) => <li key={item.id + item.event.start}>
      {item.event.title} · {item.event.start} {item.recurring ? " · Serie" : ""} {current?.kind === "caldav" && current.calendars.find((c) => c.id === itemCalendar)?.canWrite && <>
        <button disabled={busy} onClick={() => { setEdit(item); setEditScope(item.recurring ? "occurrence" : "single");
          setEvent({ title: item.event.title, start: item.event.start, end: item.event.end,
          allDay: item.event.allDay, description: item.event.description ?? "", location: item.event.location ?? "", rrule: "" }); }}>Bearbeiten</button>
        <button disabled={busy} onClick={() => { if (window.confirm(item.recurring ? `Nur diesen Termin ${item.event.title} löschen?` : `Termin ${item.event.title} löschen?`)) void run({ action: "delete-event", accountId: id,
          calendarId: itemCalendar, eventId: item.id, etag: item.etag, scope: item.recurring ? "occurrence" : "single",
          ...(item.recurring && item.recurrenceId ? { recurrenceId: item.recurrenceId } : {}) },
          (data) => data.state === "uncertain" ? "Ergebnis unklar: Anbieter prüfen, bevor du es erneut versuchst." : "Termin gelöscht.", () => read(itemCalendar)); }}>Löschen</button>
        {item.recurring && <button disabled={busy} onClick={() => { if (window.confirm(`Gesamte Serie ${item.event.title} löschen?`)) void run({ action: "delete-event", accountId: id,
          calendarId: itemCalendar, eventId: item.id, etag: item.etag, scope: "series" },
          (data) => data.state === "uncertain" ? "Ergebnis unklar: Anbieter prüfen, bevor du es erneut versuchst." : "Serie gelöscht.", () => read(itemCalendar)); }}>Ganze Serie löschen</button>}
      </>}
    </li>)}</ul>}
    {current && writable.length > 0 && <form onSubmit={(e) => { e.preventDefault(); const calendarId = itemCalendar && writable.some((c) => c.id === itemCalendar) ? itemCalendar : current.defaultCalendarId ?? writable[0]!.id;
      void run({ action: edit ? "update" : "create", accountId: id, calendarId, ...(edit ? { eventId: edit.id, etag: edit.etag, scope: editScope,
        ...(editScope === "occurrence" && edit.recurrenceId ? { recurrenceId: edit.recurrenceId } : {}) } : {}), event },
        (data) => data.state === "uncertain" ? "Ergebnis unklar: Anbieter prüfen, bevor du es erneut versuchst." : "Terminänderung bestätigt.",
        () => { setEdit(null); read(calendarId); }); }}>
      <h3>{edit ? editScope === "series" ? "Gesamte Terminserie bearbeiten" : "Termin bearbeiten" : "Externen Termin anlegen"}</h3>
      {edit?.recurring && <label>Bereich <select value={editScope} onChange={(e) => { const scope = e.target.value as "series" | "occurrence";
        setEditScope(scope); setEvent((old) => ({ ...old, start: scope === "series" ? edit.masterStart : edit.event.start,
          end: scope === "series" ? edit.masterEnd : edit.event.end })); }}>
        <option value="occurrence">Nur diesen Termin</option><option value="series">Ganze Serie</option></select></label>}
      {edit?.hasExceptions && editScope === "series" && <p>Diese Serie hat Ausnahmen. Beginn und Ende der Serie bleiben bei Änderungen erhalten; einzelne Ausnahmen bleiben unverändert.</p>}
      <label>Titel <input required value={event.title} onChange={(e) => setEvent({ ...event, title: e.target.value })} /></label>
      <label><input type="checkbox" checked={event.allDay} onChange={(e) => setEvent({ ...event, allDay: e.target.checked, start: "", end: "" })} />Ganztägig</label>
      <label>Beginn <input required type={event.allDay ? "date" : "datetime-local"} value={event.start.slice(0, event.allDay ? 10 : 16)} onChange={(e) => setEvent({ ...event, start: event.allDay ? e.target.value : new Date(e.target.value).toISOString() })} /></label>
      <label>Ende (bei ganztägig exklusiv) <input required type={event.allDay ? "date" : "datetime-local"} value={event.end.slice(0, event.allDay ? 10 : 16)} onChange={(e) => setEvent({ ...event, end: event.allDay ? e.target.value : new Date(e.target.value).toISOString() })} /></label>
      <label>Beschreibung <textarea value={event.description} onChange={(e) => setEvent({ ...event, description: e.target.value })} /></label>
      <label>Ort <input value={event.location} onChange={(e) => setEvent({ ...event, location: e.target.value })} /></label>
      <label>Wiederholung (RRULE) <input placeholder="FREQ=WEEKLY;COUNT=4" value={event.rrule} onChange={(e) => setEvent({ ...event, rrule: e.target.value })} /></label>
      <button disabled={busy} type="submit">{edit ? "Änderung speichern" : "Termin anlegen"}</button>
      {edit && <button type="button" onClick={() => setEdit(null)}>Bearbeitung abbrechen</button>}
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
