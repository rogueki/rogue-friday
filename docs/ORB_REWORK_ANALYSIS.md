# Orb-Rework: Analyse und Plan (Owner-Auftrag 2026-10-17, Abschnitt 1)

Stand: 2026-10-17, Branch `claude/serene-goodall-uw4u83` (= `main` @ `1e9f50b`). Reine Analyse, kein Produktcode geändert.
Vorher-Belege: `docs/evidence/orb-rework/before/` (WebP + `measurements.json`). Messumgebung siehe Abschnitt 7.

Kurzfazit: Der Orb ist bereits eine vollwertige prozedurale R3F-Szene (kein Bild/Video), mit XState-Maschine, 14 Modi, 2D-Fallback
und Audio-Eingang. Die im Auftrag genannten Fehler kommen **nicht** von einem fehlenden Orb, sondern von (1) viel zu langsamen
Idle-Parametern und fast konstanter Kernhelligkeit, (2) Layout/Kamera (Orb ~98 % der Stage-Höhe, 17 px über Stage-Mitte, oben
abgeschnitten), (3) fehlenden echten Eventpfaden (Browser-Mikrofon und Browser-TTS erreichen den Orb nie; Transkription, Thinking
und TTS-Events existieren real nicht) und (4) einer Audio-Kette mit 4-Hz-Pegelwerten ohne Bänder. Der Auftrag lässt sich auf der
bestehenden Architektur umsetzen (refaktorieren, nicht neu bauen).

---

## 1. Framework und Umsetzung

| Thema | Befund (Datei) |
|---|---|
| App-Framework | Next.js 16 (Turbopack), React 19, Static Export + Control API; Orb wird nur client-seitig geladen: `apps/web/src/features/orb/OrbSlot.tsx` (`dynamic(..., {ssr:false})`) |
| Orb-Paket | `packages/orb` (`@friday/orb`, Export direkt aus `src/index.ts`, kein Build-Schritt) |
| Renderer | **React Three Fiber** (`@react-three/fiber`) + Three.js, `@react-three/postprocessing` (nur `Bloom`, `mipmapBlur`), eigene `ShaderMaterial`s (additiv, `depthTest:false`), Linien als instanzierte Screen-Space-Quads, Punkte/Plates instanziert. Kein Video/GIF/Bild/CSS-Kreis (`@react-three/drei` wird nicht benötigt). |
| Zustand | **XState v5** parallele Maschine `packages/orb/src/machine/orbMachine.ts` (Regionen connectivity/voice/work/attention/flash) + reine Funktion `deriveVisualTargets` → `LiveParams` (ein mutables Objekt pro Orb, per `useFrame` gedämpft, keine React-Updates pro Frame) |
| Fallback | Canvas-2D `fallback/OrbFallback2D.tsx` + `draw2d.ts`, nutzt dieselben `stepLiveParams` |
| Qualität | low/medium/high/ultra/auto (`settings.ts`, `scene/adaptiveQuality.ts`), Hidden-Tab/IntersectionObserver stoppt `frameloop` |
| Testbarkeit | Test-Clock (`settings.testClock`), Audio-Fixtures, `window.__ORB_DEBUG__`, Web: `orbTestHook.ts` (`?orbTime`, `window.__FRIDAY_ORB_TEST__`) |

## 2. Aktuelle Orb-Architektur (Text-Diagramm)

```
 Control API                                   Browser (apps/web)
 ───────────                                   ──────────────────
 deriveOrb() (core-views.ts)  ──GET /orb/status──► useOrbSnapshot() = TanStack-Query-Eintrag queryKeys.orb
   Eingaben: Agents(working), Tasks(running),    ▲
   Approvals(pending), Notifications P0/P1,      │ setQueryData
   VoiceStatus.mode, Adapter-Health              │
 trackDerivedState(): jedes Hub-Event ─150 ms debounce─► friday.orb.status_changed ─► applyEvent()
 voice-http adapter: Poll /status (250 ms aktiv / 1000 ms idle)
   └► friday.voice.audio_level {direction, level}  ─► RealtimeProvider.onEvent ─► audioStore.pushAudioLevel()  (kein React-State)
                                                     │  (state_changed/tts_*/transcript_* : applyEvent → return, ignoriert)
 OrbSlotInner.tsx ── snapshot, settings.orb, getAudioLevel=readAudioLevel ──► <FridayOrb>
   FridayOrb.tsx: layers = snapshot.layers → deriveVisualTargets() → targetsRef (React-Rate, nur bei Snapshot-Wechsel)
     OrbCanvas (R3F Canvas, alpha, dpr[1,cap]) → OrbScene
        FrameDriver.useFrame: dt, clock → resolveAudioLevel(reader) → stepLiveParams(live, targets, audio)  → Uniforms
        Szene (alle lesen nur `live.current`): DepthDust, MicroParticleHalo, SphereGlow, CoreCorona, EnergyArcs, MidCircuitSphere,
        OuterFragmentShell, InnerReactor, InnerGyroRings, Primary/SecondaryOrbitalRing, TelemetryRing, ProgressOrbit, DataPackets,
        ScanPlane, AudioReactiveHalo, AgentMarkers, Approval/Warning/ErrorFractureOverlay, CoreLens, WhiteHotCore, Bloom
     OrbOverlay (HTML: Statuslabel, in der Web-Panel-Variante per CSS ausgeblendet), Hit-Button, Tooltip, aria-live
 CorePanels.tsx OrbPanel: .ov-orb > .ov-orb__stage (inset 0 0 42px 0) > OrbSlot(sizeBoost 1.25) ; .ov-orb__status (42 px Streifen)
```

Browser-Sprachpfad (Linux, neu auf `main`) läuft **parallel** und ist vom Orb entkoppelt:
`useVoiceUi` → `browserAudio.ts` (getUserMedia → AudioContext → AudioWorklet `friday-capture` → Resampler → WebSocket
`/api/v1/voice/browser-audio` → Control API `BrowserVoiceGateway` → Voice-Dienst :43695 `/audio`; Rückweg: PCM-Frames → `playPcm`
(AudioBufferSourceNode → `destination`), Textnachrichten `audio_start|audio_end|clear|beep|status`). Kein AnalyserNode, kein Pegel.

## 3. Herkunft der Statuswerte

1. **Wire-Form**: Contract `OrbStatus`/`OrbLayers`/`OrbSnapshot` (`packages/contracts/schemas/orb/*`), 14 Modi identisch zur Auftragsliste. `OrbLayers.voice` kennt `idle|listening|transcribing|speaking`; `thinking`/`paused` stecken im `work`-Layer; `waiting_approval|success|warning|error` im `attention`-Layer.
2. **Arbitrierung server-seitig** `deriveOrb` (`apps/control-api/src/services/core-views.ts`): Priorität error > offline > approval > listening/speaking > transcribing > thinking > (paused) > working > warning > idle. Mock-Modus: `world.orbSnapshot()` (`packages/mock-data`, erzwingbar via Scenario-Aktion `force_orb_state`/`release_orb_state`).
3. **Arbitrierung client-seitig** nochmals in `arbitrateOrbState` (`orbMachine.ts`) auf den Layern; Abweichungen von der Auftragsliste (booting zuerst, paused über Aktivität, warning knapp über idle, success 1,5 s Flash) sind in `docs/ORB_SPECIFICATION.md` §4 dokumentiert. Die Auftrags-Priorität (critical error > offline > approval > listening > speaking > transcribing > thinking > working > syncing > idle) deckt sich bis auf error/offline: Server-Derive hat error vor offline (wie Auftrag), die Client-Maschine `arbitrateOrbState` hat offline vor error. Der Controller vereinheitlicht auf die Auftragsreihenfolge (critical error > offline).
4. **Client**: `useOrbSnapshot()` (Query-Cache `GET /orb/status`, durch `friday.orb.status_changed` per `applyEvent` aktualisiert) → `OrbSlotInner` → `FridayOrb` (`snapshot`-Prop) → `deriveVisualTargets`. Die XState-Maschine (`createOrbActor`) ist exportiert, wird im Web **nicht** benutzt (nur Storybook/Tests); im Web gilt der Server-Snapshot 1:1.

## 4. Eventlage heute (Pfad pro Auftragsbegriff)

| Auftragsbegriff | Contract-Event / Quelle | Wer emittiert real? | Erreicht den Orb? |
|---|---|---|---|
| Mikrofon aktiv | `friday.voice.state_changed` (`VoiceStatus.microphone.{state,active,inputLevel}`), `browserAudio.snapshot().active/paused` (lokaler Store) | Voice-http-Adapter: **nur Status-Poll**, `state_changed` wird real nicht gepusht (nur Mock); Browser: lokaler Store | Nur indirekt: Server-`deriveOrb` → `listening`, wenn Dienst `state=command|followup` meldet (Latenz 0,15–1,15 s: Idle-Poll 1000 ms + 150 ms Debounce). **Browser-Mikro offen ≠ Orb listening** (Wake-Word-Armed bleibt `idle`). |
| Voice Activity | kein eigenes Event; nur `friday.voice.audio_level` | voice-http, nur wenn `state=command|followup` (input) bzw. `speaking` (output), 250 ms | Ja, aber 4 Hz, siehe unten |
| Transkription | `friday.voice.transcript_partial` / `transcript_final` | **nur Mock** (`packages/mock-data/src/world/services/voice.ts`); Voice-Dienst meldet `transcribing` nicht (`adapters/voice-http/src/mapping.ts` `toVoiceMode`: nur listening/speaking/idle; `state=command` umfasst STT+Routing+Hermes-Wartezeit) | `applyEvent` ignoriert beide (`return`). Orb kann real nie `transcribing` zeigen. |
| Modellverarbeitung | `OrbLayers.work="thinking"` (nur wenn `VoiceStatus.mode==="thinking"`), `friday.agent.status_changed`, `friday.task.*` | `thinking` real **nie** (s. o.); Agent/Task-Events kommen vom Hermes-Adapter | Agent/Task → `work=working` über Server-Derive; `thinking` nur im Mock |
| TTS-Ausgabe | `friday.voice.tts_started` / `tts_ended` (`utteranceId`, `engine`, `interrupted`) | **nur Mock**; real: Dienst-Flag `speaking` → `VoiceStatus.mode=speaking` | Orb `speaking` über Server-Derive (verzögert); `tts_*` von `applyEvent` ignoriert |
| Agentenaktivität | `friday.agent.status_changed`, `friday.agent.heartbeat` | Hermes-Adapter | `activeAgentIds`/`activeAgentCount` per Server-Derive (nur `status=working`); kein Agentenname im Snapshot (`currentAgentId` nur ID) |
| Fehler | `friday.notification.created` (P0), `VoiceStatus.mode=error`, `friday.adapter.health_changed`, `friday.task.failed` | Control API/Adapter | Server-Derive → `error`/`warning`/`offline`; kein direktes Orb-Error-Event, `detailText` aus Notification-Titel |
| Freigaben | `friday.approval.requested/resolved/expired` | Control API | Cache + Server-Derive → `waiting_approval` mit `approvalId`; Klick → `/approvals?approval=<id>` (`useOrbActions.routeOrbActivation`) funktioniert |
| Orb direkt | `friday.orb.status_changed` (Snapshot) | Control API (150 ms debounced, ohne `audioLevel`/`since` in der Signatur) / Mock | ja, einzige Quelle |

### Erreichen echte Audiopegel den Orb?

* **Eingang (Mikro)**: Nein im Browser. `browserAudio.ts` hängt `MediaStreamAudioSourceNode` → Worklet → Resampler ins Netz, es gibt keinen `AnalyserNode` und keinen Pegelwert. Der Worklet-Block (`public/browser-audio-worklet.js`) postet die Roh-Samples, sie werden nur resampelt/gesendet.
* **Eingang (Windows/Device-Modus)**: Dienst-seitig gemessen (`installer/voice/audio_level.py`, `LevelMeter`, geglätteter RMS), vom voice-http-Adapter alle 250 ms aus `/status.input_level` gelesen → `friday.voice.audio_level {direction:"input"}` → `audioStore`. 4 Hz, 1 Wert, kein Peak/Bänder; Stale nach 600 ms → 0.
* **Ausgang (TTS)**: Device-Modus: TTS spielt **auf dem Server** (PC-Lautsprecher); nur `output_level` aus `/status` (4 Hz) → `audio_level {direction:"output"}`. Browser-Modus (Linux + ElevenLabs): PCM kommt per WebSocket in den Browser und läuft über `playPcm` → `destination`: **echtes analysierbares Signal**, aber ohne Tap.
* **Weitere Mängel der Kette**: `audioStore` speichert nur *einen* `level` (Richtung wird abgelegt, aber `readAudioLevel` ignoriert sie: Input-Pegel kann `speaking` treiben und umgekehrt); `status.audioLevel` des Snapshots wird im Web **ignoriert**, weil `resolveAudioLevel` den Reader bevorzugt (ein erzwungenes `audioLevel` im Mock bleibt wirkungslos); `AudioReactiveHalo`/Kern bekommen nur `live.audio` (ein Skalar, Attack 60 ms/Release 250 ms) — keine RMS/Peak/Low/Mid/High-Trennung.

## 5. Relevante Dateien

`packages/orb/src/`: `FridayOrb.tsx`, `OrbOverlay.tsx`, `settings.ts`, `machine/orbMachine.ts`, `visual/deriveVisualTargets.ts`,
`scene/{OrbCanvas,OrbScene,liveParams,materials,hooks}.ts(x)`, `scene/components/{core,rings,circuit,signals,overlays,OrbCameraRig}.tsx`,
`scene/geometry/*`, `scene/shaders/*`, `audio/{audioSource,fixtures}.ts`, `fallback/*`, `debug/OrbPerfOverlay.tsx`, `stories/Orb.stories.tsx`, `demo/*`, `scripts/*`.
`apps/web/src/`: `features/orb/{OrbSlot,OrbSlotInner,audioStore,orbTestHook,useOrbActions,useOrbSnapshot}.ts(x)`, `features/overview/CorePanels.tsx` (`OrbPanel`),
`app/web.css` (`.ov-orb*`, Z. 78–95, 150), `lib/realtime/{RealtimeProvider,applyEvent}.ts(x)`, `features/voice/{useVoiceUi,browserAudio,browserAudioResampler}.ts`,
`public/browser-audio-worklet.js`, `features/dev-scenarios/ScenarioConsole.tsx` + `app/(dashboard)/dev/scenarios/page.tsx`, `features/shell/AppBottomBar.tsx`.
Backend/Contract: `packages/contracts/asyncapi/friday-events.yaml` (+ `schemas/events/voice-*.json`, `schemas/orb/*`), `adapters/voice-http/src/{adapter,mapping}.ts`,
`apps/control-api/src/services/core-views.ts`, `runtime/create-runtime.ts` (`trackDerivedState`), `realtime/browser-voice.ts`, `installer/voice/{friday_voice,audio_level,elevenlabs_cloud}.py`.
Tests: `tests/e2e/{orb-states,visual,performance,fallback-2d}.spec.ts`, `packages/orb/src/*.test.ts(x)`.

## 6. Schwachstellen (gegen Auftrag §2, mit Messwerten)

Alle Maße: Standalone-Mock, 1920×1080 bzw. 1366×768, DPR 1; Orb-Pixel = Differenz Screenshot mit/ohne Canvas (Details Abschnitt 7).

| # | Auftrag §2 | Befund (verifiziert) |
|---|---|---|
| 1 | Nahezu statisch / Idle kaum Eigenbewegung | Code (`deriveVisualTargets.IDLE`): Ringe 0,16 / 0,10 / 0,035 / −0,028 / 0,012 rad/s = **39 s, 63 s, 180 s, 224 s, 523 s je Umdrehung**; Inner-Reactor 63 s, Mid-Shell 524 s, Outer 1047 s. Auftrag: 8–14 s / 13–21 s / 22–35 s. Gemessen (erzwungenes Idle): grobe Struktur ändert sich nur **~7 % pro Sekunde** (Low-Pass-Diff), Kernhelligkeit schwankt **±1,5 % (max/min 1,03)**. Auf Pixelebene flimmern Feinlinien (42 % der Orb-Pixel ändern sich pro Sekunde um >24/255): das ist Shader-Flow/Twinkle, kein sichtbarer großflächiger Lauf (`idle-1920x1080-motion-1s-frame-raw-lowpass.webp`). |
| 2 | Kern pulsiert nicht glaubwürdig | `coreGlowFragmentShader`: `k = uCore * uBreath * uEmission`; `uBreath = 1 ± 0,02` bei 5,2 s. Helligkeit idle konstant 0,62; kein 72–100-%-Zyklus, keine Skalen-Asymmetrie (Auftrag 0,97–1,035). PLAN §19.2 verlangt noch „±2 %, Glow 35–50 %“ — **der Owner-Auftrag überschreibt das** (Spec-Update nötig). |
| 3 | Ebenen nicht unabhängig | Eine `LiveParams`-Instanz, alle Gruppen dämpfen mit denselben Zeitkonstanten des *Moduswechsels* (`transitionTimeConstants`) auf aus dem Modus abgeleitete Skalare. Es gibt 5 Ring-Winkel + inner/mid/outer, aber keine eigenen Phasen/Noise-/Pulsgeneratoren je Gruppe, kein Layer-Controller; Fragmente teilen sich `shellActivity`/`radialOffset`. |
| 4 | Keine Reaktion bei Zuhören, Aufnahme, Transkription, Modellarbeit, Sprechen | Visuals existieren (cyan Halo, Scanplane, Gyro-Gegenlauf, Speak-Waves), werden aber **real nicht ausgelöst**: Browser-Mikro nicht angebunden (kein Orb-`listening` bei offenem Mikro), `transcribing`/`thinking` real nie gemeldet, `tts_*`/`transcript_*` von `applyEvent` verworfen, Statuslatenz 0,15–1,15 s. |
| 5 | Keine Audio-Reaktivität | Kette siehe §4: 4 Hz, 1 Skalar, richtungslos, 600-ms-Stale, keine Bänder; im Browser-Modus gar kein Pegel. Im 3D wirkt Audio nur auf Kern +0,35, Skalierung +10 %, Halo-Balken-Pegel, Corona-Wellen. Kein Input-/Output-Wellenring getrennt, keine Partikel-/Ring-Kopplung. |
| 6 | Orb zu weit oben, nicht exakt zentriert | `OrbCameraRig.LIFT = 0,045`: Kern gemessen bei y=167 px; Stage-Mitte 184 → **17 px (4,6 % Stage-Höhe) zu hoch**, Panel-Mitte 205 → **38 px zu hoch** (1920). Zusätzlich liegt der Canvas nur über dem 42-px-Statusstreifen, nicht über dem Panel. 1366×768: Kern erwartet y≈114 vs Stage-Mitte 125,5 / Panel-Mitte 146,5 (**32 px**). Horizontal mittig (Abweichung ≤3 px). |
| 7 | Glow/Partikel/Fragmente oben abgeschnitten | Orb-Box 1920: **y 0…359 bei 368 px Stage (98 %)**, x 187…613. Ausdehnung unterhalb des Kerns 192 px bei nur 167 px Platz nach oben → **≥25 px oben abgeschnitten**; 75–134 geänderte Pixel in den obersten 3 Canvas-Zeilen (Telemetrie-/Halo-Ring, siehe `idle-1920x1080-annotated-bbox.webp`). 1366×768: Box y 0…245/251, ≥17 px abgeschnitten, 341 Pixel in den obersten 3 Zeilen, Orb überlagert das Brand-Label („F.R.I.D.A.Y. AI CORE“). Ursache: `sizeBoost 1,25` (`CorePanels.tsx` `ORB_PANEL_SIZE_BOOST`, Entscheidung „orb ~90 % panel height“ aus `PROJECT_STATUS` A.2) × `FIT_RADIUS 3,55` passt nur Radius ≈2,84 in die halbe Höhe, Außenringe liegen bei 2,45–2,72 plus Glow 2,7. **Auftrag verlangt 65–78 % — aktuell 98 %.** Der Hit-Button ist 533 px hoch (Stage 368) und ragt nach oben aus der Stage. |
| 8 | Statusänderungen nicht unmittelbar erkennbar | Server-Derive: Hub-Event → 150 ms Debounce → Snapshot; Voice-Zustandsänderung wird erst vom nächsten Poll (≤1000 ms im Leerlauf) bemerkt. Modus-Visuals sind teils subtil (listening: Halo-Pegel gesteuert, aber nur 8 % Cyan); transcribing/thinking unterscheiden sich real nicht, weil nur Mock sie liefert. |

Weitere Befunde:
* Performance-Probe (SwiftShader, medium): 48 Draw-Calls, 18,4 k Dreiecke, 7,3 k Segmente — Frame 0,58 s (nur Software-GL; echte Messung auf GPU offen, siehe Abschnitt 11).
* Konsolen-Rauschen im Mock: 404 für `/api/v1/voice/browser-audio-availability` und `/api/v1/onboarding` (außerhalb des Orbs, für Abnahme 22.10 „keine Console Errors“ zu beachten).
* `FridayOrb.onVoiceToggle` (Leertaste) → `useVoiceUi.toggle`; das Browser-Mikro wird dort gestartet, der Orb erfährt es nicht.

---

## 7. Messumgebung / Belege

Dev-Server `FRIDAY_NEXT_DIST_DIR=.next-orb node scripts/run-next.mjs dev --port 3021 --mock` (Variablenname in `next.config.ts:18` bestätigt, nach Rename unverändert), Chromium 1194 headless, `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, Modi per `window.__fridayMock.engine.control({action:"force_orb_state",mode})`, Pegel für listening/speaking per `play_event friday.voice.audio_level` (60 ms). Server nach der Messung per PID beendet. `release_orb_state` fällt im Mock auf `waiting_approval` zurück, Idle wurde deshalb explizit erzwungen.
Dateien in `docs/evidence/orb-rework/before/`: `<modus>-1920x1080-full.webp` (idle, listening, thinking, working, speaking, waiting_approval, error, transcribing, warning), `<modus>-1920x1080-ai-core-panel-orb-only.webp`, `idle-1366x768-full.webp`, `*-1366x768-ai-core-panel.webp`, `idle-*-annotated-bbox.webp` (cyan = Canvas/Stage, grün = Stage-Mitte, magenta = Panel-Mitte, gelb = Orb-Box), `idle-1920x1080-motion-1s-frame-raw-lowpass.webp` (Frame | Roh-Diff | Low-Pass-Diff), `measurements.json`. Vergleich mit `design-references/jarvis_orb_reference.webp` und `..._dashboard_reference.webp`: Goldidentität, Kugelschale + Kern-Optik passen; die Referenz-Orb-Fläche (Dashboard-Referenz) ist deutlich größer als 78 % der Panelhöhe — **Zielkonflikt Auftrag §5 (65–78 %) vs. Referenz**, siehe offene Entscheidungen.

---

## 8. PLAN

### (a) Zielstruktur der Szene (Auftrag §4) und Wiederverwendung

Prinzip: bestehende Gruppen/Komponenten umbenennen/aufspalten, **kein zweiter Orb**, Geometrie einmal bauen (`useGeometry`), Gruppen per eigener `GroupDriver`-Funktion unabhängig animieren (je Gruppe: eigener Phasen-/Noise-Generator, eigene Dämpfungskonstanten, eigener Seed).

| Auftrags-Knoten | Bestand | Aktion |
|---|---|---|
| OrbScene | `scene/OrbScene.tsx` | refaktorieren: Gruppen als `<group name=...>` mit Group-Drivern |
| OrbCameraRig | `components/OrbCameraRig.tsx` | umbauen: Fit aus sichtbarer BBox, **kein `setViewOffset`/LIFT**, Zentrum (0,0,0) |
| CoreGroup: WhiteHotCore | `core.tsx WhiteHotCore` | reuse + Puls-Hüllkurve (Helligkeit 72–100 %, Skala 0,97–1,035) |
| CoreEnergyNoise | – | **neu** (Billboard/Shader, Noise-Turbulenz im Kern, audio-/thinking-moduliert) |
| CorePulseShell | `CoreCorona` (Speak-/Think-Wellen) + `CoreLens` | CoreCorona → CorePulseShell erweitern; CoreLens bleibt |
| InnerRingGroup: InnerRingA/B | `InnerReactor` (4 Mini-Ringe) + `InnerGyroRings` | reuse, Ring A cw 8–14 s, B ccw 13–21 s (Parameter statt Konstante) |
| SegmentedRing | – | **neu** (Ring mit Segmenten, die sich radial verschieben; Audio-Bänder/„richten sich aus“) |
| InnerDataArcs | `EnergyArcs` | reuse + umbenennen |
| CircuitSphereGroup: CircuitLines / DataNodes | `MidCircuitSphere`, `CircuitNodes` | reuse (sequenzielles Aufleuchten für Thinking per Shader-Uniform) |
| HolographicPanels | Plates in `circuit.tsx` (`usePlateSets`) + transparente Kugelschalen | Schalen **neu** (2 fresnel-Shells, billig), Plates reuse |
| OuterRingGroup: OuterRingA/B | `PrimaryOrbitalRing`, `SecondaryTiltedRing` | reuse (22–35 s) |
| TelemetryRing / ProgressRing | `TelemetryRing`, `ProgressOrbit` | reuse (Telemetry zeigt Ein-/Ausgangsdaten bei Syncing: Uniform) |
| FragmentGroup: FloatingFragments | `FloatingDataFragments` (in `circuit.tsx`) | reuse + individuelle Phase/Mini-Rotation/radiale Drift im Vertex-Shader |
| BrokenArcs / TechnicalPanels | `OuterFragmentShell` (Arcs, Traces, Plates) | aufteilen in zwei Komponenten |
| ParticleGroup: AmbientParticles | `MicroParticleHalo` + `DepthDust` | reuse + Drift/Helligkeitsvarianz |
| EnergyParticles | – | **neu** (instanziert, Kraft von `bands.high`/Peaks, nach außen/innen) |
| DataPackets | `DataPackets` | reuse, seedbare, nicht gleichzeitige Ringe (Scheduler) |
| VoiceReactionGroup: InputWaveRing / OutputWaveRing / RadialPulseRings | `AudioReactiveHalo` (Balken) + `CoreCorona.uSpeak` | **neu** Wellenringe (Input cyan-gold, Output gold-weiß, Radialpulse); Halo-Balken bleiben als Bänder-Anzeige |
| ScanGroup: HorizontalScan | `ScanPlane` | reuse |
| RadialScan / AnalysisSweep | – | **neu** (Sweep-Linie/Keil, Thinking/Transcribing) |
| PostProcessing | `BloomPass` | reuse; optional Vignette (Auftrag „optional“): nein in Phase 1 |
| Overlays Approval/Warning/Error | `overlays.tsx` | reuse; Warning „Orb bleibt lebendig“: langsamer Puls + Amber-Impuls, nur einzelne Außenringe reduziert (kein globaler Dämpfer) |
| AgentMarkers | `AgentMarkers` | reuse (n Marker = Agentenanzahl) |

Idle-Parameter laut Auftrag §8 als Tabelle in `deriveVisualTargets` (Ring A 0,45–0,78 rad/s ⇒ 8–14 s; B 0,30–0,48 ⇒ 13–21 s; Außen 0,18–0,29 ⇒ 22–35 s; Atem 4,5–6 s mit Asymmetrie 0,97–1,035; Kernhelligkeit 0,72–1,0 über `0,86 + 0,14·sin` + ein zweiter langsamer Oszillator für Unregelmäßigkeit, Mikrobewegung positionY ±0,02 + Rotationsdrift mit Value-Noise). Übergangszeiten laut Auftrag §17 in `transitionDurationMs` angleichen (idle→listening 120–200 usw.; ist bereits 170/240/300/420/250/160/950 — wenige Anpassungen, speaking→idle 350–600, error→recovered 700–1100).

### (b) Typisierter `OrbController` und Layer-Modell (`packages/orb`, framework-agnostisch)

Ort: `packages/orb/src/controller/` (`types.ts`, `createOrbController.ts`, `layers.ts`, `audioChannels.ts`, `demo.ts`). Kein React-Import, kein DOM außer in `audio/` (Web Audio, per DI testbar). Der Controller **kapselt die vorhandene XState-Maschine** (`orbMachine`) als deterministischen Kern und ergänzt: Audio-Kanäle, Leases, Quellen-Arbitrierung, Demo-Skripte. Wire-`OrbStatus` bleibt unverändert; die Laufzeitform heißt `OrbRuntimeStatus` (Namenskollision mit dem Contract-Typ `OrbStatus`, der im Paket re-exportiert wird). Keine Contract-Änderung nötig (optionale additive Wünsche in Abschnitt 11).

Layer-Modell (Auftrag §7), abgebildet auf die bestehenden Regionen:

| Layer | Werte | Bestand |
|---|---|---|
| `primaryInteraction` | idle, listening, transcribing, thinking, speaking | `voice`-Region (+ `thinking` aus `work` des Contracts) |
| `backgroundWork` | idle, syncing, working (+ activeAgents) | `work`-Region |
| `systemHealth` | connectivity booting/online/offline/paused, health online/degraded/offline, attention none/warning/error, success-Flash | `connectivity` + `health` + Teile von `attention` |
| `approval` | pending, count, approvalId | `attention=approval` (wird eigener Layer, damit approval **neben** error/speaking sichtbar bleibt) |

`mode` (OrbMode) entsteht ausschließlich durch `arbitrate(layers)` nach Auftrags-Priorität (critical error > offline > waiting_approval > listening > speaking > transcribing > thinking > working > syncing > idle; booting/paused/success/warning wie dokumentiert). Aus **Layern**, nie aus Text/DOM.

```ts
// packages/orb/src/controller/types.ts  (WP-A liefert zuerst; WP-B kompiliert dagegen)
import type { OrbMode as ContractOrbMode, OrbSnapshot } from "../contract-types";

export type OrbMode = ContractOrbMode; // booting|idle|listening|transcribing|thinking|syncing|working|speaking|waiting_approval|success|warning|error|offline|paused
export type OrbProgressMode = "none" | "determinate" | "indeterminate";
export type OrbSeverity = "none" | "info" | "warning" | "critical";

/** Client runtime form of the status (wire form = contract OrbStatus). Ephemeral, never put into React state. */
export interface OrbRuntimeStatus {
  mode: OrbMode;
  activityText?: string;
  detailText?: string;
  inputAudioLevel: number;   // 0..1, smoothed, gated
  outputAudioLevel: number;  // 0..1, smoothed
  progress?: number | null;  // 0..1, only meaningful for progressMode "determinate"
  progressMode: OrbProgressMode;
  activeAgentCount?: number;
  currentAgentName?: string;
  currentTaskId?: string;
  severity?: OrbSeverity;
  since: number;             // epoch ms of the last mode change
}

export type PrimaryInteraction = "idle" | "listening" | "transcribing" | "thinking" | "speaking";
export type BackgroundWork = "idle" | "syncing" | "working";
export interface SystemHealthState {
  connectivity: "booting" | "online" | "offline" | "paused";
  health: "online" | "degraded" | "offline" | "unknown";
  attention: "none" | "warning" | "error" | "success";
  message?: string;
}
export interface ApprovalState { pending: boolean; count: number; approvalId?: string }
export interface OrbLayerState {
  primaryInteraction: PrimaryInteraction;
  backgroundWork: BackgroundWork;
  systemHealth: SystemHealthState;
  approval: ApprovalState;
}

export type OrbAudioSourceKind = "none" | "analyser" | "service-level" | "synthetic";
/** One analysed audio frame; the object is owned by the caller and refilled in place (no per-frame allocation). */
export interface OrbAudioFrame {
  rms: number; peak: number; low: number; mid: number; high: number; // all 0..1, normalised + noise-gated
  gateOpen: boolean;  // voice present (hysteresis)
  source: OrbAudioSourceKind;
}
export interface OrbAudioFrameSource {
  /** Called at most once per rendered frame from the orb's animation loop. Must not allocate or throw. */
  sample(nowMs: number, out: OrbAudioFrame): void;
  dispose(): void;
}

export interface OrbControllerState {
  readonly version: number;                 // increments on every low-rate state change
  readonly status: OrbRuntimeStatus;        // audio levels here are the last published values (<= 10 Hz), not per-frame
  readonly layers: OrbLayerState;
  readonly overrideMode: OrbMode | null;    // set by setMode (debug/demo), cleared by reset()
}

export interface OrbController {
  getState(): OrbControllerState;                                   // stable reference between changes
  subscribe(listener: (state: OrbControllerState) => void): () => void; // low-rate only (useSyncExternalStore)
  /** Per-frame read for the scene (no React): fills `inputs` in place. */
  readFrame(nowMs: number, inputs: OrbFrameInputs): void;

  setMode(mode: OrbMode, options?: { activityText?: string; detailText?: string }): void; // explicit override (debug, demo, tests)
  setInputAudioLevel(level: number): void;                          // scalar convenience; becomes a "service-level" frame
  setOutputAudioLevel(level: number): void;
  setInputAudioSource(source: OrbAudioFrameSource | null): void;    // analyser or synthetic source (replaces scalar)
  setOutputAudioSource(source: OrbAudioFrameSource | null): void;
  setProgress(progress: number | null, mode?: OrbProgressMode): void;
  setActivity(activityText?: string, detailText?: string): void;
  setAgentCount(count: number, names?: readonly string[]): void;
  setApproval(approval: { approvalId?: string; count?: number } | null): void;
  setSystemHealth(patch: Partial<SystemHealthState>): void;
  applySnapshot(snapshot: OrbSnapshot): void;                       // server truth for work/approval/health/attention
  reset(): void;
  dispose(): void;
  readonly bridge: OrbEventBridge;                                  // see (c)
}

/** What the scene reads each frame; one preallocated instance per orb. */
export interface OrbFrameInputs { input: OrbAudioFrame; output: OrbAudioFrame; speechEnvelopeActive: boolean }

export interface CreateOrbControllerOptions {
  now?: () => number;       // test clock
  seed?: number;            // deterministic envelopes / demo
  leaseMs?: number;         // default 1500: local voice facts expire without refresh
}
export declare function createOrbController(options?: CreateOrbControllerOptions): OrbController;
```

`FridayOrb` bekommt eine zusätzliche, rückwärtskompatible Prop `controller?: OrbController`. Mit Controller werden `snapshot/status` und `getAudioLevel/audioLevelRef` ignoriert (bleiben als `@deprecated` für Stories/Tests). Pro Frame ruft `FrameDriver` `controller.readFrame` (allokationsfrei), React rendert nur bei `subscribe`-Änderungen (Moduswechsel, Text, Progress-Schritte), Audio-Pegel im `status` werden höchstens mit 10 Hz publiziert (nur für Texte/aria, nicht für die Szene).

**Quellen-Arbitrierung (Konfliktregel)**: Der Server-Snapshot (`applySnapshot`) ist Wahrheit für `backgroundWork`, `approval`, `systemHealth`, Agentenanzahl und Fortschritt. Lokale Voice-Fakten (Mikro offen, VAD, TTS an) setzen `primaryInteraction` als **Lease** (`leaseMs`, vom Bridge-Heartbeat verlängert: Audio-Frames, `status`-Nachrichten). Läuft die Lease ab (Verbindungsabbruch, Tab-Wechsel), fällt der Layer auf den Server-Wert zurück — kein hängender „listening“-Zustand. Der Server-`voice`-Layer gilt, solange kein lokaler Fakt aktiv ist. Explizit `setMode` (Debug/Demo) übersteuert alles, bis `reset()`.

### (c) `OrbEventBridge` (austauschbar, ohne Kopplung an Hermes/Kimi/Voice-Framework)

Interface + Implementierung `createOrbEventBridge(controller)` in `packages/orb/src/bridge/` (WP-A). Die **Quellen-Adapter** (Realtime, Browser-Mikro, TTS) liegen in `apps/web` (WP-B) und rufen nur dieses Interface.

```ts
// packages/orb/src/bridge/OrbEventBridge.ts
export interface OrbTaskInfo {
  taskId: string;
  title?: string;
  agentName?: string;
  /** 0..1 or null when unknown (then progressMode is indeterminate; percentages are never invented). */
  progress?: number | null;
}
export interface OrbErrorInfo { message: string; code?: string; critical?: boolean }

export interface OrbEventBridge {
  onMicrophoneOpened(info?: { source: "browser" | "service"; passive?: boolean }): void; // passive = wake-word armed, no command yet
  onVoiceActivity(level: number | OrbAudioFrame): void;   // 0..1 or analysed frame; refreshes the lease
  onMicrophoneClosed(): void;
  onTranscriptionStarted(): void;
  onTranscriptionCompleted(): void;
  onThinkingStarted(activityText?: string): void;
  onThinkingCompleted(): void;
  onTaskStarted(task: OrbTaskInfo): void;
  onTaskProgress(progress: number | null): void;
  onTaskCompleted(result?: { taskId?: string; success?: boolean }): void;  // success -> 1.5 s success flash
  onTtsStarted(info?: { utteranceId?: string; engine?: string; hasAudioAnalysis?: boolean }): void;
  onTtsAudioLevel(level: number | OrbAudioFrame): void;
  onTtsEnded(info?: { interrupted?: boolean }): void;       // interrupted = barge-in
  onApprovalRequired(approvalId: string): void;
  onWarning(message: string): void;
  onError(error: OrbErrorInfo | Error | string): void;
  // additions (needed for 22.x and the server-truth layers; not in the order's list but required):
  onApprovalResolved(approvalId?: string): void;
  onWarningCleared(): void;
  onErrorCleared(): void;
  onSyncStarted(source?: string): void;
  onSyncFinished(): void;
  onAgentActivity(count: number, names?: readonly string[]): void;
  onOnline(): void;
  onOffline(): void;
  onPaused(): void;
  onResumed(): void;
  onSnapshot(snapshot: OrbSnapshot): void;                  // friday.orb.status_changed
  dispose(): void;
}
export declare function createOrbEventBridge(controller: OrbController): OrbEventBridge;
```

Verdrahtung in `apps/web` (WP-B), Ort `apps/web/src/features/orb/bridge/`:

| Quelle | Eingang | Bridge-Aufruf |
|---|---|---|
| `RealtimeProvider.onEvent` (vor `applyEvent`) → `routeRealtimeToOrb(event, bridge)` | `friday.orb.status_changed` | `onSnapshot` |
| | `friday.voice.audio_level` (service) | `onVoiceActivity` (input) / `onTtsAudioLevel` (output) — **nur wenn kein lokaler Analyser aktiv** (Quelle `service-level`) |
| | `friday.voice.transcript_partial/final` | `onTranscriptionStarted` / `onTranscriptionCompleted` (+ nie den Text speichern) |
| | `friday.voice.tts_started/ended` | `onTtsStarted` / `onTtsEnded({interrupted})` |
| | `friday.voice.state_changed` (mode listening/speaking/thinking/error, `microphone.state`) | passive/aktiv-Mikro, `onThinkingStarted/Completed`, `onError` |
| | `friday.task.created/updated/progress/completed/failed/cancelled` | `onTaskStarted/onTaskProgress(determinate? value : null)/onTaskCompleted({success})`, `onError` bei failed |
| | `friday.agent.status_changed/heartbeat` | `onAgentActivity(count, names)` (Namen aus Agent-Cache) |
| | `friday.approval.requested/resolved/expired` | `onApprovalRequired(id)` / `onApprovalResolved` |
| | `friday.notification.created` (P0/P1), `friday.adapter.health_changed` | `onError({critical})` / `onWarning` |
| | Transport `onGap/onResync` / Offline | `resetAudio`, `onOffline/onOnline` |
| `browserAudio.ts` | Store-Änderungen `active/paused/speaking`, WS `audio_start/audio_end/clear/status` | `onMicrophoneOpened({source:"browser"})`, `onMicrophoneClosed`, `onPaused/Resumed`, `onTtsStarted/Ended`, `clear` → `onTtsEnded({interrupted:true})` (Barge-In) |
| Analyser (d) | Mic-/TTS-`AudioFrameSource` | `controller.setInputAudioSource/setOutputAudioSource` (kein Event pro Frame) |

Server-Latenz-Lücken: Weil real kein `transcribing/thinking/tts_*` ankommt, leitet der Browser-Adapter diese Phasen **explizit gekennzeichnet** (`source:"local-heuristic"`) aus Fakten ab: lokales VAD fällt nach Sprachende (>400 ms Stille bei offenem Gate) → `onTranscriptionStarted`, Dienst meldet weiter `command` ohne `speaking` → nach `transcript_final` oder 1,2 s `onThinkingStarted`; `audio_start` → `onTtsStarted`. Das ist Zustand aus Ereignissen, nicht aus Texten, und wird in der Debug-Anzeige als „abgeleitet“ markiert. Sauberer Weg (offen, Entscheidung Lead): Voice-Dienst/Adapter um echte `stt`/`thinking`-Zustände und `tts_started/ended`-Events erweitern (siehe Abschnitt 11).

### (d) Audio-Analyse

**Ort**: `packages/orb/src/audio/analyzer.ts` (WP-A, Browser-API injiziert, daher Node-testbar mit Fake-`AnalyserNode`/`OfflineAudioContext`). Genutzt von `apps/web` (WP-B) an zwei Stellen:
1. Mikro: in `browserAudio.start()` vorhandenes `source` (MediaStreamAudioSourceNode) zusätzlich in `createAudioAnalyzer(audioContext, source, {kind:"input"})` leiten. Der Analyser hängt als **Tap** (Ausgang → stummes `GainNode(0)` → `destination` bzw. unverbunden): beeinflusst Capture/Wiedergabe nicht.
2. TTS: `playPcm` verbindet die `AudioBufferSourceNode`s künftig mit einem persistenten `outputBus: GainNode` → `destination`; der Analyser (`kind:"output"`) liest `outputBus`. Wiedergabe läuft ungeblockt; `clear` stoppt die Quellen wie bisher. Gleiches Muster für `HTMLAudioElement` (`createMediaElementSource`) falls später ein Browser-`<audio>`-TTS entsteht.

**Algorithmus** (`AnalyserNode`, `fftSize 1024`, `smoothingTimeConstant 0`; vorallozierte `Float32Array`; Pull einmal pro Render-Frame aus `readFrame`, keine eigenen Timer):
* RMS und Peak aus `getFloatTimeDomainData`; Bänder aus `getFloatFrequencyData` (dB → linear): Low 60–250 Hz, Mid 250–2000 Hz, High 2–6 kHz (Sprache).
* Normalisierung in dB: `level = clamp((dB − floorDb) / (ceilDb − floorDb))`, `floorDb` = adaptiver Rauschboden, `ceilDb` = langsamer Spitzen-Tracker (−12 dB Start, Zerfall 4 s) → leise klein, laut größer, nie >1.
* **Noise-Gate (kalibriert)**: beim Öffnen 600 ms Kalibrierung (Rauschboden = Median RMS), danach mitlaufendes Minimum (langsamer Anstieg 0,5 dB/s); Öffnen bei `floor + 9 dB` (≈ 2,8×), Schließen bei `floor + 5 dB`, Hold 80 ms (Hysterese) → Stille = keine starke Bewegung.
* **Glättung** (zeitbasiert, `smoothAudioLevel` bleibt): Attack 70 ms (Konfiguration 50–90), Release 200 ms (150–260), pro Band getrennt; Peak mit schnellerem Release (120 ms) für Partikelstöße.
* Ausgabe als `OrbAudioFrame` mit `source:"analyser"`.

Mapping in der Szene (begrenzt, alle Faktoren in `audioMapping.ts`, Konstanten testbar):
`coreScale = base + input*0.08`, `coreIntensity = base + input*1.2` (geclamped auf HDR-Max), `waveAmplitude = input`, `ringSpeed = base + input*k`, `particleForce = input*k` (Peak-Anteil), `bloom = base + input*k` (Obergrenze); Speaking: Low → Kernpuls, Mid → SegmentedRing/Ringsegmente, High → EnergyParticles + feine Lichtimpulse, RMS → Gesamtintensität. Eingang treibt nur `listening`, Ausgang nur `speaking`; `transcribing`/`thinking`: Mikro-Reaktion hart aus (Auftrag §10/§11).

**Service-Pegel (Device-Modus, 4 Hz)**: `ServiceLevelSource` interpoliert die 250-ms-Werte (linear + Release), `source:"service-level"`, keine Bänder (low/mid/high aus RMS abgeleitet, als solche markiert).

**Speech-Envelope-Fallback** (`audio/speechEnvelope.ts`, deterministisch über `mulberry32(seed)`, kein Sinus): Silbenmodell mit Silbendauer 140–260 ms (Log-Normal), Wortgruppen von 2–6 Silben, Wortlücken 60–140 ms, Satzpause 350–700 ms nach 8–20 Silben, pro Silbe zufällige Intensität 0,35–1,0 und Raised-Cosine-Hüllkurve, Mikro-Jitter, Konsonanten-Bursts für `high`. Aktiv, wenn `onTtsStarted` kam und innerhalb 250 ms **kein** Analyser-/Service-Pegel eintrifft (oder bei `hasAudioAnalysis:false`); der Service-Pegel (falls vorhanden) skaliert die Hüllkurve statt sie zu ersetzen. `source:"synthetic"`, im Debug-Panel sichtbar. TTS-Ende beendet die Hüllkurve mit Release, Barge-In sofort (≤150 ms).

Reduced Motion: Audio nur als ruhiger Ring (Wellenring-Amplitude, keine Kern-/Partikelstöße).

### (e) Layout/Zentrierung im AI-Core-Panel

Ursachen: `LIFT` im Kamera-Rig, `sizeBoost 1,25`, Canvas nur über dem Stage-Bereich ohne Padding/Grid, Hit-Button größer als Stage. Maßnahmen:
* `OrbCameraRig`: `setViewOffset` und `LIFT` entfernen; Kamera/LookAt exakt (0,0,0). Fit aus **sichtbarer Gesamt-BBox**: `R_VIS = 2,9` (äußerstes nicht ausblendendes Element inkl. Progress-Ring 2,64, Impulsringe auf ≤2,9 begrenzt, Fragment-Push-out), `halfViewUnits = R_VIS / fill`, `fill = 0,72` (Auftrag 65–78 %), passend für `min(Höhe, Breite)` der **Nutzfläche** (Stage minus Padding `clamp(24px,4vh,52px)`). Glow/Bloom-Billboards dürfen über R_VIS hinaus auslaufen und blenden bis zum Canvas-Rand auf 0 aus (Shader-`smoothstep` auf Canvas-Rand statt harter Kante).
* `FridayOrb` Host: `position:relative; width/height:100%; min-height:420px; display:grid; place-items:center; overflow:hidden; padding:clamp(24px,4vh,52px)`; Canvas-Wrapper `position:absolute; inset:0; display:grid; place-items:center; pointer-events:none`; Hit-Button zentriert (`inset:0; margin:auto; width/height = Orb-Durchmesser`), nicht mehr mit `top:46 %`. Keine negativen `top/translate/margin`-Hacks.
* `OrbSlotInner`/`CorePanels.tsx` (WP-B): `ORB_PANEL_SIZE_BOOST` entfernen (=1), `.ov-orb__stage` unverändert als Grid-Host (`inset: 0 0 var(--ov-orb-strip) 0`) mit Padding; Brand-Label/„Aktualisiert“ liegen außerhalb der Nutzfläche (Padding-Top ≥ Label-Höhe 44 px bei kleinen Panels) — kein Überlappen bei 1366×768.
* **Größe**: Bei `fill 0,72` wird der Orb auf 1920×1080 ≈ 265 px (Stage 368) und auf 1366×768 ≈ 181 px (Stage 251) — **kleiner als heute (360/245 px)**. Das ist Auftrag §5, widerspricht aber der Dashboard-Referenz und dem früheren Owner-Wunsch ~90 %. Entscheidungsvorschlag: Auftrag befolgen (Glow darf größer auslaufen), Panelhöhe **nicht** ändern (Dashboard ist fertig); Wert zentral als `ORB_FILL_RATIO` konfigurierbar, 0,78 als Obergrenze. Offene Rückfrage für den Owner in Abschnitt 11.
* Tests: Pixelprüfung „keine Orb-Pixel in den äußersten 2 Canvas-Zeilen/-Spalten“, Mittelpunkt = Stage-Mitte ±2 px, BBox/Stage in 0,65–0,78 (Methode: Differenz-Screenshots wie in Abschnitt 7).

### (f) Debug-Panel (nur Development)

* Komponente `apps/web/src/features/orb/debug/OrbDebugPanel.tsx` (WP-B), arbeitet **nur** gegen `OrbController` (kein Backend). Buttons: Idle, Listening, Transcribing, Thinking, Syncing, Working, Speaking, Waiting Approval, Success, Warning, Error, Offline, Paused; Slider: Input/Output Audio Level, Progress (mit „unbekannt“-Schalter), Agent Count, Bloom, Particle Density, Animation Speed (die drei letzten gehen in `OrbSettings` über einen kleinen `orbDebugStore`); Auto Demo (Idle→Listening→Transcribing→Thinking→Working→Speaking→Success→Idle), Voice Demo, Working Demo, Error Recovery Demo, Reset. Die Demo-Skripte selbst (`createOrbDemo(controller)`, deterministisch, seedbar) liefert WP-A.
* Platzierung: (1) auf der bestehenden Dev-Seite `/dev/scenarios` (`features/dev-scenarios/ScenarioConsole.tsx`, bereits durch `features.devScenarios` gegatet) als Abschnitt „Orb-Labor“ **plus** (2) optionales schwebendes Overlay im `OrbPanel` bei `?orbDebug=1` und `meta.features.devScenarios`. Produktion: `dynamic(import)` hinter `process.env.NODE_ENV !== "production" && features.devScenarios`; Test, dass der Production-Build keinen Debug-Code enthält (analog zum bestehenden „no mock code in prod build“-Grep).
* Controller-Zugriff für E2E: `window.__FRIDAY_ORB__ = { controller }` nur bei `devScenarios` (neben `__FRIDAY_ORB_TEST__`).

### (g) Testplan (Auftrag §22)

Unit (Vitest): Controller/Arbitrierung (Layer-Matrix, Priorität, Lease-Ablauf, Barge-In), Bridge (jeder `on*`-Aufruf → erwarteter Layer/Mode/Text), Audio-Analyser (synthetische Sinus-/Rausch-Buffer: leise<laut, Stille unter Gate, Hysterese, Attack/Release-Zeiten ±10 %), Speech-Envelope (Determinismus, Pausenstatistik, keine Periodizität: Autokorrelation), Mapping-Grenzen, `deriveVisualTargets` (Idle-Rotationsperioden, Kern-Hüllkurve, Warning „lebendig“), Layout-Funktion (Kamera-Fit rein numerisch), `routeRealtimeToOrb` (Eventtabelle), `OrbDebugPanel` (RTL).
E2E (Playwright, neue `tests/e2e/orb-*.spec.ts`):

| Abnahme | Test |
|---|---|
| 22.1 Position | Differenz-Screenshot-Messung bei 1366×768, 1920×1080, 2560×1440, 3840×2160, Zoom 80/100/125 % (Viewport×DPR); Mittelpunkt, kein Rand-Pixel, Fill 0,65–0,78 |
| 22.2 Idle | forced idle 8 s: ≥5 unabhängige Bewegungen über Probe (`window.__ORB_DEBUG__` um Gruppenwinkel/Phasen erweitern) + Bildvarianz Kern/Ringe/Fragmente/Partikel/Datenimpuls getrennt (Zonen-Diff wie Abschnitt 7) |
| 22.3 Listening | Chromium `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` (Stille/leise/laut deterministisch erzeugt) → `getUserMedia` → Analyser; Modus ≤200 ms nach Mikro-Start; Pegel leise<laut; Stille bleibt ruhig (Bild-Diff-Schwelle) |
| 22.4 Transcribing | Bridge-Sequenz via Dev-Hook, Wellenring weg, Scan sichtbar, Pixelmuster ≠ Thinking |
| 22.5 Thinking | kein Wellenring, kein Prozent-Text (`progressMode none`) |
| 22.6 Working | `friday.task.*` via Szenario-Engine → Working + Agentenzahl (`aria`/Probe), ProgressArc nur bei determinate, Abschluss → success → idle |
| 22.7 Speaking | TTS-Start (Test-`OscillatorNode` über `outputBus`) → speaking während der ganzen Ausgabe, Pausen sichtbar (Pegel→0), Ende beendet, Barge-In (`clear`) ≤150 ms |
| 22.8 Approval | `approval-waiting`-Szenario → Orb + Klick öffnet richtige Freigabe (besteht schon, erweitern um Parallelzustand speaking+approval) |
| 22.9 Error | Fehler sofort, 10 s ohne Flackern (Frame-Diff-Varianz), Recovery 700–1100 ms |
| 22.10 Performance | 30-Min-Soak (bestehende Infrastruktur `tests/e2e/support/perf.ts`): Heap-Slope, `draws`/`geometries`/`textures` konstant, keine Console-Errors (404-Rauschen vorher beheben/whitelisten), Mikro-/TTS-Analyser öffnen/schließen 200× ohne Leak (AudioContext/Nodes) |

Visuell: `toHaveScreenshot` mit Test-Clock (`fixedTime`, `animationProgress`, `audioFixture`) für idle, listening(low/high), transcribing, thinking, syncing, working(det/indet), speaking(+Hintergrundagenten), waiting_approval, warning, error, offline, paused; 2D-Fallback weiter statisch (`animations:"off"`). Neue Baselines nur nach Lead-Sichtprüfung gegen Referenzbilder; Abnahme-Screenshots + kurzes Video (Playwright `recordVideo`, Auto-Demo) + Perf-Werte nach Auftrag §23.
Perf-Budget: High-Qualität p95 < 16,7 ms auf realer GPU (nicht im Cloud-Sandkasten messbar), Draw-Calls ≤ 70, keine Allokationen pro Frame (Test mit `performance.memory`/Alloc-Zähler im Controller-Pfad), `ultra` nur manuell.
Reduced-Motion/Fallback: bestehende Specs erweitern (alle Zustände lesbar über Text/Helligkeit, Audio nur ruhiger Ring; 2D-Fallback zeigt alle Zustände inkl. Wellenring).

### (h) Aufteilung in zwei parallele Arbeitspakete (disjunkte Schreibbereiche)

**WP-A — `packages/orb/**` (inkl. `packages/orb/src/stories/**`, `packages/orb/demo/**`, `packages/orb/scripts/**`)**
Controller, Layer-Modell, Bridge-Implementierung, Audio-Analyse + Speech-Envelope + Service-Level-Quelle, Demo-Skripte, Szenenumbau (Gruppen, neue Komponenten, Idle-Parameter, Übergänge, Kamera-Fit ohne LIFT, Host-CSS), 2D-Fallback-Parität, Reduced Motion, Stories/Demo, Paket-Unit-Tests, Aktualisierung `docs/ORB_SPECIFICATION.md` (Doku gehört zu WP-A, `docs/ORB_REWORK_ANALYSIS.md` bleibt Lead).
**WP-B — `apps/web/**` + `tests/e2e/**`**
`features/orb/*` (Controller-Singleton `orbRuntime.ts`, Bridge-Adapter `bridge/routeRealtimeToOrb.ts`, `bridge/browserVoiceBridge.ts`), Änderungen an `RealtimeProvider.tsx` (Event-Routing), `browserAudio.ts` (Analyser-Taps, `outputBus`, Event-Hooks), `useVoiceUi.ts`, `OrbSlotInner.tsx` (Controller statt Snapshot/Reader), `audioStore.ts` (Richtungen trennen oder ablösen), `CorePanels.tsx` + `web.css` (Layout/BoostEntfernung), `OrbDebugPanel` + Einbindung in `/dev/scenarios`, E2E/Visual/Perf-Tests, Aktualisierung bestehender Orb-Tests.
Nicht in den Paketen (Lead/ggf. später): Contract, Adapter, Installer/Voice-Dienst, `docs/PROJECT_STATUS.md`.

**Gemeinsame Schnittstelle** (WP-B konsumiert; Quelle der Wahrheit = die TypeScript-Blöcke in (b) und (c), Datei `packages/orb/src/controller/types.ts` + `bridge/OrbEventBridge.ts`, Export aus `packages/orb/src/index.ts`):

```ts
// @friday/orb — new public surface (semver-additive; existing exports stay)
export type {
  OrbMode, OrbProgressMode, OrbSeverity, OrbRuntimeStatus, OrbLayerState, PrimaryInteraction, BackgroundWork,
  SystemHealthState, ApprovalState, OrbAudioFrame, OrbAudioFrameSource, OrbAudioSourceKind, OrbControllerState,
  OrbController, OrbFrameInputs, CreateOrbControllerOptions, OrbEventBridge, OrbTaskInfo, OrbErrorInfo,
} from "./controller/types"; // + ./bridge/OrbEventBridge
export { createOrbController } from "./controller/createOrbController";
export { createOrbEventBridge } from "./bridge/createOrbEventBridge";
export { createAudioAnalyzer } from "./audio/analyzer";
export { createServiceLevelSource } from "./audio/serviceLevelSource";
export { createSpeechEnvelopeSource } from "./audio/speechEnvelope";
export { createOrbDemo } from "./controller/demo";

export declare function createAudioAnalyzer(
  context: BaseAudioContext,
  source: AudioNode,
  options: { kind: "input" | "output"; attackMs?: number; releaseMs?: number; fftSize?: number },
): OrbAudioFrameSource & { readonly node: AnalyserNode };
export declare function createServiceLevelSource(): OrbAudioFrameSource & { push(level: number, nowMs?: number): void };
export declare function createSpeechEnvelopeSource(options?: { seed?: number; intensity?: number }): OrbAudioFrameSource & { start(nowMs?: number): void; stop(interrupted?: boolean): void };
export declare function createOrbDemo(controller: OrbController): {
  start(name: "auto" | "voice" | "working" | "errorRecovery"): void; stop(): void; readonly running: boolean;
};

// FridayOrb: one new optional prop, everything else unchanged
//   controller?: OrbController     (wins over snapshot/status/getAudioLevel/audioLevelRef, which stay for stories/tests)
```

Verträge zwischen den Paketen:
1. WP-A liefert **zuerst** (erste Stunde) `types.ts`, `OrbEventBridge.ts` und `index.ts`-Exports mit funktionsfähigem, aber einfachem `createOrbController` (Layer-Modell + `bridge`, Audio als Skalar) — damit kann WP-B sofort kompilieren; ausgebaute Szene/Audio-Qualität folgen ohne Interface-Änderung. Bis dahin entwickelt WP-B gegen ein lokales Test-Fake in `apps/web/src/features/orb/__fakes__/`.
2. Semantik, auf die sich WP-B verlassen darf: `bridge.*` ist idempotent und thread-/event-reihenfolgetolerant (z. B. `onTtsEnded` ohne Start ist ein No-op); lokale Fakten laufen über Leases; `applySnapshot` darf jederzeit mit dem gleichen Snapshot wiederholt werden; `readFrame` ist allokationsfrei und wirft nie; `subscribe` feuert höchstens bei Moduswechsel/Textänderung/Progress-Schritt/Agentenanzahl (≤10 Hz).
3. WP-B darf `@friday/orb` nur über `index.ts` importieren; WP-A darf keinen Import aus `apps/web` haben (Paket bleibt framework- und app-unabhängig; React nur in `FridayOrb.tsx`/`scene/`).
4. Test-/Debug-Hooks: WP-A erweitert `window.__ORB_DEBUG__` (`OrbDebugProbe`) additiv um `bboxPx`, `canvasPx`, `groupPhases`, `audioSource` — WP-B-Tests lesen nur optionale Felder.
5. Layout: Host-CSS und Kamera-Fit in WP-A (`ORB_CSS`, `OrbCameraRig`, Prop `fillRatio?: number`, Default 0,72); WP-B setzt nur Panel-/Stage-CSS und entfernt `sizeBoost`.
Merge-Reihenfolge: WP-A → WP-B (WP-B kann bis zur Fertigstellung von A gegen das Interface bauen; Integrationstest nach Merge beider).

---

## 9. Reihenfolge der Umsetzung (innerhalb der WPs)

WP-A: (1) Interface + Mini-Controller, (2) Idle-/Übergangsparameter + Gruppen-Driver, (3) Kamera/Layout, (4) Wellenringe/Scan/Partikel/neue Gruppen, (5) Audio-Analyse + Envelope + Mapping, (6) Warning/Error/Approval-Feinschliff, 2D-Fallback, Reduced Motion, (7) Demo-Skripte + Stories + Doku.
WP-B: (1) `orbRuntime` + Bridge-Routing + Snapshot-Einspeisung (Parität zum heutigen Verhalten), (2) Browser-Mikro-/TTS-Analyser-Taps und Event-Hooks, (3) Layout (BoostEntfernung, Stage-Padding), (4) Debug-Panel, (5) E2E/Visual/Perf, (6) Aufräumen `audioStore`.

## 10. Risiken

* SwiftShader (0,6 s/Frame): visuelle und Performance-Abnahme der Bewegung ist im Cloud-Sandkasten nur über Test-Clock-Frames und Differenzmessung möglich; echte 60-fps-/30-fps-Werte nur auf GPU-Hardware.
* AnalyserNode im Hintergrund-Tab (Throttling) — Orb pausiert dort ohnehin (`frameloop never`).
* Echo-/Selbsthörung: der Ausgangs-Tap liegt hinter dem Playback-Bus, der Mikro-Analyser vor Echo-Cancellation des Browsers; Sprecher-Echo wird nicht als Input gewertet, solange Output aktiv (`primary` = speaking blendet Input aus).
* Wake-Word-Armed (passives Mikro): „Mikro an → sofort listening“ (Auftrag §9) kollidiert mit dauerhaft offenem Mikro. Vorschlag: UI-Toggle (explizite Nutzeraktion) → `listening`; passives Warten → `idle` + kleines Mikro-Glyph (Bridge-Parameter `passive`).

## 11. Offene Entscheidungen / Contract-Lücken (für den Lead)

1. **Orb-Größe**: Auftrag 65–78 % der Panelhöhe vs. heutige 98 % und Dashboard-Referenz (größer). Vorschlag s. (e); Owner bestätigen.
2. **Echte Pipeline-Zustände fehlen** (keine Contract-Änderung nötig, aber Adapter/Dienst): Voice-Dienst/`voice-http` liefert nie `transcribing`/`thinking` und emittiert weder `friday.voice.tts_started/ended` noch `transcript_*` (nur Mock). Empfehlung: additiv in `adapters/voice-http` aus den Dienst-Zuständen ableiten bzw. im Dienst ergänzen; bis dahin kennzeichnet die Bridge abgeleitete Phasen als Heuristik.
3. **Contract additiv (optional)**: `OrbStatus.currentAgentName` (heute nur `currentAgentId`), `OrbStatus.audioLevel` pro Richtung (`inputAudioLevel`/`outputAudioLevel`) und `VoiceAudioLevel` um Bänder `bands:{low,mid,high}` erweitern (Device-Modus: nur 4 Hz-Skalar ohne Bänder). Ohne Änderung arbeitet der Orb mit `agentCount` und `service-level`.
4. `audio_level` des Adapters ist 4 Hz und richtungsgetrennt, im Web aber richtungslos gespeichert → WP-B trennt Richtungen (kein Contract-Eingriff).
5. PLAN §19.2/`ORB_SPECIFICATION` Idle-Richtwerte (±2 %, Glow 35–50 %, sehr langsame Rotation) widersprechen dem Owner-Auftrag §8 — Spec nach Umsetzung anpassen (Owner-Auftrag gilt).
6. Listening bei Wake-Word-Armed (siehe Risiken) — Standardentscheidung: UI-Toggle = listening, passiv = idle.
7. Konsolen-404 (`browser-audio-availability`, `onboarding`) im Mock beheben oder in den Tests whitelisten (Abnahme 22.10).
