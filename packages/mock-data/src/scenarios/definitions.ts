import type { OrbMode } from "@jarvis/sdk";
import type { ScenarioDefinition } from "./types";

const REDUCED_MOTION_MODES: OrbMode[] = [
  "booting",
  "idle",
  "listening",
  "transcribing",
  "thinking",
  "syncing",
  "working",
  "speaking",
  "waiting_approval",
  "success",
  "warning",
  "error",
  "offline",
  "paused",
];

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: "clean-idle",
    name: "Clean Idle",
    description: "Alles online, keine Alerts, keine Freigaben, der Orb ruht.",
    profile: "default",
    baseline: "quiet",
    steps: [{ at: 0, label: "Alles online", description: "Keine offenen Freigaben oder Alerts.", orbMode: "idle", actions: [{ kind: "system.metrics" }] }],
    expectedOrbModes: ["idle"],
    uiExpectations: [
      "Orb im Zustand BEREIT, ruhige Atmung, kein Cyan-Farbumschlag",
      "Topbar zeigt „Jarvis online“, Attention-Zone zeigt den Leerzustand",
      "Alle Adapter und Dienste grün",
    ],
  },
  {
    id: "listening",
    name: "Listening",
    description: "Mikrofon aktiv, simulierte Pegel (silence, normal, loud, spike) mit 12 Hz.",
    profile: "default",
    baseline: "quiet",
    steps: [
      { at: 0, label: "Mikrofon öffnet", description: "Stille, Pegel um 1 %.", orbMode: "listening", actions: [{ kind: "voice.mode", mode: "listening" }, { kind: "voice.audio", fixture: "silence", durationMs: 1500, direction: "input" }] },
      { at: 1500, label: "Normale Sprache", orbMode: "listening", actions: [{ kind: "voice.audio", fixture: "normal", durationMs: 3000, direction: "input" }] },
      { at: 4500, label: "Laute Sprache", orbMode: "listening", actions: [{ kind: "voice.audio", fixture: "loud", durationMs: 1500, direction: "input" }] },
      { at: 6000, label: "Pegelspitze", description: "Kurzer Spike bis 100 %.", orbMode: "listening", actions: [{ kind: "voice.audio", fixture: "spike", durationMs: 500, direction: "input" }] },
      { at: 6500, label: "Wieder still", orbMode: "listening", actions: [{ kind: "voice.audio", fixture: "silence", durationMs: 1500, direction: "input" }] },
      { at: 8000, label: "Mikrofon schließt", orbMode: "idle", actions: [{ kind: "voice.mode", mode: "idle" }] },
    ],
    expectedOrbModes: ["idle", "listening", "idle"],
    uiExpectations: [
      "Mikrofon-Symbol sichtbar und nur während der Erfassung aktiv",
      "Audio-Halo folgt dem geglätteten Pegel und zittert nicht",
      "Voice-Seite zeigt Mikrofon „listening“ und den Live-Pegel",
    ],
  },
  {
    id: "voice-pipeline",
    name: "Voice Pipeline",
    description: "Listening → Transcribing → Thinking → Speaking → Idle mit Partial- und Final-Transkripten.",
    profile: "default",
    baseline: "quiet",
    steps: [
      { at: 0, label: "Zuhören", orbMode: "listening", actions: [{ kind: "voice.mode", mode: "listening" }, { kind: "voice.audio", fixture: "normal", durationMs: 2500, direction: "input" }] },
      { at: 2500, label: "Transkribieren", orbMode: "transcribing", actions: [{ kind: "voice.mode", mode: "transcribing" }] },
      { at: 2800, label: "Partial-Transkript 1", orbMode: "transcribing", actions: [{ kind: "voice.transcript", text: "Wie ist", final: false }] },
      { at: 3200, label: "Partial-Transkript 2", orbMode: "transcribing", actions: [{ kind: "voice.transcript", text: "Wie ist das Wetter morgen", final: false }] },
      { at: 3700, label: "Final-Transkript", orbMode: "transcribing", actions: [{ kind: "voice.transcript", text: "Wie ist das Wetter morgen in Hannover?", final: true }] },
      { at: 4000, label: "Nachdenken", orbMode: "thinking", actions: [{ kind: "voice.mode", mode: "thinking" }] },
      { at: 5500, label: "Sprechen", orbMode: "speaking", actions: [{ kind: "voice.mode", mode: "speaking", text: "Morgen wird es in Hannover wechselhaft, bei etwa vierzehn Grad." }, { kind: "voice.audio", fixture: "tts", durationMs: 3000, direction: "output" }] },
      { at: 8500, label: "Bereit", orbMode: "idle", actions: [{ kind: "voice.mode", mode: "idle" }] },
    ],
    expectedOrbModes: ["idle", "listening", "transcribing", "thinking", "speaking", "idle"],
    uiExpectations: [
      "Orb wechselt fließend zwischen den fünf Zuständen mit deutschem Statustext",
      "Transkript-Zeile zeigt Partial-Text kursiv, Final-Text fest",
      "Stop-Schaltfläche (Barge-In) ist während JARVIS SPRICHT sichtbar",
    ],
  },
  {
    id: "multi-agent-working",
    name: "Multi-Agent Working",
    description: "Drei Agenten arbeiten an zwei Aufgaben: eine mit echtem Fortschritt, eine mit unbekanntem (indeterminate).",
    profile: "default",
    baseline: "quiet",
    steps: [
      {
        at: 0,
        label: "Drei Agenten starten",
        orbMode: "working",
        actions: [
          { kind: "task.spawn", ref: "recherche", title: "Marktanalyse Büromöbel Region Hannover", agent: "Recherche-Agent", priority: "P2", progress: 0.1, steps: ["Quellen sammeln", "Preise vergleichen", "Bericht schreiben"] },
          { kind: "task.spawn", ref: "coding", title: "Schnittstelle zum Lieferantenportal umbauen", agent: "Coding-Agent", priority: "P3", steps: ["Analyse", "Umsetzung", "Tests"] },
          { kind: "agent.status", agent: "Kommunikations-Agent", status: "working", task: "recherche" },
        ],
      },
      { at: 4000, label: "Fortschritt 35 %", orbMode: "working", actions: [{ kind: "task.progress", ref: "recherche", value: 0.35, message: "Quelle 3 von 8 gelesen" }] },
      { at: 8000, label: "Fortschritt 60 %", orbMode: "working", actions: [{ kind: "task.progress", ref: "recherche", value: 0.6 }] },
      { at: 12000, label: "Fortschritt 85 %", orbMode: "working", actions: [{ kind: "task.progress", ref: "recherche", value: 0.85 }] },
      { at: 14000, label: "Recherche fertig", orbMode: "success", actions: [{ kind: "task.complete", ref: "recherche" }] },
      { at: 16000, label: "Nur noch der Coding-Agent", description: "Aufgabe ohne bekannten Fortschritt: indeterminate.", orbMode: "working", actions: [{ kind: "activity.log", title: "Coding-Agent führt Tests aus", activityKind: "tool_call", adapterId: "mock-tasks" }] },
      { at: 20000, label: "Umbau fertig", orbMode: "success", actions: [{ kind: "task.complete", ref: "coding" }] },
      { at: 22000, label: "Bereit", orbMode: "idle", actions: [] },
    ],
    expectedOrbModes: ["idle", "working", "success", "working", "success", "idle"],
    uiExpectations: [
      "Orb zeigt „3 AGENTEN AKTIV“ mit drei Agent-Markern und echtem Fortschrittsring (Recherche)",
      "Danach „CODE WIRD ERSTELLT“ mit umlaufendem Indeterminate-Ring ohne Prozentzahl",
      "Agents-Seite und Overview listen genau die aktiven Agenten, Tasks zeigen determinate/indeterminate Balken",
    ],
  },
  {
    id: "syncing",
    name: "Syncing",
    description: "Mail und Kalender werden synchronisiert; Activity Feed erhält Ereignisse.",
    profile: "default",
    baseline: "quiet",
    steps: [
      { at: 0, label: "Postfach-Abgleich", orbMode: "syncing", actions: [{ kind: "sync.start", ref: "mail", source: "mail", label: "GMX-Postfach" }, { kind: "activity.log", title: "Synchronisation GMX-Postfach gestartet", activityKind: "adapter", adapterId: "mock-communication" }] },
      { at: 1500, label: "Kalender-Abgleich", orbMode: "syncing", actions: [{ kind: "sync.start", ref: "calendar", source: "calendar", label: "Kalender" }, { kind: "activity.log", title: "Synchronisation Kalender gestartet", activityKind: "adapter", adapterId: "mock-calendar" }] },
      { at: 2500, label: "Neue Mail eingetroffen", orbMode: "syncing", actions: [{ kind: "mail.receive", subject: "Rückfrage zur Lieferung der Bürostühle", from: { name: "Björn Zander", address: "b.zander@zander-logistik.example" }, body: "Guten Tag, können Sie bitte den Liefertermin KW 46 bestätigen?", priority: "P2", summary: "Fragt nach Bestätigung des Liefertermins KW 46." }] },
      { at: 4000, label: "Postfach fertig", orbMode: "syncing", actions: [{ kind: "sync.finish", ref: "mail" }, { kind: "activity.log", title: "Synchronisation GMX-Postfach abgeschlossen (1 neue Nachricht)", activityKind: "adapter", adapterId: "mock-communication" }] },
      { at: 6000, label: "Kalender fertig", orbMode: "idle", actions: [{ kind: "sync.finish", ref: "calendar" }, { kind: "activity.log", title: "Synchronisation Kalender abgeschlossen", activityKind: "adapter", adapterId: "mock-calendar" }] },
    ],
    expectedOrbModes: ["idle", "syncing", "idle"],
    uiExpectations: [
      "Orb zeigt „MAILS WERDEN AKTUALISIERT“, danach „2 QUELLEN WERDEN SYNCHRONISIERT“ und die Quelle neben dem Orb",
      "Activity Feed erhält vier Adapter-Ereignisse in Echtzeit",
      "Communication-Seite zeigt den neuen Thread, Kanal-Zähler steigt",
    ],
  },
  {
    id: "approval-waiting",
    name: "Approval Waiting",
    description: "Ein E-Mail-Versand wartet auf Freigabe; nichts wird ohne Entscheidung gesendet.",
    profile: "default",
    baseline: "quiet",
    steps: [
      { at: 0, label: "Entwurf und Freigabe angefordert", orbMode: "waiting_approval", actions: [{ kind: "approval.draft", ref: "mail", threadKey: "becker", agent: "Kommunikations-Agent" }] },
      { at: 5000, label: "Wartet auf Entscheidung", description: "Der Orb bleibt ruhig in Amber, es gibt keinen Auto-Approve.", orbMode: "waiting_approval", actions: [{ kind: "activity.log", title: "Freigabe für E-Mail an Frau Becker steht aus", activityKind: "system", adapterId: "mock-approvals" }] },
    ],
    expectedOrbModes: ["idle", "waiting_approval"],
    uiExpectations: [
      "Orb zeigt FREIGABE ERFORDERLICH, ein Klick öffnet die konkrete Freigabe",
      "Overview zeigt eine Attention-Card „E-Mail an Katharina Becker senden“",
      "Approvals-Seite: Vorschau, Risikostufe 2, Ablaufzeit; Entwurf steht auf pending_approval",
    ],
  },
  {
    id: "critical-alert",
    name: "Critical Alert",
    description: "P0-Alert mit Eskalationskette Dashboard → Telegram → WhatsApp → Telefon; das System bleibt bedienbar.",
    profile: "default",
    baseline: "quiet",
    steps: [
      {
        at: 0,
        label: "P0-Alert ausgelöst",
        orbMode: "error",
        actions: [
          { kind: "service.status", name: "Windows Worker", status: "offline", detail: "Keine Antwort seit 3 Minuten" },
          { kind: "notification.raise", ref: "alert", priority: "P0", category: "system", title: "Kritisch: Windows-Worker nicht erreichbar, Backup überfällig", body: "Der Windows-Worker antwortet nicht mehr. Die nächtliche Sicherung konnte nicht gestartet werden.", chain: ["dashboard", "telegram", "whatsapp", "phone"], stepSeconds: [0, 15, 40, 80] },
        ],
      },
      { at: 15000, label: "Eskalation: Telegram", orbMode: "error", actions: [] },
      { at: 40000, label: "Eskalation: WhatsApp", orbMode: "error", actions: [] },
      { at: 80000, label: "Eskalation: Telefon", orbMode: "error", actions: [] },
      { at: 90000, label: "Alert bestätigt", orbMode: "idle", actions: [{ kind: "notification.ack", ref: "alert" }] },
      { at: 100000, label: "Dienst wiederhergestellt", orbMode: "idle", actions: [{ kind: "service.status", name: "Windows Worker", status: "online", detail: "Dienst läuft" }] },
    ],
    expectedOrbModes: ["idle", "error", "idle"],
    uiExpectations: [
      "Orb im Fehler-Zustand mit kontrolliertem Eintrittsimpuls, Kern bleibt golden, kein Dauerblinken",
      "Alerts-Seite zeigt die Eskalationskette mit Zeitstempeln je Kanal (sent/pending)",
      "Alle anderen Seiten bleiben bedienbar, Command Bar weiter erreichbar",
    ],
    notes: ["Die Eskalationsverzögerungen (0/15/40/80 s) sind für die Demo verkürzt und werden mit der Abspielgeschwindigkeit skaliert."],
  },
  {
    id: "partial-outage",
    name: "Partial Outage",
    description: "Mail-Adapter offline, Aufgaben bleiben online; die Overview bleibt nutzbar.",
    profile: "default",
    baseline: "quiet",
    steps: [
      { at: 0, label: "Mail-Adapter fällt aus", orbMode: "warning", actions: [{ kind: "adapter.state", category: "communication", mode: "offline", reason: "IMAP-Server nicht erreichbar" }] },
      { at: 3000, label: "Weitere Aktivität", orbMode: "warning", actions: [{ kind: "activity.log", title: "Mail-Synchronisation übersprungen: Adapter offline", activityKind: "adapter", adapterId: "mock-communication", severity: "warning" }] },
    ],
    expectedOrbModes: ["idle", "warning"],
    uiExpectations: [
      "Orb im Zustand EINGESCHRÄNKTER BETRIEB mit Hinweis auf den Mail-Ausfall",
      "Overview lädt vollständig, Mail-Kachel zeigt „offline“ mit Offline-Cache-Hinweis",
      "Tasks, Kalender, Agents liefern frische Daten; Mail-Aktionen sind deaktiviert",
    ],
  },
  {
    id: "adapter-recovery",
    name: "Adapter Recovery",
    description: "Kalender-Adapter: online → timeout → degraded → offline → recovering → online.",
    profile: "default",
    baseline: "quiet",
    steps: [
      { at: 0, label: "Online", orbMode: "idle", actions: [] },
      { at: 3000, label: "Timeout", description: "ADAPTER_TIMEOUT, Lifecycle DEGRADED", orbMode: "warning", actions: [{ kind: "adapter.state", category: "calendar", mode: "timeout", reason: "Zeitüberschreitung nach 10 s" }] },
      { at: 7000, label: "Degraded", description: "Antworten verzögert, Daten stale", orbMode: "warning", actions: [{ kind: "adapter.state", category: "calendar", mode: "degraded", reason: "Antworten verzögert" }] },
      { at: 11000, label: "Offline", description: "Circuit open, Daten aus dem Cache", orbMode: "warning", actions: [{ kind: "adapter.state", category: "calendar", mode: "offline", reason: "Kalender-Server nicht erreichbar" }] },
      { at: 16000, label: "Recovering", description: "Circuit half-open, Lifecycle RECOVERING", orbMode: "warning", actions: [{ kind: "adapter.state", category: "calendar", mode: "recovering", reason: "Verbindung wird wiederhergestellt" }] },
      { at: 21000, label: "Wieder online", orbMode: "idle", actions: [{ kind: "adapter.state", category: "calendar", mode: "online" }] },
    ],
    expectedOrbModes: ["idle", "warning", "idle"],
    uiExpectations: [
      "Systemseite: Adapter-Matrix wechselt Status und Lifecycle (DEGRADED → OFFLINE → RECOVERING → ONLINE)",
      "Kalenderansicht zeigt Freshness stale → offline-cache → fresh, nie alte Daten als live",
      "Orb kehrt nach der Wiederherstellung zu BEREIT zurück",
    ],
  },
  {
    id: "empty-new-installation",
    name: "Empty New Installation",
    description: "Frische Installation ohne Daten: alle Listen leer, Kanäle nicht konfiguriert.",
    profile: "empty",
    baseline: "seeded",
    steps: [{ at: 0, label: "Leeres System", orbMode: "idle", actions: [] }],
    expectedOrbModes: ["idle"],
    uiExpectations: [
      "Jede Seite zeigt einen sinnvollen Empty State mit nächstem Schritt, kein kaputtes Layout",
      "Communication: alle Kanäle „Nicht konfiguriert“ mit Hinweis „Adapter konfigurieren“",
      "Orb BEREIT, Overview mit leeren Karten und Quick Commands",
    ],
  },
  {
    id: "high-load",
    name: "High Load",
    description: "1 000 Aufgaben, 10 000 Aktivitätsereignisse, 100 Agenten; Live-Feed erhält zusätzlich Ereignisse.",
    profile: "highLoad",
    baseline: "seeded",
    steps: [
      { at: 0, label: "Große Datenmenge geladen", orbMode: "waiting_approval", actions: [] },
      { at: 2000, label: "Ereignisburst", description: "60 Aktivitätsereignisse in 6 Sekunden.", orbMode: "waiting_approval", actions: [{ kind: "activity.burst", count: 60, intervalMs: 100, title: "Hintergrundverarbeitung" }] },
    ],
    expectedOrbModes: ["waiting_approval"],
    uiExpectations: [
      "Listen virtualisiert oder paginiert, Scrollen bleibt flüssig, keine DOM-Explosion",
      "Kanban zeigt Spaltenzähler statt aller Karten; Filter und Suche reagieren schnell",
      "Activity Feed hält die Framerate trotz Burst",
    ],
  },
  {
    id: "long-german-text",
    name: "Long German Text",
    description: "Sehr lange Betreffzeilen und Titel mit Umlauten und Komposita.",
    profile: "longGerman",
    baseline: "seeded",
    steps: [
      { at: 0, label: "Lange Texte geladen", orbMode: "waiting_approval", actions: [] },
      { at: 3000, label: "Lange Benachrichtigung", orbMode: "waiting_approval", actions: [{ kind: "notification.raise", ref: "long", priority: "P2", category: "mail", title: "Donaudampfschifffahrtsgesellschaftskapitänsmützenreinigungsauftrag: Rückfrage zur Abrechnung der Betriebskostennachzahlungsüberprüfung", body: "Sehr lange Meldung mit vielen Umlauten (ä, ö, ü, ß) zur Prüfung von Textumbrüchen, Ellipsen und Tooltips.", chain: ["dashboard"] }] },
    ],
    expectedOrbModes: ["waiting_approval"],
    uiExpectations: [
      "Titel brechen um oder werden mit Ellipse und Tooltip gekürzt, nichts läuft aus den Panels",
      "Umlaute und ß werden korrekt gerendert, Kopfzeilen in Großbuchstaben bleiben lesbar",
      "Drawer, Tabellen und Cards behalten ihr Layout",
    ],
  },
  {
    id: "reduced-motion",
    name: "Reduced Motion",
    description: "Alle 14 Orb-Zustände nacheinander, für Reduced-Motion-Prüfung der Informationsvollständigkeit.",
    profile: "default",
    baseline: "quiet",
    uiHints: { reducedMotion: true },
    steps: [
      ...REDUCED_MOTION_MODES.map((mode, index) => ({
        at: index * 3000,
        label: `Zustand ${mode}`,
        orbMode: mode,
        actions: [{ kind: "orb.force" as const, mode }, ...(index === 0 ? [{ kind: "ui.hint" as const, key: "reducedMotion" as const, value: true }] : [])],
      })),
      { at: REDUCED_MOTION_MODES.length * 3000, label: "Override aufgehoben", orbMode: "idle", actions: [{ kind: "orb.force", mode: null }] },
    ],
    expectedOrbModes: ["idle", ...REDUCED_MOTION_MODES, "idle"],
    uiExpectations: [
      "Animation reduziert (keine Rotationen, nur Opazitäts- und Farbwechsel), Information bleibt vollständig",
      "Jeder Zustand zeigt seinen deutschen Statustext und die Zustandsakzentfarbe",
      "Prefers-reduced-motion und Orb-Einstellung „reduced“ liefern dasselbe Ergebnis",
    ],
  },
  {
    id: "webgl-failure",
    name: "WebGL Failure",
    description: "WebGL ist nicht verfügbar: der Orb wechselt auf den 2D-Fallback, die Startseite bleibt bedienbar.",
    profile: "default",
    baseline: "quiet",
    uiHints: { forceOrbFallback2D: true },
    steps: [
      { at: 0, label: "WebGL-Fehler simuliert", description: "meta.features.forceOrbFallback2D = true, danach resync_required.", orbMode: "idle", actions: [{ kind: "ui.hint", key: "forceOrbFallback2D", value: true }] },
      { at: 2000, label: "Arbeit im Fallback", orbMode: "working", actions: [{ kind: "task.spawn", ref: "task", title: "Wochenbericht zusammenstellen", agent: "Task-Agent", priority: "P3", progress: 0.2 }] },
      { at: 8000, label: "Fortschritt im Fallback", orbMode: "working", actions: [{ kind: "task.progress", ref: "task", value: 0.7 }] },
    ],
    expectedOrbModes: ["idle", "working"],
    uiExpectations: [
      "Orb-Bereich zeigt den 2D-Fallback (OrbFallback2D) mit denselben Zuständen und Texten",
      "Hinweis „WebGL nicht verfügbar“, keine unbedienbare Startseite",
      "Klick auf den Orb öffnet weiterhin die laufende Aktivität",
    ],
  },
];

export function scenarioDuration(definition: ScenarioDefinition): number {
  let end = 0;
  for (const step of definition.steps) {
    end = Math.max(end, step.at);
    for (const action of step.actions) {
      if (action.kind === "voice.audio") end = Math.max(end, step.at + action.durationMs);
      if (action.kind === "activity.burst") end = Math.max(end, step.at + action.count * action.intervalMs);
      if (action.kind === "orb.transient") end = Math.max(end, step.at + action.durationMs);
    }
  }
  return end;
}
