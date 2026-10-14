# Deployment auf dem Benutzergerät (Windows 11)

Dieses Dokument beschreibt, wie das F.R.I.D.A.Y. Command Center (Dashboard + Control API) auf dem Rechner des Benutzers läuft:
was der Installer (Schritt 15) tut, wie man es von Hand installiert, aktualisiert und entfernt, wo Konfiguration, Daten, Logs und
Geheimnisse liegen und was bei Problemen zu prüfen ist. Grundlage: `docs/PLAN.md` §49 (Sicherheit) und §54 (Deployment),
`docs/SECURITY.md`, `apps/control-api/README.md`, `docs/INSTALLER_INTEGRATION_REVIEW.md` §4.

Das Command Center ist ein **einziger Node-Prozess**: die Control API (Fastify) liefert REST, WebSocket und das statisch
exportierte Web (`apps/web/out`) auf **einem Port** aus (Standard `127.0.0.1:3100`). Der Browser spricht nur mit der Control API
(PLAN §49.2); Hermes, Voice-Dienst, Qwen und Systemdaten erreicht ausschließlich der Serverprozess.

## 1. Zielpfade und Entscheidung C:\ statt D:\

| Was | Pfad |
|---|---|
| Programm (Kopie des Repos, ohne `installer/`, `.git`, `node_modules` der Quelle) | `C:\Jarvis\dashboard` |
| Konfiguration | `C:\Jarvis\dashboard\config\dashboard.yaml`, `adapters.yaml` |
| Daten (SQLite `dashboard.sqlite`, `auth.key`, `audit-head.json`) | `C:\Jarvis\dashboard\data` |
| Sicherungen | `C:\Jarvis\dashboard\backups` |
| Logs der Anwendung (JSON-Zeilen, rotierend) | `C:\Jarvis\logs\dashboard\` |
| Ausgabe des Dienstes (stdout/stderr, Neustarts) | `C:\Jarvis\logs\dashboard-service.log` |
| Installationsprotokoll von Schritt 15 | `C:\Jarvis\logs\dashboard-install.log` |
| Hash des Owner-Passworts | `C:\Jarvis\config\dashboard_owner.hash` |
| Autostart-Skripte (vom Installer kopiert) | `C:\Jarvis\installer\scripts\start-dashboard.ps1`, `hidden.vbs` |

**Entscheidung (Eigentümer):** Zielpfad `C:\Jarvis\dashboard`. PLAN §54 nennt `D:\Jarvis\dashboard`. Gründe für die Abweichung:
Der gesamte Installer (Sprache, Hermes, Qwen, Modelle, Logs, `install-state.json`) legt alles unter `C:\Jarvis` ab; ein
`D:`-Laufwerk ist nicht garantiert (Prüfung, Fehlerfall, zusätzlicher Zustand), und ein einheitlicher Wurzelordner vereinfacht
Sicherung, Deinstallation und Support. Alle Pfade stehen in `dashboard.yaml` (`paths.*`) und sind dort änderbar; wer das Command
Center auf `D:` betreiben will, kopiert den Ordner, passt `paths.*` an und die Aufgabe `JARVIS_Dashboard` (Launcher
`start-dashboard.ps1` enthält den Pfad `C:\Jarvis\dashboard`).

**Logs:** Alle dienstbezogenen Logs liegen wie bei den anderen JARVIS-Diensten (`voice-service.log`, `qwen-server.log`) in
`C:\Jarvis\logs`. **Daten und Sicherungen** gehören zur Anwendung (PLAN §54.4) und bleiben in `C:\Jarvis\dashboard`, damit ein
erneutes Einspielen des Programms (`/MIR`) sie nie berührt.

## 2. Voraussetzungen

- Windows 11, Installation über `install-jarvis.bat` (Administrator, PowerShell 5.1). Hermes (43691/43693), Qwen (43692) und der
  Voice-Dienst (43694) sind vorher eingerichtet; ohne sie startet das Command Center trotzdem, zeigt aber die betroffenen
  Bereiche als eingeschränkt (Teilausfall, `503 ADAPTER_UNAVAILABLE` nur für den jeweiligen Adapter).
- Das **vollständige Paket** ist entpackt (Ordner `apps`, `packages`, `adapters`, `config`, `scripts` und Dateien wie
  `package.json`, `pnpm-lock.yaml` liegen neben `installer\`). Der Installer merkt sich den Ort in `install-state.json`
  (`dashboard_source`), damit er auch nach dem WSL-Neustart (Skript läuft dann aus `C:\Jarvis\installer`) gefunden wird.
- Internet (npm-Registry für `pnpm install`, winget/nodejs.org für Node.js).
- `winget` (App-Installer) für die automatische Node.js-Installation, sonst Node.js LTS ≥ 22.13 von Hand.
- Node.js ≥ 22.13 (`engines` im Root-`package.json`; `node:sqlite` wird gebraucht) und pnpm in der Version aus
  `packageManager` im Root-`package.json` (derzeit `pnpm@10.28.2`; der Installer liest sie dort aus, nichts ist hartkodiert).

## 3. Was der Installer tut (Schritt 15 „dashboard“)

Der Schritt kommt **nach** `voiceservice` und vor dem Abschlussbericht. Die Namen und die Reihenfolge der Schritte 1 bis 14
bleiben unverändert; bereits fertig installierte Systeme führen beim nächsten Start nur Schritt 15 aus. Er ist idempotent;
der Fortschritt steht in `C:\Jarvis\config\install-state.json` (`done` enthält `dashboard`, dazu `dashboard_hash`,
`dashboard_source`, `dashboard_pnpm`).

1. **Quelle suchen:** Ordner über `installer\` (oder `dashboard_source` aus dem Zustand). Fehlt sie: Abbruch mit Hinweis, das komplette
   Paket zu entpacken (Neustart setzt an dieser Stelle fort).
2. **Node.js:** `node --version` ≥ 22.13? Sonst `winget install --id OpenJS.NodeJS.LTS` (bei zu alter Version zuerst `winget upgrade`),
   danach PATH der laufenden Sitzung aus Maschinen- und Benutzer-PATH neu laden und per Fundort (nicht Exitcode) prüfen.
3. **pnpm:** `corepack enable` + `corepack prepare pnpm@<Version aus package.json> --activate`; Ausweichweg `npm install -g pnpm@<Version>`.
4. **Quellstand prüfen:** SHA-256 über alle kopierten Quellen (ohne `node_modules`, Build-Ausgaben, Screenshots/Belege und ohne die
   lokalen `dashboard.yaml`/`adapters.yaml`). Ist der Hash wie beim letzten erfolgreichen Build und existieren `dist` und `out`,
   wird der Build übersprungen.
5. **Bereitstellen (nur bei Änderung):** laufenden Dienst stoppen, `robocopy` nach `C:\Jarvis\dashboard`
   (`apps`, `packages`, `adapters`, `scripts` gespiegelt mit `/MIR`, `node_modules`/`dist`/`out` bleiben im Ziel erhalten;
   `config` ohne Löschen und ohne Überschreiben der beiden lokalen YAML-Dateien), dann `pnpm install --frozen-lockfile` und
   `pnpm build:app` in `C:\Jarvis\dashboard`. Ausgabe nach `C:\Jarvis\logs\dashboard-install.log`.
6. **Konfiguration:** `dashboard.yaml` (hybrid, `127.0.0.1:3100`, `auth.mode: local`, `ui.assistantName` = gewählter Assistentenname)
   und `adapters.yaml` (siehe §6). Existiert eine Datei, bleibt sie; weicht sie von der Vorgabe ab, fragt der Installer, ob er
   überschreiben soll (Standard „nein“, alte Datei wird nach `C:\Jarvis\backups` gesichert). Bei einem Namenswechsel
   (`change-assistant-name.bat`) wird nur `ui.assistantName` nachgezogen.
7. **Owner-Passwort:** zweimal per `Read-Host -AsSecureString`, mindestens 12 Zeichen. Der Hash entsteht mit der CLI aus
   `packages/auth` (`pnpm --filter @jarvis/auth hash-password`); das Passwort geht **über stdin**, nie über die Befehlszeile. Nur der
   scrypt-Hash wird in `C:\Jarvis\config\dashboard_owner.hash` gespeichert (siehe §7).
8. **Autostart und Start:** Aufgabe `JARVIS_Dashboard` (bei Anmeldung, 60 s Verzögerung nach `JARVIS_Voice`, versteckt über
   `hidden.vbs` → `start-dashboard.ps1`, Neustartschleife alle 10 s bei Absturz), sofort gestartet.
9. **Healthcheck:** bis zu 60 s `GET http://127.0.0.1:3100/api/v1/health`. Antwortet der Server (auch mit 503 bei Teilausfall),
   gilt der Schritt als erledigt; sonst Warnung mit Logpfad.

Fehlerbehandlung (Sprache und Hermes laufen in jedem Fall unverändert weiter):

| Situation | Verhalten |
|---|---|
| Paketquellen fehlen | `Stop-Install`, deutscher Hinweis; erneutes Starten setzt hier fort |
| `winget` fehlt | `Stop-Install` mit Hinweis (App-Installer aktualisieren oder Node.js von nodejs.org) |
| Node.js nach Installation nicht auffindbar (neue Shell nötig) | `Stop-Install`: Fenster schließen, `install-jarvis.bat` neu starten |
| `pnpm install` scheitert (offline/Registry) | `Stop-Install`, letzte Logzeilen angezeigt, Hinweis auf Internet/Proxy |
| `pnpm build:app` scheitert | `Stop-Install` mit Exitcode und `dashboard-install.log` |
| Port 3100 belegt (Fremdprozess) | Warnung mit Prozessname, PID, Befehlszeile (`Get-NetTCPConnection`); Schritt bleibt offen, Installation läuft weiter |
| Health-Timeout | Warnung mit Verweis auf `dashboard-service.log`; Schritt bleibt offen |

## 4. Betrieb: Befehle von Hand

Alle Befehle in PowerShell. Bei Bedarf vorher: `cd C:\Jarvis\dashboard`.

**Erstinstallation / Neuaufbau ohne Installer**

```powershell
cd C:\Jarvis\dashboard
corepack enable
corepack prepare pnpm@10.28.2 --activate      # Version = packageManager im package.json
pnpm install --frozen-lockfile
pnpm build:app                                 # baut nur Web (apps/web/out) und Control API (apps/control-api/dist)
Copy-Item config\dashboard.hybrid.example.yaml config\dashboard.yaml    # einmalig, danach anpassen
Copy-Item config\adapters.hybrid.example.yaml  config\adapters.yaml
```

In `dashboard.yaml` muss `auth.ownerPasswordHash: file:C:/Jarvis/config/dashboard_owner.hash` stehen (die Vorlage nutzt `env:`).
Den Owner-Hash erzeugt `pnpm --filter @jarvis/auth hash-password` (fragt interaktiv zweimal, oder Passwort über stdin);
Ergebnis (`JARVIS_OWNER_PASSWORD_HASH='scrypt$…'`) ohne die Anführungszeichen in `C:\Jarvis\config\dashboard_owner.hash`
schreiben (kein Zeilenumbruch nötig) und die Datei mit `icacls` auf den Benutzer beschränken.

**Starten / Stoppen / Neustart**

```powershell
Start-ScheduledTask -TaskName JARVIS_Dashboard           # startet den Launcher (Neustartschleife)
# Stop-ScheduledTask beendet nur die Aufgabe, nicht die Neustartschleife; zum Stoppen Launcher und Server beenden:
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*start-dashboard.ps1*' -or $_.CommandLine -like '*control-api*dist*main.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# im Vordergrund (Diagnose, Strg+C beendet):
$env:JARVIS_CONFIG_DIR = 'C:\Jarvis\dashboard\config'
node C:\Jarvis\dashboard\apps\control-api\dist\main.js
```

**Aktualisieren**

Neues, vollständiges Paket entpacken und `update-dashboard.bat` doppelklicken (= `install-jarvis.ps1 -UpdateDashboard`: nur Schritt 15,
ohne Rückfragen zu bestehender Konfiguration oder Passwort). Der Quellhash entscheidet, ob neu gebaut wird. Von Hand: neue
Dateien nach `C:\Jarvis\dashboard` kopieren (nicht `config\dashboard.yaml`/`adapters.yaml`, `data`, `backups`), dann
`pnpm install --frozen-lockfile; pnpm build:app` und `Start-ScheduledTask JARVIS_Dashboard`. Vor einem Update eine Sicherung von
`data` anlegen (`Copy-Item -Recurse C:\Jarvis\dashboard\data C:\Jarvis\dashboard\backups\data-$(Get-Date -Format yyyyMMdd)`). Wer die
Datenbank bewusst aus einer Sicherung wiederherstellt, löscht vorher `data\audit-head.json` (siehe `apps/control-api/README.md`, Audit).

**Deinstallieren**

```powershell
Stop-ScheduledTask -TaskName JARVIS_Dashboard -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName JARVIS_Dashboard -Confirm:$false
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*start-dashboard.ps1*' -or $_.CommandLine -like '*control-api*dist*main.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item C:\Jarvis\dashboard -Recurse -Force          # löscht Programm, Konfiguration, Daten, Sicherungen
Remove-Item C:\Jarvis\config\dashboard_owner.hash
```

Danach in `C:\Jarvis\config\install-state.json` `"dashboard"` aus `done` entfernen, falls der Schritt später wieder laufen soll.

## 5. Betriebsmodi

`dataMode` in `dashboard.yaml` (überschreibbar mit `JARVIS_DATA_MODE`):

| Modus | Bedeutung | Einsatz |
|---|---|---|
| `mock` | Alles simuliert (`@jarvis/adapter-mock`), offline lauffähig, Dev-Konten nur auf Loopback | Entwicklung, Demo, Tests |
| `hybrid` (**Installer-Standard**) | In `adapters.yaml` genannte Kategorien live, alle anderen `mock-*` (in der Oberfläche als Simulation erkennbar) | Produktivstart, solange nur Hermes/Voice/System angebunden sind |
| `live` | Nur konfigurierte Kategorien aktiv, alle anderen deaktiviert (nicht gemockt); Vorlage `config/adapters.live.example.yaml` | spätere Vollanbindung (Mail, Kalender, …) |

Umstellen: `dataMode` ändern (und bei `live` die Adapterliste vervollständigen), dann den Dienst neu starten. `auth.mode: dev` ist
nur mit `mock` und Loopback erlaubt; der Installer nutzt immer `local`.

## 6. Konfigurationsdateien

- `dashboard.yaml` (Server, Pfade, Auth, UI, Logging; Schema `packages/config`), Vorlage `config/dashboard.hybrid.example.yaml`.
- `adapters.yaml` (Allowlist + Kategorien), Vorlage `config/adapters.hybrid.example.yaml`. Vom Installer erzeugt:

| Kategorie | Provider (`@jarvis/…`) | Ziel |
|---|---|---|
| `tasks`, `activity`, `agents` | `hermes-*` (`adapter-hermes`) | Hermes-Dashboard `127.0.0.1:43691`, API-Server `127.0.0.1:43693` mit `apiKey: file:C:/Jarvis/config/hermes_api.key` |
| `voice` | `jarvis-voice-http` (`adapter-voice-http`) | Voice-Status `127.0.0.1:43694`, Qwen `127.0.0.1:43692`, `wakePhrase` = Wake Word des Assistenten |
| `system` | `local-system` (`adapter-system-local`) | Qwen-/Hermes-/Voice-Probes, `storagePaths: ["C:/"]`, `wslDistro: Ubuntu` |
| alle übrigen | `mock-*` (Hybrid-Rückfall) | – |

Änderungen wirken nach einem Neustart des Dienstes. Der Anzeigename kommt aus `ui.assistantName`; `settings.profile.assistantName`
(in der Oberfläche geändert, in SQLite) hat Vorrang.

## 7. Ports

| Port | Dienst | Bindung | Anmerkung |
|---|---|---|---|
| **3100** | **Command Center (Control API + Web)** | 127.0.0.1 | `server.port` in `dashboard.yaml`; Installer und Launcher lesen den Port von dort |
| 43691 | Hermes-Dashboard | 127.0.0.1 (WSL, mirrored networking) | Adapter `hermes-*` |
| 43692 | Qwen3-4B (llama-server) | 127.0.0.1 | Adapter `voice`, `system`; keine Auth |
| 43693 | Hermes-API-Server | 127.0.0.1 (WSL) | Bearer-Key `hermes_api.key` |
| 43694 | Voice-Statusserver | 127.0.0.1 | Adapter `voice`, `system`; keine Auth, kein CORS |

Alles bleibt auf Loopback (PLAN §49.1). Für Zugriff von außen gilt PLAN §49.7 (TLS, VPN oder Zero-Trust, nie eine offene
Portfreigabe); technisch erst nach `server.allowRemote: true`, was der Installer nie setzt.

## 8. Geheimnisse

Regeln (PLAN §49.6, `docs/SECURITY.md` §5): Geheimnisse nur serverseitig, nie im Browser, nie im Klartext in `dashboard.yaml`/
`adapters.yaml`, nie in SQLite oder Logs. Config-Dateien enthalten nur **Referenzen**: `file:<absoluter Pfad>`, `env:NAME` oder
`wincred:ZIEL`.

| Geheimnis | Ablage | Schutz |
|---|---|---|
| Hermes-API-Key | `C:\Jarvis\config\hermes_api.key` (vom Hermes-Schritt), Referenz `file:C:/Jarvis/config/hermes_api.key` | ACL: Benutzer RW, SYSTEM R; Control API läuft unter demselben Benutzer |
| Hash des Owner-Passworts | `C:\Jarvis\config\dashboard_owner.hash`, Referenz `auth.ownerPasswordHash: file:C:/Jarvis/config/dashboard_owner.hash` | scrypt-Hash (N=2^15, r=8, p=1), `icacls /inheritance:r`, Benutzer RW, SYSTEM R; Passwort selbst wird nirgends gespeichert oder geloggt |
| Server-Schlüssel (CSRF, Approval-Tokens) | `C:\Jarvis\dashboard\data\auth.key` | von der Control API beim ersten Start mit Rechten nur für den Benutzer angelegt; Verlust macht nur Tokens ungültig |
| Weitere Adapter-Secrets (Mail, Kalender, später) | Windows Credential Manager (`wincred:ZIEL`, PowerShell-Modul `CredentialManager`) oder `env:NAME` | nie als Klartext in Dateien; über die API write-only |

Begründung der Ablage des Owner-Hashs als Datei statt als Benutzer-Umgebungsvariable: Eine `User`-Umgebungsvariable ist für **jeden**
Prozess des Benutzers lesbar, wird in Prozessabbildern vererbt und erscheint in Diagnosewerkzeugen; eine Datei mit ACL entspricht dem
bereits genutzten Muster `hermes_api.key` (Review §4.1), und `wincred:` bräuchte ein nicht vorinstalliertes PowerShell-Modul.
Der Installer gibt das Passwort nie auf der Konsole oder im Transkript aus; es existiert nur im Arbeitsspeicher des Installationsprozesses und
wird per stdin an die Hash-CLI übergeben. Passwort vergessen: Eintrag `dashboard` aus `done` in `install-state.json` löschen,
`install-jarvis.bat` starten und beim Passwort „Neu setzen“ mit `j` antworten (oder die Hash-Datei von Hand ersetzen).

## 9. Logs

| Log | Inhalt |
|---|---|
| `C:\Jarvis\logs\dashboard-install.log` | Schritt 15: winget, corepack, `pnpm install`, `pnpm build:app` (vollständig) |
| `C:\Jarvis\logs\dashboard-service.log` | Start/Ende des Servers, stdout/stderr, Neustarts (rotiert bei 10 MB auf `.1`) |
| `C:\Jarvis\logs\dashboard\` | JSON-Zeilen der Anwendung (`logging.*` in `dashboard.yaml`, Rotation nach `maxBytes`/`maxFiles`), Secrets werden maskiert |
| `C:\Jarvis\logs\install-<Zeitstempel>.log` | Transkript des gesamten Installers |

## 10. Fehlersuche

| Symptom | Prüfen / Lösung |
|---|---|
| `http://127.0.0.1:3100` lädt nicht | `Get-ScheduledTask JARVIS_Dashboard`; `Start-ScheduledTask JARVIS_Dashboard`; `dashboard-service.log` lesen; im Vordergrund starten (§4) |
| Login schlägt immer fehl | Benutzername `owner`; nach 5 Fehlversuchen Sperre (`429 Retry-After`); Passwort neu setzen (§8); `auth.ownerPasswordHash` zeigt auf `dashboard_owner.hash`? |
| Start bricht mit Konfigurationsfehler ab | `dashboard-service.log` nennt Datei und Pfad; YAML-Einrückung und Secret-Referenzen prüfen (Credential-Felder müssen `file:`/`env:`/`wincred:` sein) |
| Bereiche zeigen „eingeschränkt“/offline | Adapter einzeln prüfen: Hermes `curl http://127.0.0.1:43693/health`, Voice `http://127.0.0.1:43694`, Qwen `http://127.0.0.1:43692/v1/models`; WSL läuft (`JARVIS_WSL_Keepalive`)? Das Command Center bleibt für die übrigen Bereiche nutzbar |
| Port 3100 belegt | `Get-NetTCPConnection -LocalPort 3100 -State Listen` → `Get-Process -Id <PID>`; Programm beenden oder `server.port` ändern |
| `pnpm install` scheitert | Internet/Proxy; Eintrag `ERR_PNPM_*` im `dashboard-install.log`; Lockfile unverändert lassen (`--frozen-lockfile`) |
| `node` nicht gefunden | Neue PowerShell öffnen (PATH); `where.exe node`; Node.js ≥ 22.13 (`node --version`) |
| Nach Update veraltete Oberfläche | `apps\web\out` neu gebaut? `update-dashboard.bat`; Browser-Cache leeren |
| Dienst startet nicht nach Anmeldung | Aufgabe hat 60 s Verzögerung; sonst Aufgabenplanung → Verlauf; Launcher-Pfad `C:\Jarvis\installer\scripts\start-dashboard.ps1` vorhanden? |

## 11. Offene Punkte

- Der Installer lief bisher nur statisch geprüft (Parser, Konventionen); der Lauf auf einem echten Windows-11-Rechner steht aus
  (winget/Node, corepack, `pnpm install` unter Windows, Task-Start, Healthcheck).
- Dienstbetrieb als Windows-Dienst (statt Aufgabe bei Anmeldung) ist nicht vorgesehen: die Control API braucht den
  Benutzerkontext (Lesezugriff auf `hermes_api.key`, Interaktivität von WSL).
- Ein eigener Port außerhalb von 3100 wird von Installer und Launcher aus `dashboard.yaml` gelesen; die Umgebungsvariable `JARVIS_PORT`
  wird dabei nicht berücksichtigt.
