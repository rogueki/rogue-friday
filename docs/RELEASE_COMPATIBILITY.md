# Release, Kompatibilität und Nachweise (REL-06.02)

Stand: 2026-10-30. Alle Angaben stammen aus dem Quellbaum; Zeilenangaben beziehen sich auf den Stand dieses Dokuments.
Die tatsächlich installierte Revision steht nach der Installation in `<Root>\dashboard\data\dashboard-revision.json`
und auf der Systemseite (Karte „Installation“, `GET /api/v1/system/installation`).

## 1. Versions- und Kompatibilitätsmatrix

| Baustein | Version / Pin | Quelle |
|---|---|---|
| Betriebssystem | Windows 11, PowerShell 5.1 (Windows 10 nur eingeschränkt) | `installer/install-friday.ps1` (`#Requires -Version 5.1`), `installer/ANLEITUNG.md` |
| WSL-Distribution | Ubuntu 24.04, installiert als `Ubuntu` | `installer/install-friday.ps1` (`$Distro`, Schritt 7/15) |
| Linux-Installer | Ubuntu 22.04/24.04, Debian 12/13 | `installer/install-friday-linux.sh` |
| Node.js | ≥ 22.13 | `package.json` (`engines`), Installerprüfung in `install-friday.ps1` |
| pnpm | 10.28.2 | `package.json` (`packageManager`) |
| Vertrag (API/Events) | 2.0.0 | `packages/contracts/package.json`, Voice-Events in `installer/voice/friday_voice.py` |
| Hermes Agent | Commit-Pin `d923a5eb487a17c0a68801bba9ef0f56c81040a8`; Installation prüft HEAD == Pin | `installer/wsl/setup_hermes.sh` (`HERMES_PIN`), `install-friday-linux.sh` |
| Lokales LLM | Qwen3-4B `Qwen3-4B-Q4_K_M.gguf`, SHA-256 geprüft | `install-friday.ps1` (Qwen-Download) |
| llama.cpp | kein fester Pin: neuestes Release mit passendem Asset (cuda-13, cuda-12.4 oder cpu), Digest-geprüft | `install-friday.ps1` (llama-Asset-Auswahl) |
| Lokale Qwen3-TTS | ggml-org/Qwen3-TTS-12Hz-1.7B-Base-GGUF (Q4_K_M + mmproj Q8_0), SHA-256 geprüft | `installer/voice/voice_setup.py` |
| Voice-Dienst | Python 3.11 (Venv); torch/faster-whisper ungepinnt | `install-friday.ps1` (Voice-Venv) |
| WSL-Schnell-TTS | torch 2.11.0 (cu128), faster-qwen3-tts 0.5.3, transformers 5.15.1 | `installer/fast_tts/install_wsl.sh` |

Bewusst offen: llama.cpp und die Windows-Voice-Pakete sind nicht versionsgepinnt. Ein neues Upstream-Release kann
daher eine Neuinstallation anders ausstatten als die vorherige; die Hashprüfung schützt nur vor beschädigten Downloads.

### Ports und Zuständigkeit

| Port | Dienst | Prüfung durch das Dashboard |
|---|---|---|
| 3100 | Command Center (Control API + Dashboard) | Systemseite, Karte „Installation“ (Port, Startzeit) |
| 43691 | Hermes-Dashboard in WSL | Dienstzeile „Hermes Dashboard“ mit Adresse |
| 43692 | Qwen / llama-server | Dienstzeile „Qwen lokal (llama-server)“ mit Adresse |
| 43693 | Hermes-API-Server | Dienstzeile „Hermes API“ mit Adresse |
| 43694 | Voice-Statusserver (`health_port`) | Dienstzeile „Voice-Dienst“ mit Adresse |
| 43695 | Browser-Audio des Voice-Dienstes (Voice-Port + 1) | über den Voice-Dienst |
| 43696 | SearXNG (Podman-Unit `friday-searxng`) für die Recherche | Recherche-Einrichtung |

Das Dashboard-Update akzeptiert auf Port 3100 nur den eigenen control-api-Prozess des Installationsordners; ein älteres
Dashboard auf demselben Port gilt nicht als Erfolg.

## 2. Paketmanifest

- **Quelle:** GitHub-Quell-ZIP oder Git-Checkout. Das ZIP enthält keine Agenten-Metadaten und Arbeitsentwürfe
  (`CLAUDE.md`, `.claude/`, `docs/agent-work/` sind `export-ignore` in `.gitattributes`).
- **Installer:** kopiert seinen eigenen Ordner nach `<Root>\installer` (Standard `C:\Friday`).
- **Dashboard:** nach `<Root>\dashboard` gespiegelt werden `apps`, `packages`, `adapters`, `scripts` sowie die
  Root-Dateien `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`,
  `vitest.config.ts`, `.npmrc`, `.nvmrc`, `README.md`, `LICENSE`; `config` nur ergänzend ohne `dashboard.yaml` und
  `adapters.yaml` des Nutzers.
- **Nie mitkopiert:** `node_modules`, `.git`, `.next`, `dist`, `out`, `coverage`, `storybook-static`,
  `playwright-report`, `test-results`, `screenshots`, `evidence`, `.turbo`, `__pycache__`, `.claude`, `fixtures` sowie
  Dateien `*.log`, `*.key`, `*.pem`, `*.pfx`, `*.p12` (`installer/lib/dashboard-sync.ps1`). `docs/` gehört nicht zum
  installierten Dashboard.
- **Laufzeitdaten:** `<Root>\dashboard\data` (Datenbank, Schlüssel, Revision) wird nie gespiegelt oder überschrieben.

## 3. Aktuelle Revision

- GitHub setzt beim ZIP-Export den Commit in `installer/source-revision.txt` ein (`export-subst`); bei einem
  Git-Checkout gilt `git rev-parse HEAD`.
- Der Installer schreibt daraus `<Root>\dashboard\data\dashboard-revision.json` (`commit`, `installedAt`); fehlt beides,
  warnt er sichtbar.
- Das Dashboard-Update (`installer/scripts/update-dashboard-github.ps1`) setzt diese Datei voraus und schreibt sie nach
  jedem Update neu.

## 4. Migrationen

- **Control-API-Datenbank** (`dashboard.sqlite`): append-only Migrationsliste in `apps/control-api/src/db/database.ts`.
  Vor ausstehenden Migrationen entsteht `*.pre-migrate-<Zeit>.bak` (die letzten drei bleiben); eine Datenbank mit
  unbekannter, neuerer Migrations-ID wird abgewiesen statt beschädigt. Rücksicherung über `restoreMigrationBackup`.
- **Audit-Anker:** eigene Migration `apps/control-api/src/db/audit-anchor-migration.ts`, beim Start ausgeführt.
- **J.A.R.V.I.S.-Übernahme:** `C:\Jarvis` → `C:\Friday` mit Phasenstand in `C:\Jarvis\migrate-to-friday.json`;
  WSL-Pfade und Modellname über `installer/wsl/migrate_paths.sh`.

## 5. Rollback

| Fall | Mechanismus | Quelle |
|---|---|---|
| Dashboard-Update scheitert am Healthcheck | Sicherung `<Root>\updates\backup-<Zeit>`, automatische Rücksicherung inkl. SQLite/WAL und Revision | `installer/scripts/update-dashboard-github.ps1`, `docs/DASHBOARD_UPDATES.md` |
| Neuinstallation über bestehende Daten | `Backup-DashboardState` nach `<Root>\backups`, Prüfung und `Restore-DashboardState` | `installer/lib/dashboard-backup.ps1` |
| Stimmprofil | Sicherung unter `voice\profiles\backups`, Prüfung, Rücksicherung | `installer/lib/voice-profile-backup.ps1` |
| Hermes-Memory-Brücke | `~/.hermes/friday-memory-backup-<Lauf>` mit `manifest.json` | `installer/wsl/configure_memory_bridge.py` |
| Hermes-Cron-Patch | Original als `*.friday-cron-original` | `installer/wsl/patch_hermes_cron_lock.py` |
| Datenbankmigration | `*.pre-migrate-<Zeit>.bak` | `apps/control-api/src/db/database.ts` |

Eine allgemeine Sicherung der gesamten Hermes-Konfiguration legt der Installer nicht an; vor manuellen Änderungen an
`~/.hermes` ist eine eigene Sicherung nötig.

## 6. Nachweisindex

- `docs/ACCEPTANCE.md` – Abnahmekriterien; `docs/PROJECT_STATUS.md` – verifizierter Verlauf.
- `docs/evidence/` – Bildnachweise (`gold-accents/`, `integration/`, `orb-rework/` mit Messwerten).
- `docs/agent-work/finalization/` (nur im Repository, nicht im ZIP):
  - `issue-ledger.csv` – jede Lücke mit Status (`CLOSED_VERIFIED`, `FIXED_PROVEN_CODE`, `BLOCKED_EXTERNAL`, …) und Beleg.
  - `requirements.csv`, `installer-inventory.csv`, `inventory.md`, `progress.md`, `supervised-processes.md`.
  - Belege je Planpunkt: `dash-02-*` bis `dash-18-*`, `ins-02-*` bis `ins-12-*`, `keep-05-studio-paritaet.md`,
    `acceptance-environment.md`, `baseline.md`, `contract-freeze.md`.

## 7. Verbleibende Betreiberaktionen

Diese Punkte brauchen den Eigentümer oder echte Hardware/Konten; sie stehen im Ledger als `BLOCKED_EXTERNAL`:

- **Saubere Neuinstallation** auf frischem Windows (INS-13/REL-03; Ledger I-042, I-044) inklusive UAC-Abbruchprobe.
- **Konten und Anbieter:** Mailkonten, WhatsApp, Discord, CloudTalk/Telefonie, Windows-Kalender, Anbieter-Logins
  (OAuth/Deviceflow, FP-04), Hermes-Zugänge (N-050), Developer-Apps und Social-Publishing (I-050, I-022).
- **Telegram:** Bot-Token im Einrichtungsablauf eingeben und eine Testnachricht freigeben.
- **Audio:** Mikrofon-/Headsettests und Wake-Word-Kalibrierung (N-037, I-015, I-032), Bildschirmskalierung und
  Screenreader (N-036).
- **Referenzaufnahmen:** Entscheidung, ob `installer/voice_models/*.wav` öffentlich ausgeliefert werden darf
  (`installer/voice_models/LIESMICH.txt` nennt sie privat).
