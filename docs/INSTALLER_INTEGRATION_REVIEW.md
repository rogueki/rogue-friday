# Installer- und Integrations-Review (Phase B, Abschluss)

Stand: 2026-10-14, ergänzt 2026-10-15 (Eigentümer-Entscheidungen: Umbenennung jarvis → friday im Installer, Migration von `C:\Jarvis`, frei wählbares Wake Word; Abschnitte 2.7, 5.4, 6). Umfang: `installer/` (Windows 11, PowerShell 5.1, WSL2), die Anbindung von Hermes, Voice-Dienst und lokalem Qwen
an das F.R.I.D.A.Y. Command Center sowie der Dashboard-Schritt 15. Abschlussdokument von Phase B („Installer + Hermes + Dashboard als
Gesamtpaket“).

Die Cloud-VM ist Linux. Der Installer lief dort **nicht**. Jede Aussage ist deshalb einer der Kategorien zugeordnet:

- **PASS**: statisch am Code belegt, oder in dieser VM ausgeführt und grün.
- **FAIL**: Fehler oder Risiko, am Code belegt. Der Eintrag nennt, ob er behoben ist (Commit) oder offen bleibt.
- **BLOCKED**: nur auf echtem Windows 11 bzw. mit echten Diensten prüfbar, oder der Zugriff ist durch den Cloud-Proxy gesperrt.
- **Annahme (unbelegt)**: nicht geprüft und nicht als Fakt verwendet.

Kürzel: `PS` = `installer/install-friday.ps1`, `SR` = `installer/wsl/setup_root.sh`, `SH` = `installer/wsl/setup_hermes.sh`,
`SQ` = `installer/scripts/start-qwen-server.ps1`, `SV` = `installer/scripts/start-friday-voice.ps1`, `SD` = `installer/scripts/start-dashboard.ps1`,
`JV` = `installer/voice/friday_voice.py`, `VS` = `installer/voice/voice_setup.py`. Zeilenangaben beziehen sich auf den Stand dieses
Dokuments (nach dem Dashboard-Schritt 15, Commit `f31977c`) und gelten für die Dateien **vor** der Umbenennung vom 2026-10-15: die Dateinamen
und Pfade in diesem Dokument sind auf die neuen Namen umgestellt (`install-friday.ps1`, `C:\Friday`, `FRIDAY_*`), die Zeilennummern sind es nicht
(der Installer ist um die Migration und die Wake-Phrase-Abfrage gewachsen). Der Entwurf vom 2026-10-14 hatte teils veraltete Zeilen.

Dieses Dokument wurde ohne Code-Änderung und ohne Commit erstellt (Schreibbereich: nur diese Datei). Alle vorgeschlagenen Fixes sind
offen und als solche markiert. Die Ergänzung vom 2026-10-15 (Abschnitt 2.7) dokumentiert die danach im Installer umgesetzten Änderungen.

---

## 1. Zusammenfassung

**Ziel:** Ein frischer Windows-11-PC läuft mit `installer/install-friday.bat` durch. Danach zeigt das F.R.I.D.A.Y. Command Center echte
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
- Das Wake Word (Standard „Hey Friday“, seit 2026-10-15 frei wählbar; persönliches Modell) ist nur durch Unit-Tests belegt. Die synthetische Qualitätsmessung ist in
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

Nachtrag 2026-10-15: Der Installer wurde auf `C:\Friday`/`FRIDAY_*` umgestellt, bietet die Übernahme einer vorhandenen Installation aus `C:\Jarvis`
an und fragt das Wake Word immer frei (2.7, Checkliste 5.4). Der erste Windows-Lauf muss jetzt auch die Migration auf dem Eigentümer-PC prüfen.

---

## 2. Befunde

### 2.1 Installer, statisch (I-01 bis I-40 und I-42)

Prüfwerkzeuge in dieser Session:

| Prüfung | Ergebnis |
| --- | --- |
| PowerShell-Parser, PS 7.4.6 (Linux, in dieser Session neu ausgeführt) | `install-friday.ps1`, `start-dashboard.ps1`, `start-friday-voice.ps1`, `start-qwen-server.ps1`: **0 Parserfehler** |
| PS-5.1-Kompatibilität (Ternary, `??`, `?.`, `&&`/`\|\|`, `-Parallel`) | Ergebnis des Entwurfs übernommen (0 Treffer), in dieser Session nicht erneut geprüft |
| PSScriptAnalyzer | BLOCKED (PowerShell Gallery per Proxy gesperrt). Ersatz: manuelle Durchsicht |
| `bash -n wsl/*.sh` | beide OK (in dieser Session neu) |
| `shellcheck -S style wsl/*.sh` | **0 Befunde**, Version **0.11.0** (Entwurf: 0.9.0) |
| `python3 -m pyflakes voice common` (in dieser Session neu, Venv mit pyflakes) | **1 Befund**: `voice/tests/test_personal_wake.py:29` importiert `sklearn` ungenutzt (I-38). Der Entwurf meldete „keine“ |
| `ast.parse` aller `voice/*.py`, `common/*.py` | alle OK |
| Zeilenenden/BOM | `.ps1`/`.bat`/`.vbs` CRLF (0 LF-only-Zeilen), `.ps1` mit UTF-8-BOM (`EF BB BF`), `.sh` ohne CR |

| ID | Bereich | Datei:Zeile (aktuell) | Befund | Bewertung | Fix / Commit |
| --- | --- | --- | --- | --- | --- |
| I-01 | Elevation | `install-friday.bat:10`, `PS:32-41` | Admin-Prüfung und Neustart per `-Verb RunAs`. Falls ein **anderes** Admin-Konto bestätigt wird, gelten Aufgaben und ACLs für dieses Konto, nicht für den angemeldeten Nutzer | PASS (Hinweis) | – (ANLEITUNG verlangt Administrator-Konto) |
| I-02 | robocopy Schritt 2 | `PS:257-258` | Exitcode >= 8 wurde ignoriert | PASS (behoben) | `e824960`: `LASTEXITCODE -ge 8` -> `Stop-Install` |
| I-03 | Dateisync bei Neustart | `PS:254-262` | Schritt 2 lief nur einmal; neue Dateien erreichten bestehende Installationen nicht | PASS (behoben für `C:\Friday\installer`) | `e824960`: Sync bei jedem Start, solange `$PSScriptRoot -ne $Inst`. **Restlücke: I-31** |
| I-04 | nvidia-smi | `PS:229-242` | Fehlertext älterer Treiber (ohne `compute_cap`) wurde als GPU-Zeile geparst | PASS (behoben) | `e824960`: Zeilenvalidierung, Zweitabfrage, `cc = 0` -> CUDA-12.4 |
| I-05 | Python-Launcher | `PS:474-483` | `$LASTEXITCODE` ohne `py.exe` veraltet, `winget` wurde übersprungen | PASS (behoben) | `e824960`: `Get-Command py.exe` vor dem Aufruf |
| I-06 | llama.cpp-ZIP | `PS:446-447` | Defektes ZIP blieb im Cache, `curl -C -` setzte darauf auf | PASS (behoben) | `e824960`: `Remove-Item` vor `Stop-Install`. **Hinweis:** Die Prüfsumme wird nur verglichen, wenn die GitHub-API ein `digest` liefert (`if ($a.digest -and …)`). Sonst keine Prüfung (siehe I-22) |
| I-07 | ACL `hermes_api.key` | `PS:407-415` | ACL nur bei Neuanlage, Exitcode nicht geprüft | PASS (behoben) | `e824960`: leere Datei anlegen, ACL setzen (Exitcode geprüft), erst dann Schlüssel schreiben |
| I-08 | Linux-Passwort | `SR:6` | `read -r PW` entfernte führende/abschließende Leerzeichen | PASS (behoben) | `e824960`: `IFS= read -r PW` |
| I-09 | Hermes-Prüfung | `SH:32`, `SH:101`, `SH:106` | Unter `set -e` brach `curl -w` bei „Verbindung abgelehnt“ ohne FAIL-Zeile ab; `mkdir -p ~/.hermes` fehlte | PASS (behoben) | `e824960`: `\|\| true`, `mkdir -p "$H"`, `if/else`. ShellCheck 0 |
| I-10 | Resume-Zustand | `PS:110-115` (`Save-State` `PS:113`) | `install-state.json` wird mit `Set-Content` direkt überschrieben, nicht atomar. Eine abgeschnittene Datei lässt `ConvertFrom-Json` fehlschlagen, der Lauf beginnt leer und überschreibt sie | FAIL (niedrig, offen) | Vorgeschlagen: in `.tmp` schreiben, `Move-Item -Force`; Ladefehler abfangen und Datei als `.corrupt` sichern |
| I-11 | Reboot bei fehlendem WSL | `PS:273-291`, `PS:149-151` | `wsl --install --no-distribution`, Task `FRIDAY_Installation_fortsetzen` (RunLevel Highest), Neustart nach Rückfrage. Der Task wird beim nächsten Start gelöscht. Das Verhalten von `wsl --status` bei teilweise aktivierten Features ist statisch nicht prüfbar | BLOCKED | – (Test auf Windows 11 mit und ohne WSL) |
| I-12 | Fehlerbehandlung | `PS:14`, `Stop-Install` `PS:54-58` | `ErrorActionPreference = 'Continue'` mit expliziten Prüfungen. Kritische Pfade prüfen ihr Ergebnis | PASS | – |
| I-13 | Linux-Passwort | `PS:365-371`, `SR:5-8`, `SR:20` | Passwort per `Read-Host -AsSecureString` über stdin, `unset PW`, nie auf Platte. BOM/CR entfernt. Linux-Benutzername validiert (`^[a-z_][a-z0-9_-]{0,31}$`) | PASS | – |
| I-14 | Kimi-Key | `PS:396-404`, `SH:6-9`, `SH:57`, `SH:103`, `SH:106` | Key über stdin an `setup_hermes.sh`, nach `~/.hermes/.env` (chmod 600). `SH` übergibt den Hermes-API-Schlüssel an `curl -H` (in `ps` innerhalb WSL sichtbar, nur für den eigenen Benutzer) | PASS | – (optional `curl -H @datei`) |
| I-15 | Aufgaben | `PS:142-147` (`Register-UserTask`), `PS:389`, `PS:466`, `PS:542`, `PS:965` | Registrierung korrekt: AtLogOn des Installationsbenutzers, Limited, ohne Zeitlimit, `IgnoreNew`, Voice 45 s, Dashboard 60 s. Aufgaben starten nur bei **Anmeldung**, nicht beim Systemstart. Das Stoppverhalten ist in I-32 erfasst | PASS (Registrierung) |  – |
| I-16 | Keepalive | `scripts/wsl-keepalive.vbs:3-6` | WMI-Abfrage verhindert Doppelstart, `wsl.exe` verborgen gestartet | PASS | – |
| I-17 | Qwen-Prozess | `SQ:16-17`, `PS:466` | `llama-server.exe` wird per `Start-Process` gestartet. Ob es nach Ende der Aufgabeninstanz weiterläuft, ist statisch nicht prüfbar. Kein Neustart bei Absturz (Voice fällt auf `kimi_low`/Kimi zurück) | BLOCKED | Vorgeschlagen: nach Anmeldung `Get-NetTCPConnection -LocalPort 43692` prüfen; Überwachungsschleife wie `SV` |
| I-18 | Einzelinstanz Voice | `SV:10` | Die Prüfung über den Health-Port versagt, solange der Port beim Modellladen (bis ca. 3 min) geschlossen ist. Ein zweiter Start dann erzeugt eine zweite Instanz. Verschärft durch I-32 | FAIL (niedrig, offen) | Vorgeschlagen: benannter Mutex oder Prozessprüfung (`Win32_Process` mit `friday_voice.py`) |
| I-19 | Quoting `cmd /c` | `SV:22` | `cmd.exe /c "…"` funktioniert, weil `C:\Friday` keine Leerzeichen hat | PASS | – (nicht ändern, solange Pfade fest sind) |
| I-20 | Klartext-Transkripte | `SV:18-24`, `JV:472`, `JV:489`, `JV:500` | `voice-service.log` enthält Transkripte (`> text`) und Antworten (`< text`) im Klartext, ohne Rotation. Auch `voice.jsonl` und `qwen-server.log` wachsen unbegrenzt | FAIL (niedrig, offen) | Vorgeschlagen: Größenlimit/Rotation; Dashboard darf diese Logs nie spiegeln |
| I-21 | Log-Encoding | `PS:491`, `PS:493` | `Out-File -Append` ohne `-Encoding` schreibt in PS 5.1 UTF-16LE in `pip.log`. Der Rest ist UTF-8 | FAIL (niedrig, offen) | Vorgeschlagen: `-Encoding utf8` |
| I-22 | Nicht gepinnt | `PS:433` (llama.cpp „neueste Release“), `PS:454` (Qwen `resolve/main`), `PS:492-493` (pip ohne Versionen außer `nvidia-cudnn-cu12==9.*`), `SH:25-26` (`hermes-agent.nousresearch.com/install.sh \| bash`) | Keine Version, keine Prüfsumme für Hermes. Qwen-GGUF per Hash geprüft (`PS:455`), aber von `main` geladen. llama.cpp-Prüfsumme nur bei verfügbarem `digest` | FAIL (Risiko, offen) | Vorgeschlagen: llama.cpp-Tag, Hermes-Commit, `requirements` mit Hashes, HF-Revision fixieren |
| I-23 | Bestehende Distro | `SR:18` (`useradd -G sudo` nur bei Neuanlage), `SR:23` (`cat > /etc/wsl.conf` überschreibt vollständig) | Ein vorhandener Benutzer bekommt kein `sudo`, `/etc/wsl.conf` wird ohne Sicherung ersetzt, Passwort wird gesetzt | FAIL (Risiko, offen) | Vorgeschlagen: `/etc/wsl.conf` sichern, `usermod -aG sudo "$U"`, Warnhinweis in der Rückfrage (`PS:362-368`) |
| I-24 | systemd-User-Bus | `SH:69-72`, `SH:92-93`, `SR:39` (Linger) | `systemctl --user` nach Keepalive ohne Warten auf `/run/user/<uid>/bus` | BLOCKED | Vorgeschlagen: Schleife bis Bus existiert (max. 30 s) vor „Gateway als Dienst“ |
| I-25 | Zone-Identifier | `PS:257-260` (robocopy) | Aus dem Internet geladene Dateien können Zone.Identifier tragen. Im Installer gibt es kein `Unblock-File` | BLOCKED (offen) | Vorgeschlagen: `Get-ChildItem $Inst -Recurse \| Unblock-File` nach dem Kopieren |
| I-26 | `.wslconfig` | `PS:332-338` | Vollständig überschrieben, Backup in `C:\Friday\backups`. `networkingMode=mirrored` nur ab Build 22621 (`PS:335`); darunter Warnung (`PS:336`) | PASS | – |
| I-27 | Energieoptionen | `PS:294-302` | Ändern den aktiven Plan dauerhaft; in `ANLEITUNG.md` dokumentiert, keine Wiederherstellung bei Deinstallation | PASS | – (Deinstallation ergänzen) |
| I-28 | Voice-Code, Sichtprüfung | `JV:1-6`, `JV:138` | Der Entwurfsbefund „Docstring nennt Qwen3-8B“ ist **nicht mehr zutreffend** (Docstring geändert, kein 8B im Installer). Verbleibend: `JV:138` nennt einen Qwen3-TTS-Server, der mit `tts_url: null` (`VS`) nie aktiv ist | PASS | – |
| I-29 | Hermes-Modellname | `JV:437` (Code-Default `kira`), `PS`/`VS:126` (`hermes_model`), `SH:59` | Der Entwurf nannte `docs/MAPPING/hermes.md`. Die Drift steht korrekt in `docs/MAPPING/voice.md` §0.2. Wirkung: keine, solange `voice.json` gesetzt ist | PASS (behoben 2026-10-15) | Code-Default in `friday_voice.py` jetzt `friday`; `hermes_model` und `API_SERVER_MODEL_NAME` heißen überall `friday` (I-43) |
| I-30 | Deinstallation und Autostart | `ANLEITUNG.md:153`, `PS:1005` | Vier Aufgaben (`FRIDAY_Voice`, `FRIDAY_Qwen`, `FRIDAY_WSL_Keepalive`, `FRIDAY_Dashboard`; seit I-42 fünf mit `FRIDAY_Watchdog`) in ANLEITUNG und Abschlussbericht, `DEPLOYMENT.md` §4 | PASS (aktualisiert) | `f31977c` |
| I-31 | Update des Sprachdienstes | `PS:484` (`Copy-Item "$Inst\voice\*" "$Root\voice\"`, nur in Schritt 12, Aufruf `voice_setup.py` in `PS:496`) | `C:\Friday\voice` (von `SV:4-5` ausgeführt) wird **nur in Schritt 12** aktualisiert. Ein neues Paket mit geändertem `friday_voice.py` erreicht eine bestehende Installation nicht, solange `voicepython` in `done` steht. `update-dashboard.bat` deckt das nicht ab. I-03 hat nur `C:\Friday\installer` synchronisiert | behoben: `Sync-VoiceFiles` vergleicht bei jedem Start die SHA256 je Datei von `installer\voice` und `C:\Friday\voice`, kopiert Geändertes (ohne `profiles`, `models`, `.venv`) und startet den Sprachdienst neu, falls er lief. Nur unter Windows prüfbar | Vorgeschlagen: Voice-Dateien bei jedem Start synchronisieren (ohne `profiles`, `models`, `.venv`), oder `ANLEITUNG` um „`voicepython` aus `done` entfernen“ ergänzen |
| I-32 | Stop/Neustart des Sprachdienstes | `PS:542-547`, `scripts/hidden.vbs:3` | `hidden.vbs` startet PowerShell mit `Run(…, 0, False)`. `wscript` endet daher sofort, und die Neustartschleife von `SV` läuft als eigenständiger Prozess weiter. `Stop-ScheduledTask 'FRIDAY_Voice'` (`PS:544`) beendet sie voraussichtlich nicht. `PS:545-546` beendet nur `python.exe`; die Schleife startet Python nach 10 s neu. `PS:547` startet dann eine zweite Schleife, wenn der Port in dieser Zeit frei ist. Der Dashboard-Launcher hat dafür `Stop-DashboardService` (`PS:716-724`), Voice nicht. Dasselbe gilt für den Testablauf „Sprachdienst-Task stoppen“ in ANLEITUNG und in Abschnitt 5 | behoben: Launcher halten einen benannten Mutex (Einzelinstanz) und prüfen eine Stop-Flag-Datei `C:\Friday\run\<Skript>.stop`; `Stop-LauncherService` (Schritt 14, `Sync-VoiceFiles`, `Stop-DashboardService`) setzt das Flag, beendet Schleife (powershell) und Kindprozess per CommandLine. Qwen-Launcher prüft zusätzlich `llama-server.exe` auf Port 43692. Nur unter Windows prüfbar | Vorgeschlagen: `SV`-Prozess per CommandLine stoppen (wie `SD`), dann Python; Testanleitung entsprechend ändern |
| I-33 | Abbruch in Schritt 15 | `PS:57` (`exit 1`), `PS:911`, `PS:913`, `PS:938`, `PS:940`, `PS:944`, `PS:945`, `PS:890` (Aufrufe von `Stop-Install` innerhalb `Install-Dashboard`) | `Stop-Install` beendet den **gesamten** Installer. Der Kommentar `PS:562` verspricht „ein Fehler hier lässt Sprache/Hermes/Qwen unangetastet“. Das stimmt für laufende Dienste, aber der Abschlussbericht `INSTALL_STATE.md` (`PS:1008`) und die Schlussmeldung (`PS:1010`) entfallen, und der Benutzer sieht „Enter zum Beenden“ statt „FERTIG“ | behoben: Fehler in Schritt 15 lösen `Stop-Dashboard` (Ausnahme) aus, die der Aufrufer fängt: Fehlerblock, Logpfad, `dashboard` bleibt offen, Rerun-Hinweis (`update-dashboard.bat` / `install-friday.bat -Resume`); Abschlussbericht und Schlussmeldung erscheinen, der Bericht nennt das Command Center als nicht eingerichtet | Vorgeschlagen: in `Install-Dashboard` `return` statt `Stop-Install` (wie `PS:963`, `PS:974`), oder Bericht vor Schritt 15 schreiben |
| I-34 | Log-Rotation Command Center | `SD:31` (Rotation nur bei Schleifenstart), `SD:42` | Die Rotation von `dashboard-service.log` bei 10 MB läuft nur zwischen zwei Neustarts des Servers. Während der Server läuft, wächst die Datei ungebremst | behoben: `start-dashboard.ps1` leitet die Ausgabe von node zeilenweise durch `Write-AppLog` (kein cmd-Redirect mehr); alle 30 s Größenprüfung, Rotation bei 10 MB nach `.log.1` auch während der Server läuft. Nur unter Windows prüfbar | Vorgeschlagen: Rotation im Schreibpfad oder über das Logging der Anwendung |
| I-35 | Begrüßung nach Installation | `voice/say_hello.py:14` (Standard `„Guten Tag. JARVIS ist installiert …“`), `PS:555` (ruft ohne Text auf), `ANLEITUNG.md:47` („begrüßt dich dein Assistent“) | Die gesprochene Begrüßung einer Friday-Installation sagt „JARVIS“. Die Anleitung beschreibt das Gegenteil. Der Entwurf des Installers hat das nicht erkannt | behoben: Schritt 14 übergibt `Guten Tag. <Name> ist installiert und bereit.` an `say_hello.py`; der Standardtext dort nutzt `assistant_name` aus `voice.json`, sonst neutral („Der Assistent“) | Vorgeschlagen: `PS:555` übergibt `"Guten Tag. $AN ist installiert und einsatzbereit."` als zweites Argument. Ein Standard in `say_hello.py` auf den Namen aus `persona.json` umstellen |
| I-36 | Rückmeldung Schritt 14 | `PS:540-557` (keine `Ok`-Zeile), `PS:555` (`2>$null`) | Erfolg von Schritt 14 zeigt sich nur an der gesprochenen Begrüßung. Fehler der Begrüßung (Audio, Piper) sind unsichtbar | behoben: `[OK] <Name> antwortet auf dem Sprachport (state=listening).`; Ausgabe der Begrüßung (stderr inklusive) wird nach `C:\Friday\logs\say-hello.log` geschrieben, Fehler erscheinen als Warn mit Logpfad | Vorgeschlagen: `Ok "$AN antwortet auf dem Sprachport (state=listening)."` nach `PS:554` |
| I-37 | Dokumentation Kimi-Key | `ANLEITUNG.md:19` (`install-kira.bat`), `PS:398-399` | `install-kira.bat` liegt **nicht** im Repo (extern, laut ANLEITUNG „separat“). Die Anleitung sagt „erkennt den Schlüssel automatisch“, der Installer fragt aber nach („Verwenden? (j/n)“) | behoben: `ANLEITUNG.md` verweist nicht mehr auf `install-kira.bat`; beschreibt `KIMI_API_KEY`-Erkennung mit Rückfrage und die Eingabe | Anleitung korrigieren: „erkennt … und fragt zur Bestätigung“ |
| I-38 | Tests Voice | `voice/tests/test_personal_wake.py:29` | `sklearn` importiert, nicht genutzt (pyflakes). Die 12 Tests laufen | behoben: Import durch `importlib.util.find_spec("sklearn")` ersetzt; pyflakes ohne Meldung | Import entfernen |
| I-39 | Owner-Passwort-Hash | `PS:885`, `packages/auth/src/cli/hash-password.ts:45-50`, `packages/auth/src/password.ts:35` | Passwort über stdin an `pnpm --filter @friday/auth hash-password`. Die CLI liest stdin, wenn kein TTY vorhanden ist. Das Ausgabeformat `scrypt$N$r$p$…` passt zum Regex in `PS:888` | PASS (statisch); Windows-Lauf (`pnpm.cmd` mit Pipe) BLOCKED | – |
| I-40 | Dokumentation Evidence | `docs/evidence/integration/README.md` (Tabelle, Zeile 1), Route | Der Nachweis nennt `/overview`. Die Übersicht ist tatsächlich `/` (`apps/web/src/features/shell/navModel.tsx:58`) | PASS (behoben 2026-10-14: Route `/`, API `GET /api/v1/overview`) | `/overview` -> `/` |
| I-42 | Watchdog | `installer/scripts/friday-watchdog.ps1`, `PS` Abschnitt „Zusatz – Service-Watchdog“ (nach Schritt 15), `Register-UserTask` (Parameter `repeatMinutes`, `timeLimitMinutes`), Markierung `C:\Friday\run\installer.active` | Abgestürzte Dienste (Voice 43694, Qwen 43692, Command Center) blieben bis zur nächsten Anmeldung aus. Eigener Watchdog statt Fremdaufgabe: Aufgabe `FRIDAY_Watchdog` (bei Anmeldung +120 s und alle 5 min endlos, `IgnoreNew`, Limit 2 min) startet **über `hidden.vbs` (wscript)**, nicht über `powershell.exe -WindowStyle Hidden` (das blitzte beim Eigentümer alle 5 min ein Konsolenfenster auf, weil das Flag erst nach Erzeugung der Konsole greift). Ein Durchlauf, Neustart (`Start-ScheduledTask`) nur bei: Port/Health zu **und** kein Launcher-/Dienstprozess (Modellladen) **und** kein Stop-Flag `run\<Launcher>.stop` **und** Installer nicht aktiv (`installer.active`, deckt `-UpdateDashboard`/`-ChangeName` ab, in denen `Stop-LauncherService` sein Flag nach dem Stoppen wieder löscht) **und** Backoff (10 min Abstand, max. 3/h, dann nur Warnung). Nie `Stop-Process`. Einzelinstanz per Mutex, Log `C:\Friday\logs\watchdog.log` (1 MB Rotation, stündlicher Heartbeat), Schritt `watchdog` idempotent, Fehler nur Warnung. Entscheidungslogik als `Get-WatchdogDecision` per `-LibraryOnly` testbar. Eine alte Aufgabe `JARVIS_Voice_Watchdog` wird nicht angefasst (manuell löschbar, `ANLEITUNG.md`). Folge für Tests: Ausfalltests (5.3) müssen den Watchdog vorher deaktivieren | PASS (statisch: Parser 0 Fehler, Entscheidungs-Unit-Tests unter pwsh/Linux); Windows BLOCKED | Auf Windows prüfen: Aufgabe registriert (zwei Trigger), kein Fenster, Neustart eines beendeten Dienstes binnen 5 min, kein Neustart bei Stop-Flag/Modellladen/laufendem Installer |

Ergänzend ohne Befund: PS-5.1-Quoting der `Start-Process`/`&`-Aufrufe (Pfade ohne Leerzeichen in `C:\Friday`), Ports nur auf `127.0.0.1`,
Hash-Datei und `hermes_api.key` nur mit ACL für Installationsbenutzer und SYSTEM.

### 2.2 Hermes (Live in der VM mit Fake-LLM, Quellcode `0e427d7`)

Quelle der Wahrheit: `docs/MAPPING/hermes.md`. Die Tabelle fasst den Stand zusammen, Details dort.

| ID | Prüfung | Ergebnis | Bewertung | Beleg |
| --- | --- | --- | --- | --- |
| H-01 | Installation, API-Server mit Installer-Variablen (`API_SERVER_*`, Modell `friday`; die Live-Messung vom 2026-10-14 lief noch mit `jarvis`), Dashboard mit Installer-Aufruf (`hermes dashboard --host 127.0.0.1 --port 43691 --no-open --skip-build`) | Live: `GET /v1/models` mit Bearer -> Modellname (damals `jarvis`); ohne Auth nur `/health`. Dashboard auf 43691 | PASS (mit Fake-LLM) | `hermes.md` §1, §3 |
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
| I-41 | Integrationstest „Ausfall Voice“ (`tests/integration/hybrid.spec.ts:154-182`, Nachweis `docs/evidence/integration/README.md` Zeile 6) | Test und Nachweis erwarten „Nicht verbunden“ (Stand vor `5e88eeb`). Das Produkt zeigt jetzt bei einem Ausfall „Sprachdienst offline“ bzw. „Offline – … nicht erreichbar“ (`apps/web/src/i18n/modules/e.de.ts:22`); „Nicht verbunden“ bleibt dem Fall „nicht konfiguriert“ vorbehalten (`e.de.ts:4`). Tests 7 bis 9 sind ungeprüft. Playwright-Artefakte liegen im gitignorierten `test-results/` | PASS (behoben 2026-10-14: Assertions auf Ausfalltext umgestellt, Tests unabhängig; 7 von 7 in zwei Läufen, Nachweis aktualisiert) |
| A-03 | Grenzen des Integrationsnachweises | Fakes, keine echten Hermes/Voice/Qwen-Dienste. Windows/WSL-Portweiterleitung, `wsl.exe`-Pfade, Dienststart nicht abgedeckt. Der Circuit Breaker im Lauf auf 3 Fehler / 5 s gekürzt | BLOCKED (echte Dienste) |
| A-04 | Hybrid-Beispielkonfiguration | `config/adapters.hybrid.example.yaml` und `dashboard.hybrid.example.yaml` stimmen mit dem Installer-Ergebnis überein, bis auf: Der Installer schreibt `ownerPasswordHash: file:…`, die Vorlage `env:FRIDAY_OWNER_PASSWORD_HASH`. Beides wird unterstützt (`packages/config/src/secrets.ts`, `apps/control-api/src/security/auth-service.ts:179`) | PASS (Doku-Hinweis) |
| A-05 | Retry-Stapelung (Commit `3801c81`) | Registry-Default `maxAttempts: 1` (`packages/config/src/load.ts:274`, `packages/adapter-core/src/registry.ts:350`). Adapter-HTTP-Clients retryen weiter für Transportfehler | PASS (behoben) |

### 2.4 Dashboard-Schritt 15 (`PS:559-987`)

| ID | Prüfung | Ergebnis | Bewertung |
| --- | --- | --- | --- |
| D-01 | PowerShell-Parser | 0 Fehler (PS 7.4.6). Die Funktionen sind in `install-friday.ps1` belassen, nicht als separate Datei | PASS (Parser) |
| D-02 | Build-Eingaben | `DashRootFiles` (`PS:568-569`), `DashSyncDirs` (`PS:567`) decken `pnpm build:app` ab: `apps/web`, `apps/control-api`, `packages/*`, `adapters/*`, `tsconfig.base.json`, `pnpm-workspace.yaml`, `.npmrc`. `tests/` und `docs/` werden für den Build nicht benötigt | PASS (statisch) |
| D-03 | Konfiguration | `dashboard.yaml`: `server.port 3100`, `auth.mode local`, `ownerPasswordHash: file:C:/Friday/config/dashboard_owner.hash`; `adapters.yaml`: Allowlist und fünf Kategorien (`PS:806-859`). Port-Auslesen (`Get-ConfiguredPort`, `PS:695-705`) identisch zu `SD:18-24` | PASS (statisch) |
| D-04 | Owner-Passwort | siehe I-39 | PASS (statisch), BLOCKED (Windows) |
| D-05 | Node.js/pnpm (winget, corepack) unter Administrator | `Ensure-Node` (`PS:596-618`), `Ensure-Pnpm` (`PS:619-637`) | BLOCKED |
| D-06 | Native Binaries unter Windows | `@swc/core` (`apps/control-api/package.json:46`) braucht plattformspezifische Pakete. Ein `pnpm install` unter Windows ist nicht geprüft | BLOCKED |
| D-07 | Abbruchverhalten | I-33 | FAIL (niedrig) |
| D-08 | Dienststart und Healthcheck | Task `FRIDAY_Dashboard` (60 s Verzögerung, `PS:965`), Launcher `SD` mit Neustartschleife (10 s), Health `GET /api/v1/health` bis 60 s (`PS:968-970`). Stoppen per CommandLine (`PS:716-724`) | PASS (statisch), Windows BLOCKED |
| D-09 | Lokaler Test in der VM | Build und Start der gebauten Control API in der VM (Integrations-Lauf, A-02) | PASS (Linux) |

### 2.5 Wake Word (Standard „Hey Friday“, frei wählbare Phrase; persönliches Modell, `voice/personal_wake.py`, `voice/build_personal_wake.py`)

| ID | Prüfung | Ergebnis | Bewertung |
| --- | --- | --- | --- |
| W-01 | Unit-Tests `installer/voice/tests/test_personal_wake.py` (Python 3.13, pytest) | 2026-10-14: 12 von 12. **2026-10-15: alle bestanden** (zusätzlich zu den bisherigen: Phrasen-Validierung = persona.py, Engine-Wahl nur bei exakt „Hey Jarvis“, Slug/Kurzform/Aufnahmeblöcke, `resolve_wake_phrase`, freie Phrase in `persona.json`, harte Negative aus den Phrasenwörtern, Negativtexte ohne Phrasenwörter, Phrasenabgleich Stufe 2 für Standard-/Mehrwort-/Einwort-Phrasen und Umlaute, abgeleitete Sperrwörter, Fenstermodell ohne Kurzform, Dienst-Stufe-2 mit ganzer Phrase) | PASS |
| W-02 | Synthetische Auswertung `installer/voice/tests/eval_synthetic_wake.py` | **Nicht ausführbar**: Die Piper-Stimmen liegen auf Hugging Face, das in der Cloud nicht erreichbar ist (HTTP 000). **Im Repo stehen keine Messwerte**. `voice.md` §0.4 verweist auf einen „Übergabebericht“, der nicht im Repo liegt. `PROJECT_STATUS.md` (Commit `119d544`) nennt die Ergebnisse „gemischt“. Das Ziel „ca. 9 von 10 Aufrufen“ (`ANLEITUNG.md:110`) ist eine Zielangabe, keine Messung | BLOCKED (keine Zahlen verfügbar) |
| W-03 | Stufe 2 (faster-whisper Phrasencheck: ganze Phrase bzw. Kurzform) | Modell-Download von Hugging Face nicht möglich. Getestet nur mit einem Fake (`FakeWhisper` in den Tests) | BLOCKED |
| W-04 | Echte Stimme, Mikrofon, Lautsprecher | Nicht prüfbar (Cloud) | BLOCKED |
| W-05 | Kalibrierungsausgabe und Warnung | `WAKE_QUALITY=gut/mittel/schwach` (`build_personal_wake.py:103`) und Warnhinweis bei `schwach` (`PS:530-533`). Der Installer greppt `Wake` case-insensitiv, daher erscheint die Zeile in der Konsole | PASS (statisch) |
| W-06 | Erkennungslogik ohne Stimme | Trefferquote und Fehlauslösung für `Friday` nicht gemessen | BLOCKED |

Für die Wake Phrase „Hey Jarvis“ (nur diese, nicht der Name) gilt ein anderer Weg (vortrainiertes `hey_jarvis`-Modell plus Verifier), dieser Weg ist in dieser Session nicht geprüft.

### 2.6 Umgesetzte Fixes der Phase B (siehe auch Abschnitt 3)

| Fix | Commit | Bewertung |
| --- | --- | --- |
| Statische Installer-Fixes I-02 bis I-09 | `e824960` | PASS |
| Name vor den Aufnahmen, Standard Friday / „Hey Friday“, persönliches Wake Word, `change-assistant-name.bat` | `119d544` | PASS (statisch); Qualität BLOCKED (W-02 bis W-06) |
| Dashboard-Schritt 15, `update-dashboard.bat`, `SD` | `f31977c` | PASS (statisch); Windows BLOCKED |
| Retry-Stapelung (Registry-Default 1 Versuch) | `3801c81` | PASS (A-05) |
| Orb-Defaults `intensity`/`particleDensity` 70/60 (vorher 1 %) | `b54c73d` | PASS (`packages/orb/src/settings.ts:43,45`) |
| Branding F.R.I.D.A.Y., Anzeigename konfigurierbar | `d6f071e` | PASS; **Ausnahme I-35** |

### 2.7 Eigentümer-Entscheidungen 2026-10-15: Umbenennung, Migration, freies Wake Word (Installer)

Statisch geprüft (Cloud, Linux): PowerShell-Parser 0 Fehler (alle `.ps1`), CRLF/BOM, `bash -n`, ShellCheck, `py_compile`/pyflakes, pytest `installer/voice/tests`,
Watchdog-Entscheidungstests unter pwsh. Die PowerShell-Hilfsfunktionen für Wake Phrase (Validierung, Anzeigeform, Slug, Kurzform, Engine) wurden unter pwsh gegen die Python-Implementierung
auf identische Ergebnisse geprüft (24 Eingaben, 0 Abweichungen), `Convert-LegacyText`/`Convert-LegacyFile` (JSON-Escaping, BOM, Idempotenz, kaputtes JSON) und die Migrationsdatei
(Lesen/Speichern/Phase) mit Beispieldaten. **Alles, was Windows-APIs braucht, ist BLOCKED** (siehe 5.4).

| ID | Bereich | Befund / Änderung | Bewertung |
| --- | --- | --- | --- |
| I-43 | Umbenennung | Dateien: `install-friday.bat/.ps1`, `scripts/start-friday-voice.ps1`, `voice/friday_voice.py` (`git mv`); Wurzel `C:\Friday` (WSL `/mnt/c/Friday`), Aufgaben `FRIDAY_Qwen/Voice/Dashboard/Watchdog/WSL_Keepalive/Installation_fortsetzen`, `FRIDAY_CONFIG_DIR`, `pnpm --filter @friday/auth hash-password` (Ausgabe `FRIDAY_OWNER_PASSWORD_HASH=`), `adapters.yaml`/`dashboard.yaml` mit `@friday/…`, `friday-voice-http`, `friday-command-midnight/-overview`, `API_SERVER_MODEL_NAME=friday`, `hermes_model: friday`, `~/friday` statt `~/jarvis`. Bewusst geblieben: Modell `hey_jarvis_v0.1.onnx` (nur bei der Phrase „Hey Jarvis“), die Stimmdatei `jarvis_de.onnx` und der Filmfilter (Stimme unverändert), „J.A.R.V.I.S.“ als Vorgänger in Texten | PASS (statisch) |
| I-44 | Wake Phrase | Abfrage „Mit welchem Wort oder Satz soll <Name> geweckt werden?“ (Standard „Hey <Name>“, 1–4 Wörter, Buchstaben/Umlaute/Bindestrich, 3–30 Zeichen) in `install-friday.ps1`, gleiche Regeln in `personal_wake.py`/`persona.py` (Test auf Gleichheit). `install-state.json`: `wake_phrase`, `wake_slug` (Slug der **Phrase**, z. B. `hey_friday`), `wake_engine`. Vortrainiert nur bei exakt „Hey Jarvis“. Aufnahme: `enroll_record.py --name --phrase`, Blöcke `wake_<Slug der Phrase>` und (bei Grußwort) `wake_<Slug der Kurzform>`, sonst 44 Aufnahmen der Phrase; harte Negative aus den Phrasenwörtern (`hard_negatives`), Lesetexte/Piper-Sätze ohne Phrasenwörter (`negative_texts.without_phrase_words`), Training `build_personal_wake.py` ohne Kurzform-Gruppe möglich, Meta `personal_wake.json` mit Phrase; Stufe 2 `phrase_matches` vergleicht die ganze Phrase (oder Kurzform/Alias) wortweise mit kleiner phonetischer Editierdistanz, erstes Wort darf bei ≥ 3 Wörtern fehlen, abgeleitete Sperrwörter. Bestehende Installationen behalten ihre Ordnernamen (`wake_hey_friday`/`wake_friday`) und ihr Modell (Meta-Phrase „Hey Friday“ passt). `change-assistant-name.bat` ändert Name **und** Wake Phrase. Vor dem Training wird ein altes `personal_wake.*` entfernt und danach die Phrase im Meta geprüft (kein veraltetes Modell) | PASS (statisch + Unit-Tests); Erkennungsqualität mit echter Stimme BLOCKED (W-02 bis W-06) |
| I-45 | Migration `C:\Jarvis` -> `C:\Friday` | Angebot (Standard ja), wenn `C:\Jarvis\config\install-state.json` existiert und `C:\Friday` nicht. Phasen `stop`, `copy`, `rewrite`, `tasks`, `wsl` (Zustand `C:\Jarvis\migrate-to-friday.json`, wiederholbar), Abschlussmeldung mit Hinweis auf die Sicherung und Löschbefehl. Details: `DEPLOYMENT.md` §12. Sicherungen: alte Aufgaben als XML, Hermes-Dateien vor dem Patch, `C:\Jarvis` unverändert. Fremde `JARVIS_*`-Aufgaben (z. B. `JARVIS_Voice_Watchdog`) und Aufgaben mit Aktionen unter `C:\Jarvis` außerhalb des eigenen Pfads werden nur aufgelistet. Prozesse werden nur beendet, wenn ihre Befehlszeile `C:\Jarvis\` nennt. Bei Ablehnung: frische Installation, alte Dienste auf Wunsch angehalten und Aufgaben deaktiviert | PASS (statisch); Windows BLOCKED |
| I-46 | Migrationsrisiken | (a) kopierte `voice\.venv` am neuen Ort: Import-Test, sonst Neuaufbau in Schritt 12. (b) Command Center wird neu gebaut (kein Kopieren von `node_modules`/Junctions). (c) ACLs der Geheimnisdateien werden nach dem Kopieren neu gesetzt. (d) Kimi-Schlüssel und Hermes-Installation bleiben (Pfad-Patch statt Neuinstallation); nach `restart` Prüfung Dashboard/API = 200. (e) Genug Platz auf C: wird vorher geprüft (Größe × 1,1 + 2 GB). (f) `Get-LauncherProcesses` erfasst jetzt auch `llama-server.exe` (Qwen), nötig für das Beenden des alten Qwen | offen bis Windows-Lauf |

---

## 3. Umgesetzte Fixes

Behoben und in den Commits enthalten:

| Commit | Inhalt |
| --- | --- |
| `e824960` | I-02 bis I-09: robocopy-Exitcode und Neusynchronisation, nvidia-smi-Fallback, `py.exe`-Prüfung, Entfernen defekter ZIPs, ACL vor Schreiben des Schlüssels, `IFS= read`, `set -e`-FAIL-Pfad, ShellCheck |
| `3801c81` | Registry-Retry-Default 1 (Stapelung von Versuchen bei Ausfall beseitigt) |
| `b54c73d` | Orb-Defaults 70/60 statt 1 (Orb wurde mit 1 % gerendert) |
| `119d544` | Namensabfrage vor Stimmaufnahme, persönliches Wake Word, `change-assistant-name.bat` |
| `f31977c` | Schritt 15: Command Center nach `C:\Friday\dashboard`, `update-dashboard.bat`, `SD`, `DEPLOYMENT.md` |

Am 2026-10-15 wurde im Installer die Umbenennung, die Migration und das freie Wake Word umgesetzt (2.7, noch nicht committet, Windows-Lauf offen).
In der **Review**-Session vom 2026-10-14 wurde kein Code geändert und nichts committet. Dieses Dokument ist die einzige Änderung. Ein unabhängiger
`git status` zeigt außerdem uncommittete Arbeit anderer Stränge (`package.json` mit Skript `test:e2e:update`, `playwright.config.ts`,
`tests/e2e/`). Diese wurden nicht angefasst.

Vorgeschlagene Fixes ohne Umsetzung (in dieser Session wegen des Schreibbereichs nicht durchgeführt): I-10, I-18, I-20, I-21, I-22, I-23,
I-25, I-31, I-32, I-33, I-34, I-35, I-36, I-37, I-38, I-40, I-41. Priorität vor dem Windows-Test: **I-32, I-35, I-31, I-41**.

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
13. Übrige Befunde niedriger Schwere: I-21 (UTF-16 in `pip.log`), I-23 (bestehende Distro, `sudo` fehlt),
    I-37 (Anleitung zum Kimi-Key), I-38 (Import in Tests), I-40 (Evidence-Route).
    I-41 (veralteter Integrationstest) ist kein Produktfehler, muss aber vor einer Abnahme behoben sein.

---

## 5. Checkliste für den echten Test auf einem frischen Windows-11-PC

Vorbedingungen aus `ANLEITUNG.md`: Administrator-Konto, NVIDIA-Treiber aktuell, 40 GB frei auf C:, Mikrofon und Lautsprecher, komplettes
Paket entpackt (`installer`, `apps`, `packages`, `adapters`, `config`, `scripts`, `package.json`, `pnpm-lock.yaml` nebeneinander). Der
entpackte Ordner muss bis zum Ende an seinem Platz bleiben. Vor dem Test: den Schritt-Namen aus `install-state.json` notieren, falls
Neustarts nötig werden.

Jeder Schritt ist ein Prüfpunkt. Erst weitergehen, wenn der Erwartungswert erfüllt ist. Bei Fehlern: Logzeile notieren, Problem
beheben, `install-friday.bat` erneut starten. Der Lauf setzt an der Stelle fort.

### 5.1 Schritte im Ablauf

| Schritt | Sichtbar in der Konsole (Erwartung) | Dateien / Ordner | Prüfung |
| --- | --- | --- | --- |
| Start | Doppelklick auf `install-friday.bat`, UAC-Abfrage mit Ja. Gibt es `C:\Jarvis\config\install-state.json` und noch kein `C:\Friday`, zuerst die Migrationsfrage (siehe 5.4). Titel „F.R.I.D.A.Y. – Installation“, Zeile „Dauer: ca. 45–90 Minuten“ | `C:\Friday\{config,exchange,logs,models,scripts,voice,windows-worker,backups,cache,installer}`, `C:\Friday\logs\install-<yyyyMMdd-HHmmss>.log` | Ordner vorhanden, Transkript-Datei wächst |
| Name und Wake Word (vor Schritt 1) | Titel „Dein Assistent“. Frage „Wie soll dein Assistent heißen? [Friday]“. Eingabe Enter. Hinweis zum Wake Word, dann Frage „Mit welchem Wort oder Satz soll Friday geweckt werden? [Hey Friday]“, Enter. Zeile `[OK] Dein Assistent heißt Friday – Wake Word: 'Hey Friday'.` Ungültige Eingaben (mehr als 4 Wörter, Ziffern/Satzzeichen, unter 3 oder über 30 Zeichen) werden mit Hinweis abgelehnt | `C:\Friday\config\install-state.json` mit `assistant_name`, `wake_phrase`, `wake_slug` (`hey_friday`, Slug der **Phrase**), `wake_engine` (`personal`; `openwakeword` nur bei „Hey Jarvis“) | `install-state.json` lesen. Zusatzprobe: Phrase „Computer“ eingeben -> `wake_slug` `computer`, Schritt 13 verlangt 44× die Phrase ohne Kurzform |
| Schritt 1/15 Systemcheck | `Windows-Build … | RAM … GB | … Threads | C: … GB frei`, `Grafikkarte: …`, `[OK] Internet erreichbar` | `install-state.json`: `build`, `ram_gb`, `cores`, `gpu` | – |
| Schritt 2/15 Dateien | `[OK] Dateien liegen in C:\Friday\installer` | `C:\Friday\installer\install-friday.ps1`, `wsl\`, `voice\`, `scripts\`, `common\` | Dateien vorhanden |
| Schritt 3/15 WSL2 | Entweder `[OK] WSL bereit: …`. Oder „WSL wird installiert …“, `Windows muss jetzt neu starten …`, Rückfrage „Jetzt neu starten? (j/n)“ | Bei Neustart: Aufgabe `FRIDAY_Installation_fortsetzen` (nur temporär) | Nach Neustart öffnet sich das Fenster von selbst; die Aufgabe ist danach gelöscht |
| Schritt 4/15 Energie | `[OK] Am Netzteil: kein Standby …` | Energieplan | `powercfg /getactivescheme` |
| Schritt 5/15 Persönlichkeit | Fragen: Vorname; Anrede (1–3); Charakter (1–3); Länge (1–2); „Über mich“. Dann `[OK] Gespeichert (änderbar in C:\Friday\config\persona.json).` | `C:\Friday\config\persona.json` (`assistant_name`, `wake_phrase`, `owner_name`, `address`, `character`, `length`, `about`) | Datei enthält `assistant_name: Friday`, `wake_phrase: Hey Friday` |
| Schritt 6/15 .wslconfig | `[OK] WSL: N GB RAM, N Threads, 8 GB Swap.` | `%USERPROFILE%\.wslconfig` (`[wsl2]`, `networkingMode=mirrored` ab Build 22621), ggf. `C:\Friday\backups\.wslconfig.bak-*` | Datei lesen; `wsl --shutdown` lief |
| Schritt 7/15 Ubuntu | `[OK] Ubuntu ist installiert.` Bei vorhandenem Ubuntu: Rückfrage „Diese verwenden? (j/n)“ (siehe I-23) | WSL-Distribution `Ubuntu` (24.04) | `wsl -l -q` zeigt `Ubuntu` |
| Schritt 8/15 Linux-Benutzer | Frage Benutzername (Standard = Windows-Name in Kleinbuchstaben), Passwort zweimal. Dann `Richte Ubuntu ein …`, graue Zeilen aus WSL, `[OK] Benutzer '<user>' aktiv, systemd läuft.` | In Ubuntu: `/etc/wsl.conf` (`systemd=true`, `default=<user>`), `/var/lib/systemd/linger/<user>`, `~/friday/` | `wsl -d Ubuntu --exec whoami` = Benutzer; `wsl -d Ubuntu --exec ps -p 1 -o comm=` = `systemd` |
| Schritt 9/15 Keepalive | `[OK] Aufgabe FRIDAY_WSL_Keepalive eingerichtet (startet bei jeder Anmeldung).` | Aufgabe `FRIDAY_WSL_Keepalive`; Prozess `wsl.exe … sleep infinity` | `Get-ScheduledTask FRIDAY_WSL_Keepalive` |
| Schritt 10/15 Hermes + Kimi | Falls `KIMI_API_KEY` gefunden: „Verwenden? (j/n)“. Sonst Eingabe des Schlüssels (unsichtbar). Dann `Installiere Hermes …` (10–20 min), graue Ausgabe, `[OK] Kimi K3 antwortet.` (oder `[!] Kimi-Test nicht bestanden`), `[OK] Dashboard von Windows erreichbar: http://127.0.0.1:43691` (oder `[!]`) | In Ubuntu: `~/.hermes/.env` (chmod 600, `KIMI_API_KEY`, `API_SERVER_*`), `~/.hermes/SOUL.md`, `~/.config/systemd/user/hermes-dashboard.service`. Windows: `C:\Friday\config\hermes_api.key` (64 Hex-Zeichen) | `http://127.0.0.1:43691/` (200), `http://127.0.0.1:43693/v1/models` mit Bearer (200). In Ubuntu: `systemctl --user is-active hermes-gateway hermes-dashboard` = `active` |
| Schritt 11/15 Qwen | `llama.cpp-Variante: cuda-13` (RTX 50xx), `cuda-12.4` oder `cpu`. `[OK] llama-b….zip (<tag>) geprüft und entpackt`. `Lade Qwen3-4B (2,5 GB) …`. `[OK] Qwen3-4B geprüft`. `[OK] Qwen antwortet (N,N s): …` | `C:\Friday\llama.cpp\llama-server.exe`, `C:\Friday\models\Qwen3-4B\Qwen3-4B-Q4_K_M.gguf`, `C:\Friday\config\qwen.json`, `C:\Friday\logs\qwen-server.log` und `qwen-server.log.out`. Aufgabe `FRIDAY_Qwen` | `http://127.0.0.1:43692/v1/models` (200); Antwort auf die Testfrage enthält `LOCAL_OK` (modellabhängig) |
| Schritt 12/15 Sprachsteuerung | Ggf. `Installiere Python 3.11 …`. `Python-Pakete (ca. 3 GB, 10–20 min) …`. Zeilen mit `==>`, `DONE` aus `voice_setup.py`. `[OK] Sprachmodelle bereit.` | `C:\Friday\voice\.venv\Scripts\python.exe`, `C:\Friday\voice\*.py` (kopiert, siehe I-31), `C:\Friday\config\voice.json` (`assistant_name` Friday, `wake_phrase` „Hey Friday“, `wake_engine` `personal`, `health_port` 43694), `C:\Friday\models\` (whisper, ecapa, piper), `C:\Friday\logs\pip.log` (UTF-16, I-21) | `voice.json` lesen |
| Schritt 13/15 Stimme | Titel „Schritt 13/15 – Friday lernt deine Stimme“, Liste „26x “Hey Friday”, 18x “Friday”, 15 ähnlich klingende Wörter, 8 kurze Texte“ (ohne Grußwort in der Phrase: „44x “<Phrase>”, 15 ähnlich klingende Wörter (Teile und Varianten der Phrase) …“). Enter, Aufnahmefenster. Danach Zeilen `Profil aus N Fenstern erstellt`, `Kreuzvalidierung 1,5-s-Fenster: …`, `Schwelle …`, `WAKE_QUALITY=…`. Bei `schwach`: `[!]`-Warnung. `[OK] Stimmprofil erstellt (bleibt nur auf diesem PC).` | `C:\Friday\voice\profiles\owner\raw\wake_<Slug der Phrase>\*.wav` (Standard `wake_hey_friday`, >= 20), `raw\speech\*.wav` (>= 6), `raw\wake_<Slug der Kurzform>\*.wav` (Standard `wake_friday`, nur bei Grußwort); `C:\Friday\voice\profiles\owner\embeddings\owner_ecapa.npy`; `C:\Friday\models\openwakeword\personal_wake.npz` und `personal_wake.json` | Dateien zählen. Bei weniger als 20/6: Schleife meldet „Zu wenige Aufnahmen“ |
| Schritt 14/15 Sprachdienst | Titel „Schritt 14/15 – Friday starten“, `Lade die Sprachmodelle (bis zu 3 Minuten) …`. **Keine `[OK]`-Zeile (I-36).** Gesprochene Begrüßung (Standard: „JARVIS ist installiert …“, I-35) | Aufgabe `FRIDAY_Voice` (45 s Verzögerung). Prozesse: `powershell` mit `start-friday-voice.ps1`, `python.exe` mit `friday_voice.py`. Log `C:\Friday\logs\voice-service.log`, `C:\Friday\logs\voice.jsonl` | `http://127.0.0.1:43694` liefert JSON mit `"state":"listening"` |
| Schritt 15/15 Command Center | Titel „Schritt 15/15 – F.R.I.D.A.Y. Command Center (Dashboard) einrichten“. `Ziel: C:\Friday\dashboard | URL: http://127.0.0.1:3100 | Log: …`. `Quelle: …`. `[OK] Node.js … bereit` (oder gefunden). `[OK] pnpm 10.28.2 bereit`. `Prüfe Quellstand …`, `Kopiere das Command Center …`, `pnpm install --frozen-lockfile …` (einige Minuten), `pnpm build:app …`, `[OK] Command Center gebaut.` `[OK] dashboard.yaml geschrieben: …`, `[OK] adapters.yaml geschrieben: …`. Passwortabfrage (mind. 12 Zeichen, zweimal). `[OK] Owner-Passwort gesetzt (Hash in …dashboard_owner.hash, nur für <user> lesbar).` `[OK] Aufgabe FRIDAY_Dashboard eingerichtet …`. `Warte auf das Command Center (bis zu 60 Sekunden) …`. `[OK] Command Center läuft: http://127.0.0.1:3100 (Health 200)` | `C:\Friday\dashboard\apps\control-api\dist\main.js`; `C:\Friday\dashboard\apps\web\out\` (nicht leer); `C:\Friday\dashboard\config\dashboard.yaml`, `adapters.yaml`; `C:\Friday\config\dashboard_owner.hash`; `C:\Friday\logs\dashboard-install.log`, `C:\Friday\logs\dashboard-service.log`; Aufgabe `FRIDAY_Dashboard`; `install-state.json` mit `dashboard`, `dashboard_hash`, `dashboard_source`, `dashboard_pnpm` | `http://127.0.0.1:3100/api/v1/health` (200) |
| Zusatz Watchdog (nach Schritt 15) | Titel „Zusatz – Service-Watchdog einrichten“. `[OK] Aufgabe FRIDAY_Watchdog eingerichtet (alle 5 Minuten und bei Anmeldung, unsichtbar). Log: C:\Friday\logs\watchdog.log`. Bei Fehler nur `[!]`-Warnung, Installation läuft weiter | Aufgabe `FRIDAY_Watchdog` (Aktion `wscript.exe //B //Nologo …\hidden.vbs …\friday-watchdog.ps1`, Trigger: Anmeldung +120 s und Wiederholung alle 5 min); `C:\Friday\installer\scripts\friday-watchdog.ps1`; `install-state.json` mit `watchdog`; `C:\Friday\run\installer.active` existiert bis zum Ende des Installers | `Get-ScheduledTask FRIDAY_Watchdog \| Select -Expand Actions`; nach dem Installer erste Zeile (spätestens nach 60 min `Heartbeat`) in `watchdog.log`; **kein** Fenster, das alle 5 min aufblitzt |
| Abschluss | `INSTALL_STATE.md`, Titel „FERTIG – Friday ist einsatzbereit“, Zeile „Sag: “Hey Friday” …“, Rückfrage „Command Center jetzt im Browser öffnen? (j/n)“ | `C:\Friday\INSTALL_STATE.md` | Datei enthält alle Adressen (Abschnitt „Installationsstatus“) |

Hinweis zu Schritt 15: Ein Fehler dort beendet den Installer (I-33). `INSTALL_STATE.md` und die Schlussmeldung entfallen dann. Die
Dienste von Schritt 10, 11 und 14 laufen weiter. Die Meldung „Command Center nicht erreichbar“ steht im Abschluss, wenn der Health-Check
scheitert.

### 5.2 Aufgaben, Ports, Logs (exakte Namen)

**Geplante Aufgaben** (Aufgabenplanung, Trigger „bei Anmeldung“ des Installationsbenutzers):

| Name | Startet | Hinweis |
| --- | --- | --- |
| `FRIDAY_WSL_Keepalive` | sofort bei Anmeldung | hält WSL wach |
| `FRIDAY_Qwen` | sofort | `llama-server` auf 43692 |
| `FRIDAY_Voice` | 45 s nach Anmeldung | Schleife, bis zu 120 s Wartezeit auf Qwen |
| `FRIDAY_Dashboard` | 60 s nach Anmeldung | Schleife, Neustart nach 10 s |
| `FRIDAY_Watchdog` | 120 s nach Anmeldung, dann alle 5 min | unsichtbar über `hidden.vbs`; ein Durchlauf, startet abgestürzte Dienste neu (I-42); Log `watchdog.log` |
| `FRIDAY_Installation_fortsetzen` | nur nach WSL-Neustart, Highest | wird beim nächsten Lauf gelöscht |

Systemd in Ubuntu: `hermes-gateway` (Hermes-eigene Unit, `hermes gateway install`), `hermes-dashboard` (`~/.config/systemd/user/hermes-dashboard.service`).

**Ports** (alle nur 127.0.0.1):

| Port | Dienst | Prüfung |
| --- | --- | --- |
| 3100 | Command Center (Web + Control API) | `http://127.0.0.1:3100/` (Login-Seite), `http://127.0.0.1:3100/api/v1/health` (200; 503 = Teilausfall) |
| 43691 | Hermes-Dashboard | `http://127.0.0.1:43691/` (200, ohne Auth) |
| 43692 | Qwen3-4B (llama-server) | `http://127.0.0.1:43692/v1/models` (200) |
| 43693 | Hermes-API-Server | `http://127.0.0.1:43693/health` (200, ohne Auth); `/v1/models` nur mit `Authorization: Bearer <Inhalt von C:\Friday\config\hermes_api.key>` (200) |
| 43694 | Voice-Statusserver | `http://127.0.0.1:43694` (JSON, Feld `state`; Port ist während des Modellladens geschlossen) |

**Log-Dateien unter `C:\Friday\logs`:**

| Datei | Inhalt |
| --- | --- |
| `install-<yyyyMMdd-HHmmss>.log` | Transkript des Installers (je Lauf eine Datei) |
| `pip.log` | pip-Ausgabe Schritt 12 (UTF-16, I-21) |
| `qwen-server.log`, `qwen-server.log.out` | stderr und stdout von `llama-server` |
| `voice-service.log` | Start/Ende, Transkripte im Klartext (I-20) |
| `voice.jsonl` | Metadaten (`wake`, `wake_rejected`, `command`, …) |
| `dashboard-install.log` | Schritt 15: winget, corepack, pnpm |
| `dashboard-service.log` (+ `.1`) | Start/Ende des Command-Center-Prozesses, stdout/stderr |
| `watchdog.log` (+ `.1`) | Service-Watchdog: Neustarts, Warnungen, stündlich `Heartbeat` (I-42) |
| `dashboard\` | JSON-Logs der Anwendung. Dateinamen werden von der Anwendung bestimmt und sind hier nicht geprüft |
| `C:\Jarvis\logs\migrate-to-friday-<Zeit>.log` (alte Wurzel!) | Transkript der Übernahme (nur bei Migration), dazu `C:\Jarvis\migrate-to-friday.json` und `migration-tasks\*.xml` |

Hermes-Logs liegen in Ubuntu (`journalctl --user -u hermes-gateway`, `journalctl --user -u hermes-dashboard`), nicht unter `C:\Friday\logs`.

### 5.3 Funktionale Endtests

| Test | Ausführung | Erwartung |
| --- | --- | --- |
| Wake Word | Das gewählte Wake Word („Hey Friday“) sagen, dann eine Frage („Wie spät ist es?“). Zusätzlich: Kurzform („Friday“), falsche Nachbarwörter („Freitag“, „Frieda“) und bei eigener Phrase deren Teile (z. B. nur „Guten Morgen“) dürfen **nicht** auslösen bzw. werden von Stufe 2 abgewiesen (`wake_rejected` steigt) | `http://127.0.0.1:43694`: `state` wechselt `listening` -> `command` -> `speaking` -> `followup` -> `listening`. `wake_count` steigt. `voice.jsonl` enthält ein `wake`-Ereignis. Die Antwort kommt hörbar |
| Command Center: Übersicht | `http://127.0.0.1:3100/` (Login `owner`, Passwort aus Schritt 15) | Live-Daten; Quellen-Badges: Aufgaben und Agenten `hermes`, Sprache `friday-voice` (Adapter `friday-voice-http`), System `local-system`. CPU/RAM sind echte Messwerte |
| Command Center: Aufgaben | `/tasks` | Liste aus dem Hermes-Kanban (Board `default`), Badge `hermes`. Leere Liste ist gültig, wenn Hermes keine Aufgaben hat |
| Command Center: Agenten | `/agents` | Hermes-Profile, Badge `hermes` |
| Command Center: Sprache | `/voice` | Modus „Bereit“, Wake Word wie gewählt (Standard „Hey Friday“), Modell `qwen3-router` |
| Command Center: System | `/system` | Dienste Qwen, Hermes-API, Hermes-Dashboard, Voice online; Modelle `qwen3-router` und `friday`; Badge `local-system` |
| Watchdog: Dienst-Neustart (I-42) | `Start-ScheduledTask FRIDAY_Watchdog` zur Kontrolle (kein Fenster). Dann `python.exe` mit `friday_voice.py` **und** den Launcher-`powershell` beenden (Sprachdienst ist danach ohne Prozess) und bis zu 5 min warten | `watchdog.log`: `Sprachdienst: Port 43694 antwortet nicht, kein Prozess - Aufgabe FRIDAY_Voice neu gestartet.`; nach Modellladen `state` `listening`. Kein Neustart, solange nur das Modell lädt oder `C:\Friday\run\start-friday-voice.ps1.stop` existiert |
| Sprachdienst stoppen (Ausfall) | **Vorher** `schtasks /change /tn FRIDAY_Watchdog /disable` (sonst startet der Watchdog den Dienst binnen 5 min neu; danach `/enable`). **Nicht** nur `Stop-ScheduledTask FRIDAY_Voice` (I-32). Stattdessen: `start-friday-voice.ps1`-Prozess und `python.exe`-Prozess mit `friday_voice.py` beenden (Abfrage über `Get-CimInstance Win32_Process`) | `http://127.0.0.1:43694` nicht erreichbar. Sprache-Seite zeigt „Nicht verbunden“, Voice-Dienst „Offline“. Übrige Bereiche (Aufgaben, Agenten, Übersicht, System) bleiben nutzbar |
| Sprachdienst neu starten | `Start-ScheduledTask FRIDAY_Voice` (Ausfall vorher beenden, sonst zwei Instanzen) | Nach bis zu 3 min Modellladen: `state` `listening`; Command Center zeigt Sprache wieder „Bereit“ |
| Hermes stoppen (optional) | In Ubuntu `systemctl --user stop hermes-dashboard` (und/oder `hermes-gateway`) | Aufgaben und Agenten zeigen „nicht verfügbar“, Sprache und übrige Bereiche laufen weiter |
| Neustart Windows | Neustart, dann anmelden als Installationsbenutzer | Nach Anmeldung starten `FRIDAY_WSL_Keepalive`, `FRIDAY_Qwen`, `FRIDAY_Voice` (+45 s), `FRIDAY_Dashboard` (+60 s). Ports 3100, 43691–43694 erreichbar. Hinweis: Die Aufgaben laufen erst nach **Anmeldung**, nicht beim Boot |
| Update des Command Centers | `update-dashboard.bat` aus neuem Paket | Quellhash geändert -> Build; Konfiguration bleibt. Sprachdienst wird **nicht** aktualisiert (I-31) |

### 5.4 Migration einer bestehenden Installation (`C:\Jarvis` -> `C:\Friday`)

Testet den Eigentümer-PC mit einer funktionierenden JARVIS-Installation. **Vorher** (Sicherheitsnetz): eine Liste der Aufgaben notieren
(`Get-ScheduledTask JARVIS_* | Select TaskName, State`), `C:\Jarvis\config\install-state.json` sichern, `wsl -d Ubuntu --exec ls ~` (zeigt `jarvis`) notieren.
Das **vollständige** neue Paket entpacken und `install-friday.bat` starten (UAC mit Ja).

| Phase | Erwartung in der Konsole | Zustand danach | Prüfung |
| --- | --- | --- | --- |
| Angebot | Titel „Vorhandene Installation gefunden“, fünf Zeilen Erklärung, Frage „Bestehende Installation nach C:\Friday übernehmen? (j/n) [j]“. **Nur wenn `C:\Friday` nicht existiert** | `C:\Jarvis\migrate-to-friday.json` mit leerer `phases`-Liste | Zweiter Lauf mit bereits vorhandenem `C:\Friday` und ohne Marker: **keine** Frage |
| `stop` (1/4) | „alte Dienste anhalten …“; kein Fenster bleibt offen | `JARVIS_Watchdog` deaktiviert; Prozesse `start-jarvis-voice.ps1`, `python.exe … jarvis_voice.py`, `llama-server.exe`, `node … control-api` mit Pfad `C:\Jarvis\` beendet | Ports 43692, 43694, 3100 antworten nicht mehr (43691/43693 gehören zu Hermes in WSL und laufen weiter); `Get-CimInstance Win32_Process` zeigt keine Prozesse mit `C:\Jarvis\`; **fremde** Prozesse (anderer Pfad) laufen weiter |
| `copy` (2/4) | „Zu kopieren: ca. N GB, frei auf C: M GB“, dann robocopy-Lauf (einige Minuten). Bei zu wenig Platz Abbruch mit Hinweis | `C:\Friday` mit `config`, `models`, `voice` (inkl. `profiles`, `.venv`), `llama.cpp`, `logs`, `exchange`, `backups`, `dashboard\{config,data,backups}`; **kein** `C:\Friday\installer`, kein `dashboard\node_modules`, kein `voice\jarvis_voice.py` | Stichproben: `C:\Friday\voice\profiles\owner\embeddings\owner_ecapa.npy` vorhanden; Größe `C:\Friday\models` = `C:\Jarvis\models` |
| `rewrite` (3/4) | „umgeschrieben: config\install-state.json …“ je Datei, `[OK] N Datei(en) umgeschrieben.`, ggf. `voice.json: hermes_model jarvis → friday`, Venv-Test; bei Fehler Warnung „Python-Umgebung … neu aufgebaut“ | `Select-String -Path C:\Friday\config\*,C:\Friday\dashboard\config\* -Pattern 'Jarvis' -SimpleMatch` ohne Treffer (außer Absicht); `install-state.json`: `done` ohne `files`, `voiceservice`, `dashboard`, `watchdog`; `migrated_from`; `hermes_api.key`/`dashboard_owner.hash` nur für Benutzer und SYSTEM (`icacls`) | JSON gültig (`Get-Content … \| ConvertFrom-Json`); `dashboard.yaml`/`adapters.yaml` mit `@friday/…`, `friday-voice-http`, `friday-command-*` |
| `tasks` (4/4) | je Aufgabe `[OK] Alte Aufgabe JARVIS_… entfernt (Sicherung: …xml)`, `[OK] Aufgabe FRIDAY_WSL_Keepalive …`, `[OK] Aufgabe FRIDAY_Qwen …`; für fremde Aufgaben mit Aktion unter `C:\Jarvis` (auf dem Eigentümer-PC `JARVIS_Voice_Watchdog`): Liste mit Aktion und Frage „Diese Aufgaben jetzt DEAKTIVIEREN …? [j]“ | `C:\Jarvis\migration-tasks\*.xml` und `foreign-*.xml`; `Get-ScheduledTask JARVIS_Voice_Watchdog` existiert weiter, `State` = `Disabled` (nach *ja*); `FRIDAY_WSL_Keepalive`, `FRIDAY_Qwen` vorhanden; `migrate-to-friday.json` enthält unter `disabled` den Enable-Befehl | Fremde Aufgaben werden **nie gelöscht**; bei *nein* bleiben sie aktiv (Warnung). Nach *ja* startet der alte Sprachdienst auf 43694 nicht mehr neu (5 min warten, `Get-NetTCPConnection -LocalPort 43694` gehört `friday_voice.py` aus `C:\Friday`). Ein **TTS-Server auf 43695** der alten Installation wird **nicht migriert** (prüfen, ob er noch läuft und auf `C:\Jarvis` zeigt) |
| Schritt 2 danach | `[OK] Dateien liegen in C:\Friday\installer`, Sprachdateien synchronisiert (`friday_voice.py` neu) | `C:\Friday\installer\install-friday.ps1`, `wsl\migrate_paths.sh` | – |
| `wsl` | Titel „Übernahme: Hermes und Dienste umstellen“, graue Ausgabe von `migrate_paths.sh`, `MIGRATE_WSL_DONE`; `[OK] Hermes verwendet jetzt /mnt/c/Friday und das Modell "friday".`; `[OK] Qwen läuft aus C:\Friday.` | In Ubuntu: `~/friday` statt `~/jarvis`, `grep -c /mnt/c/Jarvis ~/.hermes/config.yaml ~/.hermes/.env` = 0, `API_SERVER_MODEL_NAME=friday`, Sicherungen in `~/friday/backups`, `SOUL.md` mit `/mnt/c/Friday` | `curl http://127.0.0.1:43693/v1/models` mit Bearer -> `friday`; `systemctl --user is-active hermes-gateway hermes-dashboard` = `active`; **Kimi-Schlüssel nicht erneut abgefragt** |
| Weiter mit Schritten 3–15 | übersprungene Schritte, Wake-Phrase-Frage entfällt (Aufnahmen vorhanden); Schritt 12 nur bei defekter Venv; Schritt 14: `FRIDAY_Voice`, Begrüßung; Schritt 15: Rebuild, Passwortabfrage „Neu setzen?“ -> **n** (Hash wurde kopiert); `dashboard.yaml` weicht eventuell von der Vorgabe ab -> Überschreiben-Frage mit **n** | `FRIDAY_Voice`, `FRIDAY_Dashboard`, `FRIDAY_Watchdog` vorhanden; Command Center unter `http://127.0.0.1:3100`, **alter Login funktioniert**, alte Daten sichtbar | Wake Word wie vorher; `http://127.0.0.1:43694` zeigt `wake_phrase`; Watchdog-Log |
| Abschluss | Titel „Übernahme abgeschlossen“: Hinweis, dass `C:\Jarvis` als Sicherung bleibt, Pfade der Sicherungen, Löschbefehl, die deaktivierten fremden Aufgaben mit `Enable-ScheduledTask -TaskName '…'`, Hinweis zum nicht migrierten TTS-Server (43695), Liste der übrigen nicht angefassten Aufgaben | `migrate-to-friday.json`: `finished: true` | Neustart der Windows-Anmeldung: nur `FRIDAY_*`-Dienste starten, nichts aus `C:\Jarvis` (Prozessliste) |

Fehlerpfade (jeweils absichtlich herbeiführen): (1) Fenster während `copy` schließen -> Neustart des Installers setzt bei `copy` fort (keine zweite Frage).
(2) Nach `tasks` abbrechen -> der nächste Lauf überspringt `stop`–`tasks`. (3) Migration ablehnen (frischer PC-Zustand mit `C:\Jarvis`, ohne `C:\Friday`) -> Frage nach dem Anhalten der alten Dienste und nach dem Deaktivieren fremder Aufgaben mit Pfad `C:\Jarvis` (mit Enable-Befehlen);
danach läuft eine frische Installation, `JARVIS_*` bleiben deaktiviert, aber vorhanden. (4) `wsl --shutdown` vor der Phase `wsl` -> das Skript startet Ubuntu selbst.
**Löschen der Sicherung** erst nach mindestens einem Neustart und einem funktionierenden Wake-Word-/Command-Center-Test: `Remove-Item -Recurse -Force C:\Jarvis`.

---

## 6. Entscheidungen des Owners

Entschieden am 2026-10-15 (für den Installer umgesetzt, siehe 2.7):

1. **Internes Umbenennen** `@jarvis/*` -> `@friday/*`, `JARVIS_*` -> `FRIDAY_*` (Control API akzeptiert die alten Variablen mit Warnung), Pfade `C:\Jarvis` -> `C:\Friday`,
   Hermes-Modellname `jarvis` -> `friday`. Im Installer umgesetzt; Migration bestehender Installationen: 2.7 und 5.4.
2. **Wake Word** wird immer frei gefragt (Standard „Hey <Name>“), nicht aus dem Namen abgeleitet; vortrainiert nur exakt „Hey Jarvis“.
3. **Stimme unverändert:** Jarvis-Stimme (Thorsten, Piper) plus Filmfilter (`tts_film_filter`) bleiben (`voice_models\jarvis_de.onnx` als optionale eigene Stimme, `film_filter.py`).

Weiterhin offen:

1. **Autor-Umschreiben der Git-Historie** (Force-Push). Irreversibel für Remotes und Klone.
2. **Hermes-Version pinnen** (Commit oder Tag; Prüfsumme des Installers). Betrifft H-06, I-22.
3. **Wake-Word-Verfahren**, falls die Qualität mit echter Stimme nicht reicht: z. B. ein eigenes openWakeWord-Modell für die Phrase trainieren.
   Bisher nur das persönliche Verfahren (Stufen 1 bis 3).

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
- Befund I-42 (Service-Watchdog) ergänzt, außerdem Eintrag in Checkliste 5.1 (Zusatzschritt), Aufgabenliste 5.2, Log-Liste und Endtests 5.3 (Ausfalltest erfordert deaktivierten Watchdog). Nur statisch und per Entscheidungs-Unit-Tests unter pwsh/Linux geprüft; Windows-Lauf offen.
- 2026-10-15: Pfade, Aufgaben-, Datei- und Paketnamen in Befunden und Checkliste auf `C:\Friday`/`FRIDAY_*`/`install-friday.*`/`friday_voice.py`/`@friday/*` umgestellt
  (Zeilennummern nicht), I-29 als behoben markiert, neuer Abschnitt 2.7 (I-43 bis I-46), Checkliste 5.1 um Wake-Phrase-Abfrage und Migration ergänzt, neuer Abschnitt 5.4
  (Migration), Abschnitt 6 auf die Eigentümer-Entscheidungen umgestellt. Historische Beschreibungen des Fehlers I-35 („JARVIS ist installiert“) und der Fremdaufgabe
  `JARVIS_Voice_Watchdog` bleiben wörtlich stehen.
