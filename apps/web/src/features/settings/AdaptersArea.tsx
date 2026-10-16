"use client";

import type { AdapterConfigSettings, AdapterTestResult } from "@friday/sdk";
import { Button, EmptyState, HealthBadge, StatusChip, Switch } from "@friday/ui";
import { Plug, Save, TestTube2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
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
        version: settings.version,
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
        title={adapter.provider === "caldav-calendar" ? "Kalender: ICS oder CalDAV (nur lesen)" : adapter.provider}
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

export function AdaptersArea({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useT();
  const { readOnly, role } = useSettingsDrafts();
  const canRead = useCapability("system", "read");
  const ownerOnly = role === "owner";
  const query = useAdapterSettings(ownerOnly);
  const items = query.data?.items ?? [];
  const calendar = items.find((item) => item.category === "calendar");
  const calendarUpdate = useUpdateAdapterSettings();
  const [calendarMode, setCalendarMode] = useState<"ics" | "caldav">("ics");
  const [feedUrl, setFeedUrl] = useState("");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendarUsername, setCalendarUsername] = useState("");
  const [calendarPassword, setCalendarPassword] = useState("");
  const [calendarMessage, setCalendarMessage] = useState("");
  const selected = items.find((item) => item.adapterId === selectedId) ?? items[0];

  useEffect(() => {
    setCalendarMode(calendar?.config.mode === "caldav" ? "caldav" : "ics");
  }, [calendar?.config.mode]);

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
      setCalendarMessage("Kalenderzugang verschluesselt gespeichert. Die Verbindung ist erst nach einem erfolgreichen Test verifiziert; Friday liest Termine nur.");
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
        <p>ICS liest einen freigegebenen Feed, etwa eine private Google- oder Outlook-ICS-URL. CalDAV liest einen Kalender bei einem kompatiblen Server mit Benutzername und App-Passwort. Google Calendar und private Outlook-Konten benoetigen fuer direkten Kontozugriff OAuth und sind hier nicht per Passwort anschliessbar. Windows Kalender ist eine App, kein eigener Anbieter.</p>
        <label>Verbindungsart <select value={calendarMode} onChange={(event) => setCalendarMode(event.target.value as "ics" | "caldav")} disabled={readOnly}><option value="ics">iCalendar/ICS</option><option value="caldav">CalDAV</option></select></label>
        {calendarMode === "ics" ? <label>Private ICS-URL <input type="password" autoComplete="off" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://.../calendar.ics" disabled={readOnly} /></label> : <>
          <label>CalDAV-Kalendersammlung (HTTPS) <input type="password" autoComplete="off" value={calendarUrl} onChange={(event) => setCalendarUrl(event.target.value)} placeholder="https://.../dav/calendars/.../" disabled={readOnly} /></label>
          <label>Benutzername <input autoComplete="off" value={calendarUsername} onChange={(event) => setCalendarUsername(event.target.value)} disabled={readOnly} /></label>
          <label>Passwort oder App-Passwort <input type="password" autoComplete="new-password" value={calendarPassword} onChange={(event) => setCalendarPassword(event.target.value)} disabled={readOnly} /></label>
        </>}
        <Button type="button" disabled={readOnly || calendarUpdate.isPending || (calendarMode === "ics" ? !feedUrl.trim() : !calendarUrl.trim() || !calendarUsername.trim() || !calendarPassword)} loading={calendarUpdate.isPending} onClick={() => void saveCalendar()}>Kalenderzugang speichern</Button>
        <p role="status">{calendar.provider === "caldav-calendar" && (calendar.config.mode === "caldav" ? calendar.secretFields.calendarUrl?.configured && calendar.secretFields.username?.configured && calendar.secretFields.password?.configured : calendar.secretFields.feedUrl?.configured) ? "Zugang hinterlegt (nur lesen); Verbindung separat testen" : "Noch kein Kalenderzugang hinterlegt; Kalenderansicht verwendet Simulation."}</p>
        {calendarMessage ? <p role="status">{calendarMessage}</p> : null}
      </section> : null}
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
                  <span className="st-master__name">{item.provider === "caldav-calendar" ? "Kalender: ICS oder CalDAV (nur lesen)" : item.provider}</span>
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
