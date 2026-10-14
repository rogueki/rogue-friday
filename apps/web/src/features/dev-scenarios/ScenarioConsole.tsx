"use client";

import type { OrbMode, ScenarioControlRequest, ScenarioState } from "@jarvis/sdk";
import { Button, EmptyState, HudPanel, Select, Skeleton, Slider, StatusChip, Switch, TagPill, TextField } from "@jarvis/ui";
import { Clock, FlaskConical, Play, Plug, RotateCcw, ShieldCheck, Sparkles, Unlock, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NumberField } from "@/features/settings/controls";
import { ORB_MODES } from "@/features/settings/settingsLogic";
import { useT, type MessageKey } from "@/i18n";
import { useActivity } from "@/lib/api/domains/activity";
import { useMeta, useOrbStatusQuery } from "@/lib/api/domains/core";
import { useControlScenario, usePlayScenario, useScenarios, useScenarioState } from "@/lib/api/domains/dev";
import { useAdapters } from "@/lib/api/domains/system";
import { useCapabilities } from "@/lib/capabilities";
import { useSession } from "@/lib/session";
import { EVENT_MODES, EVENT_SEQUENCES, SPEEDS, TIME_UNITS, forceOrbRequest, stepsOf, toMs, type TimeUnit } from "./scenarioLogic";
import "./dev-scenarios.css";

const ICON = { size: 16, strokeWidth: 1.5 } as const;
const modeLabel = (t: (key: MessageKey) => string, mode: string): string => t(`settings.orb.mode.${mode}` as MessageKey);

function NotFoundView() {
  const { t } = useT();
  const router = useRouter();
  return (
    <div className="ds-notfound">
      <EmptyState title={t("notFound.title")} description={t("notFound.description")} action={<Button onClick={() => router.push("/")}>{t("notFound.home")}</Button>} />
    </div>
  );
}

/** Dev/QA console (PLAN §44.6). Only exists when the server reports `features.devScenarios`; otherwise the route is "not found". */
export function ScenarioConsolePage() {
  const meta = useMeta();
  const { role } = useSession();
  if (meta.isPending) {
    return (
      <div className="ds-page" aria-busy="true">
        <Skeleton variant="row" height={44} />
      </div>
    );
  }
  if (!meta.data?.features.devScenarios) return <NotFoundView />;
  if (role !== "owner") return <OwnerOnly />;
  return <ScenarioConsole />;
}

function OwnerOnly() {
  const { t } = useT();
  return (
    <div className="ds-page">
      <EmptyState icon={<FlaskConical size={22} />} title={t("devScenarios.ownerOnly.title")} description={t("devScenarios.ownerOnly.desc")} />
    </div>
  );
}

function StatePanel({ state }: { state: ScenarioState | undefined }) {
  const { t, locale } = useT();
  const fmt = (iso: string): string => new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));
  return (
    <HudPanel title={t("devScenarios.state.title")} subtitle={t("devScenarios.state.subtitle")} icon={<Sparkles {...ICON} />} live level={2} className="ds-panel">
      {state ? (
        <dl className="ds-facts">
          <div>
            <dt>{t("devScenarios.state.active")}</dt>
            <dd>
              {state.activeScenarioId ?? t("devScenarios.state.none")} {state.running ? <StatusChip tone="green" pulse>{t("devScenarios.state.running")}</StatusChip> : null}
            </dd>
          </div>
          <div>
            <dt>{t("devScenarios.state.step")}</dt>
            <dd className="ds-mono">{state.stepIndex}</dd>
          </div>
          <div>
            <dt>{t("devScenarios.state.time")}</dt>
            <dd className="ds-mono">{fmt(state.simulatedTime)}</dd>
          </div>
          <div>
            <dt>{t("devScenarios.state.offset")}</dt>
            <dd className="ds-mono">{state.clockOffsetMs} ms</dd>
          </div>
          <div>
            <dt>{t("devScenarios.state.seed")}</dt>
            <dd className="ds-mono">{state.seed}</dd>
          </div>
          <div>
            <dt>{t("devScenarios.state.forced")}</dt>
            <dd>{state.forcedOrbMode ? modeLabel(t, state.forcedOrbMode) : t("devScenarios.state.derived")}</dd>
          </div>
        </dl>
      ) : (
        <Skeleton variant="row" height={44} />
      )}
    </HudPanel>
  );
}

function ScenarioConsole() {
  const { t, locale } = useT();
  const scenarios = useScenarios();
  const stateQuery = useScenarioState();
  const adapters = useAdapters();
  const orb = useOrbStatusQuery();
  const activity = useActivity({ limit: 12 });
  const { capabilities } = useCapabilities();
  const play = usePlayScenario();
  const control = useControlScenario();
  const state = stateQuery.data?.data;

  const [scenarioId, setScenarioId] = useState<string>("");
  const [speed, setSpeed] = useState<number>(1);
  const [timeAmount, setTimeAmount] = useState<number | null>(5);
  const [timeUnit, setTimeUnit] = useState<TimeUnit>("m");
  const [target, setTarget] = useState<string>("");
  const [latency, setLatency] = useState<number | null>(500);
  const [errorRate, setErrorRate] = useState<number>(0.2);
  const [capModule, setCapModule] = useState<string>("");
  const [capName, setCapName] = useState<string>("");
  const [orbMode, setOrbMode] = useState<OrbMode>("working");
  const [orbText, setOrbText] = useState("");
  const [orbLevel, setOrbLevel] = useState(0.4);
  const [last, setLast] = useState<string | null>(null);
  const [running, setRunning] = useState<{ name: string; step: number; total: number } | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const items = useMemo(() => scenarios.data?.items ?? [], [scenarios.data]);
  useEffect(() => {
    if (!scenarioId && items[0]) setScenarioId(items[0].id);
  }, [items, scenarioId]);
  const scenario = items.find((item) => item.id === scenarioId);
  const adapterList = adapters.data?.items ?? [];
  const modules = Object.entries((capabilities?.modules ?? {}) as Record<string, Record<string, unknown>>);
  const capKeys = Object.entries(modules.find(([name]) => name === capModule)?.[1] ?? {})
    .filter(([, value]) => typeof value === "boolean")
    .map(([key]) => key);
  useEffect(() => {
    if (!capModule && modules[0]) setCapModule(modules[0][0]);
  }, [modules, capModule]);
  useEffect(() => {
    if (capKeys.length > 0 && !capKeys.includes(capName)) setCapName(capKeys[0] as string);
  }, [capKeys, capName]);

  const send = async (request: ScenarioControlRequest, label: string): Promise<void> => {
    try {
      await control.mutateAsync({ request });
      setLast(label);
    } catch {
      // the mutation cache reports the failure as a toast; the console keeps its last good state
    }
  };

  const playEvent = async (name: string): Promise<void> => {
    const steps = stepsOf(name);
    for (const [index, mode] of steps.entries()) {
      if (cancelled.current) return;
      setRunning({ name, step: index + 1, total: steps.length });
      try {
        await control.mutateAsync({ request: forceOrbRequest(mode) });
      } catch {
        setRunning(null);
        return;
      }
      if (index < steps.length - 1) await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    setRunning(null);
    setLast(t("devScenarios.events.played", { name }));
  };

  const busy = control.isPending || play.isPending;
  const fmtTime = (iso: string): string => new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { timeStyle: "medium" }).format(new Date(iso));
  const orbSnapshot = orb.data?.data;

  const eventButtons = useMemo(() => [...Object.keys(EVENT_MODES), ...Object.keys(EVENT_SEQUENCES)], []);

  return (
    <div className="ds-page">
      <header className="ds-header">
        <div>
          <h1 className="ds-title">
            <FlaskConical size={20} strokeWidth={1.5} aria-hidden="true" /> {t("devScenarios.title")}
          </h1>
          <p className="ds-desc">{t("devScenarios.desc")}</p>
        </div>
        <div className="ds-header__tags">
          <TagPill tone="amber">{t("devScenarios.devOnly")}</TagPill>
          {last ? (
            <span className="ds-last" role="status">
              {t("devScenarios.last", { action: last })}
            </span>
          ) : null}
        </div>
      </header>

      <div className="ds-grid">
        <div className="ds-col">
          <HudPanel title={t("devScenarios.scenario.title")} subtitle={t("devScenarios.scenario.subtitle")} icon={<Play {...ICON} />} className="ds-panel">
            {scenarios.isPending ? (
              <Skeleton variant="row" height={44} />
            ) : scenarios.isError ? (
              <p className="ds-error" role="alert">
                {t("devScenarios.scenario.loadError")}
              </p>
            ) : (
              <>
                <Select label={t("devScenarios.scenario.select")} value={scenarioId} options={items.map((item) => ({ value: item.id, label: item.name }))} onChange={(event) => setScenarioId(event.target.value)} />
                {scenario ? <p className="ds-muted">{scenario.description}</p> : null}
                <div className="ds-speed" role="group" aria-label={t("devScenarios.scenario.speed")}>
                  <span className="jv-field__label">{t("devScenarios.scenario.speed")}</span>
                  <div className="ds-chips">
                    {SPEEDS.map((value) => (
                      <button key={value} type="button" className="ds-chip" aria-pressed={speed === value} onClick={() => setSpeed(value)}>
                        {value}×
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ds-row">
                  <Button type="button" icon={<Play size={15} />} disabled={!scenarioId || busy} loading={play.isPending} onClick={() => play.mutate({ id: scenarioId, speed }, { onSuccess: () => setLast(t("devScenarios.scenario.played", { name: scenario?.name ?? scenarioId })) })}>
                    {t("devScenarios.scenario.play")}
                  </Button>
                  <Button type="button" variant="ghost" icon={<RotateCcw size={15} />} disabled={busy} onClick={() => void send({ action: "reset" }, t("devScenarios.reset.done"))}>
                    {t("devScenarios.reset")}
                  </Button>
                </div>
                {scenario ? (
                  <ol className="ds-steps" aria-label={t("devScenarios.scenario.steps")}>
                    {scenario.steps.map((step) => (
                      <li key={step.index} data-current={state?.activeScenarioId === scenario.id && state.stepIndex === step.index ? "true" : undefined}>
                        <span className="ds-mono">{String(step.index + 1).padStart(2, "0")}</span>
                        <span>{step.label}</span>
                        <span className="ds-mono ds-muted">+{step.delayMs} ms</span>
                        {step.orbMode ? <TagPill tone="gold">{modeLabel(t, step.orbMode)}</TagPill> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </>
            )}
          </HudPanel>

          <HudPanel title={t("devScenarios.clock.title")} subtitle={t("devScenarios.clock.subtitle")} icon={<Clock {...ICON} />} className="ds-panel">
            <div className="ds-chips">
              {([["+1 min", 60_000], ["+5 min", 300_000], ["+1 h", 3_600_000], ["+1 d", 86_400_000]] as const).map(([label, ms]) => (
                <Button key={label} type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void send({ action: "clock_advance", ms }, t("devScenarios.clock.done", { amount: label }))}>
                  {label}
                </Button>
              ))}
            </div>
            <div className="ds-inline">
              <NumberField label={t("devScenarios.clock.amount")} integer min={1} value={timeAmount} onValueChange={setTimeAmount} />
              <Select label={t("devScenarios.clock.unit")} value={timeUnit} options={(Object.keys(TIME_UNITS) as TimeUnit[]).map((unit) => ({ value: unit, label: t(`devScenarios.clock.unit.${unit}` as MessageKey) }))} onChange={(event) => setTimeUnit(event.target.value as TimeUnit)} />
              <Button type="button" disabled={busy || !timeAmount || timeAmount < 1} onClick={() => timeAmount && void send({ action: "clock_advance", ms: toMs(timeAmount, timeUnit) }, t("devScenarios.clock.done", { amount: `${timeAmount} ${timeUnit}` }))}>
                {t("devScenarios.clock.advance")}
              </Button>
            </div>
            {state ? <p className="ds-muted">{t("devScenarios.clock.now", { time: fmtTime(state.simulatedTime) })}</p> : null}
          </HudPanel>

          <HudPanel title={t("devScenarios.adapters.title")} subtitle={t("devScenarios.adapters.subtitle")} icon={<Plug {...ICON} />} className="ds-panel">
            <Select
              label={t("devScenarios.adapters.target")}
              value={target}
              options={[{ value: "", label: t("devScenarios.adapters.all") }, ...adapterList.map((adapter) => ({ value: adapter.manifest.id, label: adapter.manifest.id }))]}
              onChange={(event) => setTarget(event.target.value)}
            />
            <div className="ds-row">
              <Button type="button" variant="danger" size="sm" disabled={busy || !target} onClick={() => void send({ action: "adapter_offline", adapterId: target, offline: true }, t("devScenarios.adapters.offlineDone", { id: target }))}>
                {t("devScenarios.adapters.offline")}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy || !target} onClick={() => void send({ action: "adapter_offline", adapterId: target, offline: false }, t("devScenarios.adapters.onlineDone", { id: target }))}>
                {t("devScenarios.adapters.online")}
              </Button>
              {!target ? <span className="ds-muted">{t("devScenarios.adapters.pickOne")}</span> : null}
            </div>
            <div className="ds-inline">
              <NumberField label={t("devScenarios.adapters.latency")} integer min={0} max={60000} value={latency} onValueChange={setLatency} />
              <Button type="button" disabled={busy || latency === null} onClick={() => latency !== null && void send({ action: "latency", ms: Math.round(latency), ...(target ? { adapterId: target } : {}) }, t("devScenarios.adapters.latencyDone", { ms: latency }))}>
                {t("devScenarios.set")}
              </Button>
            </div>
            <div className="ds-inline">
              <Slider label={t("devScenarios.adapters.errorRate")} min={0} max={1} step={0.05} value={errorRate} formatValue={(v) => `${Math.round(v * 100)} %`} onValueChange={setErrorRate} />
              <Button type="button" disabled={busy} onClick={() => void send({ action: "error_rate", rate: errorRate, ...(target ? { adapterId: target } : {}) }, t("devScenarios.adapters.errorRateDone", { rate: Math.round(errorRate * 100) }))}>
                {t("devScenarios.set")}
              </Button>
            </div>
            {state && state.adapterOverrides.length > 0 ? (
              <ul className="ds-overrides" aria-label={t("devScenarios.adapters.overrides")}>
                {state.adapterOverrides.map((override) => (
                  <li key={override.adapterId} data-active={override.adapterId === target || undefined}>
                    <span className="ds-mono">{override.adapterId}</span>
                    <StatusChip tone={override.offline ? "red" : "green"}>{override.offline ? t("devScenarios.adapters.stateOffline") : t("devScenarios.adapters.stateOnline")}</StatusChip>
                    {override.latencyMs !== undefined ? <span className="ds-mono">{override.latencyMs} ms</span> : null}
                    {override.errorRate !== undefined ? <span className="ds-mono">{Math.round(override.errorRate * 100)} %</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ds-muted">{t("devScenarios.adapters.noOverrides")}</p>
            )}
          </HudPanel>
        </div>

        <div className="ds-col">
          <HudPanel title={t("devScenarios.orb.title")} subtitle={t("devScenarios.orb.subtitle")} icon={<Zap {...ICON} />} tone="gold" level={2} live className="ds-panel">
            <div className="ds-orbstatus" role="status" aria-live="polite" aria-label={t("devScenarios.orb.live")}>
              <span className="jv-field__label">{t("devScenarios.orb.live")}</span>
              {orbSnapshot ? (
                <>
                  <StatusChip tone="gold" pulse>
                    {modeLabel(t, orbSnapshot.status.mode)}
                  </StatusChip>
                  <span className="ds-orbtext">{orbSnapshot.status.activityText ?? "—"}</span>
                  <span className="ds-muted ds-mono">{orbSnapshot.status.health}</span>
                </>
              ) : (
                <span className="ds-muted">—</span>
              )}
              {state?.forcedOrbMode ? <TagPill tone="amber">{t("devScenarios.orb.forced", { mode: modeLabel(t, state.forcedOrbMode) })}</TagPill> : null}
            </div>
            <Select label={t("devScenarios.orb.mode")} value={orbMode} options={ORB_MODES.map((mode) => ({ value: mode, label: modeLabel(t, mode) }))} onChange={(event) => setOrbMode(event.target.value as OrbMode)} />
            <TextField label={t("devScenarios.orb.text")} value={orbText} placeholder={t("devScenarios.orb.textPlaceholder")} onChange={(event) => setOrbText(event.target.value)} />
            <Slider label={t("devScenarios.orb.level")} min={0} max={1} step={0.05} value={orbLevel} formatValue={(v) => `${Math.round(v * 100)} %`} onValueChange={setOrbLevel} />
            <div className="ds-row">
              <Button type="button" variant="jarvis" icon={<Zap size={15} />} disabled={busy} onClick={() => void send(forceOrbRequest(orbMode, { text: orbText.trim(), level: orbLevel }), t("devScenarios.orb.forceDone", { mode: modeLabel(t, orbMode) }))}>
                {t("devScenarios.orb.force")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                icon={<Unlock size={15} />}
                disabled={busy || !state?.forcedOrbMode}
                title={state?.forcedOrbMode ? undefined : t("devScenarios.orb.releaseNothing")}
                onClick={() => void send({ action: "release_orb_state" }, t("devScenarios.orb.releaseDone"))}
              >
                {t("devScenarios.orb.release")}
              </Button>
            </div>
            <p className="ds-muted">{t("devScenarios.orb.releaseHint")}</p>
          </HudPanel>

          <HudPanel title={t("devScenarios.events.title")} subtitle={t("devScenarios.events.subtitle")} icon={<Sparkles {...ICON} />} className="ds-panel">
            <div className="ds-chips" role="group" aria-label={t("devScenarios.events.title")}>
              {eventButtons.map((name) => (
                <Button key={name} type="button" size="sm" variant="ghost" disabled={busy || running !== null} onClick={() => void playEvent(name)}>
                  {t(`devScenarios.event.${name}` as MessageKey)}
                </Button>
              ))}
            </div>
            {running ? (
              <p className="ds-muted" role="status">
                {t("devScenarios.events.running", { name: running.name, step: running.step, total: running.total })}
              </p>
            ) : null}
          </HudPanel>

          <HudPanel title={t("devScenarios.caps.title")} subtitle={t("devScenarios.caps.subtitle")} icon={<ShieldCheck {...ICON} />} className="ds-panel">
            <div className="ds-inline">
              <Select label={t("devScenarios.caps.module")} value={capModule} options={modules.map(([name]) => ({ value: name, label: name }))} onChange={(event) => setCapModule(event.target.value)} />
              <Select label={t("devScenarios.caps.capability")} value={capName} options={capKeys.map((key) => ({ value: key, label: key }))} onChange={(event) => setCapName(event.target.value)} />
            </div>
            <div className="ds-row">
              <Button type="button" size="sm" variant="ghost" disabled={busy || !capName} onClick={() => void send({ action: "capability_toggle", module: capModule, capability: capName, enabled: true }, t("devScenarios.caps.done", { path: `${capModule}.${capName}`, state: t("devScenarios.caps.on") }))}>
                {t("devScenarios.caps.enable")}
              </Button>
              <Button type="button" size="sm" variant="danger" disabled={busy || !capName} onClick={() => void send({ action: "capability_toggle", module: capModule, capability: capName, enabled: false }, t("devScenarios.caps.done", { path: `${capModule}.${capName}`, state: t("devScenarios.caps.off") }))}>
                {t("devScenarios.caps.disable")}
              </Button>
            </div>
            {state && state.capabilityOverrides.length > 0 ? (
              <ul className="ds-overrides" aria-label={t("devScenarios.caps.overrides")}>
                {state.capabilityOverrides.map((override) => (
                  <li key={`${override.module}.${override.capability}`}>
                    <Switch
                      label={`${override.module}.${override.capability}`}
                      checked={override.enabled}
                      disabled={busy}
                      stateLabels={[t("devScenarios.caps.on"), t("devScenarios.caps.off")]}
                      onCheckedChange={(enabled) => void send({ action: "capability_toggle", module: override.module, capability: override.capability, enabled }, t("devScenarios.caps.done", { path: `${override.module}.${override.capability}`, state: enabled ? t("devScenarios.caps.on") : t("devScenarios.caps.off") }))}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ds-muted">{t("devScenarios.caps.noOverrides")}</p>
            )}
          </HudPanel>
        </div>

        <div className="ds-col">
          <StatePanel state={state} />
          <HudPanel title={t("devScenarios.recent.title")} subtitle={t("devScenarios.recent.subtitle")} icon={<Zap {...ICON} />} live className="ds-panel ds-panel--events" scroll>
            {activity.isPending ? (
              <Skeleton variant="row" height={44} />
            ) : (activity.data?.items ?? []).length === 0 ? (
              <EmptyState compact title={t("devScenarios.recent.empty")} />
            ) : (
              <ol className="ds-events" aria-label={t("devScenarios.recent.title")}>
                {(activity.data?.items ?? []).map((event) => (
                  <li key={event.id} data-severity={event.severity}>
                    <span className="ds-mono ds-muted">#{event.sequence}</span>
                    <span className="ds-events__title">{event.title}</span>
                    <span className="ds-mono ds-muted">{fmtTime(event.occurredAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </HudPanel>
        </div>
      </div>
    </div>
  );
}
