# DASH-02.05 - Sicherung vor Migration und Vertragsversion

Stand: 2026-10-22. Branch `feat/friday-finalization-20261021`.

## 1. Befund im Quellstand

- `openDatabase` rief `migrate` ohne jede Sicherung. Eine Schema-Migration lief also ohne Rueckweg; bei einem Fehler
  mitten in der Migration blieb nur der ROLLBACK der laufenden Transaktion, nicht der Stand davor.
- Eine alte Vertragsversion war zur Laufzeit nicht erkennbar: `CONTRACT_VERSION` wurde in Antworten gesendet, aber
  kein Client konnte sagen, welche Version er spricht, und die API haette eine fremde Hauptversion still falsch
  gedeutet.

## 2. Aenderungen

**Sicherung vor Migration** (`apps/control-api/src/db/database.ts`)

- `openDatabase` prueft vor dem Migrieren, ob die Datei **schon existiert** und ob Migrationen **ausstehen**
  (`pendingMigrations`). Nur dann entsteht eine Kopie; eine frische Installation und eine In-Memory-Datenbank
  erzeugen keine Sicherung.
- `backupBeforeMigration` leert zuerst das WAL (`PRAGMA wal_checkpoint(TRUNCATE)`), kopiert dann die Datei nach
  `<datenbank>.pre-migrate-<zeitstempel>.bak` und behaelt die letzten drei Kopien.
- `listMigrationBackups(path)` listet die Kopien, neueste zuerst.
- `restoreMigrationBackup(backup, target)` prueft die Kopie **vor** dem Ueberschreiben: `PRAGMA integrity_check`
  muss `ok` sein und die Kopie muss eine `schema_migrations`-Tabelle enthalten; sonst bricht der Aufruf ab und die
  Zieldatenbank bleibt unberuehrt. Nach dem Zurueckspielen werden `-wal`/`-shm` entfernt, damit kein alter
  WAL-Inhalt die Kopie ueberlagert. Es wird nie eine neue Datenbank angelegt.

**Vertragsversion** (`apps/control-api/src/contract-version.ts`, `apps/control-api/src/http/server.ts`)

- Optionaler Header `X-Friday-Contract-Version`. Fehlt er, bleibt das Verhalten unveraendert (abwaertskompatibel).
  Nennt er eine andere Hauptversion, antwortet die API mit **409 CONFLICT** (`details.reason =
  contract_version_unsupported`, `received`, `supported`) und der Meldung, welche Version diese Installation spricht
  und dass nichts geaendert wurde. Eine unlesbare Version (nicht `x.y.z`) ergibt **400 VALIDATION_FAILED**
  (`reason = contract_version_malformed`). Innerhalb derselben Hauptversion sind Minor/Patch additiv und erlaubt.
- Kein neuer Fehlercode und keine Vertragsmodell-Aenderung: der Header ist eine zusaetzliche, freiwillige Auskunft
  des Clients, deshalb bleibt `contracts:check` unveraendert gueltig.

## 3. Nachweise (frisch gelaufen)

| Nachweis | Ergebnis |
|---|---|
| `apps/control-api/test/db-migration-backup.test.ts` | **4 Tests gruen**: frische Datei ohne Sicherung; bestehende Installation mit ausstehender Migration erzeugt genau eine Sicherung; vier Migrationslaeufe halten die letzten drei Kopien; Rueckspielen stellt den Stand wieder her, die Migration laeuft erneut und `integrity_check=ok`; eine beschaedigte Kopie wird abgelehnt und die Datenbank bleibt unveraendert; In-Memory schreibt keine Datei |
| `apps/control-api/test/contract-version-compat.test.ts` | **4 Tests gruen**: ohne Header 200, gleiche Hauptversion 200 (2.0.0 und 2.7.3), fremde Hauptversion 409 mit klarer Meldung und **ohne Aenderung** an den Einstellungen, fehlerhafte Version 400, alte Daten mit gesetzter Version unveraendert lesbar |
| vollstaendige Node-Suite (`--maxWorkers=2`) | **191 Dateien, 2789 Tests gruen, 60 uebersprungen, Exit 0 in 222 s** |
| `tsc -p apps/control-api/tsconfig.json --noEmit` | 0 Fehler |

Der Drill arbeitet auf echten SQLite-Dateien: die Testdatei baut den Zustand einer Installation **vor** der letzten
Migration nach (Migrationsmarke entfernen und die von ihr angelegte Tabelle fallen lassen), migriert, sichert und
spielt zurueck.

## 4. Rueckspielanleitung (geprueft)

1. Dienst stoppen, damit keine Verbindung mehr auf der Datei liegt.
2. Sicherung auswaehlen: die neueste Datei `<datenbank>.pre-migrate-<zeitstempel>.bak` neben der Datenbank; die
   letzten drei Staende bleiben erhalten.
3. Pruefen: `PRAGMA integrity_check` auf der Kopie muss `ok` melden und `schema_migrations` vorhanden sein -
   genau das macht `restoreMigrationBackup` vor dem Kopieren.
4. Zurueckspielen: `restoreMigrationBackup("<...>.bak", "<datenbank>")` (oder die `.bak` ueber die Datenbank kopieren
   und `-wal`/`-shm` loeschen).
5. Dienst starten: die fehlende Migration laeuft erneut; vorher entsteht wieder eine Sicherung. Konten, Entwuerfe und
   Plaene bleiben erhalten (im Test byte-gleich geprueft).

## 5. Ergebnis

DASH-02.05 ist umgesetzt und belegt; `N-043` auf `CLOSED_VERIFIED`. Offen bleibt nur die physische Abnahme der
Gesamtinstallation (INS-13/REL) und die feldweise Rueckleseprobe der Einstellungen (KEEP-04).