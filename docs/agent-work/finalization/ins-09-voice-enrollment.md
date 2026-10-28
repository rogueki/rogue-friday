# INS-09 - Grafische Aufnahme der Stimme

Stand: 2026-10-22. Branch `feat/friday-finalization-20261021`.

Ziel laut Masterplan: die vorhandene Aufnahmeoberflaeche und den Enrollmentpfad in `installer/voice/`
untersuchen und **alle** Aufnahmeinteraktionen grafisch anbinden; Testton, Samplewiederholung und
Wiederaufnahme vollstaendiger Bloecke muessen belegt sein.

## 1. Befund vor dem Umbau

| Punkt | Zustand vorher | Wirkung |
|---|---|---|
| Fuehrung | `enroll_record.py --gui` zeigte je Aufnahme einen eigenen `askokcancel`-Dialog, der uebrige Text lief als Konsolenausgabe in den Ereignisstrom | Der Assistent zeigte "Schritt 13" und danach fremde Fenster; Aufforderung, Fortschritt und Aktionen waren nicht in der Oberflaeche |
| Start | Signalton kam nach dem Dialog | Anfang der Aufnahme war im Assistenten nicht sichtbar, "Enter" war im Konsolenpfad versteckt |
| Wiederholung | keine | Eine misslungene Aufnahme musste neu gesprochen werden |
| Abbruch | Dialog-Abbruch beendete den Prozess | Kein Weg, eine einzelne Aufnahme zu ueberspringen |
| Wiederaufnahme | vorhandene WAVs wurden uebersprungen | Blockweise Wiederaufnahme war vorhanden, aber nicht sichtbar |
| Profil | keine Sicherung | Eine zweite Aufnahme ueberschrieb WAVs und Embedding ohne Rueckweg |

## 2. Vertrag: Interaktionsdateien statt Dialoge

Aufnahme und Assistent sprechen ueber zwei Dateien im Lauf-Ordner `<Root>\run\`:

- Anfrage `gui-interaction.json` (schreibt `installer/voice/gui_interaction.py`):
  `v`, `id`, `kind`, `title`, `prompt`, `detail`, `block`, `index`, `total`, `actions`, `created`.
- Antwort `gui-interaction.json.response` (schreibt `installer/lib/gui-interaction.ps1`):
  `v`, `id`, `action`, `at` - eine Antwort zaehlt nur mit identischer Kennung und nur fuer angebotene Aktionen.

Beide Seiten schreiben atomar (`.tmp` + `os.replace` bzw. `[IO.File]::Replace`), lesen nur vollstaendige
Dateien, verwerfen fremde Kennungen und Raeumen nach dem Lesen auf. Aktionen: `ok`, `replay`, `skip`, `cancel`.
Ohne Interaktionsdatei bleibt der alte Weg (Dialog bei `--gui`, Konsole sonst) als Rueckfall erhalten.

## 3. Assistent

- Neue Aufnahmenseite im Rahmen (`interactionPage`): Titel, Aufforderung, Variante, Fortschritt
  ("Aufnahme 3 von 44") und die drei Aktionen "Jetzt sprechen", "Anhören", "Überspringen".
- Fusszeile waehrend der Aufnahme: kein "Weiter", kein "Zurück", "Abbrechen" beantwortet die Anfrage
  mit `cancel` (die Aufnahme endet dann mit Exitcode 2, der Installer haelt mit Klartextmeldung an).
- Ein Timer liest alle 200 ms; ohne laufenden Lauf und ohne Testordner wird nichts gelesen, damit eine
  liegen gebliebene Datei den Assistenten nie vor dem Start blockiert. Beantwortete Kennungen werden
  gemerkt und die beantwortete Anfrage geloescht - sonst erschiene dieselbe Aufforderung erneut.
- Der Installer raeumt vor und nach jedem Aufnahmeversuch auf (`Clear-GuiInteraction`).

## 4. Aufnahme

- `--interaction-file` schaltet die Dateifuehrung ein; `ready()` fragt dort zuerst, dann Dialog, dann Konsole.
- `replay` spielt die zuletzt gespeicherte WAV erneut ab und fragt danach wieder - ohne neues Sprechen.
- `skip` laesst die Aufnahme aus (Zaehlung bleibt), `cancel` beendet mit Exitcode 2.
- Der Signalton bleibt hoerbar vor jeder Aufnahme; Pegelpruefung verwirft zu leise und uebersteuerte Aufnahmen.
- Wiederaufnahme: vorhandene Dateien je Block werden weiterhin uebersprungen; der Fortschritt zeigt
  jetzt Block, Index und Gesamtzahl.

## 5. Profilsicherung

`installer/lib/voice-profile-backup.ps1` sichert `voice/profiles/owner` vor der Aufnahme nach
`voice/profiles/backups/<Zeitstempel>-<Anlass>` mit Manifest (Groesse und SHA-256 je Datei).
`Restore-VoiceProfile` prueft jede Pruefsumme und schreibt nur bei fehlerfreier Sicherung zurueck;
hoechstens drei Sicherungen bleiben erhalten. Der Installer sichert mit Anlass `vor-enrollment`
und nennt den Pfad im Protokoll.

## 6. Nachweise

| Pruefung | Ergebnis |
|---|---|
| `installer/tests/gui-interaction.Tests.ps1` | PASS, 34 Zusicherungen: Anfrage/Antwort, fremde Kennung, unbekannte und nicht angebotene Aktion, Aufraeumen, Abbruch mit Exitcode 2, Python-Gegenstelle schreibt und liest dieselbe Datei, drei Gegenproben an Kopien von Installer, Assistent und Aufnahme |
| `installer/voice/tests/test_gui_interaction.py` | 9 Tests PASS (Standardbibliothek, kein stdin, Zeitlimit, veraltete Antwort, Aufraeumen) |
| `installer/tests/gui-wizard-pages.Tests.ps1` | PASS, 108 Zusicherungen; der Selbsttest belegt `interaction=visible:True ok:True` (Seite sichtbar, Tastatur erreicht alle drei Aktionen und den Abbruch, Klick schreibt die Antwort) |
| `installer/tests/voice-profile-backup.Tests.ps1` | PASS, 25 Zusicherungen: Sicherung mit Pruefsummen, byte-identische Wiederherstellung, beschaedigte Sicherung wird abgelehnt, Begrenzung auf drei, Verdrahtung vor der Aufnahme inklusive Gegenprobe |
| Gegenprobe Aufnahme-Nachweis | Antwortnachweis entfernt -> `gui-wizard-pages.Tests.ps1` Exit 1; Datei byte-identisch wiederhergestellt (SHA-256 gleich) |
| Installer-Suite | 32/32 Exit 0 (188 s) |

## 7. Offen

- **Echtes Mikrofon/Headset**: Aufnahme mit hoerbarem Start, vollstaendigem Durchlauf und erzeugten
  Modellen/Embeddings ist auf dieser Maschine nicht abnehmbar (10-12 Minuten Sprechen, Mensch am Geraet).
- **Wake-Phrase gegen Metadaten**: der Installer prueft `personal_wake.json` bereits gegen die Phrase;
  ein Nachweis mit echter Aufnahme fehlt.
- **Sprechergrenzwert**: nicht abgesenkt; die Kalibrierung bleibt beim Training und wird nicht zum Gruenmachen
  verstellt (`build_personal_wake.py` unveraendert).
- Die Aufnahmenseite ist noch nicht mit einem Screenreader geprueft (siehe N-036).