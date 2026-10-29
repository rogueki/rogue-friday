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
| Programm (Kopie des Repos, ohne `installer/`, `.git`, `node_modules` der Quelle) | `C:\Friday\dashboard` |
| Konfiguration | `C:\Friday\dashboard\config\dashboard.yaml`, `adapters.yaml` |
| Daten (SQLite `dashboard.sqlite`, `auth.key`, `audit-head.json`) | `C:\Friday\dashboard\data` |
| Mail-Lesebrücke | `C:\Friday\dashboard\data\mail-bridge\auth.key` und `~/.hermes/friday-mail-bridge.{key,json}` in WSL |
| Sicherungen | `C:\Friday\dashboard\backups` |
| Logs der Anwendung (JSON-Zeilen, rotierend) | `C:\Friday\logs\dashboard\` |
| Ausgabe des Dienstes (stdout/stderr, Neustarts) | `C:\Friday\logs\dashboard-service.log` |
| Installationsprotokoll von Schritt 15 | `C:\Friday\logs\dashboard-install.log` |
| Hash des Owner-Passworts | `C:\Friday\config\dashboard_owner.hash` |
| Autostart-Skripte (vom Installer kopiert) | `C:\Friday\installer\scripts\start-dashboard.ps1`, `hidden.vbs` |

**Entscheidung (Eigentümer):** Zielpfad `C:\Friday\dashboard`. PLAN §54 nennt `D:\Friday\dashboard`. Gründe für die Abweichung:
Der gesamte Installer (Sprache, Hermes, Qwen, Modelle, Logs, `install-state.json`) legt alles unter `C:\Friday` ab; ein
`D:`-Laufwerk ist nicht garantiert (Prüfung, Fehlerfall, zusätzlicher Zustand), und ein einheitlicher Wurzelordner vereinfacht
Sicherung, Deinstallation und Support. Alle Pfade stehen in `dashboard.yaml` (`paths.*`) und sind dort änderbar; wer das Command
Center auf `D:` betreiben will, benötigt eine dort bereits eingerichtete Installation mit passenden `paths.*` und Aufgaben.
Der Launcher `start-dashboard.ps1` ermittelt den Root-Pfad aus seinem eigenen Installationsort.

**Logs:** Alle dienstbezogenen Logs liegen wie bei den anderen FRIDAY-Diensten (`voice-service.log`, `qwen-server.log`) in
`C:\Friday\logs`. **Daten und Sicherungen** gehören zur Anwendung (PLAN §54.4) und bleiben in `C:\Friday\dashboard`, damit ein
erneutes Einspielen des Programms (`/MIR`) sie nie berührt.

## 2. Voraussetzungen

- Windows 11, Installation über `install-friday.bat` (Administrator, PowerShell 5.1). Eine Installation der früheren Version unter
  `C:\Jarvis` wird zur Übernahme angeboten (§12). Hermes (43691/43693), Qwen (43692) und der
  Voice-Dienst (43694) sind vorher eingerichtet; ohne sie startet das Command Center trotzdem, zeigt aber die betroffenen
  Bereiche als eingeschränkt (Teilausfall, `503 ADAPTER_UNAVAILABLE` nur für den jeweiligen Adapter).
- Das **vollständige Paket** ist entpackt (Ordner `apps`, `packages`, `adapters`, `config`, `scripts` und Dateien wie
  `package.json`, `pnpm-lock.yaml` liegen neben `installer\`). Der Installer merkt sich den Ort in `install-state.json`
  (`dashboard_source`), damit er auch nach dem WSL-Neustart (Skript läuft dann aus `C:\Friday\installer`) gefunden wird.
- Internet (npm-Registry für `pnpm install`, winget/nodejs.org für Node.js).
- `winget` (App-Installer) für die automatische Node.js-Installation, sonst Node.js LTS ≥ 22.13 von Hand.
- Node.js ≥ 22.13 (`engines` im Root-`package.json`; `node:sqlite` wird gebraucht) und pnpm in der Version aus
  `packageManager` im Root-`package.json` (derzeit `pnpm@10.28.2`; der Installer liest sie dort aus, nichts ist hartkodiert).

## 3. Was der Installer tut (Schritt 15 „dashboard“)

### Frische Installation an einem eigenen Ort

Der Doppelklick auf `installer/install-friday.bat` verwendet weiter `C:\Friday`. Fuer eine frische Installation an einem anderen Ort muessen Zielordner und eigene WSL-Distribution explizit angegeben werden. Zielordner und WSL-Ablageort muessen auf demselben Laufwerk liegen, duerfen sich nicht ueberlappen und muessen frei sein. Beispiel aus einem PowerShell-Fenster im Repository:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer\install-friday.ps1 -InstallRoot 'D:\Friday' -DistroName Friday-Ubuntu -DistroLocation 'D:\Friday-WSL'
```

Der Installer prueft die Ports 43791 bis 43795 sowie 3101, registriert die benannte Distribution am angegebenen Ort und schreibt Installationspfad und Ports in `config/install-state.json`. Danach starten dieselben Argumente einen unterbrochenen Lauf wieder. Eine vorhandene nicht leere Installation wird nicht als frische Installation ueberschrieben. Dieser Quellpfad ist durch Syntax-, Konfigurations- und WSL-Pfadproben geprueft; ein vollstaendiger frischer D:-Installationslauf ist noch offen.

### Bestehende Installation an einem anderen Ort gezielt aktualisieren

Fuer eine bereits vollstaendig installierte F.R.I.D.A.Y.-Instanz kann der Installer ein Dashboard-Update oder einen Stimmenwechsel mit `-InstallRoot` ausfuehren. Er uebernimmt Distribution und Ports aus `config/install-state.json`, prueft die geplanten Aufgaben und sichert vor dem Update die bestehende Konfiguration und den Dashboard-Build. Beispiel:

```powershell
& .\installer\install-friday.ps1 -InstallRoot 'D:\Friday' -UpdateDashboard
& .\installer\install-friday.ps1 -InstallRoot 'D:\Friday' -ChangeVoice
```

Die beiden Aktionen werden getrennt ausgefuehrt. Eine `C:\Jarvis`-Junction auf denselben D:-Ordner wird nicht als Quelle der automatischen Legacy-Migration behandelt. Beim Standardpfad `C:\Friday` bleibt der normale Installationslauf bestehen. Der Dashboard-Launcher leitet seinen Root-Pfad aus dem installierten Skript ab.

Der Schritt kommt **nach** `voiceservice` und vor dem Abschlussbericht. Die Namen und die Reihenfolge der Schritte 1 bis 14
bleiben unverändert; bereits fertig installierte Systeme führen beim nächsten Start nur Schritt 15 aus. Er ist idempotent;
der Fortschritt steht in `C:\Friday\config\install-state.json` (`done` enthält `dashboard`, dazu `dashboard_hash`,
`dashboard_source`, `dashboard_pnpm`).

1. **Quelle suchen:** Ordner über `installer\` (oder `dashboard_source` aus dem Zustand). Fehlt sie: Abbruch mit Hinweis, das komplette
   Paket zu entpacken (Neustart setzt an dieser Stelle fort).
2. **Node.js:** `node --version` ≥ 22.13? Sonst `winget install --id OpenJS.NodeJS.LTS` (bei zu alter Version zuerst `winget upgrade`),
   danach PATH der laufenden Sitzung aus Maschinen- und Benutzer-PATH neu laden und per Fundort (nicht Exitcode) prüfen.
3. **pnpm:** `corepack enable` + `corepack prepare pnpm@<Version aus package.json> --activate`; Ausweichweg `npm install -g pnpm@<Version>`.
4. **Quellstand prüfen:** SHA-256 über alle kopierten Quellen (ohne `node_modules`, Build-Ausgaben, Screenshots/Belege und ohne die
   lokalen `dashboard.yaml`/`adapters.yaml`). Ist der Hash wie beim letzten erfolgreichen Build und existieren `dist` und `out`,
   wird der Build übersprungen.
5. **Bereitstellen (nur bei Änderung):** laufenden Dienst stoppen, `robocopy` nach `C:\Friday\dashboard`
   (`apps`, `packages`, `adapters`, `scripts` gespiegelt mit `/MIR`, `node_modules`/`dist`/`out` bleiben im Ziel erhalten;
   `config` ohne Löschen und ohne Überschreiben der beiden lokalen YAML-Dateien), dann `pnpm install --frozen-lockfile` und
   `pnpm build:app` in `C:\Friday\dashboard`. Ausgabe nach `C:\Friday\logs\dashboard-install.log`.
6. **Konfiguration:** `dashboard.yaml` (hybrid, `127.0.0.1:3100`, `auth.mode: local`, `ui.assistantName` = gewählter Assistentenname)
   und `adapters.yaml` (siehe §6). Existiert eine Datei, bleibt sie; weicht sie von der Vorgabe ab, fragt der Installer, ob er
   überschreiben soll (Standard „nein“, alte Datei wird nach `C:\Friday\backups` gesichert). Bei einem Namenswechsel
   (`change-assistant-name.bat`) wird nur `ui.assistantName` nachgezogen.
7. **Owner-Konto:** Der Installer behält vorhandene Passwort-Hashes. Bei einer Neuinstallation bleibt die Hashdatei zunächst
   leer bzw. fehlt. Beim ersten lokalen Öffnen des Command Centers legt der Nutzer Anzeigename, Benutzername und Passwort
   (mindestens 12 Zeichen) selbst fest. Der Server schreibt nur den scrypt-Hash nach `C:\Friday\config\dashboard_owner.hash`.
8. **Autostart und Start:** Aufgabe `FRIDAY_Dashboard` (bei Anmeldung, 60 s Verzögerung nach `FRIDAY_Voice`, versteckt über
   `hidden.vbs` → `start-dashboard.ps1`, Neustartschleife alle 10 s bei Absturz), sofort gestartet.
9. **Healthcheck:** bis zu 60 s `GET http://127.0.0.1:3100/api/v1/health`. Antwortet der Server (auch mit 503 bei Teilausfall),
   gilt der Schritt als erledigt; sonst Warnung mit Logpfad.

Fehlerbehandlung (Sprache und Hermes laufen in jedem Fall unverändert weiter):

| Situation | Verhalten |
|---|---|
| Paketquellen fehlen | `Stop-Install`, deutscher Hinweis; erneutes Starten setzt hier fort |
| `winget` fehlt | `Stop-Install` mit Hinweis (App-Installer aktualisieren oder Node.js von nodejs.org) |
| Node.js nach Installation nicht auffindbar (neue Shell nötig) | `Stop-Install`: Fenster schließen, `install-friday.bat` neu starten |
| `pnpm install` scheitert (offline/Registry) | `Stop-Install`, letzte Logzeilen angezeigt, Hinweis auf Internet/Proxy |
| `pnpm build:app` scheitert | `Stop-Install` mit Exitcode und `dashboard-install.log` |
| Port 3100 belegt (Fremdprozess) | Warnung mit Prozessname, PID, Befehlszeile (`Get-NetTCPConnection`); Schritt bleibt offen, Installation läuft weiter |
| Health-Timeout | Warnung mit Verweis auf `dashboard-service.log`; Schritt bleibt offen |

## 4. Betrieb: Befehle von Hand

Alle Befehle in PowerShell. Bei Bedarf vorher: `cd C:\Friday\dashboard`.

**Erstinstallation / Neuaufbau ohne Installer**

```powershell
cd C:\Friday\dashboard
corepack enable
corepack prepare pnpm@10.28.2 --activate      # Version = packageManager im package.json
pnpm install --frozen-lockfile
pnpm build:app                                 # baut nur Web (apps/web/out) und Control API (apps/control-api/dist)
Copy-Item config\dashboard.hybrid.example.yaml config\dashboard.yaml    # einmalig, danach anpassen
Copy-Item config\adapters.hybrid.example.yaml  config\adapters.yaml
```

In `dashboard.yaml` muss für die Browser-Ersteinrichtung `auth.ownerPasswordHash: file:C:/Friday/config/dashboard_owner.hash`
stehen (die Vorlage nutzt `env:`). Die Datei darf anfangs fehlen. Der Server erlaubt die einmalige Kontoanlage nur auf
Loopback und setzt eine restriktive Datei-ACL. Eine vorhandene Hashdatei wird nicht überschrieben.

**Starten / Stoppen / Neustart**

```powershell
Start-ScheduledTask -TaskName FRIDAY_Dashboard           # startet den Launcher (Neustartschleife)
# Stop-ScheduledTask beendet nur die Aufgabe, nicht die Neustartschleife; zum Stoppen Launcher und Server beenden:
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*start-dashboard.ps1*' -or $_.CommandLine -like '*control-api*dist*main.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# im Vordergrund (Diagnose, Strg+C beendet):
$env:FRIDAY_CONFIG_DIR = 'C:\Friday\dashboard\config'
node C:\Friday\dashboard\apps\control-api\dist\main.js
```

**Service-Watchdog (`FRIDAY_Watchdog`)**

`installer/scripts/friday-watchdog.ps1` (nach `C:\Friday\installer\scripts`) macht pro Aufruf genau einen Durchlauf und beendet sich.
Die Aufgabe `FRIDAY_Watchdog` (Installer-Abschnitt „Zusatz – Service-Watchdog“, Schritt-Name `watchdog`, bei jedem Lauf neu registriert,
Fehler nur als Warnung) startet ihn bei der Anmeldung (120 s Verzögerung) und alle 5 Minuten (Wiederholung ohne Ende), Aktion
`wscript.exe //B //Nologo hidden.vbs friday-watchdog.ps1`, `MultipleInstances IgnoreNew`, Laufzeitgrenze 2 Minuten, Benutzerkontext
wie die anderen Aufgaben. **Wichtig:** immer über `hidden.vbs` starten. `powershell.exe -WindowStyle Hidden` direkt als Aufgabenaktion
blitzt bei jedem Lauf ein Konsolenfenster auf, weil das Flag erst wirkt, wenn die Konsole schon existiert.

Geprüft werden nur Dienste, deren Schritt in `install-state.json` erledigt ist (`voiceservice`, `qwen`, `dashboard`). Neustart
(`Start-ScheduledTask` der Dienstaufgabe) nur, wenn alles zutrifft:

| Bedingung | Prüfung |
|---|---|
| Port antwortet nicht | TCP-Connect auf 43694 / 43692; Command Center zusätzlich `GET /api/v1/health` (jede HTTP-Antwort zählt als „läuft“) |
| Kein Prozess läuft | Launcher (`start-friday-voice.ps1`, `start-dashboard.ps1`) oder Kindprozess (`*friday_voice.py*`, `llama-server.exe … --port 43692`, `*control-api*dist*main.js*`) per `Win32_Process`-CommandLine. Modellladen hält den Port geschlossen, der Prozess existiert aber: dann nie ein Neustart (nach 20 min nur Warnung „hängt vermutlich“) |
| Kein Stop-Flag | `C:\Friday\run\<Launcher>.stop` fehlt (gewollter Stopp bleibt gestoppt) |
| Installer läuft nicht | `C:\Friday\run\installer.active` (PID des Installers) fehlt oder ist verwaist. Der Installer setzt sie beim Start und löscht sie am Ende, damit Updates (`-UpdateDashboard`, `-ChangeName`), in denen Dienste länger ohne Stop-Flag gestoppt sind, nicht durchkreuzt werden |
| Nicht in der Anmelde-Schonfrist | die ersten 3 Minuten der Sitzung (die Dienstaufgaben starten selbst, 45/60 s Verzögerung) |
| Backoff | seit dem letzten Neustart dieses Dienstes ≥ 10 min, höchstens 3 Neustarts je Stunde (danach Warnung im Log) |

Zustand: `C:\Friday\run\watchdog-state.json`; Einzelinstanz per Mutex `Local\FRIDAY_Watchdog`. Log: `C:\Friday\logs\watchdog.log`
(eine Zeile je Neustart/Warnung/Statuswechsel, stündlich `Heartbeat`, Rotation bei 1 MB auf `.1`). Der Watchdog beendet nie einen Prozess und
fasst keine andere Aufgabe an. Eine ältere Aufgabe `JARVIS_Voice_Watchdog` (früherer Installer) bleibt bestehen; bei Nichtgebrauch
`schtasks /delete /tn JARVIS_Voice_Watchdog /f`. Zum absichtlichen Stoppen eines Dienstes den Watchdog vorher deaktivieren
(`schtasks /change /tn FRIDAY_Watchdog /disable`) oder das Stop-Flag setzen.

**Aktualisieren**

Neues, vollständiges Paket entpacken und `update-dashboard.bat` doppelklicken (= `install-friday.ps1 -UpdateDashboard`: nur Schritt 15,
ohne Rückfragen zu bestehender Konfiguration oder Passwort). Der Quellhash entscheidet, ob neu gebaut wird. Von Hand: neue
Dateien nach `C:\Friday\dashboard` kopieren (nicht `config\dashboard.yaml`/`adapters.yaml`, `data`, `backups`), dann
`pnpm install --frozen-lockfile; pnpm build:app` und `Start-ScheduledTask FRIDAY_Dashboard`. Vor einem Update eine Sicherung von
`data` anlegen (`Copy-Item -Recurse C:\Friday\dashboard\data C:\Friday\dashboard\backups\data-$(Get-Date -Format yyyyMMdd)`). Wer die
Datenbank bewusst aus einer Sicherung wiederherstellt, löscht vorher `data\audit-head.json` (siehe `apps/control-api/README.md`, Audit).

**Deinstallieren**

```powershell
Unregister-ScheduledTask -TaskName FRIDAY_Watchdog -Confirm:$false -ErrorAction SilentlyContinue   # zuerst, sonst startet er das Command Center neu
Stop-ScheduledTask -TaskName FRIDAY_Dashboard -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName FRIDAY_Dashboard -Confirm:$false
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*start-dashboard.ps1*' -or $_.CommandLine -like '*control-api*dist*main.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item C:\Friday\dashboard -Recurse -Force          # löscht Programm, Konfiguration, Daten, Sicherungen
Remove-Item C:\Friday\config\dashboard_owner.hash
```

Danach in `C:\Friday\config\install-state.json` `"dashboard"` aus `done` entfernen, falls der Schritt später wieder laufen soll.

## 5. Betriebsmodi

`dataMode` in `dashboard.yaml` (überschreibbar mit `FRIDAY_DATA_MODE`):

| Modus | Bedeutung | Einsatz |
|---|---|---|
| `mock` | Alles simuliert (`@friday/adapter-mock`), offline lauffähig, Dev-Konten nur auf Loopback | Entwicklung, Demo, Tests |
| `hybrid` (**Installer-Standard**) | In `adapters.yaml` genannte Kategorien live, alle anderen `mock-*` (in der Oberfläche als Simulation erkennbar) | Produktivstart, solange nur Hermes/Voice/System angebunden sind |
| `live` | Nur konfigurierte Kategorien aktiv, alle anderen deaktiviert (nicht gemockt); Vorlage `config/adapters.live.example.yaml` | spätere Vollanbindung (Mail, Kalender, …) |

Umstellen: `dataMode` ändern (und bei `live` die Adapterliste vervollständigen), dann den Dienst neu starten. `auth.mode: dev` ist
nur mit `mock` und Loopback erlaubt; der Installer nutzt immer `local`.

## 6. Konfigurationsdateien

- `dashboard.yaml` (Server, Pfade, Auth, UI, Logging; Schema `packages/config`), Vorlage `config/dashboard.hybrid.example.yaml`.
- `adapters.yaml` (Allowlist + Kategorien), Vorlage `config/adapters.hybrid.example.yaml`. Vom Installer erzeugt:

| Kategorie | Provider (`@friday/…`) | Ziel |
|---|---|---|
| `tasks`, `activity`, `agents` | `hermes-*` (`adapter-hermes`) | Hermes-Dashboard `127.0.0.1:43691`, API-Server `127.0.0.1:43693` mit `apiKey: file:C:/Friday/config/hermes_api.key` |
| `voice` | `friday-voice-http` (`adapter-voice-http`) | Voice-Status `127.0.0.1:43694`, Qwen `127.0.0.1:43692`, `wakePhrase` = Wake Word des Assistenten |
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
| Hermes-API-Key | `C:\Friday\config\hermes_api.key` (vom Hermes-Schritt), Referenz `file:C:/Friday/config/hermes_api.key` | ACL: Benutzer RW, SYSTEM R; Control API läuft unter demselben Benutzer |
| Hash des Owner-Passworts | `C:\Friday\config\dashboard_owner.hash`, Referenz `auth.ownerPasswordHash: file:C:/Friday/config/dashboard_owner.hash` | scrypt-Hash (N=2^15, r=8, p=1), `icacls /inheritance:r`, Benutzer RW, SYSTEM R; Passwort selbst wird nirgends gespeichert oder geloggt |
| Server-Schlüssel (CSRF, Approval-Tokens) | `C:\Friday\dashboard\data\auth.key` | von der Control API beim ersten Start mit Rechten nur für den Benutzer angelegt; Verlust macht nur Tokens ungültig |
| Weitere Adapter-Secrets (Mail, Kalender, später) | Windows Credential Manager (`wincred:ZIEL`, PowerShell-Modul `CredentialManager`) oder `env:NAME` | nie als Klartext in Dateien; über die API write-only |

Nach einem erfolgreichen Dashboard-Start und der Friday-Skills-Installation kopiert der Installer das Mail-Leseplugin aus `friday-skills` nach Hermes. Der separate lokale Dienstschlüssel geht nur über stdin nach WSL; die dortigen Dateien haben Modus 0600. Das Plugin darf nur Postfachliste und Nachrichtenvorschau lesen, nicht senden oder löschen. Eine ausdrücklich deaktivierte Hermes-Plugin-Konfiguration wird respektiert. Bei einem Plugin-Fehler bleibt das Dashboard-Postfach verfügbar; nach Behebung erneut `-UpdateDashboard` ausführen. Ein eingerichtetes IMAP/SMTP-Konto ist für echte Postfachdaten weiterhin erforderlich.

Begründung der Ablage des Owner-Hashs als Datei statt als Benutzer-Umgebungsvariable: Eine `User`-Umgebungsvariable ist für **jeden**
Prozess des Benutzers lesbar, wird in Prozessabbildern vererbt und erscheint in Diagnosewerkzeugen; eine Datei mit ACL entspricht dem
bereits genutzten Muster `hermes_api.key` (Review §4.1), und `wincred:` bräuchte ein nicht vorinstalliertes PowerShell-Modul.
Bei der Ersteinrichtung setzt der Nutzer Name, Benutzername und Passwort im lokalen Dashboard. Der Installer speichert nur den Hash und
behält ein bestehendes Konto bei Updates unverändert. Das Passwort lässt sich aus dem Hash nicht wiederherstellen. Für einen lokalen Reset:

PowerShell öffnen und `& "<InstallRoot>\installer\scripts\reset-owner-password.ps1"` ausführen. Das Skript sichert den bisherigen Hash nach `<InstallRoot>\backups\owner-password-<Zeit>`, fragt das neue Passwort verdeckt zweimal ab und trägt den Hash ein; Passwort und Hash erscheinen nirgends. Danach mit dem bisherigen Benutzernamen und dem neuen Passwort anmelden; ein Neustart ist nicht nötig.

Ein erneuter Installerlauf allein setzt ein vergessenes Passwort nicht zurück. Die frühere Anleitung zum Entfernen von `dashboard` aus `install-state.json` trifft auf den aktuellen Installer nicht mehr zu.

## 9. Logs

| Log | Inhalt |
|---|---|
| `C:\Friday\logs\dashboard-install.log` | Schritt 15: winget, corepack, `pnpm install`, `pnpm build:app` (vollständig) |
| `C:\Friday\logs\watchdog.log` | Service-Watchdog: Neustarts, Warnungen, stündlich `Heartbeat` (rotiert bei 1 MB auf `.1`) |
| `C:\Friday\logs\dashboard-service.log` | Start/Ende des Servers, stdout/stderr, Neustarts (rotiert bei 10 MB auf `.1`) |
| `C:\Friday\logs\dashboard\` | JSON-Zeilen der Anwendung (`logging.*` in `dashboard.yaml`, Rotation nach `maxBytes`/`maxFiles`), Secrets werden maskiert |
| `C:\Friday\logs\install-<Zeitstempel>.log` | Transkript des gesamten Installers |

## 10. Fehlersuche

| Symptom | Prüfen / Lösung |
|---|---|
| `http://127.0.0.1:3100` lädt nicht | `Get-ScheduledTask FRIDAY_Dashboard`; `Start-ScheduledTask FRIDAY_Dashboard`; `dashboard-service.log` lesen; im Vordergrund starten (§4) |
| Login schlägt immer fehl | Den bei der Ersteinrichtung gewählten Benutzernamen verwenden; nach mehreren Fehlversuchen gilt `429 Retry-After`. Bei vorhandener Installation den Hashdateipfad in `auth.ownerPasswordHash` prüfen. |
| Start bricht mit Konfigurationsfehler ab | `dashboard-service.log` nennt Datei und Pfad; YAML-Einrückung und Secret-Referenzen prüfen (Credential-Felder müssen `file:`/`env:`/`wincred:` sein) |
| Bereiche zeigen „eingeschränkt“/offline | Adapter einzeln prüfen: Hermes `curl http://127.0.0.1:43693/health`, Voice `http://127.0.0.1:43694`, Qwen `http://127.0.0.1:43692/v1/models`; WSL läuft (`FRIDAY_WSL_Keepalive`)? Das Command Center bleibt für die übrigen Bereiche nutzbar |
| Port 3100 belegt | `Get-NetTCPConnection -LocalPort 3100 -State Listen` → `Get-Process -Id <PID>`; Programm beenden oder `server.port` ändern |
| `pnpm install` scheitert | Internet/Proxy; Eintrag `ERR_PNPM_*` im `dashboard-install.log`; Lockfile unverändert lassen (`--frozen-lockfile`) |
| `node` nicht gefunden | Neue PowerShell öffnen (PATH); `where.exe node`; Node.js ≥ 22.13 (`node --version`) |
| Nach Update veraltete Oberfläche | `apps\web\out` neu gebaut? `update-dashboard.bat`; Browser-Cache leeren |
| Dienst fällt wiederholt aus | `C:\Friday\logs\watchdog.log` (Neustarts, Limit-Warnung), danach das Log des Dienstes; `Get-ScheduledTask FRIDAY_Watchdog`; blitzt ein Fenster auf, ist die Aktion nicht `wscript.exe … hidden.vbs …` |
| Dienst startet nicht nach Anmeldung | Aufgabe hat 60 s Verzögerung; sonst Aufgabenplanung → Verlauf; Launcher-Pfad `C:\Friday\installer\scripts\start-dashboard.ps1` vorhanden? |

## 11. Offene Punkte

- Der Installer lief bisher nur statisch geprüft (Parser, Konventionen); der Lauf auf einem echten Windows-11-Rechner steht aus
  (winget/Node, corepack, `pnpm install` unter Windows, Task-Start, Healthcheck).
- Dienstbetrieb als Windows-Dienst (statt Aufgabe bei Anmeldung) ist nicht vorgesehen: die Control API braucht den
  Benutzerkontext (Lesezugriff auf `hermes_api.key`, Interaktivität von WSL).
- Ein eigener Port außerhalb von 3100 wird von Installer und Launcher aus `dashboard.yaml` gelesen; die Umgebungsvariable `FRIDAY_PORT`
  wird dabei nicht berücksichtigt.

## 12. Übernahme einer bestehenden Installation (C:\Jarvis → C:\Friday)

Die frühere Version des Installers (J.A.R.V.I.S.) arbeitete in `C:\Jarvis` mit Aufgaben `JARVIS_*`. Der Installer dieser Version
(`install-friday.bat`, Wurzel `C:\Friday`, Aufgaben `FRIDAY_*`) bietet beim Start eine **Migration** an, wenn
`C:\Jarvis\config\install-state.json` existiert und `C:\Friday` noch nicht. Ist `C:\Friday` schon da (frische oder bereits
übernommene Installation), wird nichts angeboten.

Frage: *„Bestehende Installation nach C:\Friday übernehmen? (j/n)“*, Standard **ja**. Der Fortschritt steht in
`C:\Jarvis\migrate-to-friday.json` (Schlüssel je Phase, jede Phase ist wiederholbar); Protokoll `C:\Jarvis\logs\migrate-to-friday-<Zeit>.log`.

| Phase | Was passiert | Wiederholbar weil |
|---|---|---|
| `stop` | Marker `C:\Jarvis\run\installer.active` setzen; alte `JARVIS_Watchdog` deaktivieren und stoppen (sonst startet sie Dienste neu); dann mit den **alten** Namen/Mustern `Stop-LauncherService` für `JARVIS_Voice` (`start-jarvis-voice.ps1`, `*jarvis_voice.py*`), `JARVIS_Qwen` (`*llama-server*--port 43692*`), `JARVIS_Dashboard` (`start-dashboard.ps1`, `*control-api*dist*main.js*`): Stop-Flag in `C:\Jarvis\run\`, Launcher-`powershell` und Kindprozesse beenden. Es werden nur Prozesse beendet, deren Befehlszeile `C:\Jarvis\` nennt | beendet nur, was noch läuft |
| `copy` | Freien Platz prüfen (Größe × 1,1 + 2 GB), dann `robocopy C:\Jarvis C:\Friday /E /XJ` ohne `run`, `installer`, `dashboard`, `cache\pip`, `migration-tasks`. Vom Command Center nur `dashboard\config`, `data`, `backups` (Programm, `node_modules` und Build werden in Schritt 15 neu aufgebaut; pnpm-Junctions würden sonst aufgelöst und die Build-Pfade stimmen nicht mehr). `voice\jarvis_voice.py` wird aus der Kopie entfernt | robocopy kopiert inkrementell; Exitcode ≥ 8 bricht ab |
| `rewrite` | In `config\`, `windows-worker\`, `dashboard\config\`, `models\openwakeword\*.json`, `voice\*.json`, `INSTALL_STATE.md` (nur `.json .yaml .yml .md .txt .ps1 .cfg .ini`) werden `C:\Jarvis`, `C:\\Jarvis` (JSON-escaped), `C:/Jarvis` und `/mnt/c/Jarvis` auf `Friday` umgestellt (BOM bleibt, JSON wird vor dem Schreiben geparst, `C:\JarvisOld` bleibt unberührt). In `dashboard.yaml`/`adapters.yaml` zusätzlich `@jarvis/` → `@friday/`, `jarvis-voice-http`, `jarvis-command-midnight`, `jarvis-command-overview`. ACLs von `hermes_api.key`, `dashboard_owner.hash`, `data\auth.key` werden neu gesetzt (robocopy übernimmt sie nicht). In `install-state.json` werden `files`, `voiceservice`, `dashboard`, `watchdog` aus `done` entfernt (werden neu ausgeführt), `dashboard_hash`/`dashboard_pnpm` gelöscht, `migrated_from`/`migrated_at` gesetzt. Die kopierte `voice\.venv` wird per Import-Test geprüft; scheitert er, fliegt auch `voicepython` aus `done` (Schritt 12 baut neu) | Umschreiben ist idempotent |
| `tasks` | `Get-ScheduledTask` nach `JARVIS_*` oder Aktionen mit `C:\Jarvis`. **Eigene** (Name in der Liste `JARVIS_Watchdog/Voice/Qwen/Dashboard/WSL_Keepalive/Installation_fortsetzen` **und** Aktion unter `C:\Jarvis\installer\`) werden per `Export-ScheduledTask` nach `C:\Jarvis\migration-tasks\*.xml` gesichert und entfernt. **Fremde** Aufgaben (z. B. `JARVIS_Voice_Watchdog` eines älteren Installers) werden nie gelöscht. Nennt ihre Aktion `C:\Jarvis` oder `/mnt/c/Jarvis`, werden sie mit Aktion aufgelistet und (Frage, Standard ja) nach XML-Sicherung `migration-tasks\foreign-*.xml` per `Disable-ScheduledTask` **deaktiviert**; danach werden die alten Dienste erneut angehalten. Die deaktivierten Namen stehen als Enable-Befehl in `migrate-to-friday.json` (`disabled`) und im Abschlusstext. Ein TTS-Server auf Port 43695 wird nicht migriert. Übrige Aufgaben werden nur aufgelistet. `FRIDAY_WSL_Keepalive` und `FRIDAY_Qwen` werden direkt registriert (deren Schritte laufen nicht erneut), `FRIDAY_Voice`/`FRIDAY_Dashboard`/`FRIDAY_Watchdog` entstehen in den Schritten 14/15/Zusatz | Sicherung überschreibt, Entfernen nur wenn vorhanden |
| `wsl` | Nach Schritt 2 (die Skripte liegen dann in `C:\Friday\installer`): `wsl\migrate_paths.sh` als Linux-Benutzer: `~/jarvis` → `~/friday`, `/mnt/c/Jarvis` → `/mnt/c/Friday` in `~/.hermes/config.yaml`, `~/.hermes/.env`, `~/.config/systemd/user/*.service` (Sicherung nach `~/friday/backups`), `API_SERVER_MODEL_NAME=friday`, `SOUL.md` neu aus `persona.json`, `systemctl --user restart hermes-gateway hermes-dashboard`, Prüfung Dashboard (43691) und API (43693) = 200. Danach `FRIDAY_WSL_Keepalive` und `FRIDAY_Qwen` starten | Skript ist idempotent; Marker erst nach `MIGRATE_WSL_DONE` |

Am Ende des Installers meldet `Show-MigrationSummary`: `C:\Jarvis` bleibt als Sicherung (unverändert bis auf `migrate-to-friday.json`,
`logs\migrate-to-friday-*.log`, `migration-tasks\` und den kurzzeitigen Marker `run\installer.active`), die Liste der **nicht angefassten**
JARVIS-Aufgaben (zeigen weiter auf `C:\Jarvis`), und den Befehl zum Löschen nach erfolgreicher Prüfung:
`Remove-Item -Recurse -Force C:\Jarvis` (PowerShell als Administrator; vorher `migration-tasks` wegkopieren, falls gewünscht).

**Ablehnen:** Der Installer richtet F.R.I.D.A.Y. frisch in `C:\Friday` ein. Auf Wunsch (Standard ja) werden die alten Dienste angehalten
und ihre Aufgaben (sowie fremde Aufgaben mit Aktion unter `C:\Jarvis`, nach eigener Rückfrage und XML-Sicherung) **deaktiviert** (nicht gelöscht; `Enable-ScheduledTask JARVIS_<Name>` macht es rückgängig), weil sie dieselben Ports
(43691–43694, 3100) belegen würden.

**Grenzen:** Der Inhalt der SQLite-Datenbank des Command Centers (`dashboard\data`) wird nicht umgeschrieben; Pfade stehen dort nicht
als Konfiguration, sondern kommen aus `dashboard.yaml`. In den Daten gespeicherte Theme-/Layout-Kennungen der früheren Version
(`jarvis-command-*`) folgen den Umbenennungen der Anwendung. Andere Hermes-Dateien mit altem Pfad (eigene Skills, Notizen) meldet
`migrate_paths.sh` nur. Nur unter Windows prüfbar: alle Phasen (Aufgaben, robocopy, Prozess-Beenden, Venv nach dem Kopieren,
WSL-Umstellung).
