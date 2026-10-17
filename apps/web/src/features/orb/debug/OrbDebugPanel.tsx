"use client";

import { Button, HudPanel, Slider, Switch } from "@friday/ui";
import { FlaskConical } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ORB_MODES } from "@/features/settings/settingsLogic";
import { useT, type MessageKey } from "@/i18n";
import { getOrbRuntime } from "../orbRuntime";
import { DEFAULT_DEBUG_VISUALS, resetOrbDebugVisuals, setOrbDebugVisuals } from "./orbDebugStore";

type DemoName = "auto" | "voice" | "working" | "errorRecovery";
const DEMOS: readonly { name: DemoName; label: MessageKey }[] = [
  { name: "auto", label: "devScenarios.orbLab.demoAuto" },
  { name: "voice", label: "devScenarios.orbLab.demoVoice" },
  { name: "working", label: "devScenarios.orbLab.demoWorking" },
  { name: "errorRecovery", label: "devScenarios.orbLab.demoError" },
];
const percent = (value: number): string => `${Math.round(value * 100)} %`;

/**
 * Development-only orb lab (owner order section 19): every mode, the audio/progress/agent values and the visual
 * parameters, driven straight into the orb controller so all states can be checked without a backend. Never part of a
 * production build: the callers load it behind `process.env.NODE_ENV !== "production"`.
 */
export default function OrbDebugPanel() {
  const { t } = useT();
  const runtime = getOrbRuntime();
  const { controller, demo } = runtime;
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [input, setInput] = useState(0);
  const [output, setOutput] = useState(0);
  const [progress, setProgress] = useState(0.4);
  const [progressKnown, setProgressKnown] = useState(true);
  const [agents, setAgents] = useState(0);
  const [bloom, setBloom] = useState(DEFAULT_DEBUG_VISUALS.bloom);
  const [particles, setParticles] = useState(DEFAULT_DEBUG_VISUALS.particleDensity);
  const [speed, setSpeed] = useState(DEFAULT_DEBUG_VISUALS.speed);
  const [demoName, setDemoName] = useState<DemoName | null>(null);

  useEffect(() => () => demo.stop(), [demo]);

  const stopDemo = (): void => {
    demo.stop();
    setDemoName(null);
  };
  const startDemo = (name: DemoName): void => {
    demo.stop();
    demo.start(name);
    setDemoName(name);
  };
  const reset = (): void => {
    stopDemo();
    controller.reset();
    resetOrbDebugVisuals();
    setInput(0);
    setOutput(0);
    setProgress(0.4);
    setProgressKnown(true);
    setAgents(0);
    setBloom(DEFAULT_DEBUG_VISUALS.bloom);
    setParticles(DEFAULT_DEBUG_VISUALS.particleDensity);
    setSpeed(DEFAULT_DEBUG_VISUALS.speed);
  };

  return (
    <HudPanel title={t("devScenarios.orbLab.title")} subtitle={t("devScenarios.orbLab.subtitle")} icon={<FlaskConical size={16} strokeWidth={1.5} />} tone="gold" level={2} className="ds-panel" data-testid="orb-lab">
      <p className="ds-muted ds-mono" role="status" aria-label={t("devScenarios.orbLab.live")} data-testid="orb-lab-state">
        {state.status.mode}
        {state.overrideMode ? ` (${state.overrideMode})` : ""} · {state.layers.primaryInteraction} / {state.layers.backgroundWork}
        {demoName ? ` · ${demoName}` : ""}
      </p>
      <div className="ds-chips" role="group" aria-label={t("devScenarios.orbLab.modes")}>
        {ORB_MODES.map((mode) => (
          <button key={mode} type="button" className="ds-chip" aria-pressed={state.status.mode === mode} data-mode={mode} onClick={() => { stopDemo(); controller.setMode(mode); }}>
            {t(`settings.orb.mode.${mode}` as MessageKey)}
          </button>
        ))}
      </div>
      <Slider label={t("devScenarios.orbLab.input")} min={0} max={1} step={0.01} value={input} formatValue={percent} onValueChange={(value) => { setInput(value); controller.setInputAudioLevel(value); }} />
      <Slider label={t("devScenarios.orbLab.output")} min={0} max={1} step={0.01} value={output} formatValue={percent} onValueChange={(value) => { setOutput(value); controller.setOutputAudioLevel(value); }} />
      <Slider
        label={t("devScenarios.orbLab.progress")}
        min={0}
        max={1}
        step={0.01}
        value={progress}
        disabled={!progressKnown}
        formatValue={(value) => (progressKnown ? percent(value) : "—")}
        onValueChange={(value) => { setProgress(value); controller.setProgress(value, "determinate"); }}
      />
      <Switch
        label={t("devScenarios.orbLab.progressUnknown")}
        checked={!progressKnown}
        onCheckedChange={(unknown) => {
          setProgressKnown(!unknown);
          if (unknown) controller.setProgress(null, "indeterminate");
          else controller.setProgress(progress, "determinate");
        }}
      />
      <Slider label={t("devScenarios.orbLab.agents")} min={0} max={8} step={1} value={agents} onValueChange={(value) => { setAgents(value); controller.setAgentCount(value); }} />
      <Slider label={t("devScenarios.orbLab.bloom")} min={0} max={100} step={1} value={bloom} onValueChange={(value) => { setBloom(value); setOrbDebugVisuals({ bloom: value }); }} />
      <Slider label={t("devScenarios.orbLab.particles")} min={0} max={100} step={1} value={particles} onValueChange={(value) => { setParticles(value); setOrbDebugVisuals({ particleDensity: value }); }} />
      <Slider label={t("devScenarios.orbLab.speed")} min={0.25} max={2} step={0.05} value={speed} formatValue={(value) => `${value.toFixed(2)}×`} onValueChange={(value) => { setSpeed(value); setOrbDebugVisuals({ speed: value }); }} />
      <div className="ds-row" role="group" aria-label={t("devScenarios.orbLab.demos")}>
        {DEMOS.map(({ name, label }) => (
          <Button key={name} type="button" size="sm" variant={demoName === name ? "friday" : "ghost"} aria-pressed={demoName === name} onClick={() => startDemo(name)}>
            {t(label)}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" disabled={demoName === null} onClick={stopDemo}>
          {t("devScenarios.orbLab.stop")}
        </Button>
        <Button type="button" size="sm" variant="danger" onClick={reset}>
          {t("devScenarios.orbLab.reset")}
        </Button>
      </div>
    </HudPanel>
  );
}
