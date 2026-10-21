# INS-02 — Installer-I/O-Vertrag, Zustandsmaschine und vollständige Prompt-Inventur

Stand: 2026-10-22. Geprüft an `install-friday.ps1` (2 574 Zeilen) und `install-friday-gui.ps1` (666 Zeilen).
Kein Installationslauf; alle Prüfungen sind statisch (PowerShell-AST) plus GUI-Renderprobe im Simulationsmodus.

## 1. Transportvertrag (GUI → Backend), eingefroren als `protocol: 1`

Der grafische Assistent startet den Installer als Kindprozess mit `-GuiConfigPath <datei>`.
Die Datei liegt unter `%LOCALAPPDATA%\FridayInstaller\<guid>.json`, ACL nur für den Installationsbenutzer,
und wird vom Backend **nach dem Einlesen gelöscht** (`install-friday.ps1:44-61`).

```json
{ "protocol": 1,
  "answers": { "<key>": "<string>" },
  "secrets": { "<key>": "<DPAPI-Ciphertext, ConvertFrom-SecureString>" },
  "simulation": "success" | "failure" | "restart"   // nur im Testpfad
}
```

- Unbekanntes Protokoll → Abbruch mit `Unbekanntes GUI-Protokoll`, bevor irgendetwas angelegt oder geändert wird.
- Fehlendes `answers`/`secrets` → derselbe Abbruch.
- Secrets werden nie als Argument übergeben, nie geloggt; `Gui-Secret` entschlüsselt sie über DPAPI.
- Nicht-Geheimnisse, die einen WSL-Neustart überleben müssen, kopiert das Backend nach `install-state.json → gui_pending`
  (20 Schlüssel), bevor die Transportdatei gelöscht wird.

**28 Antworten** (`answers`): `assistantName`, `wakePhrase`, `ownerName`, `about`, `linuxUser`, `voiceMode`,
`voiceChoice`, `voiceReference`, `voiceId`, `inputDevice`, `outputDevice`, `address`, `character`, `length`,
`migrateLegacy`, `disableLegacy`, `reuseDistro`, `disableForeignTasks`, `overwriteDashboardConfig`, `keepIdentity`,
`repeatEnrollment`, `retryEnrollment`, `openBrowser`, `useExistingKimi`, `restartNow`, **`providerChoice`**,
**`modelBaseUrl`**, **`modelName`**.

**7 Geheimnisse** (`secrets`): `linuxPassword`, `linuxPasswordRepeat`, `kimiKey`, `elevenlabsKey`,
**`openaiKey`**, **`anthropicKey`**, **`customKey`**.

## 2. Ereignisvertrag (Backend → GUI)

Rein zeilenorientiert über stdout/stderr; die GUI färbt und filtert nur, sie interpretiert keine Struktur:

| Muster | Bedeutung |
|---|---|
| `Schritt <n>` | Fortschrittsmarke, setzt die Statuszeile |
| `[GUI] <text>` | explizite Oberflächenmeldung (auch im Simulationspfad) |
| `[OK] <text>` | Erfolg eines Teilschritts |
| `[FEHLER] <text>` | Fehler; die GUI bietet „Erneut versuchen" an |
| Exit `0` | fertig |
| Exit `1` | Abbruch mit Fehler |
| Exit `10` | Neustart erforderlich; die GUI zeigt „Jetzt neu starten" |

Secrets werden vor der Ausgabe über `$script:redactions` ersetzt (`[verdeckt]`), damit sie nie in der Detailansicht landen.

## 3. Zustandsvertrag (`install-state.json`)

`$State` wird als Ganzes geschrieben (`Save-State`, `install-friday.ps1:968`), Schlüssel entstehen durch Zuweisung.
Es gibt **kein** Versionsfeld: die Kompatibilität hängt an der Schlüsselmenge. Dokumentiert sind:

| Gruppe | Schlüssel |
|---|---|
| Abschluss | `done` (Menge der erledigten Schritte), `gui_pending` (Objektspeicher der Nicht-Geheimnisse) |
| Identität | `assistant_name`, `wake_phrase`, `wake_slug`, `wake_engine`, `linux_user` |
| Modell | `model_provider`, `model_name`, `model_base_url` |
| Stimme | `voice_mode`, `voice_choice`, `voice_reference`, `elevenlabs_voice_id`, `voice_mode_changed` |
| Umgebung | `distro_name`, `distro_location`, `distro_requested`, `ports`, `build`, `ram_gb`, `cpu`, `gpu`, `cores` |
| Dashboard | `dashboard_source`, `dashboard_hash`, `dashboard_pnpm`, `skills_commit` |
| Migration | `migrated_from`, `migrated_at` (bewusst ohne Pfad) |

Die Zustandsmaschine ist eine Menge, keine Kette: `MarkDone` fügt idempotent hinzu (`Select-Object -Unique`),
`IsDone` prüft die Zugehörigkeit. Die kanonische Reihenfolge für ein gezieltes Update ist
`preflight → files → wslfeature → power → persona → wslconfig → distro → linuxuser → keepalive → hermes → qwen →
voicepython → enroll → voiceservice` (`install-friday.ps1:916`); ein unvollständiger Stand bricht dort mit
`Bestehende Installation ist fuer ein gezieltes Update unvollstaendig: …` ab, statt halb weiterzulaufen.
Rückschritte sind explizit: Namensänderung setzt `hermes`/`voicepython` zurück, Stimmwechsel zusätzlich
`voiceservice`, ein nicht funktionierendes kopiertes venv entfernt `voicepython`, eine Migration entfernt
`files`/`voiceservice`/`dashboard`/`watchdog`.

## 4. Vollständige Prompt-Inventur

`install-friday.ps1` enthält **19** `Read-Host`-Stellen. Jede ist an eine GUI-Route gebunden — geprüft durch den
neuen Test (§6), nicht durch Lesen allein:

| Zeile | Frage / Zweck | GUI-Route |
|---|---|---|
| 144 | „Enter zum Beenden" (Fehlerpfad) | nur ohne GUI (`-not $GuiMode`) |
| 173 | `Ask`-Fallback (Name, Wake Word, Besitzer, Über mich, Linux-Benutzer) | `Gui-Answer` über Schlüssel-Zuordnung |
| 1081 | Sprachbetrieb | `voiceMode` |
| 1102 | ElevenLabs-Voice-ID | `voiceId` |
| 1142 | Stimme 1–3 | `voiceChoice` |
| 1156/1162 | eigene Stimmreferenz | `voiceReference` |
| 1395/1396 | Linux-Passwort + Wiederholung | `linuxPassword`, `linuxPasswordRepeat` |
| 1445 | Anbieter 1–3 | `providerChoice` |
| 1457 | OpenAI-Key | `openaiKey` |
| 1462 | Anthropic-Key | `anthropicKey` |
| 1471 | Kimi-Key | `kimiKey` |
| 1485 | Basis-URL (Erweitert) | `modelBaseUrl` |
| 1489 | Modellname (Erweitert) | `modelName` |
| 1493 | API-Key (Erweitert) | `customKey` |
| 1674 | ElevenLabs-Key | `elevenlabsKey` |
| 1759 | „Enter, wenn du bereit bist" | nur ohne GUI |
| 2573 | „Enter zum Schließen" | nur ohne GUI |

`Ask`, `Choose` und `YesNo` sind die einzigen Funktionen mit dynamischem Schlüssel: sie bilden den Fragetext per
`switch -Regex` auf einen festen Schlüssel ab und **werfen** bei unbekanntem Text (`Unbekannte GUI-Eingabe`,
`Unbekannte GUI-Auswahl`, `Unbekannte GUI-Entscheidung`) — es gibt keinen stillen Rückfall auf stdin.
Interaktive Python-Eingaben existieren nur in `enroll_record.py:35` und `:228` (Stimmaufnahme mit anwesendem
Benutzer, bewusst interaktiv).

## 5. Gefundene und behobene Lücke

Der Assistent fragte den Anbieter nicht ab: `install-friday.ps1:1432` setzte in GUI-Läufen still
`kimi-coding`/`k3`, wenn keine Antwort vorlag („dort bleibt es beim bisherigen Weg"). Damit war OpenAI, Anthropic
und „Erweitert" über die Oberfläche nicht erreichbar, und ein Benutzer bekam eine Wahl installiert, die er nie
getroffen hatte — genau der Fall, den die Abnahme ausschließt.

Behoben in dieser Arbeitseinheit:

- Neuer Reiter **„KI-Zugang"** (Tab 4, acht Reiter gesamt) mit `providerChoice`, `modelBaseUrl`, `modelName`,
  `openaiKey`, `anthropicKey`, `customKey`; die Schlüsselfelder werden passend zur Auswahl aktiviert
  (`Update-ProviderFields`), passwortgeschützte Eingabe wie bei den übrigen Geheimnissen.
- Neue Schlüssel im Transport (`answers`/`secrets`), in der Redaktionsliste und in der Aufräumliste nach dem Lauf.
- Der stille Standard ist ersetzt: fehlt die Anbieterantwort in einem GUI-Lauf, bricht der Installer mit
  `Die Oberflaeche hat keinen Anbieter uebermittelt.` ab, statt eine fremde Wahl zu installieren.
- Die Simulationsselbstprüfung der GUI verlangt jetzt den Reiter „KI-Zugang", acht Reiter und alle sechs Felder;
  die Renderprobe erzeugt zusätzlich `friday-gui-page-4.png`.

## 6. Ausführbarer Vertragswächter

`installer/tests/installer-io-contract.Tests.ps1` (neu, grün) parst beide Skripte per AST und schlägt fehl, wenn

1. das Backend `Gui-Answer`/`Gui-Secret` mit einem Schlüssel aufruft, den die GUI nicht überträgt,
2. `Ask`/`Choose`/`YesNo` auf einen Schlüssel abbilden, der im Transport fehlt,
3. ein `Read-Host` nicht durch `$GuiMode` oder eine der drei Zuordnungsfunktionen abgedeckt ist,
4. ein interaktiver Python-Prompt außerhalb der Aufnahmeprotokolle auftaucht.

Ausgabe des Laufs: `Installer I/O contract: 28 answers, 7 secrets, 19 guarded prompts, python prompts
enroll_record.py:35, enroll_record.py:228: PASS`.

Zusätzlich belegt `installer/tests/gui-installer.Tests.ps1` (grün, echte WinForms-Renderprobe) DPAPI-Rundlauf,
Ablehnung beschädigten Ciphertexts, die drei Simulationsausgänge (0/1/10), das Rendern aller acht Reiter,
Löschung der Transportdatei und die Ablehnung eines fremden Protokolls.

## 7. Offen für INS-03

Der Vertrag sagt jetzt, *welche* Anbietereingabe existiert, nicht dass jeder Anbieter fachlich geprüft ist:
Kimi-K3 ist real belegt, OpenAI/Anthropic/Erweitert sind über die Oberfläche erreichbar, aber ohne echten
Auth-Nachweis (kein Testkey, kein Aufruf). Ebenso fehlt die Rückmeldung „Verbindung geprüft" je Anbieter und die
Behandlung von OAuth-Ablehnung/Timeout. Genau das ist INS-03.