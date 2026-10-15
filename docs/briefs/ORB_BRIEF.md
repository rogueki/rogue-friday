# Orb Art-Direction Brief (input for `@friday/orb`)

Binding sources: `docs/PLAN.md` §15–23, §46.1, §52 and `design-references/jarvis_orb_reference.webp`.
This brief turns those sections into concrete construction rules. Look at the reference image before
building, and compare your screenshots against it after each iteration.

## What the reference actually shows

- A golden/amber holographic sphere that is **not a closed ball**: it is made from thousands of short,
  bright, rectilinear "circuit" strokes and small rectangular plates (like PCB traces and chip outlines)
  scattered over several nested spherical shells.
- Density is **uneven**: clusters of bright fragments, thinner gaps, and a ragged silhouette. Fragments on the
  left side protrude beyond the ideal sphere; some plates are elongated vertical streaks.
- Several **thin, long arcs** sweep across the sphere at different tilts (partial great circles), some thicker
  bands made of 2–4 parallel lines.
- At the centre: a very bright white-gold core with a **small inner ring structure** (ring + smaller circle)
  surrounded by a denser inner reactor of short spokes and ring segments.
- Back faces are visible through the front (transparency), giving strong depth; far side is dimmer.
- Additive light, controlled bloom — individual strokes remain readable, no blown-out blob.

## Construction (all procedural, deterministic seeded RNG, built once and reused)

Coordinate unit: orb radius ≈ 1.6. Camera FOV ~35°, distance so the orb + outer rings fill ~80 % of the panel.

| Layer | Build | Notes |
|---|---|---|
| WhiteHotCore | small sphere (r 0.12) with fresnel/radial shader + camera-facing glow sprite (r ~0.6) | colour hot `#fff2ba` → gold; breath scale ±2 % |
| CoreCorona | billboard radial gradient, additive, low alpha | energy indicator, never covers lines |
| InnerReactor | 3–4 mini rings (r 0.22–0.55) built from dashed segments + 24–48 radial spokes | rotates faster than outer layers |
| InnerGyroRings | 2 tilted rings r 0.6–0.8, counter-rotating | Thinking: visibly counter-rotate |
| MidCircuitSphere | **Manhattan circuit traces on sphere**: random-walk along latitude/longitude with 90° turns, 3–12 steps, step 2–6°, radius jitter across 3 shells (1.35/1.5/1.62). End points get small node squares. Single `LineSegments` buffer with per-vertex `aSeed`, `aT` (arc-length param for flowing packets) | the main mass of the orb (medium quality ≈ 2–3 k traces) |
| CircuitNodes | `InstancedMesh` of tiny squares/diamonds at trace ends | twinkle in shader |
| Data plates | `InstancedMesh` quads tangent to sphere; fragment shader draws chip graphics: outline + inner bars + pins, procedurally varied by `aSeed` | sizes 0.03–0.18; ~10 % elongated vertical streaks; clustered by 3D noise for asymmetry |
| OuterFragmentShell | partial arcs on radii 1.75–2.25, arc length 15–110°, 1–4 parallel lines each, some with tick marks; ~12 % of fragments pushed radially outward 0.1–0.35 | irregular silhouette, reacts to Working/Syncing/Error |
| PrimaryOrbitalRing | band of 3 concentric lines r ≈ 1.95 with segment gaps | |
| SecondaryTiltedRing | r ≈ 2.15 tilted ~62°, segmented | |
| TelemetryRing | r ≈ 2.45, fine tick marks + 3–4 gaps; encodes system health (gaps widen when degraded) | |
| ProgressOrbit | arc r ≈ 2.6, determinate 0..progress, indeterminate = rotating comet; hidden when `progressMode = none` | never invent percent |
| DataPackets | bright points travelling along circuit traces (shader: `fract(aT - time*speed)` window) | rate by state |
| EnergyArcs | 4–8 curved arcs core→shell, alpha animated | thinking/working only |
| MicroParticleHalo / DepthDust | `Points`, size attenuation, twinkle; dust larger and fainter, slight parallax | density = settings.particleDensity |
| ScanPlane | thin horizontal disc/ring sweeping vertically, cyan-gold edge | transcribing |
| AudioReactiveHalo | 96–160 radial bars at r ≈ 2.75 outside the gold orb; cyan when listening, gold/white when speaking; smoothed level (attack ~60 ms, release ~250 ms) | hidden otherwise |
| AgentMarkers | small diamonds orbiting at r ≈ 2.3, count = `activeAgentCount` (max per quality) | |
| Approval/Warning/ErrorFracture overlays | approval: outer ring holds open segments + slow amber pulse; warning: one outer ring left incomplete, shift towards orange; error: short entry impulse, broken ring segments displaced, deep orange/red accent lines only (core stays gold) | no flicker loops |

Materials: one shared custom `ShaderMaterial` family (lines, plates, points) with additive blending,
`depthWrite: false`, and a **depth/facing fade** (`vViewZ` or normal·view) so back sides render at ~35–45 %
of front intensity. Uniforms only: `uTime, uEnergy, uGold, uOrange, uHot, uAccent, uAccentMix, uSaturation,
uFlowSpeed, uFlowDensity, uOpacity, uFracture, uAlign`. Bloom via `@react-three/postprocessing`
(`Bloom` with `mipmapBlur`, `luminanceThreshold` ≈ 0.25–0.35 so only hot parts bloom); disabled at `low`.

## State → visual parameters

`deriveVisualTargets(layers, status, settings)` returns numeric targets; `useFrame` damps current values
towards targets using per-transition time constants (PLAN §20.2: idle→listening 120–220 ms, any→error ≤180 ms,
error→recovered 700–1200 ms, offline→online 900–1600 ms, others in between). Layers are parallel:
core+halo follow the **voice layer**, mid sphere follows voice when speaking else work, outer shell follows the
**work layer**, telemetry ring follows **health**, overlays follow **attention**. Priority for the label: PLAN §18.3.

Idle must look calm and expensive: core breath 4.5–6 s, very slow drifts on different axes, few packets,
glow 35–50 %. Working is the most active but stays legible. Offline = desaturated bronze, emission low,
rings stopped. Paused = dimmed gold, inner rings stopped, small pause glyph (HTML overlay).

## Interaction, a11y, performance

- Click / Enter → `onActivate(target)` where target depends on mode (approval/error/task/activity/command).
  Space → `onVoiceToggle()`. Hover → tooltip with state, action, runtime, agent, task id, source.
- Mouse parallax max 2–4°, damped, disabled under reduced motion or setting.
- `aria-live="polite"` sentence describing the state (PLAN §21 example).
- Quality levels `auto|low|medium|high|ultra` scale counts, DPR (low 1, medium 1.25, high 1.5–2, ultra 2),
  bloom resolution. `auto` adapts by measured frame time (downgrade if p95 > 20 ms for 3 s, upgrade carefully).
- Hidden tab → `frameloop="never"`; resume cleanly. `webglcontextlost` → show `OrbFallback2D`, try restore.
- `prefers-reduced-motion` or setting `animations: reduced|off` → no large rotations/parallax; state via
  brightness, opacity, labels. `animations: off` or no WebGL → 2D fallback (Canvas 2D drawing the same idea:
  gold core, incomplete technical rings, fragmented arcs, progress arc, audio pulse, overlays, labels).
- Test clock: `settings.testClock = { fixedTime?: number; animationProgress?: number }` and
  `audioFixture: "silence"|"normal"|"loud"|"tts"|"spike"` produce deterministic frames for screenshots.

## Forbidden

GIF/MP4/animated WebP/Lottie/sprite sheets, the reference image as texture, CSS circle orb, cyan or
blue wireframe globe, remounting geometry on state change, React state updates per frame, invented progress.
