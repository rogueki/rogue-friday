"use client";

import type { AdapterCategory, AdapterConfigSettings, AdapterTestResult } from "@friday/sdk";
import { Button, EmptyState, HealthBadge, StatusChip, Switch } from "@friday/ui";
import { Plug, Save, TestTube2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { useMeta } from "@/lib/api/domains/core";
import { useAdapterSettings, useTestAdapterSettings, useUpdateAdapterSettings } from "@/lib/api/domains/settings";
import { useCapability } from "@/lib/capabilities";
import { PanelFrame, type PanelState } from "@/components/PanelFrame";
import { Section } from "./controls";
import { SchemaForm } from "./SchemaForm";
import { asFieldSchema, jsonEqual, secretPropertyNames, stripSecrets, validateConfig } from "./schemaLogic";
import { useSettingsDrafts } from "./SettingsDrafts";

function AdapterForm({ adapter }: { adapter: AdapterConfigSettings }) {
  const { t, locale } = useT();
  const { settings, readOnly, setExternalDirty } = useSettingsDrafts();
  const update = useUpdateAdapterSettings();
  const test = useTestAdapterSettings();
  const schema = useMemo(() => asFieldSchema(adapter.configSchema), [adapter.configSchema]);
  const secretNames = useMemo(() => new Set(secretPropertyNames(schema, Object.keys(adapter.secretFields))), [schema, adapter.secretFields]);
  const serverConfig = useMemo(() => stripSecrets(adapter.config, schema, secretNames), [adapter.config, schema, secretNames]);

  const [enabled, setEnabled] = useState(adapter.enabled);
  const [config, setConfig] = useState<Record<string, unknown>>(serverConfig);
  const [secretInput, setSecretInput] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AdapterTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pendingSecrets = Object.entries(secretInput).filter(([, value]) => value !== "");
  const dirty = enabled !== adapter.enabled || !jsonEqual(config, serverConfig) || pendingSecrets.length > 0;
  const errors = useMemo(() => validateConfig(schema, config, secretNames), [schema, config, secretNames]);
  const canSave = dirty && !readOnly && errors.length === 0 && !update.isPending && Boolean(settings);

  // The adapter entry is reloaded after a save (and by realtime/other tabs): take it over while nothing is being edited.
  useEffect(() => {
    if (!dirty) {
      setEnabled(adapter.enabled);
      setConfig(serverConfig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to server changes
  }, [adapter.enabled, serverConfig]);

  useEffect(() => {
    setExternalDirty(`adapter:${adapter.adapterId}`, dirty);
    return () => setExternalDirty(`adapter:${adapter.adapterId}`, false);
  }, [adapter.adapterId, dirty, setExternalDirty]);

  const reset = (): void => {
    setEnabled(adapter.enabled);
    setConfig(serverConfig);
    setSecretInput({});
    setSaveError(null);
  };

  const save = async (): Promise<void> => {
    if (!settings) return;
    setSaveError(null);
    try {
      await update.mutateAsync({
        id: adapter.adapterId,
        // Each adapter carries its own optimistic-concurrency token. Sending the settings version made the
        // save fail with 409 as soon as the two counters diverged (for example after another adapter change).
        version: adapter.version ?? 1,
        patch: {
          enabled,
          config: stripSecrets(config, schema, secretNames),
          ...(pendingSecrets.length > 0 ? { secrets: Object.fromEntries(pendingSecrets) } : {}),
        },
      });
      // Write-only values leave the browser state as soon as they are sent.
      setSecretInput({});
      setResult(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("settings.save.failed"));
    }
  };

  const runTest = async (): Promise<void> => {
    setTestError(null);
    try {
      const response = await test.mutateAsync({ id: adapter.adapterId });
      setResult(response.data);
    } catch (error) {
      setResult(null);
      setTestError(error instanceof Error ? error.message : t("settings.adapters.testFailed"));
    }
  };

  const lastTest = result ?? null;
  const fmt = (iso: string): string => new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));

  return (
    <div className="st-adapter" data-adapter-form={adapter.adapterId}>
      <Section
        title={adapter.provider === "caldav-calendar" ? "Kalender: ICS lesen oder CalDAV anlegen" : adapter.provider}
        description={t("settings.adapters.formDesc", { category: adapter.category })}
        actions={<Switch label={t("settings.adapters.enabled")} checked={enabled} disabled={readOnly} onCheckedChange={setEnabled} stateLabels={[t("settings.state.on"), t("settings.state.off")]} />}
      >
        <SchemaForm
          schema={schema}
          value={config}
          onChange={setConfig}
          secretStatus={adapter.secretFields}
          secretInput={secretInput}
          onSecretChange={(name, value) => setSecretInput((current) => ({ ...current, [name]: value }))}
          errors={errors}
          disabled={readOnly}
          idPrefix={adapter.adapterId}
        />
      </Section>

      <Section title={t("settings.adapters.test.title")} description={t("settings.adapters.test.desc")}>
        <div className="st-row">
          <Button type="button" variant="ghost" icon={<TestTube2 size={15} />} loading={test.isPending} disabled={readOnly || dirty} onClick={() => void runTest()}>
            {t("settings.adapters.test.button")}
          </Button>
          {dirty ? <span className="st-muted">{t("settings.adapters.test.saveFirst")}</span> : null}
          {lastTest ? (
            <span className="st-test" role="status">
              <StatusChip tone={lastTest.success ? "green" : "red"}>{lastTest.success ? t("settings.adapters.test.ok") : t("settings.adapters.test.fail")}</StatusChip>
              <span>{lastTest.message}</span>
              {lastTest.latencyMs !== null ? <span className="st-mono">{lastTest.latencyMs} ms</span> : null}
            </span>
          ) : adapter.lastTestAt ? (
            <span className="st-muted" role="status">
              {t("settings.adapters.test.last", { time: fmt(adapter.lastTestAt), result: adapter.lastTestResult === "success" ? t("settings.adapters.test.ok") : t("settings.adapters.test.fail") })}
            </span>
          ) : null}
        </div>
        {testError ? <p className="st-error" role="alert">{testError}</p> : null}
      </Section>

      {saveError ? <p className="st-error" role="alert">{saveError}</p> : null}
      <div className="st-actions">
        {dirty ? <StatusChip tone="amber" pulse>{t("settings.unsaved")}</StatusChip> : null}
        <Button type="button" variant="ghost" icon={<Undo2 size={15} />} disabled={!dirty || update.isPending} onClick={reset}>
          {t("settings.discard")}
        </Button>
        <Button type="button" icon={<Save size={15} />} loading={update.isPending} disabled={!canSave} onClick={() => void save()}>
          {t("settings.adapters.save")}
        </Button>
      </div>
    </div>
  );
}

const ALL_CATEGORIES: readonly AdapterCategory[] = [
  "tasks", "activity", "memory", "agents", "approvals", "communication", "calendar", "automations",
  "research", "files", "voice", "notifications", "system", "audit", "commands",
];

const CATEGORY_LABEL: Record<AdapterCategory, string> = {
  tasks: "Aufgaben",
  activity: "Aktivität",
  memory: "Gedächtnis",
  agents: "Agenten",
  approvals: "Freigaben",
  communication: "Kommunikation",
  calendar: "Kalender",
  automations: "Automatisierungen",
  research: "Recherche",
  files: "Dateien",
  voice: "Stimme",
  notifications: "Benachrichtigungen",
  system: "System",
  audit: "Audit",
  commands: "Befehle",
};

export function AdaptersArea({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useT();
  const { readOnly, role } = useSettingsDrafts();
  const canRead = useCapability("system", "read");
  const ownerOnly = role === "owner";
  const query = useAdapterSettings(ownerOnly);
  const items = query.data?.items ?? [];
  const dataMode = useMeta().data?.dataMode;
  const live = dataMode === "live";
  // A live runtime builds no adapter for an unconfigured category: the pages then report "not configured"
  // instead of showing sample data. Everything else here would repeat the old hybrid promise of simulation.
  const unconfigured = useMemo(
    () => (live ? ALL_CATEGORIES.filter((category) => !items.some((item) => item.category === category)) : []),
    [live, items],
  );
  const calendar = items.find((item) => item.category === "calendar");
  const calendarUpdate = useUpdateAdapterSettings();
  const [calendarSource, setCalendarSource] = useState<"google" | "outlook" | "windows" | "ics" | "caldav">("ics");
  const [calendarMode, setCalendarMode] = useState<"ics" | "caldav">("ics");
  const [feedUrl, setFeedUrl] = useState("");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendarUsername, setCalendarUsername] = useState("");
  const [calendarPassword, setCalendarPassword] = useState("");
  const [calendarMessage, setCalendarMessage] = useState("");
  const selected = items.find((item) => item.adapterId === selectedId) ?? items[0];

  useEffect(() => {
    const mode = calendar?.config.mode === "caldav" ? "caldav" : "ics";
    setCalendarMode(mode);
    setCalendarSource(mode);
  }, [calendar?.config.mode]);

  const chooseCalendarSource = (source: typeof calendarSource): void => {
    setCalendarSource(source);
    setCalendarMode(source === "caldav" ? "caldav" : "ics");
    setCalendarMessage("");
  };

  const saveCalendar = async (): Promise<void> => {
    if (!calendar || calendarMode === "ics" && !feedUrl.trim() || calendarMode === "caldav" && (!calendarUrl.trim() || !calendarUsername.trim() || !calendarPassword)) return;
    setCalendarMessage("");
    try {
      const response = await calendarUpdate.mutateAsync({ id: calendar.adapterId, version: calendar.version ?? 1, patch: {
        provider: "caldav-calendar", enabled: true, config: { mode: calendarMode },
        secrets: calendarMode === "ics" ? { feedUrl: feedUrl.trim() } : { calendarUrl: calendarUrl.trim(), username: calendarUsername.trim(), password: calendarPassword },
      } });
      setFeedUrl("");
      setCalendarUrl("");
      setCalendarUsername("");
      setCalendarPassword("");
      onSelect(response.data.adapterId);
      setCalendarMessage(calendarMode === "caldav"
        ? "CalDAV-Zugang verschluesselt gespeichert. Verbindung separat testen. Friday kann nach ausdruecklicher Bestaetigung Termine anlegen, sofern der Anbieter Schreibzugriff erlaubt."
        : "ICS-Zugang verschluesselt gespeichert. Verbindung separat testen. Friday liest diesen Kalender nur.");
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : "Kalender-Feed konnte nicht gespeichert werden.");
    }
  };

  if (!ownerOnly) {
    return <EmptyState icon={<Plug size={22} />} title={t("settings.adapters.ownerOnly.title")} description={t("settings.adapters.ownerOnly.desc")} />;
  }

  let state: PanelState;
  if (query.isPending) state = { kind: "loading" };
  else if (query.isError) state = { kind: "error", error: query.error, onRetry: () => void query.refetch(), retrying: query.isFetching };
  else if (items.length === 0) state = { kind: "empty", title: t("settings.adapters.empty.title"), description: t("settings.adapters.empty.desc") };
  else state = { kind: "ready", freshness: query.data?.freshness, onRefresh: () => void query.refetch() };

  return (
    <PanelFrame state={state} title={t("settings.adapters.title")} subtitle={t("settings.adapters.subtitle")} icon={<Plug size={16} />} skeletonRows={4} className="st-panel">
      {!canRead ? <p className="st-muted">{t("settings.adapters.noCapability")}</p> : null}
      {calendar ? <section aria-labelledby="calendar-setup-title" className="st-adapter">
        <h3 id="calendar-setup-title">Kalender verbinden</h3>
        <p>Wähle, wo dein Kalender liegt. Die Auswahl zeigt nur die passende Anleitung; verbunden wird erst über die ICS- oder CalDAV-Daten und den anschließenden Verbindungstest.</p>
        <label>Anbieterhilfe für Kalender <select value={calendarSource} onChange={(event) => chooseCalendarSource(event.target.value as typeof calendarSource)} disabled={readOnly}>
          <option value="google">Google Kalender</option><option value="outlook">Outlook.com</option><option value="windows">Windows Kalender</option><option value="ics">Anderer ICS-Kalender</option><option value="caldav">CalDAV-Anbieter</option>
        </select></label>
        <p id="calendar-provider-guidance" className="st-muted">
          {calendarSource === "google" ? "In Google Kalender: Einstellungen → betreffenden Kalender wählen → Kalender integrieren → Geheimadresse im iCal-Format kopieren. Nur lesen; Google-CalDAV per Passwort wird hier nicht unterstützt." : null}
          {calendarSource === "outlook" ? "Falls dein Outlook.com-Konto einen HTTPS-ICS-Link bereitstellt, füge ihn hier ein. Prüfe die Freigabe des Links: Ein veröffentlichter Kalender kann für Personen mit dem Link lesbar sein. Direktes Microsoft-Login und Graph-Schreibzugriff sind hier nicht verfügbar." : null}
          {calendarSource === "windows" ? "Windows Kalender ist eine App, kein eigener Kalenderanbieter. Ermittle das dahinterliegende Konto (zum Beispiel Google oder Outlook) und nutze dessen HTTPS-ICS-Link. Lokale Kalender ohne solchen Link lassen sich hier nicht verbinden." : null}
          {calendarSource === "ics" ? "Kopiere den privaten HTTPS-ICS-Link deines Anbieters. Friday liest Termine daraus, kann sie aber nicht ändern oder anlegen." : null}
          {calendarSource === "caldav" ? "Trage die HTTPS-Adresse der Kalendersammlung (mit / am Ende), den Benutzernamen und ein geeignetes Passwort oder App-Passwort ein. Ob Lesen und Schreiben möglich sind, hängt vom Anbieter ab. Google und Outlook.com benötigen für direkten Kontozugriff OAuth; dafür gibt es hier keinen Passwort-Login." : null}
        </p>
        {calendarMode === "ics" ? <label>Private ICS-URL <input type="password" autoComplete="off" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://.../calendar.ics" disabled={readOnly} /></label> : <>
          <label>CalDAV-Kalendersammlung (HTTPS) <input type="password" autoComplete="off" value={calendarUrl} onChange={(event) => setCalendarUrl(event.target.value)} placeholder="https://.../dav/calendars/.../" disabled={readOnly} /></label>
          <label>Benutzername <input autoComplete="off" value={calendarUsername} onChange={(event) => setCalendarUsername(event.target.value)} disabled={readOnly} /></label>
          <label>Passwort oder App-Passwort <input type="password" autoComplete="new-password" value={calendarPassword} onChange={(event) => setCalendarPassword(event.target.value)} disabled={readOnly} /></label>
        </>}
        <Button type="button" disabled={readOnly || calendarUpdate.isPending || (calendarMode === "ics" ? !feedUrl.trim() : !calendarUrl.trim() || !calendarUsername.trim() || !calendarPassword)} loading={calendarUpdate.isPending} onClick={() => void saveCalendar()}>Kalenderzugang speichern</Button>
        <p className="st-muted">Nach dem Speichern den Kalender in der Adapterliste wählen und „Verbindung testen“ ausführen. Erst ein erfolgreicher Test bestätigt den Zugriff.</p>
        <p role="status">{calendar.provider === "caldav-calendar" && (calendar.config.mode === "caldav" ? calendar.secretFields.calendarUrl?.configured && calendar.secretFields.username?.configured && calendar.secretFields.password?.configured : calendar.secretFields.feedUrl?.configured) ? (calendar.config.mode === "caldav" ? "CalDAV-Zugang hinterlegt; Lesen und Terminanlage hängen vom Anbieterzugriff ab. Verbindung separat testen." : "ICS-Zugang hinterlegt (nur lesen); Verbindung separat testen.") : live ? "Noch kein Kalenderzugang hinterlegt. Im Live-Betrieb bleibt die Kalenderansicht leer, bis ein Zugang hinterlegt und erfolgreich getestet ist." : dataMode ? "Noch kein Kalenderzugang hinterlegt; die Kalenderansicht verwendet Simulation." : ""}</p>
        {calendarMessage ? <p role="status">{calendarMessage}</p> : null}
      </section> : null}
      {unconfigured.length > 0 ? (
        <section aria-labelledby="unconfigured-title" className="st-adapter">
          <h3 id="unconfigured-title">Nicht eingerichtete Bereiche</h3>
          <p className="st-muted">
            Für diese Bereiche ist kein Anbieter hinterlegt. Friday erzeugt dafür keinen Ersatzadapter; die jeweilige Seite meldet
            „nicht eingerichtet“, statt Beispieldaten zu zeigen. Trage den Anbieter in <code>adapters.yaml</code> ein und starte das
            Dashboard neu.
          </p>
          <ul className="st-chiplist">
            {unconfigured.map((category) => (
              <li key={category}>
                <StatusChip tone="muted" dot={false}>
                  {CATEGORY_LABEL[category]} · nicht eingerichtet
                </StatusChip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="st-master">
        <nav className="st-master__list" aria-label={t("settings.adapters.title")}>
          <ul>
            {items.map((item) => (
              <li key={item.adapterId}>
                <button
                  type="button"
                  className="st-master__item"
                  aria-current={selected?.adapterId === item.adapterId ? "true" : undefined}
                  onClick={() => onSelect(item.adapterId)}
                >
                  <span className="st-master__name">{item.provider === "caldav-calendar" ? "Kalender: ICS lesen oder CalDAV anlegen" : item.provider}</span>
                  <span className="st-master__meta">
                    {item.category}
                    {(item.provider === "caldav-calendar"
                      ? (item.config.mode === "caldav" ? ["calendarUrl", "username", "password"] : ["feedUrl"]).some((field) => !item.secretFields[field]?.configured)
                      : Object.values(item.secretFields).some((secret) => !secret.configured))
                      ? <StatusChip tone="amber" dot={false}>{t("settings.adapters.secretMissing")}</StatusChip> : null}
                  </span>
                  <HealthBadge state={item.enabled ? "ok" : "unknown"} labels={{ ok: t("settings.adapters.active"), unknown: t("settings.adapters.inactive") }} />
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="st-master__detail">
          {selected ? <AdapterForm key={selected.adapterId} adapter={selected} /> : null}
          {readOnly ? <p className="st-muted">{t("settings.readOnly")}</p> : null}
        </div>
      </div>
    </PanelFrame>
  );
}
