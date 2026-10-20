# Frischinstallations-Drill (P10)

Ziel des Drills: eine FRIDAY-Installation auf einer **frischen** Windows-11-Umgebung real durchlaufen —
Installation, Dienste, Owner-Setup, Hermes-Runtime, Kernfunktionen, Backup/Restore. Jeder Fehler wird
protokolliert und danach behoben. Der Drill ersetzt keine Provider-Abnahme; er findet Installations- und
Verdrahtungsfehler, die nur auf einer leeren Maschine auftreten.

Evidenzlage heute: alle Fixture- und CI-Prüfungen sind grün, der physische Frischinstallationslauf ist
`NOT_RUN`. Dieses Dokument ist die Checkliste für genau diesen Lauf.

## 0. Vorbedingungen

- Windows 11 (23H2+), WSL2 aktiv (`wsl --status`), mindestens 40 GB frei, Internetzugang.
- Installationsquelle: der gemergte `main`-Stand (Commit-SHA im Protokoll festhalten), nicht der lokale Arbeitsbaum.
- Alle Werte unten sind Parameter, keine Konstanten. Auf dem Operator-Host gilt:

  | Parameter | Wert auf diesem Host | Herkunft |
  |---|---|---|
  | `-InstallRoot` | `D:\Kali\Friday` | `config\install-state.json` |
  | `-DistroName` | `Friday-Ubuntu` | `distro_name` |
  | `-DistroLocation` | `D:\Kali\wsl-friday` | `distro_location` |
  | Command Center | `http://127.0.0.1:3101` | `ports.CommandCenter` |
  | Hermes Dashboard / API / Qwen / Voice | `43791` / `43793` / `43792` / `43794` | `ports` |

  Der Installer-Default ist `C:\Friday` mit den Ports 3100 und 43691–43694; ein abweichender Wurzelpfad
  verlangt `-DistroName` **und** `-DistroLocation`.
- Sauberer Ausgangszustand, sonst vorher zurückbauen:
  1. Geplante Aufgaben löschen — auf diesem Host registriert: `FRIDAY_Dashboard`, `FRIDAY_Voice`,
     `FRIDAY_WSL_Keepalive` (kein `FRIDAY_Watchdog`-Task, obwohl `INSTALL_STATE.md` ihn nennt; der Befund
     gehört ins Protokoll). Reihenfolge: Watchdog zuerst (falls vorhanden), dann Voice, Keepalive, Dashboard.
  2. **Die WSL-Distribution bleibt bestehen** — `wsl --unregister` ist für diesen Lauf gesperrt. Der
     Betreiber nutzt WSL2 auch außerhalb von FRIDAY; ein Auslöschen der Distribution würde dieses System
     treffen. Geprüft am 2026-10-20: in `Friday-Ubuntu` liegen nur `~/.hermes` (3,2 GB), `~/jarvis`
     (Altbestand J.A.R.V.I.S.) und `~/friday-tts`; der Obsidian-Vault liegt unter `D:\obsidian\Vault` (aus
     WSL als `/mnt/d/obsidian/Vault` erreichbar) und **nicht** in der Distribution. Entfernt werden deshalb
     nur die FRIDAY-Bestände in der Distro: Modelle und Dashboard-Artefakte.

     ```bash
     wsl -d Friday-Ubuntu -- du -sh ~/.hermes ~/friday-tts ~/jarvis
     wsl -d Friday-Ubuntu -- rm -rf ~/friday-tts/models ~/jarvis/dashboard
     ```

  3. `D:\Kali\Friday\models` und `D:\Kali\Friday\dashboard` löschen (beide baut der Installer neu);
     `config`, `voice` und `logs` bleiben aus der Sicherung erhalten. Eine übernommene Altinstallation
     (`C:\Friday`, `C:\Jarvis`) gleichermaßen entfernen.
- Hinweis: `install-state.json` führt `dashboard_source` als lokalen Arbeitsbaum
  (`…\rogue-friday-clean`). Für den Drill muss die Quelle der gemergte `main`-Stand sein — sonst prüft der
  Lauf den falschen Code.
- Altdaten gesichert: Backup mit `verified: true` und `wslIncluded: true`, Vault separat kopiert.
- Vorher festgelegt (sonst entscheidet der Drill willkürlich): Lokalbetrieb (llama.cpp + Qwen) oder Cloud,
  Windows-Konto für den Owner, Obsidian-Vault-Pfad, Hermes-Modellroute und ob ein echter Modellschlüssel
  hinterlegt werden darf.

## 0b. Sicherung vor dem Zurückbauen

Die laufende Installation auf diesem Host ist funktionsfähig (Health auf `127.0.0.1:3101` antwortet,
Stand 2026-10-20) und enthält Nutzdaten. Vor dem Zurückbauen wenigstens diese Bestände sichern; alles andere
sind Modelle und Build-Artefakte, die der Installer neu erzeugt:

| Bestand | Pfad | Größe | Sichern? |
|---|---|---|---|
| Installationszustand und Konfiguration | `D:\Kali\Friday\config` | 2,9 MB | ja, komplett |
| Stimmprofile und Voice-Konfiguration | `D:\Kali\Friday\voice\*.json`, `*.npy` | < 1 MB | ja; die Modelldateien (3,2 GB) nicht |
| Logs des Altlaufs | `D:\Kali\Friday\logs` | 17 MB | ja, für die Fehleranalyse |
| Hermes-Zustand | `~/.hermes` in `Friday-Ubuntu` | 3,2 GB | ja, **ohne** `cache`, `backups`, `audio_cache` |
| Dashboard-Daten (falls vorhanden) | `D:\Kali\Friday\dashboard\data` | — | ja, prüfen ob vorhanden |
| Gesamte Distro (optional) | `wsl --export Friday-Ubuntu D:\backup\friday-distro-<datum>.tar` | ~22 GB vhdx | optional; die Distro wird **nicht** gelöscht, der Export ist nur eine Rückversicherung |

Praktisch:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$dst = "D:\backup\friday-$stamp"
New-Item -ItemType Directory -Force $dst | Out-Null
Get-ScheduledTask | Where-Object { $_.TaskName -like 'FRIDAY*' } | Stop-ScheduledTask
Copy-Item 'D:\Kali\Friday\config' "$dst\config" -Recurse
Copy-Item 'D:\Kali\Friday\logs' "$dst\logs" -Recurse
New-Item -ItemType Directory -Force "$dst\voice" | Out-Null
Copy-Item 'D:\Kali\Friday\voice\*.json','D:\Kali\Friday\voice\*.npy' "$dst\voice" -ErrorAction SilentlyContinue
wsl -d Friday-Ubuntu -- bash -lc 'tar -C ~ -czf /mnt/d/backup/hermes-home.tar.gz --exclude=cache --exclude=backups --exclude=audio_cache .hermes'
```

Abnahme der Sicherung: Dateien vorhanden, `hermes-home.tar.gz` lässt sich mit `tar -tzf` auflisten, und
`config\install-state.json` ist lesbar. Erst danach Abschnitt 0 (Zurückbauen) beginnen.

## 1. Installation

Interaktiv: `install-friday.bat` bzw. `install-friday-gui.bat`. Unbeaufsichtigt:

```powershell
.\install-friday.ps1 -InstallRoot 'D:\Kali\Friday' -DistroName 'Friday-Ubuntu' -DistroLocation 'D:\Kali\wsl-friday'
```

Abnahme:

- Skript endet mit Erfolg, keine Phase in `<InstallRoot>\config\install-state.json` steht auf `failed`.
- `<InstallRoot>` enthält `dashboard`, `installer`, `config`; die WSL-Distribution ist registriert (`wsl -l -v`)
  und ihr `BasePath` zeigt auf `-DistroLocation`.
- Logs eingesammelt: `%LOCALAPPDATA%\FridayInstaller\*.log` und `<InstallRoot>\logs\*`.

Typische Fehler: Neustart zwischen Phasen nötig → `install-friday.bat -Resume`; blockierte Downloads;
WSL-Distro mit gleichem Namen existiert noch; abweichender `-InstallRoot` ohne `-DistroName`/`-DistroLocation`
bricht sofort ab.

## 2. Dienste und Ports

Die FRIDAY-Komponenten laufen als **geplante Aufgaben** (Windows) plus **systemd** in der Distro — nicht als
Windows-Dienste (`Get-Service 'FRIDAY*'` bleibt leer).

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like 'FRIDAY*' } | Select-Object TaskName, State
Get-NetTCPConnection -State Listen -LocalPort 3101, 43791, 43792, 43793, 43794
Invoke-RestMethod http://127.0.0.1:3101/api/v1/health
```

Abnahme: alle erwarteten Aufgaben vorhanden und `Ready`/`Running`, Health antwortet mit `status` und
Komponenten, alle Ports **nur** auf `127.0.0.1`. Kein Dienst in einer Neustartschleife
(`Get-WinEvent -LogName Application`).

## 3. Dashboard, Login und Owner-Setup

Aufruf `http://127.0.0.1:3101`, Owner anlegen, Consent bestätigen, keine Fremddaten eintragen.

Abnahme: Session besteht, `Einstellungen` zeigen eine Version, der erste Audit-Eintrag existiert,
Abmelden/Anmelden funktioniert, ein zweiter Browser ohne Session wird abgewiesen.

## 4. Hermes-Runtime

Die Installation provisioniert die gepinnte Hermes-Revision. Prüfen:

```powershell
wsl -d <Distro> -- bash -lc 'cd ~/hermes && git rev-parse HEAD'
```

Abnahme: Revision entspricht der Pin-Angabe des Installers; Plugin-Aktivierung und Config-Bridge sind
gesetzt; ein Modellaufruf läuft nur, wenn ein Schlüssel hinterlegt wurde — sonst muss die Oberfläche den
Zustand klar als „nicht konfiguriert" zeigen statt still zu scheitern.

## 5. Kernfunktionen (je ein Smoke-Test)

| Bereich | Prüfung | Abnahme |
|---|---|---|
| Memory | Notiz schreiben, lesen, in Obsidian sichtbar | Eintrag im Vault, Outbox leer |
| Kalender | Konto verbinden (CalDAV), Termin anlegen | Termin im Konto, Read-back im Dashboard |
| Mail | Konto verbinden (IMAP/Himalaya), Entwurf | Entwurf im Postfach, kein Versand |
| Messenger | Telegram/WhatsApp-Pairing | Status `connected`, Allowlist greift |
| Research | Lokale Suche einrichten, Projekt starten | Quellenliste, Status statt Endlosspinner |
| Automationen/Cron | Automation anlegen, pausieren, Hermes-Cron lesen | Staged-Bestätigung erscheint, Zustand persistent |
| Approvals | Schreibaktion auslösen | `403 APPROVAL_REQUIRED` + Vorschau, danach genau eine Ausführung |
| Voice | Mikro/Headset wählen, einen Befehl sprechen | Transkript, Antwort, Abbruch per „Stopp" |
| Dateien | Datei öffnen, Umbenennen vorschlagen | Vorschau, Bestätigung, Audit-Eintrag |

Jeder Fehlschlag hier ist ein Drill-Befund, kein „Umgebungsproblem" — außer fehlende Hardware oder
fehlende Zugangsdaten sind explizit die Ursache.

## 6. Backup und Wiederanlauf

Backup über die Oberfläche erstellen, Verifikation `verified: true` abwarten, dann den isolierten
Wiederanlauf nach [p10-recovery-runbook.md](p10-recovery-runbook.md) in eine **zweite** Zielinstallation
(`-InstallRoot`, andere Distro, gleicher Linux-Benutzer). Abnahme: `state: healthy` und die dort
aufgeführten Prüfungen; RTO/RPO aus diesem Lauf protokollieren, nicht schätzen.

## 7. Fehlerprotokoll

| # | Phase | Symptom | Log-Auszug | Ursache | Fix | Retest |
|---|---|---|---|---|---|---|
| 1 | | | | | | |

Regel: Ursache erst eintragen, wenn sie belegt ist. Ein Befund ohne reproduzierbaren Log-Auszug bleibt
„offen" und wird nicht als behoben markiert.

## 8. Nach dem Drill

Befunde als atomare Commits mit Test, CI grün, Merge nach `main`; danach nur die betroffenen Phasen
erneut durchlaufen. Ergebnis und offene Punkte gehören in `docs/PROJECT_STATUS.md` und die Ledger-Zeile
`DOD-14`.

## Nicht Teil dieses Drills

Provider-Sends (Mail/Telegram/WhatsApp an echte Empfänger), Telefonie/SIP, Cloud-STT mit echtem Schlüssel,
Hardware-Abnahme von Wake-Word und Stimmprüfung, fremde Konten oder echte Personendaten. Diese Punkte
bleiben `NOT_RUN`, bis sie bewusst mit kontrollierten Konten freigegeben werden.