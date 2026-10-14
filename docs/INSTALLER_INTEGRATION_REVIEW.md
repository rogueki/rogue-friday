# Installer- und Integrations-Review (Phase B, Abschluss)

Stand: 2026-10-14. Umfang: `installer/` (Windows 11, PowerShell 5.1, WSL2), die Anbindung von Hermes, Voice-Dienst und lokalem Qwen
an das F.R.I.D.A.Y. Command Center sowie der Dashboard-Schritt 15. Abschlussdokument von Phase B („Installer + Hermes + Dashboard als
Gesamtpaket“).

Die Cloud-VM ist Linux. Der Installer lief dort **nicht**. Jede Aussage ist deshalb einer der Kategorien zugeordnet:

- **PASS**: statisch am Code belegt, oder in dieser VM ausgeführt und grün.
- **FAIL**: Fehler oder Risiko, am Code belegt. Der Eintrag nennt, ob er behoben ist (Commit) oder offen bleibt.
- **BLOCKED**: nur auf echtem Windows 11 bzw. mit echten Diensten prüfbar, oder der Zugriff ist durch den Cloud-Proxy gesperrt.
- **Annahme (unbelegt)**: nicht geprüft und nicht als Fakt verwendet.

Kürzel: `PS` = `installer/install-jarvis.ps1`, `SR` = `installer/wsl/setup_root.sh`, `SH` = `installer/wsl/setup_hermes.sh`,
`SQ` = `installer/scripts/start-qwen-server.ps1`, `SV` = `installer/scripts/start-jarvis-voice.ps1`, `SD` = `installer/scripts/start-dashboard.ps1`,
`JV` = `installer/voice/jarvis_voice.py`, `VS` = `installer/voice/voice_setup.py`. Zeilenangaben beziehen sich auf den Stand dieses
Dokuments (nach dem Dashboard-Schritt 15, Commit `89b3b6c`). Der Entwurf vom 2026-10-14 hatte teils veraltete Zeilen.

Dieses Dokument wurde ohne Code-Änderung und ohne Commit erstellt (Schreibbereich: nur diese Datei). Alle vorgeschlagenen Fixes sind
offen und als solche markiert.

---

## 1. Zusammenfassung

**Ziel:** Ein frischer Windows-11-PC läuft mit `installer/install-jarvis.bat` durch. Danach zeigt das F.R.I.D.A.Y. Command Center echte
Daten von Hermes, vom Voice-Dienst und vom lokalen Qwen.

**Stand:**

- Der Installer ist vollständig implementiert: Schritte 0 (Assistentenname) bis 15 (Command Center). Die Schritte sind statisch geprüft,
  alle gefundenen Befunde mit Schwere >= mittel sind behoben oder benannt. Der PowerShell-Parser (PS 7.4.6) meldet für alle vier
  `.ps1`-Dateien 0 Fehler. ShellCheck (Stil) meldet für beide WSL-Skripte 0 Befunde.
- Die echten Adapter (Hermes, Voice-HTTP, System-lokal) sind gegen Fake-Upstreams getestet: Conformance grün (422 bestanden,
  0 fehlgeschlagen). Der Integrations-Lauf ist **grün**: 7 von 7 Szenarien in zwei aufeinanderfolgenden Läufen (Normalbetrieb
  Übersicht/Aufgaben/Agenten/Sprache/System, Ausfall + Wiederherstellung Voice, Ausfall + Wiederherstellung Hermes; A-02, I-41).
- Hermes ist in der VM live (Installation, API-Server mit Installer-Variablen, Dashboard auf 43691), aber mit einem **Fake-LLM**.
  Ein echter Kimi-K3-Lauf ist nicht erfolgt.
- Das Wake Word „Hey Friday“ (persönliches Modell) ist nur durch Unit-Tests belegt (12/12). Die synthetische Qualitätsmessung ist in
  der Cloud nicht ausführbar, und es gibt keine echte Stimmaufnahme.

**Gesamtbewertung: nicht abnahmefähig für den Endnutzer, aber für den ersten echten Windows-Test bereit.**
Der Code ist so weit verdrahtet, dass ein Test auf einem frischen PC sinnvoll ist. Die Installation selbst ist nicht geprüft, und
vier Punkte sind vor einem Test zu entscheiden oder zu beheben:

1. Die Stop-Logik des Sprachdienstes greift nicht so, wie die Testanleitung es voraussetzt (I-32). Ohne diese Korrektur ist der
   Ausfall-Test des Sprachdienstes nicht aussagekräftig und ein Neustart kann zu zwei Instanzen führen.
2. Die gesprochene Begrüßung am Ende von Schritt 14 sagt „JARVIS ist installiert“ (I-35). Das widerspricht dem Branding und der Anleitung.
3. Ein Paket-Update aktualisiert den laufenden Sprachdienst nicht (I-31).
4. Der Integrations-Test für den Sprachausfall ist gegen den aktuellen Web-Text veraltet, und der Lauf ist nicht grün (I-41).
   Vor einem Abnahmelauf muss `pnpm test:integration` vollständig grün sein.

Die Wake-Word-Qualität mit echter Stimme und ein echter Kimi-Lauf sind die größten offenen Unbekannten (siehe Abschnitt 4).

---

## 2. Befunde

### 2.1 Installer, statisch (I-01 bis I-40)

Prüfwerkzeuge in dieser Session:

| Prüfung | Ergebnis |
| --- | --- |
| PowerShell-Parser, PS 7.4.6 (Linux, in dieser Session neu ausgeführt) | `install-jarvis.ps1`, `start-dashboard.ps1`, `start-jarvis-voice.ps1`, `start-qwen-server.ps1`: **0 Parserfehler** |
| PS-5.1-Kompatibilität (Ternary, `??`, `?.`, `&&`/`\|\|`, `-Parallel`) | Ergebnis des Entwurfs übernommen (0 Treffer), in dieser Session nicht erneut geprüft |
| PSScriptAnalyzer | BLOCKED (PowerShell Gallery per Proxy gesperrt). Ersatz: manuelle Durchsicht |
| `bash -n wsl/*.sh` | beide OK (in dieser Session neu) |
| `shellcheck -S style wsl/*.sh` | **0 Befunde**, Version **0.11.0** (Entwurf: 0.9.0) |
| `python3 -m pyflakes voice common` (in dieser Session neu, Venv mit pyflakes) | **1 Befund**: `voice/tests/test_personal_wake.py:29` importiert `sklearn` ungenutzt (I-38). Der Entwurf meldete „keine“ |
| `ast.parse` aller `voice/*.py`, `common/*.py` | alle OK |
| Zeilenenden/BOM | `.ps1`/`.bat`/`.vbs` CRLF (0 LF-only-Zeilen), `.ps1` mit UTF-8-BOM (`EF BB BF`), `.sh` ohne CR |

| ID | Bereich | Datei:Zeile (aktuell) | Befund | Bewertung | Fix / Commit |
| --- | --- | --- | --- | --- | --- |
| I-01 | Elevation | `install-jarvis.bat:10`, `PS:32-41` | Admin-Prüfung und Neustart per `-Verb RunAs`. Falls ein **anderes** Admin-Konto bestätigt wird, gelten Aufgaben und ACLs für dieses Konto, nicht für den angemeldeten Nutzer | PASS (Hinweis) | – (ANLEITUNG verlangt Administrator-Konto) |
| I-02 | robocopy Schritt 2 | `PS:257-258` | Exitcode >= 8 wurde ignoriert | PASS (behoben) | `c3ede6d`: `LASTEXITCODE -ge 8` -> `Stop-Install` |
| I-03 | Dateisync bei Neustart | `PS:254-262` | Schritt 2 lief nur einmal; neue Dateien erreichten bestehende Installationen nicht | PASS (behoben für `C:\Jarvis\installer`) | `c3ede6d`: Sync bei jedem Start, solange `$PSScriptRoot -ne $Inst`. **Restlücke: I-31** |
| I-04 | nvidia-smi | `PS:229-242` | Fehlertext älterer Treiber (ohne `compute_cap`) wurde als GPU-Zeile geparst | PASS (behoben) | `c3ede6d`: Zeilenvalidierung, Zweitabfrage, `cc = 0` -> CUDA-12.4 |
| I-05 | Python-Launcher | `PS:474-483` | `$LASTEXITCODE` ohne `py.exe` veraltet, `winget` wurde übersprungen | PASS (behoben) | `c3ede6d`: `Get-Command py.exe` vor dem Aufruf |
| I-06 | llama.cpp-ZIP | `PS:446-447` | Defektes ZIP blieb im Cache, `curl -C -` setzte darauf auf | PASS (behoben) | `c3ede6d`: `Remove-Item` vor `Stop-Install`. **Hinweis:** Die Prüfsumme wird nur verglichen, wenn die GitHub-API ein `digest` liefert (`if ($a.digest -and …)`). Sonst keine Prüfung (siehe I-22) |
| I-07 | ACL `hermes_api.key` | `PS:407-415` | ACL nur bei Neuanlage, Exitcode nicht geprüft | PASS (behoben) | `c3ede6d`: leere Datei anlegen, ACL setzen (Exitcode geprüft), erst dann Schlüssel schreiben |
| I-08 | Linux-Passwort | `SR:6` | `read -r PW` entfernte führende/abschließende Leerzeichen | PASS (behoben) | `c3ede6d`: `IFS= read -r PW` |
| I-09 | Hermes-Prüfung | `SH:32`, `SH:101`, `SH:106` | Unter `set -e` brach `curl -w` bei „Verbindung abgelehnt“ ohne FAIL-Zeile ab; `mkdir -p ~/.hermes` fehlte | PASS (behoben) | `c3ede6d`: `\|\| true`, `mkdir -p "$H"`, `if/else`. ShellCheck 0 |
| I-10 | Resume-Zustand | `PS:110-115` (`Save-State` `PS:113`) | `install-state.json` wird mit `Set-Content` direkt überschrieben, nicht atomar. Eine abgeschnittene Datei lässt `ConvertFrom-Json` fehlschlagen, der Lauf beginnt leer und überschreibt sie | FAIL (niedrig, offen) | Vorgeschlagen: in `.tmp` schreiben, `Move-Item -Force`; Ladefehler abfangen und Datei als `.corrupt` sichern |
| I-11 | Reboot bei fehlendem WSL | `PS:273-291`, `PS:149-151` | `wsl --install --no-distribution`, Task `JARVIS_Installation_fortsetzen` (RunLevel Highest), Neustart nach Rückfrage. Der Task wird beim nächsten Start gelöscht. Das Verhalten von `wsl --status` bei teilweise aktivierten Features ist statisch nicht prüfbar | BLOCKED | – (Test auf Windows 11 mit und ohne WSL) |
| I-12 | Fehlerbehandlung | `PS:14`, `Stop-Install` `PS:54-58` | `ErrorActionPreference = 'Continue'` mit expliziten Prüfungen. Kritische Pfade prüfen ihr Ergebnis | PASS | – |
| I-13 | Linux-Passwort | `PS:365-371`, `SR:5-8`, `SR:20` | Passwort per `Read-Host -AsSecureString` über stdin, `unset PW`, nie auf Platte. BOM/CR entfernt. Linux-Benutzername validiert (`^[a-z_][a-z0-9_-]{0,31}$`) | PASS | – |
| I-14 | Kimi-Key | `PS:396-404`, `SH:6-9`, `SH:57`, `SH:103`, `SH:106` | Key über stdin an `setup_hermes.sh`, nach `~/.hermes/.env` (chmod 600). `SH` übergibt den Hermes-API-Schlüssel an `curl -H` (in `ps` innerhalb WSL sichtbar, nur für den eigenen Benutzer) | PASS | – (optional `curl -H @datei`) |
| I-15 | Aufgaben | `PS:142-147` (`Register-UserTask`), `PS:389`, `PS:466`, `PS:542`, `PS:965` | Registrierung korrekt: AtLogOn des Installationsbenutzers, Limited, ohne Zeitlimit, `IgnoreNew`, Voice 45 s, Dashboard 60 s. Aufgaben starten nur bei **Anmeldung**, nicht beim Systemstart. Das Stoppverhalten ist in I-32 erfasst | PASS (Registrierung) |  – |
| I-16 | Keepalive | `scripts/wsl-keepalive.vbs:3-6` | WMI-Abfrage verhindert Doppelstart, `wsl.exe` verborgen gestartet | PASS | – |
| I-17 | Qwen-Prozess | `SQ:16-17`, `PS:466` | `llama-server.exe` wird per `Start-Process` gestartet. Ob es nach Ende der Aufgabeninstanz weiterläuft, ist statisch nicht prüfbar. Kein Neustart bei Absturz (Voice fällt auf `kimi_low`/Kimi zurück) | BLOCKED | Vorgeschlagen: nach Anmeldung `Get-NetTCPConnection -LocalPort 43692` prüfen; Überwachungsschleife wie `SV` |
| I-18 | Einzelinstanz Voice | `SV:10` | Die Prüfung über den Health-Port versagt, solange der Port beim Modellladen (bis ca. 3 min) geschlossen ist. Ein zweiter Start dann erzeugt eine zweite Instanz. Verschärft durch I-32 | FAIL (niedrig, offen) | Vorgeschlagen: benannter Mutex oder Prozessprüfung (`Win32_Process` mit `jarvis_voice.py`) |
| I-19 | Quoting `cmd /c` | `SV:22` | `cmd.exe /c "…"` funktioniert, weil `C:\Jarvis` keine Leerzeichen hat | PASS | – (nicht ändern, solange Pfade fest sind) |
| I-20 | Klartext-Transkripte | `SV:18-24`, `JV:472`, `JV:489`, `JV:500` | `voice-service.log` enthält Transkripte (`> text`) und Antworten (`< text`) im Klartext, ohne Rotation. Auch `voice.jsonl` und `qwen-server.log` wachsen unbegrenzt | FAIL (niedrig, offen) | Vorgeschlagen: Größenlimit/Rotation; Dashboard darf diese Logs nie spiegeln |
| I-21 | Log-Encoding | `PS:491`, `PS:493` | `Out-File -Append` ohne `-Encoding` schreibt in PS 5.1 UTF-16LE in `pip.log`. Der Rest ist UTF-8 | FAIL (niedrig, offen) | Vorgeschlagen: `-Encoding utf8` |
| I-22 | Nicht gepinnt | `PS:433` (llama.cpp „neueste Release“), `PS:454` (Qwen `resolve/main`), `PS:492-493` (pip ohne Versionen außer `nvidia-cudnn-cu12==9.*`), `SH:25-26` (`hermes-agent.nousresearch.com/install.sh \| bash`) | Keine Version, keine Prüfsumme für Hermes. Qwen-GGUF per Hash geprüft (`PS:455`), aber von `main` geladen. llama.cpp-Prüfsumme nur bei verfügbarem `digest` | FAIL (Risiko, offen) | Vorgeschlagen: llama.cpp-Tag, Hermes-Commit, `requirements` mit Hashes, HF-Revision fixieren |
| I-23 | Bestehende Distro | `SR:18` (`useradd -G sudo` nur bei Neuanlage), `SR:23` (`cat > /etc/wsl.conf` überschreibt vollständig) | Ein vorhandener Benutzer bekommt kein `sudo`, `/etc/wsl.conf` wird ohne Sicherung ersetzt, Passwort wird gesetzt | FAIL (Risiko, offen) | Vorgeschlagen: `/etc/wsl.conf` sichern, `usermod -aG sudo "$U"`, Warnhinweis in der Rückfrage (`PS:362-368`) |
| I-24 | systemd-User-Bus | `SH:69-72`, `SH:92-93`, `SR:39` (Linger) | `systemctl --user` nach Keepalive ohne Warten auf `/run/user/<uid>/bus` | BLOCKED | Vorgeschlagen: Schleife bis Bus existiert (max. 30 s) vor „Gateway als Dienst“ |
| I-25 | Zone-Identifier | `PS:257-260` (robocopy) | Aus dem Internet geladene Dateien können Zone.Identifier tragen. Im Installer gibt es kein `Unblock-File` | BLOCKED (offen) | Vorgeschlagen: `Get-ChildItem $Inst -Recurse \| Unblock-File` nach dem Kopieren |
| I-26 | `.wslconfig` | `PS:332-338` | Vollständig überschrieben, Backup in `C:\Jarvis\backups`. `networkingMode=mirrored` nur ab Build 22621 (`PS:335`); darunter Warnung (`PS:336`) | PASS | – |
| I-27 | Energieoptionen | `PS:294-302` | Ändern den aktiven Plan dauerhaft; in `ANLEITUNG.md` dokumentiert, keine Wiederherstellung bei Deinstallation | PASS | – (Deinstallation ergänzen) |
| I-28 | Voice-Code, Sichtprüfung | `JV:1-6`, `JV:138` | Der Entwurfsbefund „Docstring nennt Qwen3-8B“ ist **nicht mehr zutreffend** (Docstring geändert, kein 8B im Installer). Verbleibend: `JV:138` nennt einen Qwen3-TTS-Server, der mit `tts_url: null` (`VS`) nie aktiv ist | PASS | – |
| I-29 | Hermes-Modellname | `JV:437` (Code-Default `kira`), `PS`/`VS:126` (`hermes_model: jarvis`), `SH:59` | Der Entwurf nannte `docs/MAPPING/hermes.md`. Die Drift steht korrekt in `docs/MAPPING/voice.md` §0.2. Wirkung: keine, solange `voice.json` gesetzt ist | FAIL (niedrig, Code-Default offen) | Vorgeschlagen: Default in `JV:437` auf `jarvis` setzen |
| I-30 | Deinstallation und Autostart | `ANLEITUNG.md:153`, `PS:1005` | Vier Aufgaben (`JARVIS_Voice`, `JARVIS_Qwen`, `JARVIS_WSL_Keepalive`, `JARVIS_Dashboard`) in ANLEITUNG und Abschlussbericht, `DEPLOYMENT.md` §4 | PASS (aktualisiert) | `89b3b6c` |
| I-31 | Update des Sprachdienstes | `PS:484` (`Copy-Item "$Inst\voice\*" "$Root\voice\"`, nur in Schritt 12, Aufruf `voice_setup.py` in `PS:496`) | `C:\Jarvis\voice` (von `SV:4-5` ausgeführt) wird **nur in Schritt 12** aktualisiert. Ein neues Paket mit geändertem `jarvis_voice.py` erreicht eine bestehende Installation nicht, solange `voicepython` in `done` steht. `update-dashboard.bat` deckt das nicht ab. I-03 hat nur `C:\Jarvis\installer` synchronisiert | behoben: `Sync-VoiceFiles` vergleicht bei jedem Start die SHA256 je Datei von `installer\voice` und `C:\Jarvis\voice`, kopiert Geändertes (ohne `profiles`, `models`, `.venv`) und startet den Sprachdienst neu, falls er lief. Nur unter Windows prüfbar | Vorgeschlagen: Voice-Dateien bei jedem Start synchronisieren (ohne `profiles`, `models`, `.venv`), oder `ANLEITUNG` um „`voicepython` aus `done` entfernen“ ergänzen |
| I-32 | Stop/Neustart des Sprachdienstes | `PS:542-547`, `scripts/hidden.vbs:3` | `hidden.vbs` startet PowerShell mit `Run(…, 0, False)`. `wscript` endet daher sofort, und die Neustartschleife von `SV` läuft als eigenständiger Prozess weiter. `Stop-ScheduledTask 'JARVIS_Voice'` (`PS:544`) beendet sie voraussichtlich nicht. `PS:545-546` beendet nur `python.exe`; die Schleife startet Python nach 10 s neu. `PS:547` startet dann eine zweite Schleife, wenn der Port in dieser Zeit frei ist. Der Dashboard-Launcher hat dafür `Stop-DashboardService` (`PS:716-724`), Voice nicht. Dasselbe gilt für den Testablauf „Sprachdienst-Task stoppen“ in ANLEITUNG und in Abschnitt 5 | behoben: Launcher halten einen benannten Mutex (Einzelinstanz) und prüfen eine Stop-Flag-Datei `C:\Jarvis\run\<Skript>.stop`; `Stop-LauncherService` (Schritt 14, `Sync-VoiceFiles`, `Stop-DashboardService`) setzt das Flag, beendet Schleife (powershell) und Kindprozess per CommandLine. Qwen-Launcher prüft zusätzlich `llama-server.exe` auf Port 43692. Nur unter Windows prüfbar | Vorgeschlagen: `SV`-Prozess per CommandLine stoppen (wie `SD`), dann Python; Testanleitung entsprechend ändern |
| I-33 | Abbruch in Schritt 15 | `PS:57` (`exit 1`), `PS:911`, `PS:913`, `PS:938`, `PS:940`, `PS:944`, `PS:945`, `PS:890` (Aufrufe von `Stop-Install` innerhalb `Install-Dashboard`) | `Stop-Install` beendet den **gesamten** Installer. Der Kommentar `PS:562` verspricht „ein Fehler hier lässt Sprache/Hermes/Qwen unangetastet“. Das stimmt für laufende Dienste, aber der Abschlussbericht `INSTALL_STATE.md` (`PS:1008`) und die Schlussmeldung (`PS:1010`) entfallen, und der Benutzer sieht „Enter zum Beenden“ statt „FERTIG“ | behoben: Fehler in Schritt 15 lösen `Stop-Dashboard` (Ausnahme) aus, die der Aufrufer fängt: Fehlerblock, Logpfad, `dashboard` bleibt offen, Rerun-Hinweis (`update-dashboard.bat` / `install-jarvis.bat -Resume`); Abschlussbericht und Schlussmeldung erscheinen, der Bericht nennt das Command Center als nicht eingerichtet | Vorgeschlagen: in `Install-Dashboard` `return` statt `Stop-Install` (wie `PS:963`, `PS:974`), oder Bericht vor Schritt 15 schreiben |
| I-34 | Log-Rotation Command Center | `SD:31` (Rotation nur bei Schleifenstart), `SD:42` | Die Rotation von `dashboard-service.log` bei 10 MB läuft nur zwischen zwei Neustarts des Servers. Während der Server läuft, wächst die Datei ungebremst | behoben: `start-dashboard.ps1` leitet die Ausgabe von node zeilenweise durch `Write-AppLog` (kein cmd-Redirect mehr); alle 30 s Größenprüfung, Rotation bei 10 MB nach `.log.1` auch während der Server läuft. Nur unter Windows prüfbar | Vorgeschlagen: Rotation im Schreibpfad oder über das Logging der Anwendung |
| I-35 | Begrüßung nach Installation | `voice/say_hello.py:14` (Standard `„Guten Tag. JARVIS ist installiert …“`), `PS:555` (ruft ohne Text auf), `ANLEITUNG.md:47` („begrüßt dich dein Assistent“) | Die gesprochene Begrüßung einer Friday-Installation sagt „JARVIS“. Die Anleitung beschreibt das Gegenteil. Der Entwurf des Installers hat das nicht erkannt | behoben: Schritt 14 übergibt `Guten Tag. <Name> ist installiert und bereit.` an `say_hello.py`; der Standardtext dort nutzt `assistant_name` aus `voice.json`, sonst neutral („Der Assistent“) | Vorgeschlagen: `PS:555` übergibt `"Guten Tag. $AN ist installiert und einsatzbereit."` als zweites Argument. Ein Standard in `say_hello.py` auf den Namen aus `persona.json` umstellen |
| I-36 | Rückmeldung Schritt 14 | `PS:540-557` (keine `Ok`-Zeile), `PS:555` (`2>$null`) | Erfolg von Schritt 14 zeigt sich nur an der gesprochenen Begrüßung. Fehler der Begrüßung (Audio, Piper) sind unsichtbar | behoben: `[OK] <Name> antwortet auf dem Sprachport (state=listening).`; Ausgabe der Begrüßung (stderr inklusive) wird nach `C:\Jarvis\logs\say-hello.log` geschrieben, Fehler erscheinen als Warn mit Logpfad | Vorgeschlagen: `Ok "$AN antwortet auf dem Sprachport (state=listening)."` nach `PS:554` |
| I-37 | Dokumentation Kimi-Key | `ANLEITUNG.md:19` (`install-kira.bat`), `PS:398-399` | `install-kira.bat` liegt **nicht** im Repo (extern, laut ANLEITUNG „separat“). Die Anleitung sagt „erkennt den Schlüssel automatisch“, der Installer fragt aber nach („Verwenden? (j/n)“) | behoben: `ANLEITUNG.md` verweist nicht mehr auf `install-kira.bat`; beschreibt `KIMI_API_KEY`-Erkennung mit Rückfrage und die Eingabe | Anleitung korrigieren: „erkennt … und fragt zur Bestätigung“ |
| I-38 | Tests Voice | `voice/tests/test_personal_wake.py:29` | `sklearn` importiert, nicht genutzt (pyflakes). Die 12 Tests laufen | behoben: Import durch `importlib.util.find_spec("sklearn")` ersetzt; pyflakes ohne Meldung | Import entfernen |
| I-39 | Owner-Passwort-Hash | `PS:885`, `packages/auth/src/cli/hash-password.ts:45-50`, `packages/auth/src/password.ts:35` | Passwort über stdin an `pnpm --filter @jarvis/auth hash-password`. Die CLI liest stdin, wenn kein TTY vorhanden ist. Das Ausgabeformat `scrypt$N$r$p$…` passt zum Regex in `PS:888` | PASS (statisch); Windows-Lauf (`pnpm.cmd` mit Pipe) BLOCKED | – |
| I-40 | Dokumentation Evidence | `docs/evidence/integration/README.md` (Tabelle, Zeile 1), Route | Der Nachweis nennt `/overview`. Die Übersicht ist tatsächlich `/` (`apps/web/src/features/shell/navModel.tsx:58`) | PASS (behoben 2026-10-14: Route `/`, API `GET /api/v1/overview`) | `/overview` -> `/` |

Ergänzend ohne Befund: PS-5.1-Quoting der `Start-Process`/`&`-Aufrufe (Pfade ohne Leerzeichen in `C:\Jarvis`), Ports nur auf `127.0.0.1`,
Hash-Datei und `hermes_api.key` nur mit ACL für Installationsbenutzer und SYSTEM.

### 2.2 Hermes (Live in der VM mit Fake-LLM, Quellcode `0e427d7`)

Quelle der Wahrheit: `docs/MAPPING/hermes.md`. Die Tabelle fasst den Stand zusammen, Details dort.

| ID | Prüfung | Ergebnis | Bewertung | Beleg |
| --- | --- | --- | --- | --- |
| H-01 | Installation, API-Server mit Installer-Variablen (`API_SERVER_*`, Modell `jarvis`), Dashboard mit Installer-Aufruf (`hermes dashboard --host 127.0.0.1 --port 43691 --no-open --skip-build`) | Live: `GET /v1/models` mit Bearer -> `jarvis`; ohne Auth nur `/health`. Dashboard auf 43691 | PASS (mit Fake-LLM) | `hermes.md` §1, §3 |
| H-02 | Docs-Seite und offizielles `install.sh` | `hermes-agent.nousresearch.com` liefert HTTP 403 (Proxy). Ob das gesperrte `install.sh` mit `scripts/install.sh` im Repo identisch ist, ist nicht belegt. In dieser Session erneut geprüft: `install.sh` nicht erreichbar (HTTP 000) | BLOCKED | `hermes.md` §1, §9 |
| H-03 | Echter Kimi-Lauf (`kimi-coding`, `k3`) | Nicht erfolgt. Kein Key, Provider-Pfad scheiterte ohne Paket. Der Installer warnt nur („Kimi-Test nicht bestanden“, `PS:420`) | BLOCKED | `hermes.md` §9.8 |
| H-04 | Dashboard-Token | Live: `X-Hermes-Session-Token` oder Bearer, Token im HTML als `window.__HERMES_SESSION_TOKEN__`, nur bei Loopback. Der Adapter liest ihn per HTML-Scrape (`dashboardAuth: scrape`) | PASS, aber Risiko (Abschnitt 4) | `hermes.md` §4.2; `adapters/hermes/README.md` |
| H-05 | Nicht belegte Aktionen | `tasks.cancel/retry/pause/resume`, `agents.pause/resume/stop/assignTask`: nicht als Capability deklariert, Schaltflächen bleiben gesperrt | PASS (ehrlich deklariert) | `adapters/hermes/README.md`, „Capabilities“ |
| H-06 | Versionspinning | Installer pinnt Hermes nicht (`install.sh` aus `main`, `SH:25-26`). Abweichungen erscheinen als `VALIDATION_FAILED` | FAIL (Risiko, offen) | `HANDOFF.md` §3 |
| H-07 | Kanban-Befehle des Installers | `hermes kanban init`, `hermes kanban boards create <slug> --name <Name>`, `hermes kanban boards list` live verifiziert | PASS | `hermes.md`, Zeile 215 |
| H-08 | Gateway-Neustart nach `.env`-Änderung | Im Test nur einmal gestartet | BLOCKED (offen) | `hermes.md` §9.11 |

### 2.3 Echte Adapter, Conformance, Integrations-Nachweis

| ID | Prüfung | Ergebnis | Bewertung |
| --- | --- | --- | --- |
| A-01 | `pnpm test:conformance` (in dieser Session ausgeführt) | 10 von 10 Testdateien bestanden, **422 Tests bestanden, 60 übersprungen, 0 fehlgeschlagen** (Adapter: `hermes`, `voice-http`, `system-local`, `mock`, Platzhalter, `example-http`) | PASS |
| A-02 | `pnpm test:integration` (Playwright, Fake-Upstreams auf Installer-Ports, gebaute Control API im Hybrid-Modus, in dieser Session ausgeführt) | **7 von 7 bestanden, zweimal hintereinander (3,5 und 3,3 min).** Die frühere Fassung (9 Tests im Serial-Modus) brach nach dem veralteten Test 6 ab, weil Playwright im Serial-Modus alle Folgetests überspringt. Jetzt ist jedes Ausfall-Szenario ein eigenständiger Test (Ausfall + Wiederherstellung, Neustart im `finally`), und die Assertions prüfen die neue Semantik: Ausfall = „Offline – … nicht erreichbar seit …“, nie „Nicht verbunden“ | PASS (2026-10-14) |
| I-41 | Integrationstest „Ausfall Voice“ (`tests/integration/hybrid.spec.ts:154-182`, Nachweis `docs/evidence/integration/README.md` Zeile 6) | Test und Nachweis erwarten „Nicht verbunden“ (Stand vor `cfd68b7`). Das Produkt zeigt jetzt bei einem Ausfall „Sprachdienst offline“ bzw. „Offline – … nicht erreichbar“ (`apps/web/src/i18n/modules/e.de.ts:22`); „Nicht verbunden“ bleibt dem Fall „nicht konfiguriert“ vorbehalten (`e.de.ts:4`). Tests 7 bis 9 sind ungeprüft. Playwright-Artefakte liegen im gitignorierten `test-results/` | PASS (behoben 2026-10-14: Assertions auf Ausfalltext umgestellt, Tests unabhängig; 7 von 7 in zwei Läufen, Nachweis aktualisiert) |
| A-03 | Grenzen des Integrationsnachweises | Fakes, keine echten Hermes/Voice/Qwen-Dienste. Windows/WSL-Portweiterleitung, `wsl.exe`-Pfade, Dienststart nicht abgedeckt. Der Circuit Breaker im Lauf auf 3 Fehler / 5 s gekürzt | BLOCKED (echte Dienste) |
| A-04 | Hybrid-Beispielkonfiguration | `config/adapters.hybrid.example.yaml` und `dashboard.hybrid.example.yaml` stimmen mit dem Installer-Ergebnis überein, bis auf: Der Installer schreibt `ownerPasswordHash: file:…`, die Vorlage `env:JARVIS_OWNER_PASSWORD_HASH`. Beides wird unterstützt (`packages/config/src/secrets.ts`, `apps/control-api/src/security/auth-service.ts:179`) | PASS (Doku-Hinweis) |
| A-05 | Retry-Stapelung (Commit `84460a7`) | Registry-Default `maxAttempts: 1` (`packages/config/src/load.ts:274`, `packages/adapter-core/src/registry.ts:350`). Adapter-HTTP-Clients retryen weiter für Transportfehler | PASS (behoben) |

### 2.4 Dashboard-Schritt 15 (`PS:559-987`)

| ID | Prüfung | Ergebnis | Bewertung |
| --- | --- | --- | --- |
| D-01 | PowerShell-Parser | 0 Fehler (PS 7.4.6). Die Funktionen sind in `install-jarvis.ps1` belassen, nicht als separate Datei | PASS (Parser) |
| D-02 | Build-Eingaben | `DashRootFiles` (`PS:568-569`), `DashSyncDirs` (`PS:567`) decken `pnpm build:app` ab: `apps/web`, `apps/control-api`, `packages/*`, `adapters/*`, `tsconfig.base.json`, `pnpm-workspace.yaml`, `.npmrc`. `tests/` und `docs/` werden für den Build nicht benötigt | PASS (statisch) |
| D-03 | Konfiguration | `dashboard.yaml`: `server.port 3100`, `auth.mode local`, `ownerPasswordHash: file:C:/Jarvis/config/dashboard_owner.hash`; `adapters.yaml`: Allowlist und fünf Kategorien (`PS:806-859`). Port-Auslesen (`Get-ConfiguredPort`, `PS:695-705`) identisch zu `SD:18-24` | PASS (statisch) |
| D-04 | Owner-Passwort | siehe I-39 | PASS (statisch), BLOCKED (Windows) |
| D-05 | Node.js/pnpm (winget, corepack) unter Administrator | `Ensure-Node` (`PS:596-618`), `Ensure-Pnpm` (`PS:619-637`) | BLOCKED |
| D-06 | Native Binaries unter Windows | `@swc/core` (`apps/control-api/package.json:46`) braucht plattformspezifische Pakete. Ein `pnpm install` unter Windows ist nicht geprüft | BLOCKED |
| D-07 | Abbruchverhalten | I-33 | FAIL (niedrig) |
| D-08 | Dienststart und Healthcheck | Task `JARVIS_Dashboard` (60 s Verzögerung, `PS:965`), Launcher `SD` mit Neustartschleife (10 s), Health `GET /api/v1/health` bis 60 s (`PS:968-970`). Stoppen per CommandLine (`PS:716-724`) | PASS (statisch), Windows BLOCKED |
| D-09 | Lokaler Test in der VM | Build und Start der gebauten Control API in der VM (Integrations-Lauf, A-02) | PASS (Linux) |

### 2.5 Wake Word „Hey Friday“ (persönliches Modell, `voice/personal_wake.py`, `voice/build_personal_wake.py`)

| ID | Prüfung | Ergebnis | Bewertung |
| --- | --- | --- | --- |
| W-01 | Unit-Tests `installer/voice/tests/test_personal_wake.py` (in dieser Session ausgeführt, Python 3.13, pytest 9.1.1) | **12 von 12 bestanden** (Slug/Validierung, Engine-Wahl, Persona-Default, Namenssuche inkl. Umlaute, Harte Negative, Fenstermodell, Kalibrierung, Matrix/Segmente, Dienst-Stufe-2 akzeptiert/abgelehnt, Barge-In, Backlog-Preroll) | PASS |
| W-02 | Synthetische Auswertung `installer/voice/tests/eval_synthetic_wake.py` | **Nicht ausführbar**: Die Piper-Stimmen liegen auf Hugging Face, das in der Cloud nicht erreichbar ist (HTTP 000). **Im Repo stehen keine Messwerte**. `voice.md` §0.4 verweist auf einen „Übergabebericht“, der nicht im Repo liegt. `PROJECT_STATUS.md` (Commit `1ca7cdb`) nennt die Ergebnisse „gemischt“. Das Ziel „ca. 9 von 10 Aufrufen“ (`ANLEITUNG.md:110`) ist eine Zielangabe, keine Messung | BLOCKED (keine Zahlen verfügbar) |
| W-03 | Stufe 2 (faster-whisper Namenscheck) | Modell-Download von Hugging Face nicht möglich. Getestet nur mit einem Fake (`FakeWhisper` in den Tests) | BLOCKED |
| W-04 | Echte Stimme, Mikrofon, Lautsprecher | Nicht prüfbar (Cloud) | BLOCKED |
| W-05 | Kalibrierungsausgabe und Warnung | `WAKE_QUALITY=gut/mittel/schwach` (`build_personal_wake.py:103`) und Warnhinweis bei `schwach` (`PS:530-533`). Der Installer greppt `Wake` case-insensitiv, daher erscheint die Zeile in der Konsole | PASS (statisch) |
| W-06 | Erkennungslogik ohne Stimme | Trefferquote und Fehlauslösung für `Friday` nicht gemessen | BLOCKED |

Für `Jarvis` gilt ein anderer Weg (vortrainiertes `hey_jarvis`-Modell plus Verifier), dieser Weg ist in dieser Session nicht geprüft.

### 2.6 Umgesetzte Fixes der Phase B (siehe auch Abschnitt 3)

| Fix | Commit | Bewertung |
| --- | --- | --- |
| Statische Installer-Fixes I-02 bis I-09 | `c3ede6d` | PASS |
| Name vor den Aufnahmen, Standard Friday / „Hey Friday“, persönliches Wake Word, `change-assistant-name.bat` | `1ca7cdb` | PASS (statisch); Qualität BLOCKED (W-02 bis W-06) |
| Dashboard-Schritt 15, `update-dashboard.bat`, `SD` | `89b3b6c` | PASS (statisch); Windows BLOCKED |
| Retry-Stapelung (Registry-Default 1 Versuch) | `84460a7` | PASS (A-05) |
| Orb-Defaults `intensity`/`particleDensity` 70/60 (vorher 1 %) | `6963206` | PASS (`packages/orb/src/settings.ts:43,45`) |
| Branding F.R.I.D.A.Y., Anzeigename konfigurierbar | `717f898` | PASS; **Ausnahme I-35** |

---

## 3. Umgesetzte Fixes

Behoben und in den Commits enthalten:

| Commit | Inhalt |
| --- | --- |
| `c3ede6d` | I-02 bis I-09: robocopy-Exitcode und Neusynchronisation, nvidia-smi-Fallback, `py.exe`-Prüfung, Entfernen defekter ZIPs, ACL vor Schreiben des Schlüssels, `IFS= read`, `set -e`-FAIL-Pfad, ShellCheck |
| `84460a7` | Registry-Retry-Default 1 (Stapelung von Versuchen bei Ausfall beseitigt) |
| `6963206` | Orb-Defaults 70/60 statt 1 (Orb wurde mit 1 % gerendert) |
| `1ca7cdb` | Namensabfrage vor Stimmaufnahme, persönliches Wake Word, `change-assistant-name.bat` |
| `89b3b6c` | Schritt 15: Command Center nach `C:\Jarvis\dashboard`, `update-dashboard.bat`, `SD`, `DEPLOYMENT.md` |

In **dieser** Session wurde kein Code geändert und nichts committet. Dieses Dokument ist die einzige Änderung. Ein unabhängiger
`git status` zeigt außerdem uncommittete Arbeit anderer Stränge (`package.json` mit Skript `test:e2e:update`, `playwright.config.ts`,
`tests/e2e/`). Diese wurden nicht angefasst.

Vorgeschlagene Fixes ohne Umsetzung (in dieser Session wegen des Schreibbereichs nicht durchgeführt): I-10, I-18, I-20, I-21, I-22, I-23,
I-25, I-29, I-31, I-32, I-33, I-34, I-35, I-36, I-37, I-38, I-40, I-41. Priorität vor dem Windows-Test: **I-32, I-35, I-31, I-41**.

---

## 4. Verbleibende Risiken (nach Auswirkung geordnet)

1. **Wake-Word-Qualität für beliebige Namen mit echter Stimme ungetestet.** Standard ist Friday, also betrifft es jede Standardinstallation.
   Die synthetische Auswertung ist nicht ausführbar und hat im Repo keine Zahlen. Falsch-Auslösungen und verpasste Aktivierungen sind
   möglich. Die Stufen 2 und 3 begrenzen Fehlauslösungen, aber nicht verpasste Aktivierungen. Ein Test mit echter Stimme ist nötig.
2. **Hermes ist nicht gepinnt** (I-22, H-06). `install.sh` wird ungeprüft aus `main` ausgeführt. Eine API- oder Dashboard-Änderung
   trifft Aufgaben, Aktivität, Agenten und die Sprachverbindung gleichzeitig. Die Fehler werden sichtbar (`VALIDATION_FAILED`, 401),
   aber nicht verhindert.
3. **Echter Kimi-K3-Lauf nicht erfolgt** (H-03). Der Installer meldet „Kimi-Test nicht bestanden“ nur als Warnung. Ohne funktionierenden
   Key fehlt die Antwort für alles über die lokale Stufe hinaus. Ein Hermes-Provider-Fehler wäre dann erst beim ersten echten Auftrag sichtbar.
4. **Dashboard-Token per HTML-Scrape** (H-04, `dashboardAuth: scrape`). Ändert Hermes das Format von `window.__HERMES_SESSION_TOKEN__`,
   fallen Aufgaben und Agenten aus. Die Adapter-Optionen `secret`/`file` sind vorbereitet, der Installer nutzt sie nicht
   (`HERMES_DASHBOARD_SESSION_TOKEN` wird nicht gesetzt).
5. **Nicht belegte Hermes-Aktionen** (H-05). Abbrechen, Wiederholen, Pausieren und Agentensteuerung sind nicht live getestet bzw. ohne
   Schnittstelle. Sie sind korrekt gesperrt, Nutzer erwarten sie aber möglicherweise. Keine Gefahr, nur ein Funktionsdefizit.
6. **Sprachdienst: Stop, Neustart und Update** (I-31, I-32, I-18). Ein Test „Sprachdienst stoppen“ mit `Stop-ScheduledTask` ist
   irreführend, weil die Schleife weiterläuft. Ein Neustart kann zwei Instanzen erzeugen. Ein Paket-Update ändert den laufenden Code nicht.
7. **Windows-only Verhalten** (alle BLOCKED): Reboot-Pfad mit Resume-Task (I-11), Lebensdauer des `llama-server` (I-17), systemd-User-Bus
   und Linger direkt nach dem Start (I-24), winget/Node/corepack unter Administrator (D-05), native Binaries bei `pnpm install`
   (D-06), `pnpm.cmd` mit Pipe für den Passwort-Hash (I-39), Zone-Identifier bei heruntergeladenen Dateien (I-25), Verhalten bei
   Installation unter einem anderen Administrator-Konto (I-01).
8. **Gesprochene Begrüßung nennt „JARVIS“** (I-35). Für den Endnutzer sichtbar und falsch. Schritt 14 meldet keinen Erfolg (I-36).
9. **Resume-Zustand nicht atomar** (I-10). Eine abgeschnittene `install-state.json` lässt den Lauf von vorn beginnen.
   Das ist nur bei Stromausfall im Schreibmoment relevant.
10. **Unbegrenzte Logs mit Klartext-Transkripten** (I-20, I-34). `voice-service.log` enthält Gesprochenes im Klartext und wächst ohne
    Grenze. Personenbezogen. Die Dashboard-Logs werden erst beim Neustart des Servers rotiert.
11. **Hash-Prüfung nur mit GitHub-`digest`** (I-06, I-22). Ohne `digest` gibt es für llama.cpp keine Prüfsumme.
12. **Abbruch in Schritt 15 ohne Abschlussbericht** (I-33). Dienste laufen weiter, aber `INSTALL_STATE.md` fehlt.
13. Übrige Befunde niedriger Schwere: I-21 (UTF-16 in `pip.log`), I-23 (bestehende Distro, `sudo` fehlt), I-29 (Code-Default `kira`),
    I-37 (Anleitung zum Kimi-Key), I-38 (Import in Tests), I-40 (Evidence-Route).
    I-41 (veralteter Integrationstest) ist kein Produktfehler, muss aber vor einer Abnahme behoben sein.

---

## 5. Checkliste für den echten Test auf einem frischen Windows-11-PC

Vorbedingungen aus `ANLEITUNG.md`: Administrator-Konto, NVIDIA-Treiber aktuell, 40 GB frei auf C:, Mikrofon und Lautsprecher, komplettes
Paket entpackt (`installer`, `apps`, `packages`, `adapters`, `config`, `scripts`, `package.json`, `pnpm-lock.yaml` nebeneinander). Der
entpackte Ordner muss bis zum Ende an seinem Platz bleiben. Vor dem Test: den Schritt-Namen aus `install-state.json` notieren, falls
Neustarts nötig werden.

Jeder Schritt ist ein Prüfpunkt. Erst weitergehen, wenn der Erwartungswert erfüllt ist. Bei Fehlern: Logzeile notieren, Problem
beheben, `install-jarvis.bat` erneut starten. Der Lauf setzt an der Stelle fort.

### 5.1 Schritte im Ablauf

| Schritt | Sichtbar in der Konsole (Erwartung) | Dateien / Ordner | Prüfung |
| --- | --- | --- | --- |
| Start | Doppelklick auf `install-jarvis.bat`, UAC-Abfrage mit Ja. Titel „F.R.I.D.A.Y. – Installation“, Zeile „Dauer: ca. 45–90 Minuten“ | `C:\Jarvis\{config,exchange,logs,models,scripts,voice,windows-worker,backups,cache,installer}`, `C:\Jarvis\logs\install-<yyyyMMdd-HHmmss>.log` | Ordner vorhanden, Transkript-Datei wächst |
| Name (vor Schritt 1) | Titel „Dein Assistent“. Frage „Wie soll dein Assistent heißen? [Friday]“. Eingabe Enter. Zeile `[OK] Dein Assistent heißt Friday – Wake Word: 'Hey Friday'.` | `C:\Jarvis\config\install-state.json` mit `assistant_name`, `wake_phrase`, `wake_slug` (`friday`), `wake_engine` (`personal`) | `install-state.json` lesen |
| Schritt 1/15 Systemcheck | `Windows-Build … | RAM … GB | … Threads | C: … GB frei`, `Grafikkarte: …`, `[OK] Internet erreichbar` | `install-state.json`: `build`, `ram_gb`, `cores`, `gpu` | – |
| Schritt 2/15 Dateien | `[OK] Dateien liegen in C:\Jarvis\installer` | `C:\Jarvis\installer\install-jarvis.ps1`, `wsl\`, `voice\`, `scripts\`, `common\` | Dateien vorhanden |
| Schritt 3/15 WSL2 | Entweder `[OK] WSL bereit: …`. Oder „WSL wird installiert …“, `Windows muss jetzt neu starten …`, Rückfrage „Jetzt neu starten? (j/n)“ | Bei Neustart: Aufgabe `JARVIS_Installation_fortsetzen` (nur temporär) | Nach Neustart öffnet sich das Fenster von selbst; die Aufgabe ist danach gelöscht |
| Schritt 4/15 Energie | `[OK] Am Netzteil: kein Standby …` | Energieplan | `powercfg /getactivescheme` |
| Schritt 5/15 Persönlichkeit | Fragen: Vorname; Anrede (1–3); Charakter (1–3); Länge (1–2); „Über mich“. Dann `[OK] Gespeichert (änderbar in C:\Jarvis\config\persona.json).` | `C:\Jarvis\config\persona.json` (`assistant_name`, `owner_name`, `address`, `character`, `length`, `about`) | Datei enthält `assistant_name: Friday` |
| Schritt 6/15 .wslconfig | `[OK] WSL: N GB RAM, N Threads, 8 GB Swap.` | `%USERPROFILE%\.wslconfig` (`[wsl2]`, `networkingMode=mirrored` ab Build 22621), ggf. `C:\Jarvis\backups\.wslconfig.bak-*` | Datei lesen; `wsl --shutdown` lief |
| Schritt 7/15 Ubuntu | `[OK] Ubuntu ist installiert.` Bei vorhandenem Ubuntu: Rückfrage „Diese verwenden? (j/n)“ (siehe I-23) | WSL-Distribution `Ubuntu` (24.04) | `wsl -l -q` zeigt `Ubuntu` |
| Schritt 8/15 Linux-Benutzer | Frage Benutzername (Standard = Windows-Name in Kleinbuchstaben), Passwort zweimal. Dann `Richte Ubuntu ein …`, graue Zeilen aus WSL, `[OK] Benutzer '<user>' aktiv, systemd läuft.` | In Ubuntu: `/etc/wsl.conf` (`systemd=true`, `default=<user>`), `/var/lib/systemd/linger/<user>`, `~/jarvis/` | `wsl -d Ubuntu --exec whoami` = Benutzer; `wsl -d Ubuntu --exec ps -p 1 -o comm=` = `systemd` |
| Schritt 9/15 Keepalive | `[OK] Aufgabe JARVIS_WSL_Keepalive eingerichtet (startet bei jeder Anmeldung).` | Aufgabe `JARVIS_WSL_Keepalive`; Prozess `wsl.exe … sleep infinity` | `Get-ScheduledTask JARVIS_WSL_Keepalive` |
| Schritt 10/15 Hermes + Kimi | Falls `KIMI_API_KEY` gefunden: „Verwenden? (j/n)“. Sonst Eingabe des Schlüssels (unsichtbar). Dann `Installiere Hermes …` (10–20 min), graue Ausgabe, `[OK] Kimi K3 antwortet.` (oder `[!] Kimi-Test nicht bestanden`), `[OK] Dashboard von Windows erreichbar: http://127.0.0.1:43691` (oder `[!]`) | In Ubuntu: `~/.hermes/.env` (chmod 600, `KIMI_API_KEY`, `API_SERVER_*`), `~/.hermes/SOUL.md`, `~/.config/systemd/user/hermes-dashboard.service`. Windows: `C:\Jarvis\config\hermes_api.key` (64 Hex-Zeichen) | `http://127.0.0.1:43691/` (200), `http://127.0.0.1:43693/v1/models` mit Bearer (200). In Ubuntu: `systemctl --user is-active hermes-gateway hermes-dashboard` = `active` |
| Schritt 11/15 Qwen | `llama.cpp-Variante: cuda-13` (RTX 50xx), `cuda-12.4` oder `cpu`. `[OK] llama-b….zip (<tag>) geprüft und entpackt`. `Lade Qwen3-4B (2,5 GB) …`. `[OK] Qwen3-4B geprüft`. `[OK] Qwen antwortet (N,N s): …` | `C:\Jarvis\llama.cpp\llama-server.exe`, `C:\Jarvis\models\Qwen3-4B\Qwen3-4B-Q4_K_M.gguf`, `C:\Jarvis\config\qwen.json`, `C:\Jarvis\logs\qwen-server.log` und `qwen-server.log.out`. Aufgabe `JARVIS_Qwen` | `http://127.0.0.1:43692/v1/models` (200); Antwort auf die Testfrage enthält `LOCAL_OK` (modellabhängig) |
| Schritt 12/15 Sprachsteuerung | Ggf. `Installiere Python 3.11 …`. `Python-Pakete (ca. 3 GB, 10–20 min) …`. Zeilen mit `==>`, `DONE` aus `voice_setup.py`. `[OK] Sprachmodelle bereit.` | `C:\Jarvis\voice\.venv\Scripts\python.exe`, `C:\Jarvis\voice\*.py` (kopiert, siehe I-31), `C:\Jarvis\config\voice.json` (`assistant_name` Friday, `wake_phrase` „Hey Friday“, `wake_engine` `personal`, `health_port` 43694), `C:\Jarvis\models\` (whisper, ecapa, piper), `C:\Jarvis\logs\pip.log` (UTF-16, I-21) | `voice.json` lesen |
| Schritt 13/15 Stimme | Titel „Schritt 13/15 – Friday lernt deine Stimme“, Liste „26x “Hey Friday”, 18x “Friday”, 15 ähnlich klingende Wörter, 8 kurze Texte“. Enter, Aufnahmefenster. Danach Zeilen `Profil aus N Fenstern erstellt`, `Kreuzvalidierung 1,5-s-Fenster: …`, `Schwelle …`, `WAKE_QUALITY=…`. Bei `schwach`: `[!]`-Warnung. `[OK] Stimmprofil erstellt (bleibt nur auf diesem PC).` | `C:\Jarvis\voice\profiles\owner\raw\wake_hey_friday\*.wav` (>= 20), `raw\speech\*.wav` (>= 6), `raw\wake_friday\*.wav`; `C:\Jarvis\voice\profiles\owner\embeddings\owner_ecapa.npy`; `C:\Jarvis\models\openwakeword\personal_wake.npz` und `personal_wake.json` | Dateien zählen. Bei weniger als 20/6: Schleife meldet „Zu wenige Aufnahmen“ |
| Schritt 14/15 Sprachdienst | Titel „Schritt 14/15 – Friday starten“, `Lade die Sprachmodelle (bis zu 3 Minuten) …`. **Keine `[OK]`-Zeile (I-36).** Gesprochene Begrüßung (Standard: „JARVIS ist installiert …“, I-35) | Aufgabe `JARVIS_Voice` (45 s Verzögerung). Prozesse: `powershell` mit `start-jarvis-voice.ps1`, `python.exe` mit `jarvis_voice.py`. Log `C:\Jarvis\logs\voice-service.log`, `C:\Jarvis\logs\voice.jsonl` | `http://127.0.0.1:43694` liefert JSON mit `"state":"listening"` |
| Schritt 15/15 Command Center | Titel „Schritt 15/15 – F.R.I.D.A.Y. Command Center (Dashboard) einrichten“. `Ziel: C:\Jarvis\dashboard | URL: http://127.0.0.1:3100 | Log: …`. `Quelle: …`. `[OK] Node.js … bereit` (oder gefunden). `[OK] pnpm 10.28.2 bereit`. `Prüfe Quellstand …`, `Kopiere das Command Center …`, `pnpm install --frozen-lockfile …` (einige Minuten), `pnpm build:app …`, `[OK] Command Center gebaut.` `[OK] dashboard.yaml geschrieben: …`, `[OK] adapters.yaml geschrieben: …`. Passwortabfrage (mind. 12 Zeichen, zweimal). `[OK] Owner-Passwort gesetzt (Hash in …dashboard_owner.hash, nur für <user> lesbar).` `[OK] Aufgabe JARVIS_Dashboard eingerichtet …`. `Warte auf das Command Center (bis zu 60 Sekunden) …`. `[OK] Command Center läuft: http://127.0.0.1:3100 (Health 200)` | `C:\Jarvis\dashboard\apps\control-api\dist\main.js`; `C:\Jarvis\dashboard\apps\web\out\` (nicht leer); `C:\Jarvis\dashboard\config\dashboard.yaml`, `adapters.yaml`; `C:\Jarvis\config\dashboard_owner.hash`; `C:\Jarvis\logs\dashboard-install.log`, `C:\Jarvis\logs\dashboard-service.log`; Aufgabe `JARVIS_Dashboard`; `install-state.json` mit `dashboard`, `dashboard_hash`, `dashboard_source`, `dashboard_pnpm` | `http://127.0.0.1:3100/api/v1/health` (200) |
| Abschluss | `INSTALL_STATE.md`, Titel „FERTIG – Friday ist einsatzbereit“, Zeile „Sag: “Hey Friday” …“, Rückfrage „Command Center jetzt im Browser öffnen? (j/n)“ | `C:\Jarvis\INSTALL_STATE.md` | Datei enthält alle Adressen (Abschnitt „Installationsstatus“) |

Hinweis zu Schritt 15: Ein Fehler dort beendet den Installer (I-33). `INSTALL_STATE.md` und die Schlussmeldung entfallen dann. Die
Dienste von Schritt 10, 11 und 14 laufen weiter. Die Meldung „Command Center nicht erreichbar“ steht im Abschluss, wenn der Health-Check
scheitert.

### 5.2 Aufgaben, Ports, Logs (exakte Namen)

**Geplante Aufgaben** (Aufgabenplanung, Trigger „bei Anmeldung“ des Installationsbenutzers):

| Name | Startet | Hinweis |
| --- | --- | --- |
| `JARVIS_WSL_Keepalive` | sofort bei Anmeldung | hält WSL wach |
| `JARVIS_Qwen` | sofort | `llama-server` auf 43692 |
| `JARVIS_Voice` | 45 s nach Anmeldung | Schleife, bis zu 120 s Wartezeit auf Qwen |
| `JARVIS_Dashboard` | 60 s nach Anmeldung | Schleife, Neustart nach 10 s |
| `JARVIS_Installation_fortsetzen` | nur nach WSL-Neustart, Highest | wird beim nächsten Lauf gelöscht |

Systemd in Ubuntu: `hermes-gateway` (Hermes-eigene Unit, `hermes gateway install`), `hermes-dashboard` (`~/.config/systemd/user/hermes-dashboard.service`).

**Ports** (alle nur 127.0.0.1):

| Port | Dienst | Prüfung |
| --- | --- | --- |
| 3100 | Command Center (Web + Control API) | `http://127.0.0.1:3100/` (Login-Seite), `http://127.0.0.1:3100/api/v1/health` (200; 503 = Teilausfall) |
| 43691 | Hermes-Dashboard | `http://127.0.0.1:43691/` (200, ohne Auth) |
| 43692 | Qwen3-4B (llama-server) | `http://127.0.0.1:43692/v1/models` (200) |
| 43693 | Hermes-API-Server | `http://127.0.0.1:43693/health` (200, ohne Auth); `/v1/models` nur mit `Authorization: Bearer <Inhalt von C:\Jarvis\config\hermes_api.key>` (200) |
| 43694 | Voice-Statusserver | `http://127.0.0.1:43694` (JSON, Feld `state`; Port ist während des Modellladens geschlossen) |

**Log-Dateien unter `C:\Jarvis\logs`:**

| Datei | Inhalt |
| --- | --- |
| `install-<yyyyMMdd-HHmmss>.log` | Transkript des Installers (je Lauf eine Datei) |
| `pip.log` | pip-Ausgabe Schritt 12 (UTF-16, I-21) |
| `qwen-server.log`, `qwen-server.log.out` | stderr und stdout von `llama-server` |
| `voice-service.log` | Start/Ende, Transkripte im Klartext (I-20) |
| `voice.jsonl` | Metadaten (`wake`, `wake_rejected`, `command`, …) |
| `dashboard-install.log` | Schritt 15: winget, corepack, pnpm |
| `dashboard-service.log` (+ `.1`) | Start/Ende des Command-Center-Prozesses, stdout/stderr |
| `dashboard\` | JSON-Logs der Anwendung. Dateinamen werden von der Anwendung bestimmt und sind hier nicht geprüft |

Hermes-Logs liegen in Ubuntu (`journalctl --user -u hermes-gateway`, `journalctl --user -u hermes-dashboard`), nicht unter `C:\Jarvis\logs`.

### 5.3 Funktionale Endtests

| Test | Ausführung | Erwartung |
| --- | --- | --- |
| Wake Word | „Hey Friday“ sagen, dann eine Frage („Wie spät ist es?“) | `http://127.0.0.1:43694`: `state` wechselt `listening` -> `command` -> `speaking` -> `followup` -> `listening`. `wake_count` steigt. `voice.jsonl` enthält ein `wake`-Ereignis. Die Antwort kommt hörbar |
| Command Center: Übersicht | `http://127.0.0.1:3100/` (Login `owner`, Passwort aus Schritt 15) | Live-Daten; Quellen-Badges: Aufgaben und Agenten `hermes`, Sprache `jarvis-voice` (Adapter `jarvis-voice-http`), System `local-system`. CPU/RAM sind echte Messwerte |
| Command Center: Aufgaben | `/tasks` | Liste aus dem Hermes-Kanban (Board `default`), Badge `hermes`. Leere Liste ist gültig, wenn Hermes keine Aufgaben hat |
| Command Center: Agenten | `/agents` | Hermes-Profile, Badge `hermes` |
| Command Center: Sprache | `/voice` | Modus „Bereit“, Wake Word „Hey Friday“, Modell `qwen3-router` |
| Command Center: System | `/system` | Dienste Qwen, Hermes-API, Hermes-Dashboard, Voice online; Modelle `qwen3-router` und `jarvis`; Badge `local-system` |
| Sprachdienst stoppen (Ausfall) | **Nicht** nur `Stop-ScheduledTask JARVIS_Voice` (I-32). Stattdessen: `start-jarvis-voice.ps1`-Prozess und `python.exe`-Prozess mit `jarvis_voice.py` beenden (Abfrage über `Get-CimInstance Win32_Process`) | `http://127.0.0.1:43694` nicht erreichbar. Sprache-Seite zeigt „Nicht verbunden“, Voice-Dienst „Offline“. Übrige Bereiche (Aufgaben, Agenten, Übersicht, System) bleiben nutzbar |
| Sprachdienst neu starten | `Start-ScheduledTask JARVIS_Voice` (Ausfall vorher beenden, sonst zwei Instanzen) | Nach bis zu 3 min Modellladen: `state` `listening`; Command Center zeigt Sprache wieder „Bereit“ |
| Hermes stoppen (optional) | In Ubuntu `systemctl --user stop hermes-dashboard` (und/oder `hermes-gateway`) | Aufgaben und Agenten zeigen „nicht verfügbar“, Sprache und übrige Bereiche laufen weiter |
| Neustart Windows | Neustart, dann anmelden als Installationsbenutzer | Nach Anmeldung starten `JARVIS_WSL_Keepalive`, `JARVIS_Qwen`, `JARVIS_Voice` (+45 s), `JARVIS_Dashboard` (+60 s). Ports 3100, 43691–43694 erreichbar. Hinweis: Die Aufgaben laufen erst nach **Anmeldung**, nicht beim Boot |
| Update des Command Centers | `update-dashboard.bat` aus neuem Paket | Quellhash geändert -> Build; Konfiguration bleibt. Sprachdienst wird **nicht** aktualisiert (I-31) |

---

## 6. Offene Entscheidungen für den Owner

Nicht entschieden in diesem Dokument:

1. **Internes Umbenennen `@jarvis/*`** (Paketnamen, `jarvis.*`-Events, `/api/v1`). Ein Vertragsbruch; PROJECT_STATUS sieht es als eigene Entscheidung.
2. **Autor-Umschreiben der Git-Historie** (Force-Push). Irreversibel für Remotes und Klone.
3. **Pfade, Dateinamen, Aufgabennamen** unter `C:\Jarvis` (z. B. `JARVIS_*`) umbenennen. Viele Stellen betroffen (Installer, Skripte, Dokumente, Deinstallation).
4. **Filmfilter für die Friday-Stimme** (`tts_film_filter`, Standard `true`, `VS`) und **weibliche TTS-Stimme** für Friday. Die Standardstimme ist Thorsten (männlich, `installer/voice/LIESMICH.txt`).
5. **Hermes-Version pinnen** (Commit oder Tag; Prüfsumme des Installers). Betrifft H-06, I-22.
6. **Wake-Word-Verfahren**, falls die Qualität mit echter Stimme nicht reicht: z. B. ein eigenes openWakeWord-Modell für den Namen trainieren. Bisher nur das persönliche Verfahren (Stufen 1 bis 3).

---

## 7. Nicht verifiziert und Änderungen an diesem Dokument

**Nicht verifiziert** (bewusst nicht als Fakt angegeben):

- Jede Ausführung auf Windows 11: Parser ist grün, aber Admin-Ablauf, UAC, winget, WSL-Installation, Neustart, Aufgabenplanung, Mirrored Networking, Dienststart und Healthcheck sind offen.
- Hermes mit echtem Kimi-K3-Key, echte Sprachaufnahme, echte Antworten, Verhalten von `hermes-agent`-Updates.
- PSScriptAnalyzer (Gallery gesperrt), PS-5.1-Syntax erneut (Entwurfsergebnis übernommen).
- Qualität und Zahlen des persönlichen Wake Words (W-02 bis W-06).
- Qwen-Server unter Windows (Lebensdauer, GPU-Layer, `--jinja`-Verhalten), `dashboard`-Anwendungslogs (Dateinamen).

**Werkzeuge dieser Session:** PowerShell 7.4.6 (Linux, aus dem Release-Archiv in den Scratch-Ordner), ShellCheck 0.11.0, pyflakes und pytest
in einer Scratch-Venv, Node 22.22.0, `pnpm test:conformance` und `pnpm test:integration` (Logs im Scratch-Ordner, nicht im Repo).

**Änderungen an dieser Datei gegenüber dem Entwurf:**

- Zeilenangaben auf den Stand nach Schritt 15 umgestellt; Entwurfsbefunde, die sich seitdem erledigt haben (I-28, I-30), korrigiert.
- Neue Befunde I-31 bis I-41 und die Ergebnisse dieser Session (Parser, ShellCheck, pyflakes, Conformance 422 bestanden,
  Integration 5 bestanden / 1 fehlgeschlagen / 3 nicht ausgeführt, Wake-Word-Tests 12/12).
- Neue Abschnitte: Hermes-Tabelle (2.2), Dashboard-Schritt (2.4), Wake-Word (2.5), Checkliste (5), Offene Entscheidungen (6).
- Die Behauptung „pyflakes: keine Meldungen“ war falsch (I-38).
