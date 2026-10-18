# Orb Specification (`@friday/orb`)

Implementation spec of the golden holographic orb. Binding sources: `docs/PLAN.md` §15–23, §46.1, §52, `docs/briefs/ORB_BRIEF.md`,
`docs/IMPLEMENTATION_CONVENTIONS.md` §8 and — **where they conflict with the PLAN — the owner order of 2026-10-17 (orb rework, "Auftrag: F.R.I.D.A.Y.-Orb
produktionsreif animieren")**, analysed in `docs/ORB_REWORK_ANALYSIS.md`. The order wins for the idle values (§4), the size/centring (§2.2), the state
priority (§5) and the transitions (§6). Wire types come from `@friday/sdk` (`OrbStatus`, `OrbLayers`, `OrbSnapshot`, `OrbMode`, `OrbHealth`); nothing about
the wire is hand-written in the package (`src/contract-types.ts` is a pure re-export).

## 1. Package layout

```text
packages/orb
├── src/contract-types.ts          re-export of @friday/sdk orb types
├── src/settings.ts                OrbSettings, defaults, quality profiles, resolveQuality(), orbSettingsFromWire()
├── src/controller/                typed runtime controller (no React, no DOM)
│   ├── types.ts                   OrbRuntimeStatus, OrbLayerState, OrbController, OrbAudioFrame ... (public)
│   ├── createOrbController.ts     leases, server truth, override, audio sources, speech-envelope fallback
│   ├── layers.ts                  layer model <-> machine layers, arbitration, wire mapping for the HTML layer
│   └── demo.ts                    createOrbDemo(): scripted sequences that drive the real bridge
├── src/bridge/                    OrbEventBridge interface + implementation (idempotent facts)
├── src/audio/
│   ├── analyzer.ts                createAudioAnalyzer(): AnalyserNode tap, RMS/peak/low/mid/high, noise gate, attack/release
│   ├── serviceLevelSource.ts      4 Hz service levels -> smooth per-frame frames (+ derived bands)
│   ├── speechEnvelope.ts          seedable syllable model: fallback for TTS without audio analysis
│   ├── audioMapping.ts            bounded audio -> visual constants (order sections 9 and 14)
│   ├── frame.ts, fixtures.ts      frame helpers; deterministic test-clock fixtures (PLAN §52.3)
├── src/machine/orbMachine.ts      XState v5 parallel machine (wire snapshot reducer), arbitrateOrbState()
├── src/visual/deriveVisualTargets.ts   pure: layers/controller state + settings -> numeric targets, transition time constants
├── src/scene/                     R3F scene (geometry builders, GLSL, components, live params, fit maths, adaptive quality)
├── src/fallback/                  OrbFallback2D (Canvas 2D) + draw2d (parity for every layer)
├── src/FridayOrb.tsx              public component (canvas + HTML layer + interaction + a11y)
├── src/OrbOverlay.tsx             StateLabel, ActivityText, glyphs, shared host CSS
├── src/labels.ts                  German/English dictionaries, aria sentence, activation targets
├── src/debug/OrbPerfOverlay.tsx   dev-only perf overlay
├── src/stories/                   Orb.stories.tsx (snapshot path) + OrbController.stories.tsx (every mode, audio sources, demos)
├── demo/                          Vite demo harness (port 5180) with the debug panel (all modes, sliders, bridge buttons, demos, real microphone)
└── scripts/                       screenshot.mjs (deterministic screenshots + frame-time probe), verify-browser.mjs
```

## 2. Public API

### 2.1 Component

```tsx
<FridayOrb
  controller={controller}           // OrbController (wins over everything below)
  // legacy / stories / tests: snapshot={orbSnapshot}  or  status={orbStatus} layers={orbLayers?}
  settings={partialOrbSettings}     // see §10, map persisted wire settings with orbSettingsFromWire()
  fillRatio={0.72}                  // visible orb incl. outer rings = this fraction of the usable panel height (order: 0.65-0.78)
  seed={n}                          // seed of the data-impulse scheduler (tests, screenshots)
  onActivate={(target) => …}        // { kind: "approval"|"error"|"task"|"activity"|"command", … }
  onVoiceToggle={() => …}
  labels={partialLabels} className style showPerf onRendererChange
/>
```

`getAudioLevel` / `audioLevelRef` / `snapshot` / `status` remain for stories and tests (single level, no bands). With a `controller` the component subscribes
low-rate (`useSyncExternalStore`: mode, texts, progress steps, agent count) and the scene pulls analysed audio frames from `controller.readFrame` once per
rendered frame — no React state per frame.

### 2.2 Controller (owner order section 6)

```ts
const controller = createOrbController({ seed, leaseMs: 1500, now?, epochNow?, initialConnectivity? });
controller.getState()        // { version, status: OrbRuntimeStatus, layers: OrbLayerState, overrideMode }
controller.subscribe(fn)     // low-rate only (<= 10 Hz): mode change, text, progress step, agent count
controller.readFrame(nowMs, inputs)   // per frame, allocation free, never throws: fills input/output OrbAudioFrame in place
controller.setMode / setInputAudioLevel / setOutputAudioLevel / setProgress / setActivity / setAgentCount / setApproval / setSystemHealth
controller.setInputAudioSource / setOutputAudioSource   // analyser, service-level or synthetic OrbAudioFrameSource
controller.applySnapshot(snapshot)   // server truth (friday.orb.status_changed / GET /orb/status)
controller.reset();  controller.dispose();  controller.bridge
```

`OrbRuntimeStatus { mode, activityText?, detailText?, inputAudioLevel, outputAudioLevel, progress?, progressMode, activeAgentCount?, currentAgentName?,
currentTaskId?, severity?, since, derived? }` is the client runtime form (the wire `OrbStatus` is unchanged). The mode is **only** ever computed from the layers
(`primaryInteraction`, `backgroundWork`, `systemHealth`, `approval`), never from texts, DOM classes or messages.

Source arbitration: local voice facts (microphone, VAD, transcription, thinking, TTS) are **leases** (`leaseMs`, refreshed by voice activity, audio
frames and an attached live source; transcription 30 s, thinking 120 s, TTS 60 s as safety caps); the server snapshot is truth for background work,
approvals, health and agent counts; an expired lease falls back to the server layer, a just-ended local phase holds the stale server value down for 1.5 s
(barge-in cannot flicker back to "speaking"); `setMode` (debug, demo, tests) overrides everything until `reset()`. An open microphone is `listening`; a
passive (wake-word armed) microphone is `idle`; TTS start demotes a still-open microphone to passive so hands-free sessions show `speaking`.

### 2.3 Event bridge (owner order section 18)

`controller.bridge` implements `OrbEventBridge` (no coupling to Hermes, Kimi or a voice framework; the sources live in `apps/web`):
`onMicrophoneOpened({source, passive?})`, `onVoiceActivity(level | {level, peak, low, mid, high})`, `onMicrophoneClosed`, `onTranscriptionStarted/Completed`,
`onThinkingStarted/Completed`, `onTaskStarted/Progress/Completed`, `onTtsStarted({hasAudioAnalysis?, derived?})`, `onTtsAudioLevel`, `onTtsEnded({interrupted})`,
`onApprovalRequired/Resolved`, `onWarning/Cleared`, `onError/Cleared`, plus `onSyncStarted/Finished`, `onAgentActivity`, `onOnline/Offline/Paused/Resumed`, `onSnapshot`.
Every call sets or clears a fact and is idempotent and order tolerant (`onTtsEnded` without a start is a no-op, repeating a call changes nothing).
Phases that a source had to **infer** (no real event exists) are passed with `derived: true` and show up as `status.derived` ("abgeleitet" in debug UIs).

### 2.4 Audio sources

| Source | Where | Signal |
|---|---|---|
| `createAudioAnalyzer(ctx, node, {kind})` | microphone tap (`MediaStreamAudioSourceNode`) and the TTS bus (`GainNode` in front of `destination`) | RMS, peak, low (60–250 Hz), mid (250–2000 Hz), high (2–6 kHz) |
| `createServiceLevelSource()` | `friday.voice.audio_level` pushes (~4 Hz, optional bands) | interpolated, smoothed; bands estimated from the scalar when missing (`bandsDerived`) |
| `createSpeechEnvelopeSource({seed})` | TTS without analysis | irregular syllables (140–260 ms), word gaps (60–140 ms), sentence pauses (350–700 ms), per-syllable intensity, fricative bursts for `high` |

Analyser: side branch only (no output connection, cannot block capture or playback), `fftSize` 1024, own attack 70 ms / release 200 ms per band (peak release
120 ms), fixed calibrated dB mapping (−60 dBFS, or the measured noise floor + 5 dB if higher → 0; −12 dBFS → 1; no peak tracking, so quiet speech stays small and loud speech strong), output 0..1. **Noise gate**: the first 600 ms measure the median RMS as
floor (`recalibrate()` repeats it, `noiseFloorDb` fixes it; the TTS bus uses −60 dBFS), the floor then follows the quietest level (+0.5 dB/s); the gate opens
at floor + 9 dB, closes at floor + 5 dB with an 80 ms hold; closed gate = exact 0. All buffers are allocated once.

Mapping (`audioMapping.ts`, bounded): `coreScale = base + input·0.08`, `coreIntensity = base + input·1.2` (HDR cap 1.75), `waveAmplitude = input`, ring speed
`base·(1 + 1.1·input)`, particle force `0.9·input`, bloom `base + 0.45·input` (cap). Speaking splits by band: low → core pulse, mid → SegmentedRing, high →
EnergyParticles and fine pulses, RMS → overall intensity. The microphone only drives `listening`, TTS only `speaking`; transcribing/thinking gate the microphone
shut. Peaks (rising edge > 0.5, ≥ 160 ms apart) spawn RadialPulseRings and a short core kick.

## 3. Layout and size (owner order section 5)

Host (`ORB_CSS`): `position:relative; width/height:100%; min-height:var(--orb-min-height,160px); display:grid; place-items:center; overflow:hidden;
padding:clamp(24px,4vh,52px)`; canvas wrapper `position:absolute; inset:0; display:grid; place-items:center; pointer-events:none`; the hit target is centred with
`inset:0; margin:auto` and the orb diameter; no negative top/translate/margin offsets. The canvas fills the whole host, so glow can use the padding.

Camera: the orb sits at (0,0,0), the camera on the z axis looking at it, **no lift, no view offset** (`fit.ts`, `OrbCameraRig`). The nominal visible orb (outer
rings, telemetry ring, progress ring, pushed fragments: radius 2.7 units) is fitted to `fillRatio` (default **0.72**, order 0.65–0.78) of the panel's short side,
capped so the host padding always stays free (`min(fill·short, short − 2·padding)`), times `settings.size`. At the AI-Core stage of 1920×1080 (≈ 426×368 px) that is
≈ 265 px, at 1366×768 ≈ 181 px. Glow (two billboards), dust, particles and every other element fade through a canvas-edge fade in the shaders (NDC 0.78 → 0.985),
so nothing is ever cut off. The HTML status label sits below the orb; the web panel hides it and renders its own status strip.

## 4. Scene architecture (order section 4)

One mutable `LiveParams` per orb advances in `useFrame` (`stepLiveParams`, allocation free): it damps every value towards `VisualTargets` with the transition
time constants, integrates ring angles with a per-ring speed wobble, computes the core look (breath cycle + audio mapping), runs the deterministic data-impulse
scheduler, the per-group drift and the peak detector, then writes the shared uniforms. **No React state is touched per frame**; the scene is mounted once and
geometry is built once per quality level — mode changes never remount anything.

```text
OrbScene
├ OrbCameraRig                       fit + centre + damped parallax (±3° yaw / ±2° pitch)
├ MicroMotion (whole orb: |positionY| < 0.03, irregular z drift)
│ ├ ParticleGroup (drift)            DepthDust, AmbientParticles, EnergyParticles, DataPackets
│ ├ SphereGlow                       tight + wide volumetric glow (fade out inside the canvas)
│ ├ HolographicShellGroup            HolographicShells: 2 fresnel shells with faint grid + scan band
│ ├ CoreGroup                        CorePulseShell, CoreEnergyNoise, WhiteHotCore, CoreLens
│ ├ InnerRingGroup (drift)           InnerDataArcs, InnerRingA/B (reactor rings + gyro rings), SegmentedRing
│ ├ CircuitSphereGroup (drift)       CircuitLines, DataNodes, HolographicPanels (plates), great arcs
│ ├ FragmentGroup (drift)            BrokenArcs, TechnicalPanels, FloatingFragments (own phase/rotation per plate)
│ ├ OuterRingGroup (drift)           OuterRingA, OuterRingB, TelemetryRing, ProgressRing
│ ├ ScanGroup                        HorizontalScan, RadialScan, AnalysisSweep, SyncSweepRings
│ ├ VoiceReactionGroup               InputWaveRing, OutputWaveRing, RadialPulseRings (+ ApprovalFocusRing, WarningPulseRing)
│ ├ AgentMarkers, ApprovalOverlay, ApprovalGlyph, WarningOverlay, ErrorFractureOverlay
└ PostProcessing                     Bloom (mipmapBlur; intensity = base + audio boost); Vignette/Noise not used
```

Every group has its own irregular drift (value-noise rotations ≤ 0.07 rad and ≤ 0.012 vertical units), every ring layer its own speed and wobble, every plate its
own phase, every particle its own drift direction and brightness life. Data impulses (comets running along ring layers) come from a stateless-per-slot scheduler
(1.1 s slots, 2.6 s pulses, hashed by seed): at most three at once, consecutive impulses always use different ring layers, the sequence is a pure function of the
time (test clock reproduces the live clock) and busy states fire far more often than idle.

### Idle (order section 8 — replaces the PLAN §19.2 values)

| Element | Value |
|---|---|
| Core scale | 0.97 … 1.035 (centre 1.0025), asymmetric sine, period 4.5–6 s (5.25 s ± 12 % wander) |
| Core brightness | 72 … 100 % of the core level |
| Inner ring A | clockwise, 11 s per revolution (order 8–14 s), ±16 % wobble |
| Inner ring B | counter-clockwise, 17 s (order 13–21 s) |
| Outer rings | 28.6 s / 33 s / 35 s (order 22–35 s), alternating directions |
| Fragments / panels | float on own phases (radial ±0.035, tangential, rotation ±0.12 rad), drift group |
| Particles | individual slow drift (some counter), ±4.5 % in/out, individual slow brightness life |
| Data impulses | occasional, seedable, never all rings at once |
| Micro motion | positionY ±0.014, irregular z drift ±0.03 rad |

## 5. State → visual mapping

`composeVisualTargets` (shared by the wire path `deriveVisualTargets` and the controller path `deriveVisualTargetsFromController`) returns numbers only. The voice
layer drives core, voice rings and inner rings; the work layer drives packets, fragments and outer rings; per field the busier value wins, so parallel states
keep every layer (speaking core + working outer rings + agent markers + pending approval).

| Mode | Core | Rings / shells | Voice / scan | Accent |
|---|---|---|---|---|
| booting | 0.8, desaturated | radial reveal from the core | – | – |
| idle | see §4 | see §4 | impulses only | none |
| listening | 1.0, white .62, breath 2.6 s, reacts to the **real** level | inner ×1.5, align .45, shells .45 | InputWaveRing opens (gold with a cyan hint), segments follow the level, particles pushed out, radial pulses on peaks, mic glyph | cyan .06 |
| transcribing | 0.88, faster but smaller pulse than speaking (1.9 s, ±1.8 %) | segments align (.85) | wave ring retracts, RadialScan + HorizontalScan, particles stream to the core, inward packets, **no microphone reaction** | cyan .14 |
| thinking | 1.05, white .88, turbulence inward | inner rings against each other (A −1.1 / B +1.25), outer calm, circuit segments light up one after another | AnalysisSweep (contracting arc rings + sweeps), no wave ring, no progress | gold-violet .16 |
| syncing | 0.9, cyclic brightness | outer rings faster, shell .5 | two counter-rotating SyncSweepRings, telemetry ring shows outgoing (gold) and incoming (cyan) data, pulses core↔outer | cyan .12 |
| working | 0.92 | all layers active, fragments pushed out, packets 1.0 | agent markers (n agents = n markers), ProgressRing determinate only with a real value, otherwise a wandering segment | none |
| speaking | 1.0, white .72, pulses with the **real** TTS level | mid band → SegmentedRing | OutputWaveRing + outgoing waves + radial pulses, particles on high band/peaks | none |
| waiting_approval | slow concentrated pulse (4.4 s), ≤ 0.78 | rings ×0.55 | ApprovalFocusRing (slow amber ring moving outwards), amber ApprovalOverlay (6 open segments), ApprovalGlyph (shield + "!"), no hectic animation | amber .18 |
| success | ≥ 1.25, white pulse | align 1 | ProgressRing closes; auto-return 1.5 s | white-gold .28 |
| warning | alive: slower pulse (7.2 s), 0.8, rings ×0.72 | **secondary ring −66 %, telemetry ring −45 %, broken arcs −30 %** | one deliberately interrupted outer ring (300°) + subtle amber WarningPulseRing | orange .34 |
| error | steady, visible, no flicker | rings ×0.6, fracture .75 (segments offset and stable) | short entry glitch only (decays within ~0.45 s) | red-orange .26 |
| offline | 0.22, bronze | stopped | wide telemetry gaps | – |
| paused | ≤ 0.4, sat ≤ .55 | inner rings stop | pause glyph | – |

"Eingeschränkter Betrieb" (warning / degraded health) is therefore visible in the orb itself, not just as text.

### Priority (order section 7)

`arbitrateOrbState` / `arbitrateLayers`: `booting` → **critical `error` → `offline`** → `waiting_approval` → `paused` → `success` → `listening` → `speaking` →
`transcribing` → `thinking` → `working` → `syncing` → `warning` → `idle`. (The wire derivation on the server already ranks error before offline; the client
machine previously ranked offline first and now follows the order.) Documented deviations from the literal list: `booting` outranks everything (system not up);
`paused` outranks the activity tiers (explicit operator override); `success` is a 1.5 s flash; `warning` sits just above idle so it cannot hide listening/working
labels (its overlay renders through the layers anyway). Layers are never dropped, only ranked: the layered state — `primaryInteraction` × `backgroundWork` ×
`systemHealth` × `approval` — is what the visuals use, the mode only names the winner.

## 6. Transitions (order section 17)

Targets are damped, never swapped: `tau = settleTime / 3`, scaled per group (intensity 1×, colour 1.2×, motion 1.5×, overlays 0.9×; 0.6× when entering error). Settle
times: idle→listening 170 ms, listening→transcribing 240, transcribing→thinking 300, thinking→working 380, working→speaking 250, speaking→idle 480, any→error 140,
error→recovered 950, offline→online 1300 (others 350–700). Wave rings open/retract with the overlay constants, audio gates cross-fade with the colour constant.
Error and success additionally fire an entry impulse (decay τ 0.45 s / 0.55 s). Rotation and breath phase are integrated, so speed changes never jump. Geometry is
never re-mounted on a state change (quality changes rebuild it, a deliberate settings change).

## 7. Materials / shading

All materials are custom `ShaderMaterial`s with additive blending, `depthWrite: false`, `depthTest: false` (order independent). Lines are **instanced quads
expanded in screen space** (pixel width × DPR, analytic anti-aliasing); `GL_LINES` are never used. A facing/depth fade renders the far side at 20–30 % and slightly
redder. Shader roles on the shared line code: MID, OUTER, REACTOR, RING, TELEMETRY, PROGRESS, ARCS, FRACTURE, OVERLAY, SCAN, SEGRING; points: PARTICLES, ENERGY, DUST,
PACKETS, MARKERS. Wave rings, sweeps, core noise, shells and the approval glyph are billboards/meshes with their own fragment shaders (all hidden — no draw call — while
their amount is ~0). HDR values (> 1) feed `Bloom`; the palette is orange → gold by seed with white-hot sparks; offline/paused desaturate towards bronze; status
accents recolour a seeded subset of strokes, never the whole orb.

## 8. Fallbacks, accessibility, motion

- **2D fallback** (`OrbFallback2D`, Canvas 2D): same palette and seeded circuit data, shares `stepLiveParams` and the parent's targets, therefore renders every layer —
  input/output wave rings, radial pulses, segmented ring, sweeps, scans, energy particles, shells, approval glyph/focus ring, warning pulse, agent markers, progress
  arc. 30 fps loop; `animations: off` draws one static frame per state.
- Chosen automatically when WebGL2 is missing, `renderer: "2d"`, `animations: "off"`, or the context is lost (verified in `scripts/verify-browser.mjs`).
- **Hidden tab / off-screen** → `frameloop="never"`; resumes cleanly (verified).
- **Reduced motion** (`animations: "reduced"` or OS `prefers-reduced-motion`): rotation ×0.1, drift ×0.15, no parallax, no radial motion, breath ±1.2 % with half the
  brightness swing, scans/pulses/packets ×0.4, no radial pulses or particle drive, core noise ×0.5. **Audio only as a calm ring** (`calm = 1`: ring level without core
  kick, particle force or speed boost). State stays readable through brightness, opacity, static ring position (align), labels and glyphs.
- **Interaction**: transparent button over the sphere (focus ring), click/Enter → `onActivate(target)` (approval → approvalId, error → error detail, working →
  task, idle → command bar, others → live activity), Space → `onVoiceToggle`, hover/focus tooltip. `aria-live="polite"` sentence; mic glyph only while listening.
  Status is never colour-only.

## 9. Testability (PLAN §52)

`settings.testClock = { fixedTime, animationProgress }` turns the scene into a pure function of `fixedTime` (no damping, rotation `speed·t` plus the closed-form wobble,
breath phase `2πt/period`, data impulses re-derived for that time, `audioFixture` evaluated at `t`). `animationProgress` selects the entry phase (boot reveal,
error/success impulse). `window.__ORB_DEBUG__` additionally carries `bboxPx` (nominal visible orb box), `canvasPx`, `groupPhases` (ring angles, breath, shell angles,
drift), `audioSource` (source kinds per direction, envelope flag, gates, levels) and `mode`.

Demo: `pnpm --filter @friday/orb demo` (http://127.0.0.1:5180) with the debug panel — mode buttons (all 14 incl. Booting and "speaking + 3 agents"), sliders (input/output
audio level, progress with "unbekannt", agent count, bloom, particle density, animation speed, fill ratio), demos (Auto, Voice, Working, Error Recovery, Reset), bridge buttons
(microphone, transcription, thinking, task, TTS, barge-in, approval, warning, error, sync), real microphone and TTS test tone through the analyser. URL params: `mode`
(`parallel` = speaking + 3 agents), `scene=approvalSpeaking`, `demo=auto|voice|working|errorRecovery`, `loop=1`, `progress`, `indeterminate=1`, `agents`, `audio`, `fixture`, `t`,
`ap`, `quality`, `anim`, `renderer`, `bloom`, `bloomStrength`, `intensity`, `particles`, `speed`, `fill`, `seed`, `size=large`, `perf=1`, `shot=1`.
Screenshots: `pnpm --filter @friday/orb screenshots` (`--only=…`, `--dsf=…`, `--quality=…`, `--out=<dir>`, env `ORB_CHROMIUM`). `node scripts/verify-browser.mjs` checks
centring, fill ratio, context loss/restore, hidden tab, keyboard and tooltip in a real browser.

## 10. Settings and quality

`OrbSettings`: `preset` (gold/amber/calm/dense), `size` 0.5–1.5, `intensity` 0–100, `speed` 0.25–2, `particleDensity` 0–100, `audioReactive`, `mouseParallax`, `bloom`,
`bloomStrength` 0–1.5 (new, default 1), `quality` (`auto|low|medium|high|ultra`), `animations` (`full|reduced|off`), `renderer` (`auto|3d|2d`), `statusAccentColors`,
`testClock`, `audioFixture`. `orbSettingsFromWire()` maps the persisted `@friday/sdk` `OrbSettings`.

| Level | DPR cap | traces | plates | outer traces/arcs | particles / dust / energy | segments | packets | markers | bloom |
|---|---|---|---|---|---|---|---|---|---|
| low | 1 | 260 | 80 | 100 / 5 | 300 / 60 / 80 | 36 | 24 | 4 | off |
| medium | 1.25 | 560 | 130 | 210 / 7 | 600 / 120 / 160 | 42 | 50 | 6 | 0.35× buffer |
| high | 1.75 | 820 | 190 | 320 / 10 | 900 / 200 / 260 | 48 | 80 | 8 | 0.5× |
| ultra | 2 | 1250 | 300 | 480 / 14 | 1400 / 300 / 420 | 60 | 120 | 12 | 0.75×, 8 mip levels |

Particles/dust are additionally scaled by `particleDensity` (0.25×–1.75×). `auto` starts at `high` (`medium` on coarse pointers or ≤ 4 cores/GB), never at `ultra`;
`AdaptiveQuality` measures wall-clock frame times: p95 > 20 ms for 3 s → one level down (≥ 1.5 s apart); p95 < 9 ms for 12 s and an 8 s cooldown → one level up,
capped at `high`. Changing level rebuilds geometry.

## 11. Performance notes

- No per-frame allocations in the frame path: `stepLiveParams`, the audio sources, `readFrame`, the pulse scheduler and the scene components mutate preallocated objects
  and typed arrays; React renders only on low-rate controller changes. Geometry, materials and billboards are shared per orb; particles, fragments, plates, nodes and
  line segments are instanced.
- Effect billboards (wave rings, sweeps, glyph, noise) are hidden while inactive; the always-on additions are the core noise, two shells, the segmented ring and the energy
  particles. Draw calls stay below the 70 budget (about 51 idle, up to 54–55 in busy parallel states, bloom passes included).
- DPR is capped per level; `auto` adapts to measured frame time; hidden/off-screen orbs stop rendering entirely. Software rendering (SwiftShader) is only a correctness
  reference (≈ 0.5 s/frame); the reference target (60 fps / p95 < 16.7 ms on a desktop GPU, ≥ 30 fps on weak devices) must be confirmed on real hardware.

## 12. Known visual gaps

Compared with the film reference: no motion-blur light streaks / long volumetric trails, plate graphics stay small at panel scale, strokes are smoother than the
reference's jagged fragments, and the bloom is restrained so individual strokes stay readable. Because the order caps the visible orb at 65–78 % of the panel height, the
orb is smaller than in the dashboard reference image; the glow reaches further out instead. Real-GPU frame times have not been measured yet (only SwiftShader).
