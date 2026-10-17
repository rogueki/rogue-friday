import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AUDIO_FIXTURE_NAMES,
  FridayOrb,
  createAudioAnalyzer,
  createOrbController,
  createOrbDemo,
  type AudioAnalyzer,
  type AudioFixtureName,
  type OrbAnimations,
  type OrbController,
  type OrbDemoName,
  type OrbMode,
  type OrbQualitySetting,
  type OrbRenderer,
  type OrbSettings,
} from "../src/index";

/** Debug-panel mode buttons (owner order section 19). */
const PANEL_MODES: Array<{ mode: OrbMode; label: string }> = [
  { mode: "idle", label: "Idle" },
  { mode: "listening", label: "Listening" },
  { mode: "transcribing", label: "Transcribing" },
  { mode: "thinking", label: "Thinking" },
  { mode: "syncing", label: "Syncing" },
  { mode: "working", label: "Working" },
  { mode: "speaking", label: "Speaking" },
  { mode: "waiting_approval", label: "Waiting Approval" },
  { mode: "success", label: "Success" },
  { mode: "warning", label: "Warning" },
  { mode: "error", label: "Error" },
  { mode: "offline", label: "Offline" },
  { mode: "paused", label: "Paused" },
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
  audio: num("audio") ?? 0,
  quality: (params.get("quality") as OrbQualitySetting | null) ?? "auto",
  animations: (params.get("anim") as OrbAnimations | null) ?? "full",
  renderer: (params.get("renderer") as OrbRenderer | null) ?? "auto",
  bloom: params.get("bloom") !== "0",
  bloomStrength: num("bloomStrength") ?? 1,
  intensity: num("intensity") ?? 70,
  particles: num("particles") ?? 60,
  speed: num("speed") ?? 1,
  fixture: (params.get("fixture") as AudioFixtureName | null) ?? undefined,
  animationProgress: num("ap"),
  size: params.get("size") === "large" ? "large" : "small",
  perf: params.get("perf") === "1",
  shot: params.get("shot") === "1",
  fill: num("fill") ?? 0.72,
  demo: (params.get("demo") as OrbDemoName | null) ?? null,
};

/** Applies a URL preset to the controller: the same layer model the product uses, no snapshot shortcuts. */
function applyPreset(controller: OrbController, preset: Preset, s: typeof initial): void {
  controller.reset();
  const parallel = preset === "parallel";
  const mode: OrbMode = parallel ? "speaking" : preset;
  const working = mode === "working" || parallel;
  const agents = parallel ? Math.max(3, s.agents) : s.agents;
  controller.setMode(mode);
  if (working) controller.bridge.onTaskStarted({ taskId: "task_01JZ8Q3N4K" });
  if (agents > 0) controller.setAgentCount(agents, ["Agent Atlas", "Agent Nova", "Agent Kepler"].slice(0, agents));
  if (working || parallel) {
    if (s.indeterminate || s.progress === undefined) controller.setProgress(null, "indeterminate");
    else controller.setProgress(s.progress / 100, "determinate");
  }
  const activity: Partial<Record<OrbMode, string>> = {
    working: "RECHERCHE LÄUFT",
    syncing: "KALENDER WIRD SYNCHRONISIERT",
    waiting_approval: "E-MAIL-ENTWURF FREIGEBEN",
    error: "ADAPTER NICHT ERREICHBAR",
    warning: "EINZELNE QUELLEN VERZÖGERT",
    thinking: "ANFRAGE WIRD ANALYSIERT",
    listening: "SPRACHE ERKANNT",
  };
  const text = parallel ? "3 AGENTEN AKTIV" : activity[mode];
  if (text) controller.setActivity(text);
  if (s.audio > 0) {
    controller.setInputAudioLevel(s.audio);
    controller.setOutputAudioLevel(s.audio);
  }
}

/** Layered scenes that need real facts (no override): the order's parallel-state examples. */
function applyScene(controller: OrbController, scene: string, audio: number): void {
  controller.reset();
  if (scene === "approvalSpeaking") {
    controller.bridge.onAgentActivity(2, ["Agent Atlas", "Agent Nova"]);
    controller.bridge.onTtsStarted({ hasAudioAnalysis: true });
    controller.bridge.onApprovalRequired("appr_01JZ8Q3N4K");
    controller.setOutputAudioLevel(audio > 0 ? audio : 0.5);
  }
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

/** Opens the real microphone and feeds the analyser tap (Web Audio) into the controller. */
async function startMicrophone(controller: OrbController): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyzer: AudioAnalyzer = createAudioAnalyzer(context, source, { kind: "input" });
  controller.setInputAudioSource(analyzer);
  controller.bridge.onMicrophoneOpened({ source: "browser" });
  return () => {
    controller.bridge.onMicrophoneClosed();
    controller.setInputAudioSource(null);
    analyzer.dispose();
    stream.getTracks().forEach((t) => t.stop());
    void context.close();
  };
}

/** Plays a syllable-modulated test tone through the output analyser tap (stands in for TTS audio). */
function startTestTone(controller: OrbController): () => void {
  const context = new AudioContext();
  const osc = context.createOscillator();
  const osc2 = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = 140;
  osc2.type = "triangle";
  osc2.frequency.value = 2200;
  const bus = context.createGain();
  bus.gain.value = 0.4;
  osc.connect(gain);
  osc2.connect(gain);
  gain.connect(bus);
  const analyzer = createAudioAnalyzer(context, bus, { kind: "output" });
  controller.setOutputAudioSource(analyzer);
  controller.bridge.onTtsStarted({ hasAudioAnalysis: true });
  osc.start();
  osc2.start();
  // irregular syllables with pauses so the analyser has something realistic to follow
  let t = context.currentTime;
  let syllable = 0;
  const schedule = () => {
    while (t < context.currentTime + 2) {
      const dur = 0.14 + ((Math.sin(syllable * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.12;
      const amp = 0.15 + ((Math.sin(syllable * 78.233) * 12345.6789) % 1 + 1) % 1 * 0.5;
      gain.gain.setTargetAtTime(amp, t, 0.02);
      gain.gain.setTargetAtTime(0.0001, t + dur, 0.03);
      t += dur + (syllable % 7 === 6 ? 0.5 : syllable % 3 === 2 ? 0.1 : 0.03);
      syllable += 1;
    }
  };
  schedule();
  const id = window.setInterval(schedule, 500);
  return () => {
    window.clearInterval(id);
    controller.bridge.onTtsEnded();
    controller.setOutputAudioSource(null);
    analyzer.dispose();
    osc.stop();
    osc2.stop();
    void context.close();
  };
}

function Demo() {
  const controller = useMemo(() => createOrbController({ seed: num("seed") ?? 20260617 }), []);
  const demo = useMemo(() => createOrbDemo(controller, { loop: params.get("loop") === "1" }), [controller]);
  const [s, setS] = useState(initial);
  const [rev, setRev] = useState<string>("");
  const [demoName, setDemoName] = useState<OrbDemoName | null>(initial.demo);
  const [micOn, setMicOn] = useState(false);
  const [toneOn, setToneOn] = useState(false);
  const stops = useRef<{ mic?: () => void; tone?: () => void }>({});
  const patch = (p: Partial<typeof initial>) => setS((prev) => ({ ...prev, ...p }));

  useEffect(() => {
    const scene = params.get("scene");
    if (initial.demo) demo.start(initial.demo);
    else if (scene) applyScene(controller, scene, initial.audio);
    else applyPreset(controller, initial.preset, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-off initial state from the URL
  }, []);

  const settings: Partial<OrbSettings> = useMemo(
    () => ({
      quality: s.quality,
      animations: s.animations,
      renderer: s.renderer,
      bloom: s.bloom,
      bloomStrength: s.bloomStrength,
      intensity: s.intensity,
      particleDensity: s.particles,
      speed: s.speed,
      audioFixture: s.fixture,
      testClock: fixedTime !== undefined ? { fixedTime, animationProgress: s.animationProgress } : undefined,
    }),
    [s.quality, s.animations, s.renderer, s.bloom, s.bloomStrength, s.intensity, s.particles, s.speed, s.fixture, s.animationProgress],
  );

  useEffect(() => {
    document.body.classList.toggle("shot", s.shot);
  }, [s.shot]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const p = window.__ORB_DEBUG__;
      const st = controller.getState();
      setRev(
        (p
          ? `frames ${p.frames}  avg ${p.avgFrameMs.toFixed(1)} ms  p95 ${p.p95FrameMs.toFixed(1)} ms  draws ${p.draws}\naudio in:${p.audioSource?.input} out:${p.audioSource?.output}${p.audioSource?.envelope ? " (Sprachhüllkurve)" : ""}`
          : "no webgl probe (2D)") + `\nmode ${st.status.mode}${st.status.derived ? " (abgeleitet)" : ""}  v${st.version}`,
      );
    }, 500);
    return () => window.clearInterval(id);
  }, [controller]);

  const setMode = (m: Preset) => {
    demo.stop();
    setDemoName(null);
    applyPreset(controller, m, { ...s, audio: s.audio });
    patch({ preset: m });
  };

  const startDemo = (name: OrbDemoName) => {
    controller.reset();
    demo.start(name);
    setDemoName(name);
  };

  const panel = (
    <div className={`panel ${s.size}`} data-testid="orb-panel">
      <div className="panel__title">AI Core</div>
      <FridayOrb
        controller={controller}
        settings={settings}
        showPerf={s.perf}
        fillRatio={s.fill}
        onActivate={(t) => console.info("activate", JSON.stringify(t))}
        onVoiceToggle={() => console.info("voice toggle")}
      />
    </div>
  );

  if (s.shot) return panel;

  const b = controller.bridge;
  return (
    <div className="demo-grid">
      {panel}
      <div className="controls">
        <fieldset>
          <legend>Zustand</legend>
          <div className="modes">
            {PANEL_MODES.map((m) => (
              <button key={m.mode} className="mode" aria-pressed={s.preset === m.mode} onClick={() => setMode(m.mode)}>
                {m.label}
              </button>
            ))}
            <button className="mode" aria-pressed={s.preset === "parallel"} onClick={() => setMode("parallel")}>speaking + 3 agents</button>
            <button className="mode" aria-pressed={s.preset === "booting"} onClick={() => setMode("booting")}>Booting</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Demos</legend>
          <div className="modes">
            {(["auto", "voice", "working", "errorRecovery"] as OrbDemoName[]).map((n) => (
              <button key={n} className="mode" aria-pressed={demoName === n} onClick={() => startDemo(n)}>
                {n === "auto" ? "Auto Demo" : n === "voice" ? "Voice Demo" : n === "working" ? "Working Demo" : "Error Recovery Demo"}
              </button>
            ))}
            <button
              className="mode"
              onClick={() => {
                demo.stop();
                setDemoName(null);
                controller.reset();
              }}
            >
              Reset
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Werte</legend>
          <Row label="Input Audio" value={`${Math.round(s.audio * 100)}%`}>
            <input type="range" min={0} max={100} value={Math.round(s.audio * 100)} onChange={(e) => { const v = Number(e.target.value) / 100; patch({ audio: v, fixture: undefined }); controller.setInputAudioLevel(v); }} />
          </Row>
          <Row label="Output Audio">
            <input type="range" min={0} max={100} defaultValue={0} onChange={(e) => controller.setOutputAudioLevel(Number(e.target.value) / 100)} />
          </Row>
          <Row label="Fortschritt" value={s.progress === undefined ? "–" : `${s.progress}%`}>
            <input type="range" min={0} max={100} value={s.progress ?? 0} onChange={(e) => { const v = Number(e.target.value); patch({ progress: v, indeterminate: false }); controller.setProgress(v / 100, "determinate"); }} />
          </Row>
          <Row label="unbekannt">
            <input type="checkbox" checked={s.indeterminate} onChange={(e) => { patch({ indeterminate: e.target.checked }); if (e.target.checked) controller.setProgress(null, "indeterminate"); }} />
          </Row>
          <Row label="Agenten" value={String(s.agents)}>
            <input type="range" min={0} max={8} value={s.agents} onChange={(e) => { const n = Number(e.target.value); patch({ agents: n }); controller.setAgentCount(n); }} />
          </Row>
          <Row label="Bloom" value={s.bloomStrength.toFixed(1)}>
            <input type="range" min={0} max={150} value={Math.round(s.bloomStrength * 100)} onChange={(e) => patch({ bloomStrength: Number(e.target.value) / 100 })} />
          </Row>
          <Row label="Partikeldichte" value={String(s.particles)}>
            <input type="range" min={0} max={100} value={s.particles} onChange={(e) => patch({ particles: Number(e.target.value) })} />
          </Row>
          <Row label="Animation Speed" value={s.speed.toFixed(2)}>
            <input type="range" min={25} max={200} value={Math.round(s.speed * 100)} onChange={(e) => patch({ speed: Number(e.target.value) / 100 })} />
          </Row>
          <Row label="Audio-Fixture">
            <select value={s.fixture ?? ""} onChange={(e) => patch({ fixture: (e.target.value || undefined) as AudioFixtureName | undefined })}>
              <option value="">(Controller)</option>
              {AUDIO_FIXTURE_NAMES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </Row>
          <Row label="Intensität" value={String(s.intensity)}>
            <input type="range" min={0} max={100} value={s.intensity} onChange={(e) => patch({ intensity: Number(e.target.value) })} />
          </Row>
        </fieldset>
        <fieldset>
          <legend>Event-Bridge</legend>
          <div className="modes">
            <button className="mode" onClick={() => b.onMicrophoneOpened({ source: "service" })}>Mikro auf</button>
            <button className="mode" onClick={() => b.onMicrophoneClosed()}>Mikro zu</button>
            <button className="mode" onClick={() => b.onVoiceActivity(0.6)}>VAD 0.6</button>
            <button className="mode" onClick={() => b.onTranscriptionStarted()}>Transkription +</button>
            <button className="mode" onClick={() => b.onTranscriptionCompleted()}>Transkription -</button>
            <button className="mode" onClick={() => b.onThinkingStarted()}>Thinking +</button>
            <button className="mode" onClick={() => b.onThinkingCompleted()}>Thinking -</button>
            <button className="mode" onClick={() => { b.onTaskStarted({ taskId: "t1", title: "Recherche läuft" }); b.onAgentActivity(3); }}>Task +</button>
            <button className="mode" onClick={() => b.onTaskProgress(0.5)}>Progress 50%</button>
            <button className="mode" onClick={() => b.onTaskProgress(null)}>Progress ?</button>
            <button className="mode" onClick={() => { b.onAgentActivity(0); b.onTaskCompleted({ taskId: "t1", success: true }); }}>Task fertig</button>
            <button className="mode" onClick={() => b.onTtsStarted({ hasAudioAnalysis: false })}>TTS + (Hüllkurve)</button>
            <button className="mode" onClick={() => b.onTtsEnded()}>TTS -</button>
            <button className="mode" onClick={() => b.onTtsEnded({ interrupted: true })}>Barge-In</button>
            <button className="mode" onClick={() => b.onApprovalRequired("appr_demo")}>Freigabe +</button>
            <button className="mode" onClick={() => b.onApprovalResolved()}>Freigabe -</button>
            <button className="mode" onClick={() => b.onWarning("Eingeschränkter Betrieb: Quelle verzögert")}>Warnung +</button>
            <button className="mode" onClick={() => b.onWarningCleared()}>Warnung -</button>
            <button className="mode" onClick={() => b.onError("Adapter nicht erreichbar")}>Fehler +</button>
            <button className="mode" onClick={() => b.onErrorCleared()}>Fehler -</button>
            <button className="mode" onClick={() => b.onSyncStarted("calendar")}>Sync +</button>
            <button className="mode" onClick={() => b.onSyncFinished()}>Sync -</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Echtes Audio</legend>
          <div className="modes">
            <button
              className="mode"
              aria-pressed={micOn}
              onClick={async () => {
                if (stops.current.mic) {
                  stops.current.mic();
                  stops.current.mic = undefined;
                  setMicOn(false);
                  return;
                }
                try {
                  stops.current.mic = await startMicrophone(controller);
                  setMicOn(true);
                } catch (e) {
                  console.error("microphone failed", e);
                }
              }}
            >
              Mikrofon (Analyser)
            </button>
            <button
              className="mode"
              aria-pressed={toneOn}
              onClick={() => {
                if (stops.current.tone) {
                  stops.current.tone();
                  stops.current.tone = undefined;
                  setToneOn(false);
                  return;
                }
                stops.current.tone = startTestTone(controller);
                setToneOn(true);
              }}
            >
              TTS-Testton (Analyser)
            </button>
          </div>
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
          <Row label="Bloom an">
            <input type="checkbox" checked={s.bloom} onChange={(e) => patch({ bloom: e.target.checked })} />
          </Row>
          <Row label="Füllgrad" value={s.fill.toFixed(2)}>
            <input type="range" min={50} max={90} value={Math.round(s.fill * 100)} onChange={(e) => patch({ fill: Number(e.target.value) / 100 })} />
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

