# Integrationsnachweis Phase B.5: echte Adapter hinter der Control API (Hybrid-Modus)

Entwurf. Beweist die Kette **Fake-Upstream -> echter Adapter -> gebaute Control API (hybrid) -> Web-UI** in der Cloud-VM.
Die Upstreams sind Fakes nach `docs/MAPPING/{hermes,voice,qwen}.md` (Quelle der Wahrheit: die Test-Fakes der Adapter).
Es lief **kein** echtes Hermes, kein echter Voice-Dienst und kein echtes Qwen.

## Reproduzieren

```bash
pnpm install
pnpm build:app          # baut apps/web (statischer Export) und apps/control-api (tsup)
pnpm test:integration   # Playwright, startet den Stack selbst (tests/integration/stack.ts)
```

`stack.ts` startet die Fake-Upstreams auf den Installer-Ports (43691 Hermes-Dashboard, 43692 Qwen, 43693 Hermes-API,
43694 Voice, 43699 Steuerendpunkt), schreibt den Fake-API-Schluessel in eine Datei, erzeugt `dashboard.yaml` und
`adapters.yaml` aus `config/*.hybrid.example.yaml` (Schluessel per `file:`-Referenz, Owner-Hash per `@jarvis/auth`) und
startet `apps/control-api/dist/main.js` mit `JARVIS_DATA_MODE=hybrid` auf 127.0.0.1:3100. Der Web-Build wird zu
Laufbeginn kopiert, damit ein paralleler Rebuild die Seiten nicht veraendert.

Umgebung: `JARVIS_INTEGRATION_DIR` (Arbeitsverzeichnis, Standard `<tmp>/jarvis-integration`), `JARVIS_EVIDENCE_DIR`
(PNG-Ausgabe, Standard `test-results/integration/evidence`), `JARVIS_CHROMIUM` (Browserpfad; in der Cloud-VM
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), WebGL-Flags `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
WebP-Kopien: PNGs mit Python/PIL nach `docs/evidence/integration/*.webp` konvertieren (Qualitaet 80).

Ohne Playwright: `pnpm fake:upstreams --key-file <pfad>` und `pnpm start:hybrid` (mit passender `config/adapters.yaml`);
Ausfaelle per `curl -X POST http://127.0.0.1:43699/services/<voice|hermes|hermes-api|hermes-dashboard|llama>/<stop|start>`.
Ein gestoppter Dienst schliesst seinen Port (ECONNREFUSED), wie ein echter gestoppter Dienst.

## Was gezeigt wird (Spec `tests/integration/hybrid.spec.ts`)

| # | Pruefung | Ergebnis | Bilder |
|---|---|---|---|
| 1 | Uebersicht: Hermes-Aufgabe im Live-Feed, Kacheln Sprache "Bereit", Agenten "1 aktiv", Modelle "2 verbunden"; `/overview`: Quellen `hermes-tasks`/`hermes-agents`/`jarvis-voice-http`, Wake Phrase, echte CPU/RAM | PASS | 01 |
| 2 | Aufgaben: 7 Hermes-Kanban-Aufgaben, Quelle-Badge `hermes` | PASS | 02 |
| 3 | Agenten: Profile Hermes, Kira, Milo, Kiras laufende Aufgabe | PASS | 03 |
| 4 | Sprache: Modus Bereit, Wake Word "Hey Friday", Modell `qwen3-router` | PASS | 04 |
| 5 | System: Qwen, Hermes API, Hermes Dashboard, Voice online; Adaptermatrix 15/15 online; Modelle `qwen3-router` + `jarvis` (API); RAM = `os.totalmem()` des Hosts (echte Messung) | PASS | 05 |
| 6 | Voice-Dienst gestoppt: genau `jarvis-voice-http` offline (Matrix 14 online, 1 offline), Sprache-Seite "Nicht verbunden", Voice-Dienst "Offline"; Aufgaben, Agenten, Uebersicht, Memory laufen weiter (`/voice/status` 503, `/tasks` 200) | PASS | 06-09 |
| 7 | Voice neu gestartet: Seite und Matrix erholen sich | PASS | 10-11 |
| 8 | Hermes (API + Dashboard) gestoppt: genau `hermes-tasks/-activity/-agents` offline (3 offline), Aufgaben/Agenten nicht verfuegbar, Hermes-Dienste "Offline"; Voice, System, Memory laufen weiter | PASS | 12-15 |
| 9 | Hermes neu gestartet: 7 Aufgaben, 3 Agenten, Matrix 15 online | PASS | 16-17 |

Lauf (9 Tests, ca. 3,5 min): `9 passed`. Zusaetzlich `apps/control-api/test/real-adapters.test.ts` (8 Tests, ohne Browser)
prueft Registrierung, Mock-Fallbacks, `file:`-Secret (Schluessel taucht in Antworten, Health und Logs nie auf), Platzhalter-Kollision
und das Live-Beispiel (nur 5 Kategorien vorhanden).

## Grenzen

- Fakes, nicht das echte Hermes/Voice/Qwen: belegt ist die Verdrahtung und das Fehlerverhalten, nicht die Treue zu echten Antworten
  (siehe die "Annahme (unbelegt)"-Listen in den Adapter-READMEs). Windows/WSL-Portweiterleitung und `wsl.exe`-Pfade sind nicht abgedeckt.
- Der Circuit Breaker ist im Lauf auf 3 Fehler / 5 s Reset gekuerzt (Beispiel-Standard 5 / 30 s), damit die Erholung in Sekunden sichtbar wird;
  mit den Standardwerten dauert sie bis zu rund 30 s laenger.
- Dienst "gestoppt" heisst geschlossener Port; Hangs, 401-Rotation und Fehlformen decken die Adaptertests ab, nicht dieser Lauf.
- Linux-VM: Speicher-Pfad `/`, keine GPU, kein WSL.

## Beobachtungen fuer die Web-Seite (nicht Teil dieses Auftrags)

- Bei gestopptem Voice-Dienst zeigt die Sprache-Seite "Dieses Modul ist in der aktuellen Konfiguration nicht verfuegbar (Capability fehlt)";
  das ist bei einem Ausfall irrefuehrend (Ursache: Adapter offline). Das Widget "Voice Status" in der Seitenleiste bleibt auf "Wartet auf Freigabe".
- Die Kachel "System" der Uebersicht zeigt "Offline", sobald nur der Voice-Dienst ausfaellt.
- Die System-Seite zeigt je Modellanbieter nur die Zahl der Modelle, nicht die Namen.
