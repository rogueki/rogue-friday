# Orb Specification (`@jarvis/orb`)

Implementation spec of the golden holographic orb. Binding sources: `docs/PLAN.md` §15–23, §46.1, §52, `docs/briefs/ORB_BRIEF.md`,
`docs/IMPLEMENTATION_CONVENTIONS.md` §8. Wire types come from `@jarvis/sdk` (`OrbStatus`, `OrbLayers`, `OrbSnapshot`, `OrbMode`, `OrbHealth`);
nothing about the wire is hand-written in the package (`src/contract-types.ts` is a pure re-export).

## 1. Package layout

```text
packages/orb
├── src/contract-types.ts        re-export of @jarvis/sdk orb types
├── src/settings.ts              OrbSettings, defaults, quality profiles, resolveQuality(), orbSettingsFromWire()
├── src/machine/orbMachine.ts    XState v5 parallel machine, arbitrateOrbState(), wire <-> internal layer mapping
├── src/visual/deriveVisualTargets.ts   pure: snapshot + settings -> numeric targets, §20.2 time constants
├── src/audio/fixtures.ts        deterministic audio fixtures + attack/release smoothing
├── src/scene/                   R3F scene (geometry builders, GLSL, components, live params, adaptive quality)
├── src/fallback/                OrbFallback2D (Canvas 2D) + draw2d
├── src/JarvisOrb.tsx            public component (canvas + HTML layer + interaction + a11y)
├── src/OrbOverlay.tsx           StateLabel, ActivityText, glyphs, shared CSS
├── src/labels.ts                German/English dictionaries, aria sentence, activation targets
├── src/debug/OrbPerfOverlay.tsx dev-only perf overlay
├── src/stories/Orb.stories.tsx  Storybook CSF3 (all PLAN §46.1 stories + parallel state)
├── demo/                        Vite demo harness (port 5180)
└── scripts/screenshot.mjs       deterministic screenshots + frame-time probe; scripts/verify-browser.mjs
```

## 2. Public API

```tsx
<JarvisOrb
  snapshot={orbSnapshot}            // OrbSnapshot ({ status, layers }) from GET /orb/status or jarvis.orb.status_changed
  // or: status={orbStatus} layers={orbLayers?}   (layers derived from status.mode when omitted)
  settings={partialOrbSettings}     // see §6, map persisted wire settings with orbSettingsFromWire()
  onActivate={(target) => …}        // { kind: "approval"|"error"|"task"|"activity"|"command", … }
  onVoiceToggle={() => …}
  labels={partialLabels} className style showPerf onRendererChange
/>
```

Also exported: `orbMachine`, `createOrbActor`, `arbitrateOrbState`, `selectOrbSnapshot/Status/Layers/Mode`, `layersFromStatus`,
`deriveVisualTargets`, `transitionTimeConstants`, `OrbFallback2D`, `OrbPerfOverlay`, `audioFixtureLevel`, `AudioSmoother`,
`AdaptiveQuality`, `ORB_LABELS_DE/EN`, `buildAriaSentence`, `activationTarget`.

`progress` is a 0..1 fraction (contract: min 0, max 1). Values > 1 are tolerated and read as percent. Progress is **never invented**:
`progressMode: "determinate"` without a value hides the orbit.

## 3. Layer architecture

One mutable `LiveParams` object per orb (a ref) is advanced inside `useFrame` by `stepLiveParams`: it damps every value towards
`VisualTargets` with the transition time constants, integrates rotation angles and breath phase, runs the entry impulses (error, success)
and the boot reveal, smooths audio, then writes the shared GLSL uniforms. **No React state is touched per frame**; the scene is mounted once,
geometry is built once per quality level (`useMemo`), state changes only move numbers.

| Component (PLAN §16) | Build | Driven by |
|---|---|---|
| `OrbCameraRig` | fit to panel (~80 %), lift 4.5 % for the label band, ±3° yaw / ±2° pitch damped parallax (window pointer) | `parallax` |
| `WhiteHotCore` | tiny white-hot point (r 0.045) + tight HDR glow billboard, breath ±2 %, +audio | voice layer |
| `CoreLens` | iris/lens structure around the core: ring r 0.16 + smaller offset circle, dashed inner ring, crossing arc, 18 fine spokes, camera-facing | voice layer / inner speed |
| `CoreCorona` | billboard; speak waves (outwards), thinking rings (inwards) | voice layer |
| `InnerReactor` | 4 dashed mini rings 0.19–0.55 + tick marks + 40 spokes, independent rotation, scaled 1.35 | `innerSpeed` |
| `InnerGyroRings` | 2 tilted rings 0.66 / 0.78 (double line); counter-rotate when thinking | `gyroCounter` |
| `MidCircuitSphere` | short Manhattan traces (2-8 steps of 1.5-4.5°) on shells 1.35/1.5/1.62 (lat/lon random walk, 90° turns, vias), a few partial great arcs (40-110°); each trace carries a noise `patch` brightness so bright fragment clusters appear; instanced screen-space line quads | voice-when-speaking else work |
| `CircuitNodes` | instanced pixel-sized squares/diamonds/glows at trace ends | packet rate |
| `FloatingDataFragments` | instanced tangent plates, chip graphics (bars, pins, grid, streak, dots) drawn in the fragment shader; ~10 % streaks, noise clusters, left-biased push-out | work layer |
| `OuterFragmentShell` | arcs r 1.75–2.25 (15–110°, 1–4 lines, ticks, 12 % pushed out 0.1–0.35), outer traces, outer plates | work layer (radial offset, flicker, error scatter) |
| `PrimaryOrbitalRing` / `SecondaryTiltedRing` | 3 dashed lines r≈1.95 / tilted 62° r≈2.15 | ring speeds, `align` |
| `TelemetryRing` | r≈2.45 ticks (minor 2°, major 10°), 4 gaps cut in the shader | `health` → gap width |
| `ProgressOrbit` | r≈2.64, determinate arc 0..p with head glow, indeterminate = rotating comet | `progress`, `progressMode` |
| `DataPackets` | orbital lanes, 6-point fading tails, inward spiral while thinking/transcribing | `packetRate`, `convergence` |
| `EnergyArcs` | 4–8 bent core→shell curves with travelling pulses (inward when thinking) | `energyArcs` |
| `MicroParticleHalo`, `DepthDust` | point sprites, twinkle, slow drift; count = quality × particleDensity | settings |
| `ScanPlane` | cyan-gold ring sweeping vertically + trail | transcribing |
| `AudioReactiveHalo` | 96–160 radial bars r≈2.72, per-bar pseudo spectrum, smoothed level (attack 60 ms / release 250 ms); cyan listening, gold/white speaking; freezes softly when transcribing | voice layer |
| `AgentMarkers` | diamonds orbiting r≈2.3, count = agents (capped per quality), smooth fade | `agentCount` |
| `ApprovalOverlay` | 6 open amber segments, slow pulse | attention |
| `WarningOverlay` | one deliberately incomplete outer ring (300°), orange | attention |
| `ErrorFractureOverlay` | broken ring segments displaced in the shader, red-orange accent, entry impulse then a stable offset; no flicker | attention |
| HTML: `StateLabel`, `ActivityText`, glyphs, `OrbHitTarget`, tooltip, aria-live | outside the sphere | status |

### Materials / shading

All materials are custom `ShaderMaterial`s with additive blending, `depthWrite: false`, `depthTest: false` (order independent).
Lines are **instanced quads expanded in screen space** (pixel width × DPR, analytic anti-aliasing, thin strokes lose energy instead of
aliasing); `GL_LINES` are never used. A facing/depth fade (`depthFade`) renders the far side at 30 % of front intensity and slightly redder.
`aT` (arc length or angle) drives comet-style energy flow (`fract(aT - time*speed)` window) and the telemetry/progress logic.
An *aperture* term lowers density in the middle of the disc so the reactor/core stay legible and the rim carries the density, as in the
reference. HDR values (> 1) feed `Bloom` (`mipmapBlur`, luminance threshold 0.55): only hot parts glow. The shared palette is
orange → gold by seed with white-hot sparks; offline/paused desaturate towards *bronze*, status accents recolour a seeded 38 % subset of
strokes, never the whole orb.

## 4. State → visual mapping

Layers drive different parts (PLAN §18.2). `deriveVisualTargets({ layers, status, settings, reducedMotion })` returns numbers only
(core intensity, white-hot mix, breath period/amplitude, 5 ring speeds + axes, inner/mid/outer speeds, shell activity, radial offset,
packet rate/flow speed, convergence, scan plane, halo mode/level/cyan mix/freeze, speak waves, saturation, emission, accent colour+mix,
align, fracture, progress/mode, overlay levels, telemetry gap, agent count, boot reveal, audio gain/level, bloom, motion scale, parallax).

| Mode | Core | Rings / mid / outer | Packets | Halo / extras | Accent |
|---|---|---|---|---|---|
| booting | 0.8, desaturated, emission ×0.75 | radial reveal from the core (ring groups appear in order) | low | – | – |
| idle | 0.62, breath 5.2 s, ±2 % | very slow drifts on different axes | 0.1 | – | none |
| listening | 0.92, white 0.55, breath 2.8 s | segments align to the camera (0.5) | 0.3, inward | cyan audio halo 0.85, mic glyph | cyan 0.08 (halo carries it) |
| transcribing | 0.8 | faster inner, convergence 0.8 | 0.55 | halo freezes, scan plane | cyan 0.18 |
| thinking | 1.02, white 0.85 | gyro rings counter-rotate, outer calm | 0.45 inward | energy arcs, inward rings | violet 0.16 (small subset) |
| syncing | – | outer shell 0.5, ring segments close/open (align 0.6) | 0.7 on orbits | – | cyan 0.14 |
| working | 0.88 | busiest: inner 0.45, mid 0.1, outer 0.075, radial offset 0.1 | 1.0 along circuit | agent markers, progress orbit | none |
| speaking | 0.95 (+audio) | mid follows voice | 0.4 | gold/white halo, outward waves | none |
| waiting_approval | ≤ 0.6 | motion ×0.4, shell ≤ 0.22 | ≤ 0.15 | amber ring pulse, shield glyph | amber 0.18 |
| success | ≥ 1.2, white pulse | align 1, motion ×0.5 | 0.35 | progress orbit closes; auto-return 1.5 s | white-gold 0.28 |
| warning | gold → orange | – | – | incomplete outer ring | orange 0.34 |
| error | stays gold | shell ≥ 0.55, fracture 0.75 | ≥ 0.12 | fracture overlay | red-orange 0.26 |
| offline | 0.22, bronze (sat 0.06), emission ×0.22 | all stopped | 0 | wide telemetry gaps | – |
| paused | ≤ 0.4, sat ≤ 0.55, emission ×0.5 | inner rings stop, outer nearly still | 0 | pause glyph | – |

Parallel example (PLAN §18.2): `voice: speaking` + `work: working` + 3 agents → core and halo follow speaking, mid sphere follows speaking,
outer shell follows working, three markers orbit, telemetry ring shows health.

### Priority (`arbitrateOrbState`, PLAN §18.3)

`booting` → `offline` → `error` → `waiting_approval` → `paused` → `success` → `listening`/`speaking` → `transcribing`/`thinking` →
`working`/`syncing` → `warning` → `idle`. Layers are never dropped; they only rank. Documented deviations from the literal list: booting outranks
everything (system not up); `paused` outranks activity tiers 3–5 (explicit operator override); `warning` sits just above idle so it cannot hide
listening/working labels (the overlay still renders through the layers); `success` is a 1.5 s flash above the activity tiers.

### Machine

XState v5, parallel regions `connectivity` (booting/online/offline/paused), `voice` (idle/listening/transcribing/thinking/speaking),
`work` (idle/syncing/working), `attention` (none/warning/approval/error via a transient router state so overlapping items are not lost) and
`flash` (none/success, `after: 1500`). Handles every PLAN §18.1 event plus `MIC_CLOSED`, `THINKING_ENDED`, `WARNING_CLEARED`, `HEALTH_CHANGED`,
`AUDIO_LEVEL` and `SYNC_STATUS { snapshot: OrbSnapshot }` which snaps all regions to a backend snapshot. The internal layer model is richer
than the wire contract; `toOrbLayers` / `toInternalLayers` map between them (thinking and paused fold into `work`, offline into `health`,
success/approval into `attention`). `selectOrbSnapshot(snapshot)` yields the wire `OrbSnapshot`.

## 5. Transitions (PLAN §20)

Targets are damped, never swapped: `tau = settleTime / 3`, scaled per group (intensity 1×, colour 1.2×, motion 1.5×, overlays 0.9×;
0.6× when entering error). Settle times: idle→listening 170 ms, listening→transcribing 240, transcribing→thinking 300, thinking→working 420,
working→speaking 250, any→error 160, error→recovered 950, offline→online 1300 (others default 350–700). Error and success also fire an entry impulse
(decay τ 0.45 s / 0.55 s) that moves fragments / flashes the core once. Rotation and breath phase are integrated, so speed changes never jump.

## 6. Settings and quality

`OrbSettings`: `preset` (gold/amber/calm/dense), `size` 0.5–1.5, `intensity` 0–100, `speed` 0.25–2, `particleDensity` 0–100, `audioReactive`,
`mouseParallax`, `bloom`, `quality` (`auto|low|medium|high|ultra`), `animations` (`full|reduced|off`), `renderer` (`auto|3d|2d`),
`statusAccentColors` (per mode), `testClock {fixedTime?, animationProgress?}`, `audioFixture?`. `orbSettingsFromWire()` maps the persisted
`@jarvis/sdk` `OrbSettings` (`renderMode`, `statusColors`) onto them.

| Level | DPR cap | traces | plates | outer traces/arcs | particles / dust | packets | halo bars | markers | bloom |
|---|---|---|---|---|---|---|---|---|---|
| low | 1 | 260 | 80 | 100 / 5 | 300 / 60 | 24 | 96 | 4 | off |
| medium | 1.25 | 560 | 130 | 210 / 7 | 600 / 120 | 50 | 128 | 6 | 0.35× buffer |
| high | 1.75 | 820 | 190 | 320 / 10 | 900 / 200 | 80 | 144 | 8 | 0.5× |
| ultra | 2 | 1250 | 300 | 480 / 14 | 1400 / 300 | 120 | 160 | 12 | 0.75×, 8 mip levels |

Particles/dust are additionally scaled by `particleDensity` (0.25×–1.75×). `auto` starts at `high` (`medium` on coarse pointers or ≤ 4 cores/GB),
never at `ultra`. `AdaptiveQuality` feeds on wall-clock frame times: p95 > 20 ms for 3 s → one level down (≥ 1.5 s apart); p95 < 9 ms for 12 s and an
8 s cooldown → one level up, capped at `high`. Changing level rebuilds geometry (a deliberate settings change, not a state change).

## 7. Fallbacks, accessibility, motion

- **2D fallback** (`OrbFallback2D`, Canvas 2D): same palette and the same seeded circuit data orthographically projected, gold core, ellipse rings with
  seeded gaps, telemetry ticks with health gaps, outer fragments, progress arc, audio halo + speak waves, approval/warning/error overlays, agent
  diamonds, scan ring. It shares `stepLiveParams`, so it cross-fades like the 3D scene. 30 fps loop; `animations: off` draws one static frame per state.
- Chosen automatically when WebGL2 is missing, `renderer: "2d"`, `animations: "off"`, or the context is lost. Context loss: the fallback appears at once,
  the canvas is kept hidden, native `webglcontextrestored` (or a fresh canvas after 3.5 s) brings 3D back (verified in `scripts/verify-browser.mjs`).
- **Hidden tab / off-screen** (`visibilitychange`, `IntersectionObserver`) → `frameloop="never"`; resumes cleanly (verified).
- **Reduced motion** (`animations: "reduced"` or OS `prefers-reduced-motion`): speeds ×0.1, no parallax, no radial motion, packets ×0.4, fracture ×0.5, no
  speak waves, breath ±1 %; state stays readable through brightness, opacity, labels. 3D is not forced: users can pick `renderer: "2d"`; with OS reduced
  motion and `renderer: "auto"` the scene renders in this calm mode.
- **Interaction**: transparent button over the sphere (focus ring), click/Enter → `onActivate(target)` (approval → approvalId, error → error detail, working →
  task, idle → command bar, others → live activity), Space → `onVoiceToggle`, hover/focus tooltip (state, action, runtime, agent, task id, source).
  `aria-live="polite"` sentence, e.g. *"Jarvis arbeitet. Aufgabe Wettbewerbsanalyse. Drei Agenten aktiv. Fortschritt 62 Prozent."* (mode changes announce
  immediately, progress/agents at most every 3 s). Mic glyph only while the voice layer is `listening`; pause and approval glyphs next to the label.
  Status is never colour-only (labels + glyphs).

## 8. Testability (PLAN §52)

`settings.testClock = { fixedTime, animationProgress }` turns the scene into a pure function of `fixedTime`: no damping (targets snap), rotation angles
`speed × t`, breath phase `2πt/period`, `audioFixture` evaluated at `t`. `animationProgress` selects the entry phase (booting reveal 0..1, error/success
impulse `1 − p`); defaults: booting 0.65, error 0.3, success 0.5, everything else settled. Audio fixtures: `silence`, `normal`, `loud`, `tts`, `spike`
(deterministic hash noise, no `Math.random`). Geometry is seeded (mulberry32 + value noise) and unit-tested for determinism.

Demo: `pnpm --filter @jarvis/orb demo` (http://127.0.0.1:5180). URL params: `mode` (all modes or `parallel`), `progress`, `indeterminate=1`, `agents`, `audio`,
`fixture`, `t` (fixed clock), `ap` (animationProgress), `quality`, `anim`, `renderer`, `bloom`, `intensity`, `size=large`, `perf=1`, `shot=1` (panel only).
Screenshots: `pnpm --filter @jarvis/orb screenshots` → `packages/orb/screenshots/*.png`, `perf.json`, `report.json` (software GL via SwiftShader; use
`--only=idle,error`, `--dsf=1`, `--quality=…`). `node scripts/verify-browser.mjs` checks context loss/restore, hidden tab, keyboard and tooltip in a real browser.

## 9. Performance notes

- Draw-size at `high`: ≈ 9.6 k line segments (instanced quads, 4 vertices each), ≈ 190 plates, ≈ 1.2 k sprites/points, ~47 draw calls per frame including the
  bloom passes, ~24 k triangles, 33 geometries, 13 textures (render targets). Vertex data < 1 MB.
- No per-frame allocations in the scene components (live params and uniforms are mutated in place); React renders only on prop changes.
- `Bloom` uses `mipmapBlur` with a high luminance threshold, multisampling 0 (strokes are anti-aliased analytically), disabled at `low` and via `bloom: false`.
- DPR is capped per level; `auto` adapts to measured frame time; hidden/off-screen orbs stop rendering entirely.
- Software rendering (SwiftShader, headless) is ~100-140 ms/frame at `high` and DPR 2 — only a correctness reference. The reference target (60 fps, p95 < 20 ms on a
  desktop GPU) must be confirmed on real hardware; the quality scaler is what protects weaker machines.

## 10. Known visual gaps

Compared with the film reference: no motion-blur light streaks / long volumetric trails, plate graphics stay small at panel scale (the reference has a few
large translucent panels), strokes are still a little smoother than the reference's jagged fragments, and the bloom is restrained so individual strokes stay
readable. Real-GPU frame times have not been measured yet (only SwiftShader).
