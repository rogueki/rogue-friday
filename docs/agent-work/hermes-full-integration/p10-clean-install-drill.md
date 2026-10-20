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
- Sauberer Ausgangszustand, sonst vorher zurückbauen (ANLEITUNG, Abschnitt *Deinstallation*):
  1. `FRIDAY_Watchdog` zuerst löschen, dann `FRIDAY_Voice`, ggf. `FRIDAY_Qwen`, `FRIDAY_WSL_Keepalive`, `FRIDAY_Dashboard`.
  2. `wsl --unregister <Distro>` (löscht Hermes mit).
  3. `C:\Friday` löschen; eine übernommene Altinstallation (`C:\Jarvis`) gleichermaßen.
- Altdaten gesichert: Backup mit `verified: true` und `wslIncluded: true`, Vault separat kopiert.
- Vorher festgelegt (sonst entscheidet der Drill willkürlich): Lokalbetrieb (llama.cpp + Qwen) oder Cloud,
  Windows-Konto für den Owner, Obsidian-Vault-Pfad, Hermes-Modellroute und ob ein echter Modellschlüssel
  hinterlegt werden darf.

## 1. Installation

Interaktiv: `install-friday.bat` bzw. `install-friday-gui.bat`. Unbeaufsichtigt:

```powershell
.\install-friday.ps1 -InstallRoot 'C:\Friday' -DistroName 'Ubuntu' -DistroLocation 'C:\Friday\wsl'
```

Abnahme:

- Skript endet mit Erfolg, keine Phase in `C:\Friday\config\install-state.json` steht auf `failed`.
- `C:\Friday` enthält `dashboard`, `installer`, `config`; die WSL-Distribution ist registriert (`wsl -l -v`).
- Logs eingesammelt: `%LOCALAPPDATA%\FridayInstaller\*.log` und `C:\Friday\logs\*`.

Typische Fehler: Neustart zwischen Phasen nötig → `install-friday.bat -Resume`; blockierte Downloads;
WSL-Distro mit gleichem Namen existiert noch.

## 2. Dienste und Ports

```powershell
Get-ScheduledTask -TaskName 'FRIDAY_*' | Select-Object TaskName, State
Get-NetTCPConnection -State Listen -LocalPort 3100, 43691, 43692, 43693, 43694
Invoke-RestMethod http://127.0.0.1:3100/api/v1/health
```

Abnahme: alle erwarteten Aufgaben vorhanden, Health antwortet mit `status` und Komponenten, alle Ports
**nur** auf `127.0.0.1`. Kein Dienst in einer Neustartschleife (`Get-WinEvent -LogName Application`).

## 3. Dashboard, Login und Owner-Setup

Aufruf `http://127.0.0.1:3100`, Owner anlegen, Consent bestätigen, keine Fremddaten eintragen.

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