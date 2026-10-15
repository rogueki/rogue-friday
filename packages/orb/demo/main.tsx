import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AUDIO_FIXTURE_NAMES,
  FridayOrb,
  layersFromStatus,
  type AudioFixtureName,
  type OrbAnimations,
  type OrbLayers,
  type OrbMode,
  type OrbQualitySetting,
  type OrbRenderer,
  type OrbSettings,
  type OrbStatus,
} from "../src/index";

const MODES: OrbMode[] = [
  "booting", "idle", "listening", "transcribing", "thinking", "syncing", "working", "speaking",
  "waiting_approval", "success", "warning", "error", "offline", "paused",
];

type Preset = OrbMode | "parallel";

const params = new URLSearchParams(window.location.search);
const num = (key: string): number | undefined => {
  const v = params.get(key);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

const fixedTime = num("t");
const initial = {
  preset: (params.get("mode") as Preset | null) ?? "idle",
  progress: num("progress"),
  indeterminate: params.get("indeterminate") === "1",
  agents: num("agents") ?? 0,
  audio: num("audio") ?? 0.55,
  quality: (params.get("quality") as OrbQualitySetting | null) ?? "auto",
  animations: (params.get("anim") as OrbAnimations | null) ?? "full",
  renderer: (params.get("renderer") as OrbRenderer | null) ?? "auto",
  bloom: params.get("bloom") !== "0",
  intensity: num("intensity") ?? 70,
  fixture: (params.get("fixture") as AudioFixtureName | null) ?? undefined,
  animationProgress: num("ap"),
  size: params.get("size") === "large" ? "large" : "small",
  perf: params.get("perf") === "1",
  shot: params.get("shot") === "1",
};

const MOUNT_TIME = new Date(Date.now() - 134_000).toISOString();

function buildStatus(preset: Preset, s: typeof initial): { status: OrbStatus; layers: OrbLayers } {
  const mode: OrbMode = preset === "parallel" ? "speaking" : preset;
  const working = preset === "working" || preset === "parallel";
  const agents = preset === "parallel" ? Math.max(3, s.agents) : s.agents;
  const hasProgress = working && s.progress !== undefined && !s.indeterminate;
  const activity: Partial<Record<OrbMode, string>> = {
    working: "RECHERCHE LÄUFT",
    syncing: "KALENDER WIRD SYNCHRONISIERT",
    waiting_approval: "E-MAIL-ENTWURF FREIGEBEN",
    error: "ADAPTER NICHT ERREICHBAR",
    warning: "EINZELNE QUELLEN VERZÖGERT",
    thinking: "ANALYSE LÄUFT",
  };
  const status: OrbStatus = {
    mode,
    activityText: preset === "parallel" ? "3 AGENTEN AKTIV" : activity[mode],
    progress: hasProgress ? (s.progress ?? 0) / 100 : null,
    progressMode: working ? (hasProgress ? "determinate" : "indeterminate") : "none",
    audioLevel: mode === "listening" || mode === "speaking" ? s.audio : 0,
    activeAgentCount: working || agents > 0 ? agents : 0,
    currentAgentId: working ? "agent_research" : undefined,
    taskId: working ? "task_01JZ8Q3N4K" : undefined,
    approvalId: mode === "waiting_approval" ? "appr_01JZ8Q3N4K" : undefined,
    health: "online",
    since: MOUNT_TIME,
    sourceEventId: "evt_demo",
  };
  const layers = layersFromStatus(status);
  if (preset === "parallel") {
    layers.work = "working";
    layers.voice = "speaking";
    layers.activeAgentIds = Array.from({ length: agents }, (_, i) => `agent_${i + 1}`);
    status.progress = hasProgress ? (s.progress ?? 0) / 100 : null;
    status.progressMode = hasProgress ? "determinate" : "indeterminate";
  }
  return { status, layers };
}

function Row({ label, children, value }: { label: string; children: React.ReactNode; value?: string }) {
  return (
    <label className="row">
      <span>{label}</span>
      {children}
      <span>{value}</span>
    </label>
  );
}

function Demo() {
  const [s, setS] = useState(initial);
  const [rev, setRev] = useState<string>("");
  const patch = (p: Partial<typeof initial>) => setS((prev) => ({ ...prev, ...p }));
  const { status, layers } = useMemo(() => buildStatus(s.preset, s), [s]);

  const settings: Partial<OrbSettings> = useMemo(
    () => ({
      quality: s.quality,
      animations: s.animations,
      renderer: s.renderer,
      bloom: s.bloom,
      intensity: s.intensity,
      audioFixture: s.fixture,
      testClock: fixedTime !== undefined ? { fixedTime, animationProgress: s.animationProgress } : undefined,
    }),
    [s.quality, s.animations, s.renderer, s.bloom, s.intensity, s.fixture, s.animationProgress],
  );

  useEffect(() => {
    document.body.classList.toggle("shot", s.shot);
  }, [s.shot]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const p = window.__ORB_DEBUG__;
      setRev(p ? `frames ${p.frames}  avg ${p.avgFrameMs.toFixed(1)} ms  p95 ${p.p95FrameMs.toFixed(1)} ms  draws ${p.draws}` : "no webgl probe (2D)");
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const panel = (
    <div className={`panel ${s.size}`} data-testid="orb-panel">
      <div className="panel__title">AI Core</div>
      <FridayOrb
        status={status}
        layers={layers}
        settings={settings}
        showPerf={s.perf}
        onActivate={(t) => console.info("activate", JSON.stringify(t))}
        onVoiceToggle={() => console.info("voice toggle")}
      />
    </div>
  );

  if (s.shot) return panel;

  return (
    <div className="demo-grid">
      {panel}
      <div className="controls">
        <fieldset>
          <legend>Zustand</legend>
          <div className="modes">
            {([...MODES, "parallel"] as Preset[]).map((m) => (
              <button key={m} className="mode" aria-pressed={s.preset === m} onClick={() => patch({ preset: m })}>
                {m === "parallel" ? "speaking + 3 agents" : m}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Werte</legend>
          <Row label="Fortschritt" value={s.progress === undefined ? "–" : `${s.progress}%`}>
            <input type="range" min={0} max={100} value={s.progress ?? 0} onChange={(e) => patch({ progress: Number(e.target.value), indeterminate: false })} />
          </Row>
          <Row label="unbestimmt">
            <input type="checkbox" checked={s.indeterminate} onChange={(e) => patch({ indeterminate: e.target.checked })} />
          </Row>
          <Row label="Audio" value={`${Math.round(s.audio * 100)}%`}>
            <input type="range" min={0} max={100} value={Math.round(s.audio * 100)} onChange={(e) => patch({ audio: Number(e.target.value) / 100, fixture: undefined })} />
          </Row>
          <Row label="Audio-Fixture">
            <select value={s.fixture ?? ""} onChange={(e) => patch({ fixture: (e.target.value || undefined) as AudioFixtureName | undefined })}>
              <option value="">(Slider)</option>
              {AUDIO_FIXTURE_NAMES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </Row>
          <Row label="Agenten" value={String(s.agents)}>
            <input type="range" min={0} max={8} value={s.agents} onChange={(e) => patch({ agents: Number(e.target.value) })} />
          </Row>
          <Row label="Intensität" value={String(s.intensity)}>
            <input type="range" min={0} max={100} value={s.intensity} onChange={(e) => patch({ intensity: Number(e.target.value) })} />
          </Row>
        </fieldset>
        <fieldset>
          <legend>Rendering</legend>
          <Row label="Qualität">
            <select value={s.quality} onChange={(e) => patch({ quality: e.target.value as OrbQualitySetting })}>
              {["auto", "low", "medium", "high", "ultra"].map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </Row>
          <Row label="Animationen">
            <select value={s.animations} onChange={(e) => patch({ animations: e.target.value as OrbAnimations })}>
              {["full", "reduced", "off"].map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </Row>
          <Row label="Renderer">
            <select value={s.renderer} onChange={(e) => patch({ renderer: e.target.value as OrbRenderer })}>
              {["auto", "3d", "2d"].map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </Row>
          <Row label="Bloom">
            <input type="checkbox" checked={s.bloom} onChange={(e) => patch({ bloom: e.target.checked })} />
          </Row>
          <Row label="Panel">
            <select value={s.size} onChange={(e) => patch({ size: e.target.value as "small" | "large" })}>
              <option value="small">560 x 380</option>
              <option value="large">900 x 700</option>
            </select>
          </Row>
          <Row label="Perf-Overlay">
            <input type="checkbox" checked={s.perf} onChange={(e) => patch({ perf: e.target.checked })} />
          </Row>
        </fieldset>
        <div className="log">{rev}{fixedTime !== undefined ? `\ntest clock t=${fixedTime}s` : ""}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
