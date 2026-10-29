"use client";

import type { DataRetentionActionResponse, Settings } from "@friday/sdk";
import { Button, ConfirmDialog, Select, Slider, StatusChip, Switch, TextField } from "@friday/ui";
import { LogOut, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { useHermesModelCatalog, useLogoutAll, useLayouts, useSettings } from "@/lib/api/domains/settings";
import { useMeta } from "@/lib/api/domains/core";
import { useVoiceDevices, useVoiceIntegrationStatus } from "@/lib/api/domains/voice";
import { useSession } from "@/lib/session";
import { useSystemBackupAction, useSystemBackupStatus } from "@/lib/api/domains/system-backups";
import { useDataRetentionAction, useDataRetentionStatus } from "@/lib/api/domains/data-retention";
import { FieldGrid, NumberField, Section, StringListEditor } from "./controls";
import { useAreaDraft } from "./SettingsDrafts";
import { NAV_PAGES } from "@/features/shell/navModel";
import { DEFAULT_ASSISTANT_NAME } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { WakeEnrollment } from "./WakeEnrollment";
import { SttModelsControl } from "./SttModelsControl";
import { voiceDeviceOptions } from "./voiceDeviceOptions";

const onOff = (t: (key: MessageKey) => string): readonly [string, string] => [t("settings.state.on"), t("settings.state.off")];

/* ── Profile ──────────────────────────────────────────────────────────── */

export function ProfileArea() {
  const { t } = useT();
  const { value, update, set, readOnly } = useAreaDraft("profile");
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      return [];
    }
  }, []);
  if (!value) return null;
  const preview = value.assistantName?.trim() || DEFAULT_ASSISTANT_NAME;

  return (
    <>
      <Section title={t("settings.profile.identity")} description={t("settings.profile.identityDesc")}>
        <FieldGrid>
          <TextField label={t("settings.profile.displayName")} value={value.displayName} disabled={readOnly} onChange={(event) => update({ displayName: event.target.value })} />
          <TextField
            label={t("settings.profile.assistantName")}
            value={value.assistantName ?? ""}
            maxLength={40}
            placeholder={DEFAULT_ASSISTANT_NAME}
            hint={t("settings.profile.assistantNameHint", { default: DEFAULT_ASSISTANT_NAME })}
            disabled={readOnly}
            onChange={(event) => {
              // The field is optional in the contract: an empty input removes it (clients fall back to the default name).
              const next = event.target.value;
              if (next === "") {
                const { assistantName: _removed, ...rest } = value;
                set(rest);
              } else update({ assistantName: next });
            }}
          />
        </FieldGrid>
        <p className="st-brandpreview" aria-live="polite">
          <span className="st-muted">{t("settings.profile.preview")}</span> <strong className="st-brandpreview__name">{preview}</strong>
          <span className="st-muted"> · {t("settings.profile.previewHint")}</span>
        </p>
      </Section>
      <Section title={t("settings.profile.region")}>
        <FieldGrid>
          <Select
            label={t("settings.profile.locale")}
            value={value.locale}
            disabled={readOnly}
            options={[
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
            onChange={(event) => update({ locale: event.target.value as Settings["profile"]["locale"] })}
          />
          <div>
            <TextField label={t("settings.profile.timeZone")} list="st-timezones" value={value.timeZone} disabled={readOnly} onChange={(event) => update({ timeZone: event.target.value })} />
            <datalist id="st-timezones">
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </div>
          <Select
            label={t("settings.profile.dateFormat")}
            value={value.dateFormat}
            disabled={readOnly}
            options={[
              { value: "dd.MM.yyyy", label: "TT.MM.JJJJ (31.12.2026)" },
              { value: "yyyy-MM-dd", label: "JJJJ-MM-TT (2026-12-31)" },
              { value: "MM/dd/yyyy", label: "MM/TT/JJJJ (12/31/2026)" },
            ]}
            onChange={(event) => update({ dateFormat: event.target.value as Settings["profile"]["dateFormat"] })}
          />
          <Select
            label={t("settings.profile.timeFormat")}
            value={value.timeFormat}
            disabled={readOnly}
            options={[
              { value: "24h", label: t("settings.profile.time24") },
              { value: "12h", label: t("settings.profile.time12") },
            ]}
            onChange={(event) => update({ timeFormat: event.target.value as Settings["profile"]["timeFormat"] })}
          />
          <Select
            label={t("settings.profile.firstDay")}
            value={value.firstDayOfWeek}
            disabled={readOnly}
            options={[
              { value: "monday", label: t("settings.profile.monday") },
              { value: "sunday", label: t("settings.profile.sunday") },
            ]}
            onChange={(event) => update({ firstDayOfWeek: event.target.value as Settings["profile"]["firstDayOfWeek"] })}
          />
        </FieldGrid>
      </Section>
    </>
  );
}

/* ── Dashboard ────────────────────────────────────────────────────────── */

export function DashboardArea() {
  const { t } = useT();
  const { value, update, readOnly } = useAreaDraft("dashboard");
  const nav = useAreaDraft("navigation");
  const layouts = useLayouts();
  if (!value || !nav.value) return null;
  const layoutOptions = (layouts.data?.items ?? []).map((layout) => ({ value: layout.layoutId, label: layout.name ?? layout.layoutId }));
  if (!layoutOptions.some((option) => option.value === value.activeLayoutId)) layoutOptions.unshift({ value: value.activeLayoutId, label: value.activeLayoutId });

  return (
    <>
      <Section title={t("settings.dashboard.display")} description={t("settings.dashboard.displayDesc")}>
        <FieldGrid>
          <Slider
            label={t("settings.dashboard.fontScale")}
            min={0.8}
            max={1.4}
            step={0.05}
            value={value.fontScale}
            disabled={readOnly}
            formatValue={(v) => `${Math.round(v * 100)} %`}
            onValueChange={(fontScale) => update({ fontScale })}
          />
          <Select
            label={t("settings.dashboard.layout")}
            value={value.activeLayoutId}
            disabled={readOnly}
            hint={t("settings.dashboard.layoutHint")}
            options={layoutOptions}
            onChange={(event) => update({ activeLayoutId: event.target.value })}
          />
          <Switch label={t("settings.dashboard.grid")} description={t("settings.dashboard.gridDesc")} checked={value.backgroundGrid} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(backgroundGrid) => update({ backgroundGrid })} />
          <Switch label={t("settings.dashboard.compact")} description={t("settings.dashboard.compactDesc")} checked={value.compact} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(compact) => update({ compact })} />
          <Switch label={t("settings.dashboard.sound")} description={t("settings.dashboard.soundDesc")} checked={value.soundEffects} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(soundEffects) => update({ soundEffects })} />
          <Switch label={t("settings.dashboard.contentStudio")} description={t("settings.dashboard.contentStudioDesc")} checked={value.contentStudioEnabled === true} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(contentStudioEnabled) => update({ contentStudioEnabled })} />
        </FieldGrid>
      </Section>
      <Section title={t("settings.dashboard.behaviour")}>
        <FieldGrid>
          <NumberField
            label={t("settings.dashboard.refresh")}
            hint={t("settings.dashboard.refreshHint")}
            integer
            min={5}
            max={3600}
            value={value.autoRefreshSeconds}
            disabled={readOnly}
            onValueChange={(next) => next !== null && update({ autoRefreshSeconds: Math.round(next) })}
          />
          <Select
            label={t("settings.dashboard.defaultPage")}
            hint={t("settings.dashboard.defaultPageHint")}
            value={nav.value.defaultPage}
            disabled={readOnly}
            options={NAV_PAGES.filter((page) => page.id !== "content-studio" || value.contentStudioEnabled === true).map((page) => ({ value: page.id, label: t(page.labelKey) }))}
            onChange={(event) => nav.update({ defaultPage: event.target.value })}
          />
        </FieldGrid>
      </Section>
    </>
  );
}

/* ── Models & routing ─────────────────────────────────────────────────── */

export function ModelsRoutingArea() {
  const { t } = useT();
  const { value, update, readOnly } = useAreaDraft("modelsRouting");
  const taskKinds = ["voice-routine", "voice-complex", "voice-critical", "agent-task"];
  const agentRoute = value?.routes.find((route) => route.taskKind === "agent-task");
  const agentProvider = agentRoute?.model.split(":", 1)[0] ?? "";
  const catalog = useHermesModelCatalog(agentProvider, !!agentRoute && !!agentProvider);
  if (!value) return null;
  const nextTaskKind = taskKinds.find((kind) => !value.routes.some((route) => route.taskKind === kind));
  const setRoute = (index: number, patch: Partial<Settings["modelsRouting"]["routes"][number]>): void =>
    update({ routes: value.routes.map((route, i) => (i === index ? { ...route, ...patch } : route)) });

  return (
    <>
      <Section title={t("settings.models.defaults")} description={t("settings.models.defaultsDesc")}>
        <FieldGrid>
          <div>
            <TextField label={t("settings.models.defaultModel")} value={value.defaultModel} disabled={readOnly} onChange={(event) => update({ defaultModel: event.target.value })} />
          </div>
          <Switch label="Lokale Verarbeitung zuerst" description="Bei Aktivierung entscheidet der lokale Router vor einem Cloud-Aufruf. Die lokale Uhrzeitantwort bleibt immer lokal." checked={value.localFirst} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(localFirst) => update({ localFirst })} />
        </FieldGrid>
        <p>Monatsbudget: {value.monthlyBudgetEur === null ? "nicht gesetzt" : `${value.monthlyBudgetEur} € gespeichert`}. Friday erfasst hier keine verlässlichen Providerkosten; der Wert wird nicht als Ausgabenlimit durchgesetzt.</p>
      </Section>
      <Section
        title={t("settings.models.routes")}
        description={t("settings.models.routesDesc")}
        actions={
          readOnly ? null : (
            <Button type="button" size="sm" variant="ghost" icon={<Plus size={14} />} disabled={!nextTaskKind} onClick={() => nextTaskKind && update({ routes: [...value.routes, { taskKind: nextTaskKind, model: value.defaultModel, reasoningLevel: "medium", fallbackModel: null }] })}>
              {t("settings.models.addRoute")}
            </Button>
          )
        }
      >
        {value.routes.length === 0 ? <p className="st-muted">{t("settings.models.noRoutes")}</p> : null}
        <ul className="st-routes">
          {value.routes.map((route, index) => (
            <li key={index} className="st-route">
              <Select label={t("settings.models.taskKind")} value={route.taskKind} disabled={readOnly}
                options={[...taskKinds.filter((kind) => kind === route.taskKind || !value.routes.some((other) => other.taskKind === kind)),
                  ...(taskKinds.includes(route.taskKind) ? [] : [route.taskKind])].map((kind) =>
                  ({ value: kind, label: taskKinds.includes(kind) ? kind : `${kind} (nicht unterstützt)` }))}
                onChange={(event) => setRoute(index, { taskKind: event.target.value, fallbackModel: event.target.value === "agent-task" ? null : route.fallbackModel })} />
              <TextField label={t("settings.models.model")} value={route.model} disabled={readOnly}
                list={route.taskKind === "agent-task" ? "agent-task-models" : undefined}
                onChange={(event) => setRoute(index, { model: event.target.value })} />
              {route.taskKind === "agent-task" ? <>
                <datalist id="agent-task-models">
                  {(catalog.data?.data.selected?.models ?? []).map((model) =>
                    <option key={model} value={`${agentProvider}:${model}`} />)}
                </datalist>
                <small role="status">{catalog.isError ? "Hermes-Modellbestand ist nicht erreichbar."
                  : catalog.isPending ? "Hermes-Modellbestand wird gelesen…"
                    : catalog.data?.data.selected?.origin === "endpoint_confirmed_picker"
                      ? "Modellliste vom Anbieter abgefragt; Zugriff auf einzelne Modelle bleibt ungeprüft."
                      : "Modellvorschläge sind kuratiert; Zugang und Modellzugriff bleiben ungeprüft."}</small>
              </> : null}
              <Select label="Denkstufe" value={route.reasoningLevel} disabled={readOnly}
                options={["none", "low", "medium", "high", "max"].map((level) => ({ value: level, label: level }))}
                onChange={(event) => setRoute(index, { reasoningLevel: event.target.value as typeof route.reasoningLevel })} />
              <TextField label="Fallback-Modell (Anbieter:Modell)" value={route.fallbackModel ?? ""} disabled={readOnly || route.taskKind === "agent-task"}
                onChange={(event) => setRoute(index, { fallbackModel: event.target.value || null })} />
              <small>{route.taskKind === "agent-task"
                ? "Hermes erhält Modell, Anbieter und Denkstufe für neue Aufgaben. Fallback gilt hier nur gemäß der globalen Hermes-Konfiguration; pro Aufgabe gibt es keinen Fallback-Schalter."
                : "Fallback nur vor dem ersten Agentaufruf, wenn kein Primärmodell eingerichtet ist. Nach jedem HTTP-Fehler oder Timeout erfolgt kein zweiter Aufruf."}</small>
              {readOnly ? null : (
                <button type="button" className="st-iconbtn st-route__remove" aria-label={t("settings.list.remove", { name: route.taskKind || `#${index + 1}` })} onClick={() => update({ routes: value.routes.filter((_, i) => i !== index) })}>
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ── Voice ────────────────────────────────────────────────────────────── */

export function VoiceArea() {
  const { t } = useT();
  const { value, update, readOnly } = useAreaDraft("voice");
  const devices = useVoiceDevices();
  const integration = useVoiceIntegrationStatus();
  const saved = useSettings();
  if (!value) return null;
  const options = (kind: "input" | "output", current: string | null) => voiceDeviceOptions(devices.data?.items ?? [], kind, current,
    { systemDefault: t("settings.voice.systemDefault"), missing: t("settings.voice.deviceMissing") });
  return (
    <>
      <Section title="Laufzeitstatus">
        {integration.isPending ? <p>Sprachdienst wird geprüft…</p> : integration.isError ? <p role="alert">Sprachdienststatus konnte nicht gelesen werden.</p> : integration.data ? (
          <p role="status">
            Einstellung gespeichert: Revision {integration.data.data.persistedRevision}. Stimme: {integration.data.data.settings.ttsVoice?.verification === "verified" ? "Umschaltung bestätigt" : "Wirkung nicht bestätigt"}.
            {integration.data.data.connected ? " Sprachdienst verbunden." : " Sprachdienst nicht verbunden."}
            {` Eingabegerät: ${integration.data.data.settings.inputDeviceId?.verification === "verified" ? "aktiv bestätigt" : "nicht bestätigt"}. Ausgabegerät: ${integration.data.data.settings.outputDeviceId?.verification === "verified" ? "aktiv bestätigt" : "nicht bestätigt"}.`}
          </p>
        ) : null}
        {integration.data ? <ul aria-label="Sprachdienst-Einstellungen">
          {([
            ["wakeWordEnabled", t("settings.voice.wakeEnabled")], ["wakeWord", t("settings.voice.wakeWord")],
            ["pushToTalkKey", t("settings.voice.ptt")], ["speakerVerificationRequired", t("settings.voice.speaker")],
            ["storeRawRecordings", t("settings.voice.raw")], ["voiceHistoryEnabled", t("settings.voice.history")],
            ["ttsRate", t("settings.voice.ttsRate")],
            ["sttLanguage", "Erkennungssprache"], ["sttModel", "Whisper-Modell"],
          ] as const).map(([field, label]) => <li key={field}>{label}: {
            integration.data.data.settings[field]?.verification === "verified" ? "Laufzeit bestätigt" : "Wirkung nicht bestätigt"
          }</li>)}
        </ul> : null}
      </Section>
      <Section title={t("settings.voice.activation")}>
        <WakeEnrollment phrase={value.wakeWord} activePhrase={saved.data?.data.voice.wakeWord ?? value.wakeWord} readOnly={readOnly} />
        <p>Ein anderes Aktivierungswort benötigt eigene Trainingsaufnahmen. Ohne Sprecherprüfung erhalten unbestätigte Stimmen lokale Antworten ohne Verlauf oder Werkzeuge; persönliche Daten und verbundene Dienste bleiben gesperrt. Push-to-Talk funktioniert mit Browser-Audio und auf dem interaktiven Windows-Gerätedesktop.</p>
        <FieldGrid>
          <Switch label={t("settings.voice.wakeEnabled")} description={t("settings.voice.wakeEnabledDesc")} checked={value.wakeWordEnabled} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(wakeWordEnabled) => update({ wakeWordEnabled })} />
          <TextField label={t("settings.voice.wakeWord")} hint={t("settings.voice.wakeWordHint")} value={value.wakeWord} disabled={readOnly || !value.wakeWordEnabled} onChange={(event) => update({ wakeWord: event.target.value })} />
          <TextField label={t("settings.voice.ptt")} value={value.pushToTalkKey} disabled={readOnly} onChange={(event) => update({ pushToTalkKey: event.target.value })} />
          <Switch label={t("settings.voice.speaker")} description={t("settings.voice.speakerDesc")} checked={value.speakerVerificationRequired} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(speakerVerificationRequired) => update({ speakerVerificationRequired })} />
        </FieldGrid>
      </Section>
      <Section title="Spracherkennung" description="Ein Modellwechsel lädt ausschließlich ein bereits lokal vorhandenes Whisper-Modell. Fehlt es oder ist Cloud-Erkennung aktiv, bleibt das bisherige Modell erhalten.">
        <FieldGrid>
          <Select label="Erkennungssprache" value={value.sttLanguage ?? "de"} disabled={readOnly}
            options={[{ value: "de", label: "Deutsch" }, { value: "en", label: "English" }]}
            onChange={(event) => update({ sttLanguage: event.target.value as "de" | "en" })} />
          <Select label="Lokales Whisper-Modell" value={value.sttModel ?? ""} disabled={readOnly}
            options={[...(value.sttModel == null ? [{ value: "", label: "Installiertes Modell übernehmen" }] : []),
              ...(value.sttModel != null && !["base", "small", "medium"].includes(value.sttModel) ? [{ value: value.sttModel, label: `Modell (${value.sttModel})` }] : []),
              { value: "base", label: "base" }, { value: "small", label: "small" }, { value: "medium", label: "medium" }]}
            onChange={(event) => update({ sttModel: event.target.value === "" ? null : event.target.value as "base" | "small" | "medium" })} />
        </FieldGrid>
        <SttModelsControl selected={value.sttModel ?? null} language={value.sttLanguage ?? "de"} readOnly={readOnly}
          onSelect={(sttModel) => update({ sttModel })} />
      </Section>
      <Section title={t("settings.voice.privacy")}>
        <FieldGrid>
          <Switch label={t("settings.voice.history")} description={t("settings.voice.historyDesc")} checked={value.voiceHistoryEnabled} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(voiceHistoryEnabled) => update({ voiceHistoryEnabled })} />
          <Switch label={t("settings.voice.raw")} description={t("settings.voice.rawDesc")} checked={value.storeRawRecordings} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(storeRawRecordings) => update({ storeRawRecordings })} />
        </FieldGrid>
      </Section>
      <Section title={t("settings.voice.output")}>
        {devices.isError ? <p role="alert">Audiogeräte konnten nicht gelesen werden. Sprachdienst und Audio-Berechtigung prüfen.</p> : null}
        <button type="button" onClick={() => void devices.refetch()} disabled={devices.isFetching}>Audiogeräte neu suchen</button>
        <FieldGrid>
          <Select label={t("settings.voice.ttsVoice")} value={value.ttsVoice} disabled={readOnly}
            options={[
              ...(!["friday-female", "classic"].includes(value.ttsVoice) ? [{ value: value.ttsVoice, label: t("settings.voice.unconfigured") }] : []),
              { value: "friday-female", label: "F.R.I.D.A.Y. (weiblich)" },
              { value: "classic", label: "J.A.R.V.I.S. (männlich)" },
            ]}
            onChange={(event) => update({ ttsVoice: event.target.value })} />
          <Slider label={t("settings.voice.ttsRate")} min={0.5} max={2} step={0.05} value={value.ttsRate} disabled={readOnly} formatValue={(v) => `${v.toFixed(2)}×`} onValueChange={(ttsRate) => update({ ttsRate })} />
          <Select label={t("settings.voice.inputDevice")} value={value.inputDeviceId ?? ""} disabled={readOnly} options={options("input", value.inputDeviceId)} onChange={(event) => update({ inputDeviceId: event.target.value === "" ? null : event.target.value })} />
          <Select label={t("settings.voice.outputDevice")} value={value.outputDeviceId ?? ""} disabled={readOnly} options={options("output", value.outputDeviceId)} onChange={(event) => update({ outputDeviceId: event.target.value === "" ? null : event.target.value })} />
        </FieldGrid>
      </Section>
    </>
  );
}

/* ── Notifications ────────────────────────────────────────────────────── */

const CHANNELS = ["dashboard", "telegram", "whatsapp", "sms", "phone", "email"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;

export function NotificationsArea() {
  const { t } = useT();
  const { value, update, readOnly } = useAreaDraft("notifications");
  if (!value) return null;
  const setChannel = (kind: string, patch: Partial<Settings["notifications"]["channels"][number]>): void =>
    update({ channels: value.channels.map((channel) => (channel.kind === kind ? { ...channel, ...patch } : channel)) });
  const setStep = (index: number, patch: Partial<Settings["notifications"]["defaultEscalation"][number]>): void =>
    update({ defaultEscalation: value.defaultEscalation.map((step, i) => (i === index ? { ...step, ...patch } : step)) });

  return (
    <>
      <Section title={t("settings.notifications.channels")} description={t("settings.notifications.channelsDesc")}>
        <ul className="st-rows">
          {value.channels.map((channel) => (
            <li key={channel.kind} className="st-rowline">
              <Switch label={t(`settings.notifications.channel.${channel.kind}` as MessageKey)} checked={channel.enabled} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(enabled) => setChannel(channel.kind, { enabled })} />
              <Select
                label={t("settings.notifications.minPriority")}
                value={channel.minPriority}
                disabled={readOnly || !channel.enabled}
                options={PRIORITIES.map((p) => ({ value: p, label: t(`settings.notifications.priority.${p}` as MessageKey) }))}
                onChange={(event) => setChannel(channel.kind, { minPriority: event.target.value as (typeof PRIORITIES)[number] })}
              />
              {channel.kind !== "dashboard" ? (
                <>
                  {["telegram", "whatsapp", "sms"].includes(channel.kind) ? (
                    <Select
                      label={t("settings.notifications.accountId")}
                      value={channel.accountId ?? "default"}
                      disabled={readOnly || !channel.enabled}
                      hint={t("settings.notifications.defaultAccountOnly")}
                      options={[
                        { value: "default", label: t("settings.notifications.defaultAccount") },
                        ...(channel.accountId && channel.accountId !== "default"
                          ? [{ value: channel.accountId, label: `${channel.accountId} (${t("settings.notifications.unsupportedAccount")})` }]
                          : []),
                      ]}
                      onChange={(event) => setChannel(channel.kind, { accountId: event.target.value })}
                    />
                  ) : (
                    <TextField
                      label={t("settings.notifications.accountId")}
                      value={channel.accountId ?? "default"}
                      disabled={readOnly || !channel.enabled}
                      maxLength={64}
                      onChange={(event) => setChannel(channel.kind, { accountId: event.target.value })}
                    />
                  )}
                  <TextField
                    label={t("settings.notifications.recipient")}
                    value={channel.recipient ?? ""}
                    disabled={readOnly || !channel.enabled}
                    maxLength={320}
                    onChange={(event) => setChannel(channel.kind, { recipient: event.target.value })}
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>
        {CHANNELS.filter((kind) => !value.channels.some((channel) => channel.kind === kind)).length > 0 && !readOnly ? (
          <div className="st-row">
            {CHANNELS.filter((kind) => !value.channels.some((channel) => channel.kind === kind)).map((kind) => (
              <Button key={kind} type="button" size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => update({ channels: [...value.channels, { kind, enabled: false, minPriority: "P2" }] })}>
                {t(`settings.notifications.channel.${kind}` as MessageKey)}
              </Button>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title={t("settings.notifications.quiet")} description={t("settings.notifications.quietDesc")}>
        <FieldGrid columns={3}>
          <Switch label={t("settings.notifications.quietEnabled")} checked={value.quietHours.enabled} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(enabled) => update({ quietHours: { ...value.quietHours, enabled } })} />
          <TextField label={t("settings.notifications.quietFrom")} type="time" value={value.quietHours.from} disabled={readOnly || !value.quietHours.enabled} onChange={(event) => update({ quietHours: { ...value.quietHours, from: event.target.value } })} />
          <TextField label={t("settings.notifications.quietTo")} type="time" value={value.quietHours.to} disabled={readOnly || !value.quietHours.enabled} onChange={(event) => update({ quietHours: { ...value.quietHours, to: event.target.value } })} />
        </FieldGrid>
        <NumberField label={t("settings.notifications.snooze")} integer min={1} value={value.snoozeDefaultMinutes} disabled={readOnly} onValueChange={(next) => next !== null && update({ snoozeDefaultMinutes: Math.round(next) })} />
      </Section>
      <Section
        title={t("settings.notifications.escalation")}
        description={t("settings.notifications.escalationDesc")}
        actions={
          readOnly ? null : (
            <Button type="button" size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => update({ defaultEscalation: [...value.defaultEscalation, { afterSeconds: 300, channel: "dashboard", description: "", stopOnAcknowledge: true }] })}>
              {t("settings.notifications.addStep")}
            </Button>
          )
        }
      >
        {value.defaultEscalation.length === 0 ? <p className="st-muted">{t("settings.notifications.noSteps")}</p> : null}
        <ul className="st-routes">
          {value.defaultEscalation.map((step, index) => (
            <li key={index} className="st-route">
              <NumberField label={t("settings.notifications.afterSeconds")} integer min={0} value={step.afterSeconds} disabled={readOnly} onValueChange={(next) => next !== null && setStep(index, { afterSeconds: Math.round(next) })} />
              <Select label={t("settings.notifications.stepChannel")} value={step.channel} disabled={readOnly} options={CHANNELS.map((kind) => ({ value: kind, label: t(`settings.notifications.channel.${kind}` as MessageKey) }))} onChange={(event) => setStep(index, { channel: event.target.value as (typeof CHANNELS)[number] })} />
              <TextField label={t("settings.notifications.stepDescription")} value={step.description} disabled={readOnly} onChange={(event) => setStep(index, { description: event.target.value })} />
              <Switch label={t("settings.notifications.stopOnAck")} checked={step.stopOnAcknowledge ?? false} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(stopOnAcknowledge) => setStep(index, { stopOnAcknowledge })} />
              {readOnly ? null : (
                <button type="button" className="st-iconbtn st-route__remove" aria-label={t("settings.list.remove", { name: `#${index + 1}` })} onClick={() => update({ defaultEscalation: value.defaultEscalation.filter((_, i) => i !== index) })}>
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ── Security ─────────────────────────────────────────────────────────── */

export function SecurityArea() {
  const { t, locale } = useT();
  const { value, update, readOnly } = useAreaDraft("security");
  const { session, role } = useSession();
  const logoutAll = useLogoutAll();
  const [confirm, setConfirm] = useState(false);
  if (!value) return null;
  const fmt = (iso: string | null | undefined): string => (iso ? new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—");

  return (
    <>
      <Section title={t("settings.security.session")} description={t("settings.security.sessionDesc")}>
        <FieldGrid>
          <Switch label={t("settings.security.loginRequired")} description={t("settings.security.loginRequiredDesc")} checked={value.loginRequired !== false} disabled={readOnly || value.allowRemoteAccess} stateLabels={onOff(t)} onCheckedChange={(loginRequired) => update({ loginRequired })} />
          <NumberField label={t("settings.security.timeout")} hint={t("settings.security.timeoutHint")} integer min={1} value={value.sessionTimeoutMinutes} disabled={readOnly} onValueChange={(next) => next !== null && update({ sessionTimeoutMinutes: Math.round(next) })} />
          <NumberField label={t("settings.security.reauth")} hint={t("settings.security.reauthHint")} integer min={1} value={value.reauthWindowMinutes} disabled={readOnly} onValueChange={(next) => next !== null && update({ reauthWindowMinutes: Math.round(next) })} />
        </FieldGrid>
        <dl className="st-facts">
          <div>
            <dt>{t("settings.security.role")}</dt>
            <dd>{role ? t(`settings.role.${role}` as MessageKey) : "—"}</dd>
          </div>
          <div>
            <dt>{t("settings.security.expires")}</dt>
            <dd>{fmt(session?.expiresAt)}</dd>
          </div>
          <div>
            <dt>{t("settings.security.reauthUntil")}</dt>
            <dd>{session?.reauthUntil ? fmt(session.reauthUntil) : t("settings.security.reauthNone")}</dd>
          </div>
        </dl>
        <div className="st-row">
          <Button type="button" variant="danger" icon={<LogOut size={15} />} onClick={() => setConfirm(true)}>
            {t("settings.security.logoutAll")}
          </Button>
          <span className="st-muted">{t("settings.security.logoutAllHint")}</span>
        </div>
      </Section>
      <Section title={t("settings.security.network")}>
        <FieldGrid>
          <Switch label={t("settings.security.remote")} description={t("settings.security.remoteDesc")} checked={value.allowRemoteAccess} disabled stateLabels={onOff(t)} onCheckedChange={(allowRemoteAccess) => update({ allowRemoteAccess })} />
          <Switch label={t("settings.security.hashChain")} description={t("settings.security.hashChainDesc")} checked={value.auditHashChain} disabled stateLabels={onOff(t)} onCheckedChange={(auditHashChain) => update({ auditHashChain })} />
        </FieldGrid>
        {value.allowRemoteAccess ? <StatusChip tone="amber">{t("settings.security.remoteWarning")}</StatusChip> : null}
        <StringListEditor label={t("settings.security.origins")} values={value.trustedOrigins} disabled={readOnly} placeholder="http://127.0.0.1:3100" onChange={(trustedOrigins) => update({ trustedOrigins })} />
      </Section>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("settings.security.logoutAllTitle")}
        description={t("settings.security.logoutAllConfirm")}
        confirmLabel={t("settings.security.logoutAll")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        loading={logoutAll.isPending}
        onConfirm={() => logoutAll.mutate({}, { onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

/* ── Approvals ────────────────────────────────────────────────────────── */

export function ApprovalsArea() {
  const { t } = useT();
  const { value, update, readOnly } = useAreaDraft("approvals");
  if (!value) return null;
  return (
    <Section title={t("settings.approvals.title")} description={t("settings.approvals.desc")}>
      <FieldGrid>
        <NumberField label={t("settings.approvals.expiry")} hint={t("settings.approvals.expiryHint")} integer min={1} value={value.defaultExpiryMinutes} disabled={readOnly} onValueChange={(next) => next !== null && update({ defaultExpiryMinutes: Math.round(next) })} />
        <Switch label={t("settings.approvals.draftOnly")} description={t("settings.approvals.draftOnlyDesc")} checked={value.draftOnlyByDefault} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(draftOnlyByDefault) => update({ draftOnlyByDefault })} />
        <Switch label={t("settings.approvals.tier2")} description={t("settings.approvals.tier2Desc")} checked={value.confirmTier2} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(confirmTier2) => update({ confirmTier2 })} />
        <Switch label={t("settings.approvals.tier3")} description={t("settings.approvals.tier3Desc")} checked={value.reauthTier3} disabled stateLabels={onOff(t)} onCheckedChange={(reauthTier3) => update({ reauthTier3 })} />
        <Switch label={t("settings.approvals.notify")} description={t("settings.approvals.notifyDesc")} checked={value.notifyOnRequest} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(notifyOnRequest) => update({ notifyOnRequest })} />
      </FieldGrid>
      {!value.reauthTier3 ? <StatusChip tone="amber">{t("settings.approvals.tier3Warning")}</StatusChip> : null}
    </Section>
  );
}

/* ── Data retention ───────────────────────────────────────────────────── */

export function DataRetentionArea() {
  const { t } = useT();
  const { value, update, dirty, readOnly } = useAreaDraft("dataRetention");
  const { role, offline } = useSession();
  const status = useDataRetentionStatus(role === "owner" && !offline);
  const action = useDataRetentionAction();
  const [preview, setPreview] = useState<Extract<DataRetentionActionResponse["data"], { eligible: unknown }> | null>(null);
  if (!value) return null;
  const days = (label: MessageKey, key: "activityDays" | "auditDays" | "notificationDays" | "temporaryFileDays", min = 1, hint?: MessageKey) => (
    <NumberField label={t(label)} hint={hint ? t(hint) : undefined} integer min={min} value={value[key]} disabled={readOnly} onValueChange={(next) => next !== null && update({ [key]: Math.round(next) })} />
  );
  return (
    <Section title={t("settings.retention.title")} description={t("settings.retention.desc")}>
      <FieldGrid>
        {days("settings.retention.activity", "activityDays")}
        {days("settings.retention.audit", "auditDays", 1, "settings.retention.auditHint")}
        <NumberField label={t("settings.retention.voice")} hint={t("settings.retention.voiceHint")} integer min={0} value={value.voiceHistoryDays} disabled={readOnly} onValueChange={(next) => next !== null && update({ voiceHistoryDays: Math.round(next) })} />
        {days("settings.retention.notifications", "notificationDays")}
        {days("settings.retention.temp", "temporaryFileDays")}
        <NumberField label={t("settings.retention.memoryTtl")} hint={t("settings.retention.memoryTtlHint")} integer min={1} nullable value={value.memoryDefaultTtlDays} disabled onValueChange={() => undefined} />
      </FieldGrid>
      {role === "owner" && <div>
        <p className="st-muted">{t("settings.retention.scope")}</p>
        {status.isError && <p role="alert">{t("settings.retention.statusError")}</p>}
        {status.data?.data.last && <p role="status">{t("settings.retention.last")}: {status.data.data.last.status} · {status.data.data.last.at}
          {status.data.data.last.error ? ` · ${status.data.data.last.error}` : ""}
          {status.data.data.last.status === "failed" && Object.keys(status.data.data.last.confirmedPartial).length
            ? ` · ${t("settings.retention.partial")}: ${JSON.stringify(status.data.data.last.confirmedPartial)}` : ""}</p>}
        {dirty && <p className="st-muted">{t("settings.retention.saveFirst")}</p>}
        <p className="st-muted">{status.data?.data.automaticEnabled ? t("settings.retention.autoOn") : t("settings.retention.autoOff")}</p>
        <div className="st-row">
          <Button size="sm" variant="ghost" disabled={readOnly || dirty || action.isPending} onClick={() => void action.mutateAsync({ action: "preview" }).then((response) => { if ("eligible" in response.data) setPreview(response.data); }).catch(() => setPreview(null))}>{t("settings.retention.preview")}</Button>
          <Button size="sm" disabled={readOnly || dirty || action.isPending} onClick={() => void action.mutateAsync({ action: "run" }).then((response) => { if ("eligible" in response.data) setPreview(response.data); }).catch(() => setPreview(null))}>{t("settings.retention.run")}</Button>
          {!status.data?.data.automaticEnabled && <Button size="sm" variant="ghost" disabled={readOnly || dirty || action.isPending || status.isLoading || status.isError} onClick={() => void action.mutateAsync({ action: "activate" }).catch(() => setPreview(null))}>{t("settings.retention.activate")}</Button>}
          {status.data?.data.automaticEnabled && <Button size="sm" variant="ghost" disabled={readOnly || action.isPending} onClick={() => void action.mutateAsync({ action: "deactivate" }).catch(() => setPreview(null))}>{t("settings.retention.deactivate")}</Button>}
        </div>
        {preview && <div role="status">
          <p>{t(preview.action === "run" ? "settings.retention.removed" : "settings.retention.eligible")}:</p>
          <ul>
            <li>{t("settings.retention.activity")}: {(preview.removed ?? preview.eligible).activity}</li>
            <li>{t("settings.retention.voice")}: {(preview.removed ?? preview.eligible).voiceHistory}</li>
            <li>{t("settings.retention.audit")}: {(preview.removed ?? preview.eligible).auditToArchive}</li>
            <li>{t("settings.retention.notifications")}: {(preview.removed ?? preview.eligible).notifications}</li>
            <li>{t("settings.retention.temp")}: {(preview.removed ?? preview.eligible).temporaryFiles}</li>
          </ul>
        </div>}
        {action.isError && <p role="alert">{t("settings.retention.actionError")}</p>}
      </div>}
    </Section>
  );
}

/* ── Backups ──────────────────────────────────────────────────────────── */

export function BackupsArea() {
  const { t, locale } = useT();
  const { value, update, readOnly } = useAreaDraft("backups");
  const { role, offline } = useSession();
  const status = useSystemBackupStatus(role === "owner" && !offline);
  const action = useSystemBackupAction();
  const [preview, setPreview] = useState<{ destination: string; estimatedBytes: number } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState("");
  const [result, setResult] = useState<string | null>(null);
  if (!value) return null;
  const last = status.data?.data.last;
  const perform = async (request: Parameters<typeof action.mutateAsync>[0]) => {
    try {
      const response = await action.mutateAsync(request);
      if (request.action === "preview") setPreview({ destination: response.data.destination ?? "", estimatedBytes: response.data.estimatedBytes ?? 0 });
      else setResult(request.action === "run" ? `Backup erstellt: ${response.data.path}` :
        request.action === "verify" ? `Integrität geprüft: ${response.data.fileCount} Dateien` : `Restore-Test erfolgreich: ${response.data.path}`);
    } catch { setResult(null); }
  };
  const fmt = (iso: string | null): string => (iso ? new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : t("settings.backups.never"));
  const tone = value.lastBackupStatus === "success" ? "green" : value.lastBackupStatus === "failed" ? "red" : "muted";
  return (
    <>
      <Section title={t("settings.backups.title")} description={t("settings.backups.desc")}>
        <FieldGrid>
          <Switch label={t("settings.backups.enabled")} checked={value.enabled} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(enabled) => update({ enabled })} />
          <TextField label={t("settings.backups.schedule")} hint={t("settings.backups.scheduleHint")} value={value.schedule} disabled={readOnly || !value.enabled} onChange={(event) => update({ schedule: event.target.value })} />
          <TextField label={t("settings.backups.target")} value={value.targetPath} disabled={readOnly || !value.enabled} onChange={(event) => update({ targetPath: event.target.value })} />
          <NumberField label={t("settings.backups.retention")} hint={t("settings.backups.retentionHint")} integer min={1} value={value.retentionCount} disabled={readOnly} onValueChange={(next) => next !== null && update({ retentionCount: Math.round(next) })} />
        </FieldGrid>
      </Section>
      <Section title={t("settings.backups.last")}>
        <p className="st-row">
          <StatusChip tone={tone}>{t(`settings.backups.status.${value.lastBackupStatus}` as MessageKey)}</StatusChip>
          <span>{fmt(value.lastBackupAt)}</span>
        </p>
      </Section>
      {role === "owner" && <Section title="Backup-Prüfung" description={status.data?.data.coverage === "windows-wsl-and-memory"
        ? "Lokaler Snapshot von Windows-Konfiguration, SQLite, Obsidian-Vault und Friday-Ubuntu-Konten mit Hermes-Zustand."
        : "Lokaler Snapshot von Windows-Konfiguration, SQLite und Obsidian-Vault; Friday-Ubuntu ist nicht konfiguriert."}>
        {status.isError && <p role="alert">Backup-Status nicht erreichbar.</p>}
        <p className="st-muted">Der Restore-Test prüft eine getrennte, inaktive Kopie. Eine betriebsbereite Wiederherstellung benötigt die Neuinstallation des im WSL-Manifest festgehaltenen Hermes-Revisionsstands sowie seiner Laufzeit- und Paketabhängigkeiten.</p>
        {last?.error && <p role="alert">Letzter Fehler: {last.error}</p>}
        <p className="st-row">Zeitplan: {status.data?.data.schedule ?? value.schedule} ({status.data?.data.timeZone ?? "Zeitzone unbekannt"})</p>
        {preview && <p role="status">Ziel: {preview.destination} · Bedarf mindestens {Math.ceil(preview.estimatedBytes / 1024 / 1024)} MiB</p>}
        <div className="st-row">
          <Button size="sm" variant="ghost" disabled={readOnly || action.isPending} onClick={() => void perform({ action: "preview" })}>Ziel und Platz prüfen</Button>
          <Button size="sm" disabled={readOnly || action.isPending} onClick={() => void perform({ action: "run" })}>Backup jetzt erstellen</Button>
          <Button size="sm" variant="ghost" disabled={readOnly || action.isPending || !last?.path} onClick={() => void perform({ action: "verify", path: last!.path! })}>Letztes Backup prüfen</Button>
        </div>
        <TextField label="Neuer Ordner für isolierten Restore-Test" value={restoreTarget} disabled={readOnly} onChange={(event) => setRestoreTarget(event.target.value)} hint="Ein noch nicht vorhandener Pfad innerhalb von dashboard/data." />
        <Button size="sm" variant="ghost" disabled={readOnly || action.isPending || !last?.path || !restoreTarget.trim()} onClick={() => void perform({ action: "restore-test", path: last!.path!, targetPath: restoreTarget.trim() })}>Restore getrennt testen</Button>
        {result && <p role="status">{result}</p>}
        {action.isError && <p role="alert">Backup-Aktion fehlgeschlagen. Der Backup-Status zeigt den letzten Lauf.</p>}
      </Section>}
    </>
  );
}

/* ── Developer ────────────────────────────────────────────────────────── */

export function DeveloperArea() {
  const { t } = useT();
  const { value, update, readOnly } = useAreaDraft("developer");
  const meta = useMeta();
  const devScenarios = Boolean(meta.data?.features.devScenarios);
  const scenarioControls = Boolean(meta.data?.features.scenarioControls);
  const router = useRouter();
  if (!value) return null;
  return (
    <>
      <Section title={t("settings.developer.title")} description={t("settings.developer.desc")}>
        <FieldGrid>
          <Switch label={t("settings.developer.debug")} description={t("settings.developer.debugDesc")} checked={value.debugMode} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(debugMode) => update({ debugMode })} />
          <Switch label={t("settings.developer.rawJson")} description={t("settings.developer.rawJsonDesc")} checked={value.showRawJson} disabled={readOnly} stateLabels={onOff(t)} onCheckedChange={(showRawJson) => update({ showRawJson })} />
          <Switch label={t("settings.developer.scenarioConsole")} description={t("settings.developer.scenarioConsoleDesc")} checked={scenarioControls && value.scenarioConsole} disabled={readOnly || !scenarioControls} stateLabels={onOff(t)} onCheckedChange={(scenarioConsole) => update({ scenarioConsole })} />
          <Switch label={t("settings.developer.orbPerf")} description={t("settings.developer.orbPerfDesc")} checked={value.orbPerfOverlay} disabled={readOnly || !scenarioControls} stateLabels={onOff(t)} onCheckedChange={(orbPerfOverlay) => update({ orbPerfOverlay })} />
          <Select
            label={t("settings.developer.logLevel")}
            value={value.logLevel}
            disabled={readOnly}
            options={(["error", "warn", "info", "debug"] as const).map((level) => ({ value: level, label: level }))}
            onChange={(event) => update({ logLevel: event.target.value as Settings["developer"]["logLevel"] })}
          />
        </FieldGrid>
      </Section>
      <Section title={t("settings.developer.tools")}>
        {devScenarios ? (
          <Button type="button" variant="ghost" onClick={() => router.push("/dev/scenarios")}>
            {t("settings.developer.openConsole")}
          </Button>
        ) : (
          <p className="st-muted">{t("settings.developer.consoleOff")}</p>
        )}
      </Section>
    </>
  );
}
