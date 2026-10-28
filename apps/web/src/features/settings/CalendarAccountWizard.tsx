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

const STEPS = [
  { id: "type", label: "Typ" },
  { id: "access", label: "Zugang" },
  { id: "discover", label: "Kalender suchen" },
  { id: "calendars", label: "Kalender & Rechte" },
  { id: "defaults", label: "Standard & Abgleich" },
  { id: "verify", label: "Prüfen & übernehmen" },
] as const;

const invoke = async (body: CalendarAccountAction) =>
  (await call(getApiClient().POST("/api/v1/integrations/calendar/accounts/actions", { body }))).data;

const emptyDraft = { displayName: "", baseUrl: "", username: "", password: "", syncMinutes: 15 };

export function CalendarAccountWizard({ onSaved }: { onSaved?: (message: string) => void } = {}) {
  const listQuery = useQuery({ queryKey: ["calendar-accounts"], queryFn: async (): Promise<List> =>
    (await call(getApiClient().GET("/api/v1/integrations/calendar/accounts"))).data as unknown as List });
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<"caldav" | "ics">("caldav");
  const [draft, setDraft] = useState(emptyDraft);
  const [account, setAccount] = useState<Account | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [defaultCalendarId, setDefaultCalendarId] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null);

  const current = account ?? null;
  const calendars = current?.calendars ?? [];
  const chosen = calendars.filter((calendar) => selected.includes(calendar.id));
  const writable = chosen.filter((calendar) => calendar.canWrite);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stepId = STEPS[step]?.id ?? STEPS[0].id;
  const stepLabel = STEPS[step]?.label ?? STEPS[0].label;
  const networkZones = ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich"];

  const run = async (body: CalendarAccountAction, ok: string | ((data: Record<string, unknown>) => string), after?: (data: Record<string, unknown>) => void) => {
    setBusy(true); setMessage("");
    try {
      const data = await invoke(body);
      after?.(data as Record<string, unknown>);
      await listQuery.refetch();
      setMessage(typeof ok === "string" ? ok : ok(data as Record<string, unknown>));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kalenderaktion fehlgeschlagen.");
      return false;
    } finally { setBusy(false); }
  };

  const reset = () => {
    setStep(0); setKind("caldav"); setDraft(emptyDraft); setAccount(null);
    setSelected([]); setDefaultCalendarId(""); setMakeDefault(false); setProbe(null); setMessage("");
  };

  const discard = async () => {
    if (!account) { reset(); setMessage("Einrichtung verworfen. Es wurde nichts gespeichert."); return; }
    const removed = await run({ action: "delete", accountId: account.id, expectedRevision: account.revision },
      "Einrichtungsentwurf entfernt. Nichts wurde aktiviert.",
      () => { setAccount(null); setSelected([]); setDefaultCalendarId(""); });
    if (removed) { reset(); setMessage("Einrichtungsentwurf entfernt. Nichts wurde aktiviert."); }
  };

  const saveAccess = async () => {
    const url = draft.baseUrl.trim();
    if (!draft.displayName.trim() || !url) { setMessage("Name und Adresse sind erforderlich."); return; }
    if (kind === "caldav" && !draft.username.trim()) { setMessage("Benutzername ist für CalDAV erforderlich."); return; }
    await run({ action: "upsert", account: { kind, displayName: draft.displayName.trim(), baseUrl: url,
      username: kind === "caldav" ? draft.username.trim() : "", syncMinutes: draft.syncMinutes },
      ...(draft.password ? { password: draft.password } : {}) }, "Zugang gespeichert. Verbindung wird noch nicht geprüft.",
      (data) => { setAccount(data as unknown as Account); setDraft((old) => ({ ...old, password: "" })); setStep(kind === "ics" ? 4 : 2); });
  };

  const search = async () => {
    if (!current) return;
    await run({ action: "discover", accountId: current.id, expectedRevision: current.revision },
      (data) => {
        const found = ((data.calendars as Collection[]) ?? []);
        setSelected((old) => old.length > 0 ? old : found.filter((calendar) => calendar.canRead).map((calendar) => calendar.id));
        return `${found.length} Kalender gefunden. Schreibrechte stehen an jedem Eintrag.`;
      },
      (data) => {
        setAccount(data as unknown as Account);
        const found = ((data.calendars as Collection[]) ?? []);
        const next = found.find((calendar) => calendar.id === defaultCalendarId) ??
          found.find((calendar) => calendar.canWrite);
        if (next) setDefaultCalendarId(next.id);
        setStep(3);
      });
  };

  const apply = async () => {
    if (!current) return;
    const target = writable.find((calendar) => calendar.id === defaultCalendarId) ?? writable[0];
    const done = await run({ action: "select", accountId: current.id, selectedIds: selected,
      defaultCalendarId: target?.id ?? null, expectedRevision: current.revision },
      (data) => {
        setAccount(data as unknown as Account);
        return `Übernommen: ${selected.length} Kalender ausgewählt, Schreibstandard ${target ? "gesetzt" : "keiner (nur lesen)"}.`;
      });
    if (!done) return;
    if (makeDefault) await run({ action: "default", accountId: current.id, expectedRevision: current.revision + 1 },
      "Als Standardkonto gesetzt.");
    const syncChanged = current.syncMinutes !== draft.syncMinutes;
    if (syncChanged) {
      await run({ action: "upsert", account: { id: current.id, kind: current.kind, displayName: current.displayName,
        baseUrl: current.baseUrl, username: current.username, syncMinutes: draft.syncMinutes },
        expectedRevision: current.revision + (makeDefault ? 2 : 1) }, "Abgleichintervall gespeichert.");
    }
    onSaved?.("Kalenderkonto eingerichtet. Termine erscheinen nach dem nächsten Abgleich.");
    setMessage(`Kalenderkonto eingerichtet: ${selected.length} Kalender übernommen, Schreibziel ${target ? target.name : "keines"}. Ein Schreibtest verändert erst auf ausdrücklichen Klick etwas.`);
  };

  const field = (id: string, label: string, value: string, onChange: (value: string) => void, options: { type?: string; hint?: string; required?: boolean } = {}) =>
    <div key={id} className="st-wizard__field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={options.type ?? "text"} value={value} autoComplete="off" required={options.required}
        aria-describedby={options.hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)} disabled={busy} />
      {options.hint ? <span id={`${id}-hint`} className="mk-note">{options.hint}</span> : null}
    </div>;

  return <section aria-label="Kalenderkonto einrichten" className="st-wizard">
    <h3>Kalender verbinden</h3>
    <p>Der Assistent speichert den Zugang erst nach der Anmeldung. Ein Kalender wird nur schreibend genutzt, wenn du das ausdrücklich übernimmst.</p>
    <button type="button" disabled={busy} onClick={() => void discard()}>Einrichtung verwerfen</button>
    <ol className="st-wizard__steps">
      {STEPS.map((entry, index) => <li key={entry.id} aria-current={index === step ? "step" : undefined}>
        <span>{index + 1}. {entry.label}</span>
      </li>)}
    </ol>

    <fieldset>
      <legend>Schritt {step + 1} von {STEPS.length}: {stepLabel}</legend>

      {stepId === "type" && <>
        <label>Typ
          <select value={kind} onChange={(event) => { setKind(event.target.value as "caldav" | "ics"); setDraft(emptyDraft); }} disabled={busy}>
            <option value="caldav">CalDAV (lesen und schreiben)</option>
            <option value="ics">ICS-Feed (nur lesen)</option>
          </select>
        </label>
        <p className="mk-note">{kind === "caldav" ? "CalDAV entdeckt Kalender und Rechte über die Kalendersammlung."
          : "Ein ICS-Feed wird ausschließlich gelesen. Friday kann darin keine Termine ändern; der Schreibtest bleibt gesperrt."}</p>
      </>}

      {stepId === "access" && <>
        {field("calendar-wizard-name", "Kontoname", draft.displayName, (value) => setDraft({ ...draft, displayName: value }), { required: true })}
        {field("calendar-wizard-url", kind === "ics" ? "Private HTTPS-ICS-URL" : "CalDAV-HTTPS-Adresse (Sammlung)",
          draft.baseUrl, (value) => setDraft({ ...draft, baseUrl: value }), { type: "url", required: true })}
        {kind === "caldav" && <>
          {field("calendar-wizard-user", "Benutzername", draft.username, (value) => setDraft({ ...draft, username: value }), { required: true })}
          {field("calendar-wizard-password", "Passwort oder App-Passwort", draft.password,
            (value) => setDraft({ ...draft, password: value }), { type: "password", hint: "Wird verschlüsselt gespeichert und nie zurückgegeben." })}
        </>}
      </>}

      {stepId === "discover" && <>
        {kind === "ics"
          ? <p role="status">Der ICS-Feed ist gespeichert. Friday liest ihn nur; es gibt keine Kalenderauswahl und keinen Schreibtest.</p>
          : <>
            <p>Die Kalendersammlung wird nach Principal und Home-Set durchsucht. Bisherige Kalenderauswahl bleibt erhalten.</p>
          </>}
      </>}

      {stepId === "calendars" && <>
        {calendars.length === 0 ? <p role="alert">Noch keine Kalender gefunden. Bitte zuerst suchen.</p>
          : <ul>{calendars.map((calendar) => <li key={calendar.id}>
            <label>
              <input type="checkbox" checked={selected.includes(calendar.id)} disabled={busy || !calendar.canRead}
                onChange={(event) => setSelected((old) => event.target.checked
                  ? [...old, calendar.id] : old.filter((id) => id !== calendar.id))} />
              {calendar.name}
            </label>
            <span className="mk-note"> {calendar.canRead ? "lesbar" : "nicht lesbar"} · {calendar.canWrite ? "schreibbar" : "nur lesen"}
              {calendar.timeZone ? ` · ${calendar.timeZone}` : ""}</span>
          </li>)}</ul>}
      </>}

      {stepId === "defaults" && <>
        <label>Standardkalender (Schreibziel)
          <select value={defaultCalendarId} onChange={(event) => setDefaultCalendarId(event.target.value)} disabled={busy}>
            <option value="">Kein Schreibziel (nur lesen)</option>
            {writable.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
          </select>
        </label>
        <label>Abgleichintervall (Minuten)
          <input type="number" min={1} max={1440} value={draft.syncMinutes} disabled={busy}
            onChange={(event) => setDraft({ ...draft, syncMinutes: Number(event.target.value) })} />
        </label>
        <p className="mk-note">Zeitzone dieses Rechners: {timeZone}. Termine werden mit ihrer eigenen Zeitzone gespeichert;
          {networkZones.includes(timeZone) ? " Sommerzeit wird beim Abgleich berücksichtigt." : " eine Abweichung zur Anbieterzeitzone zeigt der Termin selbst."}</p>
        <label><input type="checkbox" checked={makeDefault} disabled={busy}
          onChange={(event) => setMakeDefault(event.target.checked)} /> Als Standardkonto für neue Termine verwenden</label>
      </>}

      {stepId === "verify" && <>
        <ul>
          <li>Konto: {current?.displayName ?? draft.displayName} ({kind})</li>
          <li>Ausgewählt: {chosen.map((calendar) => calendar.name).join(", ") || "keine"}</li>
          <li>Schreibziel: {writable.find((calendar) => calendar.id === defaultCalendarId)?.name ?? "keines"}</li>
          <li>Abgleich: alle {draft.syncMinutes} Minuten · Zeitzone {timeZone}</li>
        </ul>
        {kind === "ics" ? <p>ICS: nur lesen. Ein Schreibtest ist nicht möglich und wird nicht angeboten.</p>
          : <div>
            <button type="button" disabled={busy || writable.length === 0}
              onClick={() => void (async () => {
                const target = writable.find((calendar) => calendar.id === defaultCalendarId) ?? writable[0];
                if (!current || !target) return;
                setProbe({ ok: false, text: "Schreibtest läuft …" });
                const ok = await run({ action: "write-test", accountId: current.id, calendarId: target.id },
                  "Testtermin angelegt, zurückgelesen und wieder entfernt.",
                  (data) => setProbe({ ok: true, text: `Schreibtest bestätigt (UID ${String(data.uid)}), danach aufgeräumt.` }));
                if (!ok) setProbe({ ok: false, text: "Schreibtest nicht bestätigt. Es wurde nichts dauerhaft geändert." });
              })()}>Schreibtest im Testkalender ausführen</button>
            <p className="mk-note">Nur auf ausdrücklichen Klick: ein eindeutig benannter Testtermin, Rückleseprüfung und sofortiges Entfernen. Keine bestehenden Termine werden angefasst.</p>
            {probe ? <p role={probe.ok ? "status" : "alert"}>{probe.text}</p> : null}
          </div>}
      </>}

      <div className="st-wizard__actions">
        {step > 0 && <button type="button" disabled={busy} onClick={() => setStep(step - 1)}>Zurück</button>}
        {step === 1 && <button type="button" disabled={busy} onClick={() => void saveAccess()}>Zugang speichern</button>}
        {step === 2 && kind === "caldav" && <button type="button" disabled={busy} onClick={() => void search()}>Kalender suchen</button>}
        {step < STEPS.length - 1 &&
          <button type="button" disabled={busy || (step === 2 && kind === "caldav" && calendars.length === 0) || (step === 3 && selected.length === 0)}
            onClick={() => setStep(step + 1)}>Weiter</button>}
        {step === STEPS.length - 1 && <button type="button" disabled={busy || !current} onClick={() => void apply()}>Kalender übernehmen</button>}
      </div>
    </fieldset>

    {message ? <p role="status">{message}</p> : null}
  </section>;
}