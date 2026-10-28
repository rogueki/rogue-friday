# INS-11 - Command Center mit Creator Studio ausliefern

Stand: 2026-10-22. Branch `feat/friday-finalization-20261021`, Commit folgt.

Ziel laut Masterplan: der Installer liefert das Creator Studio als Standardpaket aus dem integrierten kanonischen
Stand aus (Route, Menue, Assets, API, Contracts, Migrationen, Voice-Bridge, Skills) und haengt nicht von einem
unveroeffentlichten Sonderbranch ab. Abnahme: frischer Zielordner zeigt Menue und echte Route, der Plan ueberlebt
einen Neustart, FFmpeg laeuft, lokale Produktion mit synthetischen Medien, externe Konten ehrlich unverbunden,
kein Legacy-UUID-/Integer-Pfad als finaler Adapter, Sicherung mit Manifest und Datenbank-Restoreprobe.

## 1. Befund im Quellstand

| Anforderung | Befund vor der Aenderung | Bewertung |
|---|---|---|
| Creator Studio im Paket | Route `apps/web/src/app/(dashboard)/content-studio/page.tsx`, Feature `features/content-studio`, Dienste `content-studio*.ts`, Contracts-Schema, 18 Tests vorhanden | vorhanden |
| Auslieferung | `Sync-DashSource` kopierte `apps, packages, adapters, scripts` und die Wurzeldateien per robocopy, Build-Ausgaben ausgeschlossen; der Hash war ein zweites Mal im Installer implementiert | funktioniert, aber doppelt gepflegt |
| Menue und Route im frischen Ziel | `navModel.tsx` zeigt den Eintrag nur bei `dashboard.contentStudioEnabled === true`; `defaultSettingsAreas` setzte **false**, die Installer-YAML enthielt den Schluessel nicht | **Luecke**: frischer Zielordner ohne Menue, API antwortet 403 |
| Sicherung vor dem Update | `Backup-CustomDashboard` kopierte Konfiguration, Builds und Zustandsdatei, ohne Manifest und **ohne `data/dashboard.sqlite` samt WAL** | **Luecke**: Rollback haette einen Build mit leerem Zustand zurueckgebracht |
| FFmpeg | `Find-FFmpeg` (auch `FRIDAY_FFMPEG_PATH`), `Ensure-FFmpeg` mit winget, Versionspruefung, Aufruf im Dashboard-Schritt | vorhanden |
| Legacy-UUID/Integer | kein Adapter in `adapters/` gibt einen Legacy-Pfad als finalen Adapter aus; die Platzhalter sind im Live-Betrieb nicht eingetragen | in Ordnung |
| Skills | die benoetigten Faehigkeiten liegen als API-Handler im Paket (`handlers/powerpoint.ts`, Route-Table `/api/v1/skills/...`); `skills/` ist nur ein Platzhalter | Auslieferung ueber `apps/` gedeckt |

## 2. Aenderungen

- `installer/lib/dashboard-sync.ps1` (neu): Dateiliste, Inhaltshash und Kopie an einer Stelle. Quellordner mit
  `/MIR` (entfernt Veraltetes, laesst ausgeschlossene Ordner im Ziel unberuehrt), `config` mit `/E` und Erhalt von
  `dashboard.yaml`/`adapters.yaml`.
- `installer/lib/dashboard-backup.ps1` (neu): Manifest v1 mit relativer Datei, Groesse und SHA-256 je Datei sowie
  Anlass; `Test-DashboardBackup` prueft Bestand, Groesse und Pruefsumme; `Restore-DashboardState` prueft vor dem
  Schreiben und wirft bei jeder Abweichung.
- `installer/install-friday.ps1`: `Get-SourceHash` und `Sync-DashSource` delegieren an das Sync-Modul,
  `Backup-CustomDashboard` sichert zusaetzlich `data/dashboard.sqlite`, `-wal`, `-shm`,
  `dashboard-revision.json` und `audit-head.json` ueber das Manifest.
- Creator Studio als Standardpaket: `ui.contentStudio` im Konfigurationsschema mit Standard `true`,
  `defaultSettingsAreas` uebernimmt den Wert (`contentStudioEnabled: config.ui.contentStudio`), die Installer-YAML
  schreibt `contentStudio: true`, die Beispielkonfiguration nennt den Schalter. Abschalten bleibt moeglich
  (Konfiguration `false`, Einstellungen in der Oberflaeche).
- Tests `apps/control-api/test/content-studio-plan.test.ts` und `content-studio-providers.test.ts` stellen den
  AUS-Zustand jetzt ausdruecklich her, statt sich auf den Standard zu verlassen; der Test selbst bleibt damit
  aussagekraeftig fuer den deaktivierten Fall.

## 3. Nachweise

| Nachweis | Ergebnis |
|---|---|
| `installer/tests/dashboard-sync-backup.Tests.ps1` | PASS, 72 Zusicherungen: Creator-Studio-Artefakte (Route, Feature, Dienste, Migration, Voice-Bridge, Skill-Handler, Contracts) kommen an, Build-Ausgaben (`node_modules`, `.next`, `dist`, `out`) nicht, vorhandener Build bleibt, lokale Konfiguration bleibt, Hash stabil und aenderungssensitiv, Sicherung mit Manifest, Schaeden werden abgelehnt, **echte SQLite-Datenbank** gesichert, ueberschrieben, wiederhergestellt und ueber `node:sqlite` wieder gelesen |
| `vitest --project node content-studio` | 5 Dateien, 18 Tests PASS (Plan mit Revisionsvergleich, Medien, Produktion, Provider, Tuerschluessel ueber Neustart) |
| `vitest packages/config/src/config.test.ts` | 48 Tests PASS, inklusive neuer Test "liefert Creator Studio standardmaessig und respektiert ein ausdrueckliches Opt-out" |
| `vitest --project node settings` | 9 Dateien, 72 Tests PASS |
| `vitest --project web navModel ContentStudioPage` | 2 Dateien, 5 Tests PASS (Menueeintrag und Seite) |
| `contracts:check` | `lint`, `validate`, `check-generated`, `breaking` bestanden |
| `tsc --noEmit` | control-api, config, web, contracts je Exit 0 |
| FFmpeg (echt) | `ffmpeg.exe` gefunden, erste Zeile `ffmpeg version ...`; `FRIDAY_FFMPEG_PATH` wird beachtet |
| Installer-Suite | **34/34 Exit 0 in 477 s** (mit dem neuen `dashboard-sync-backup.Tests.ps1`) |

## 4. Offen

- Physischer Lauf in einen frischen Zielordner (gehoert zu INS-13/REL-03): Menue im Browser, Route, Plan nach
  Dienstneustart, Produktion mit synthetischen Medien, externe Konten als nicht verbunden.
- Klicktest des Menueeintrags in einem echten Browser (`pnpm test:e2e` ist nicht Teil dieses Schritts).
- Wiederherstellung im laufenden Betrieb (Dienst gestoppt, WAL-Dateien konsistent) als Betriebsprobe - REL.

## 5. Ledger-Bezug

- `N-039`: Creator Studio war im frischen Ziel nicht sichtbar (Standard false, Installer-YAML ohne Schalter) -
  behoben durch `ui.contentStudio` (Standard true), Ableitung in den Einstellungen und Installer-YAML.
- `N-040`: Die Sicherung vor einem Update hatte kein Manifest und keine Datenbank - behoben durch
  `dashboard-backup.ps1` und die zusaetzlichen Eintraege im Installer.
- Beide Nachweise sind reproduzierbar; die Installer-Suite bleibt gruen.