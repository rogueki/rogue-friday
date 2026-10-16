# F.R.I.D.A.Y. Content Studio

Autor: RogueKI. Stand: 16. Oktober 2026.

## Dashboard und Daten

`/content-studio` bietet Ideen, Posting-Entwürfe, Statuswechsel und Import/Export des versionierten `plan.json` aus dem separaten Content-Studio-Projekt. Autoritativ ist jetzt ein Dokument in der Control-API-SQLite-Datenbank. `GET /api/v1/content-studio/plan` liefert `{revision, plan, updatedAt}`; `plan: null` und Revision 0 bedeuten einen leeren Server. `PUT` auf denselben Pfad ersetzt den gesamten Plan und erfordert `If-Match` mit der zuletzt gelesenen Revision. Jede erfolgreiche Speicherung erhöht sie; ein konkurrierender Schreibversuch erhält HTTP 409. Beide Operationen erfordern Eigentümerrolle und den aktivierten Content-Studio-Schalter, `PUT` zusätzlich CSRF. Der Körper ist auf 2 MB begrenzt; der gemeinsame SDK-Parser bewahrt die bisherigen Version-1-Invarianten einschließlich eindeutiger IDs und gültiger Datumswerte.

Bei leerem Server und vorhandenem altem Browserplan bietet das Dashboard eine ausdrückliche Übernahme mit `If-Match: 0` an. Es überschreibt keinen bereits vorhandenen Serverplan. Der alte `localStorage`-Eintrag bleibt als Sicherung unangetastet und kann separat heruntergeladen werden; ein beschädigter Browserplan bleibt ebenfalls unangetastet und wird gemeldet. Der Dateiimport validiert den Plan, lädt zuerst ein Backup des bisherigen Serverplans herunter und schreibt dann mit der aktuellen Revision. Export bleibt als `plan.json` verfügbar. Bei einem Konflikt müssen Änderungen anhand eines erneuten Lesevorgangs abgeglichen werden; es findet kein stilles Zusammenführen statt.

Die Seite und Navigation sind über **Einstellungen → Dashboard → Content Studio aktivieren** gesteuert und standardmäßig deaktiviert. Die Mediensektion kann bestätigte kie.ai-Aufträge starten, ihren Status manuell abrufen und ElevenLabs-MP3 herunterladen. Die bisherige `Content-Studio/engine/content_engine.py` und `poster.py` bleiben unberührt. Das Dashboard veröffentlicht nichts automatisch.

## Anbieter und Grenzen

Die Seite erklärt auch die Voraussetzungen für Instagram/Facebook, TikTok und YouTube. Betreiber richten die jeweiligen Developer-Apps/OAuth-Clients ein; Nutzer verbinden danach ihre Konten beim Anbieter. Diese Anleitung führt noch keinen OAuth-Login oder Live-Post aus. Der geplante Verbindungs- und Freigabevertrag steht in `docs/CONTENT_STUDIO_PUBLISHING.md`.

Eigentümer können unter **Einstellungen → Content Studio Zugänge** kie.ai-, ElevenLabs- und CapCut-Schlüssel setzen. Die Control API gibt nur Konfigurationsflags zurück. UI-Werte werden als AES-256-GCM-Chiffretext in der Server-SQLite-Datenbank gespeichert. Der Schlüssel wird per `deriveKey(auth.key, "content-studio-keys")` von der vorhandenen Server-Master-Key-Datei getrennt abgeleitet; pro Wert gibt es einen zufälligen Nonce und eine an Anbieter und Formatversion gebundene Authentifizierung. Die Servervariablen `KIE_API_KEY`, `ELEVENLABS_API_KEY`, `CAPCUT_API_KEY` dienen als Fallback, wenn kein gespeicherter Wert vorliegt. Das Status-Flag bestätigt keine Gültigkeit. Schlüssel gehören nie in Browser-Code, `plan.json`, Git oder Logs.

Ein leerer PATCH-Wert entfernt den gespeicherten Schlüssel; ein vorhandener Umgebungswert bleibt danach aktiv und das Status-Flag entsprechend wahr. Beim Upgrade gibt es keine alten Klartext-Datenbankwerte zu migrieren: frühere UI-Werte lagen ausschließlich im Prozessspeicher und müssen einmal neu eingegeben werden. Unbekannte oder nicht entschlüsselbare gespeicherte Formate werden nicht still übernommen. Datenbank und `auth.key` müssen gemeinsam gesichert und wiederhergestellt werden. Fehlt `auth.key` bei vorhandenen Content-Studio-Schlüsseln oder wurde sie durch eine andere 32-Byte-Datei ersetzt, verweigert die Control API den Start; gespeicherte Chiffretexte bleiben erhalten. Die alten Werte können nur mit der ursprünglichen `auth.key` wiederhergestellt werden.

Die authentifizierte Control API besitzt drei Content-Studio-Operationen:

| Operation | Funktion |
| --- | --- |
| `POST /api/v1/content-studio/kie/tasks` | Sendet einen ausdrücklich bestätigten Bildauftrag (`grok-imagine/text-to-image`) oder fünfsekündigen Videoauftrag (`kling-2.6/text-to-video`) an kie.ai. Antwort: Task-ID. |
| `GET /api/v1/content-studio/kie/tasks/{id}` | Fragt den Status einer durch diesen Server erzeugten Task-ID ab und liefert HTTPS-Ergebnislinks. |
| `POST /api/v1/content-studio/elevenlabs/speech` | Erzeugt nach ausdrücklicher Bestätigung MP3 mit `eleven_multilingual_v2` für eine angegebene Voice-ID. |

Schreiboperationen erfordern Eigentümerrolle, CSRF, aktivierten Modulschalter und Idempotency-Key. Der Server speichert vor dem kostenpflichtigen Aufruf einen Auftragsmarker; bei unklarem Ausgang nach Timeout muss der Status geprüft und darf nicht blind erneut gesendet werden. Es gibt keine automatische Wiederholung, Kostenobergrenze, lokale Mediendatei-Speicherung oder automatische Statusverfolgung. Kie-Ergebnislinks müssen vor Nutzung separat heruntergeladen und geprüft werden. Die ElevenLabs-Antwort wird direkt als MP3 ausgeliefert. Es wurden nur Mock-Provider getestet; mit realen Schlüsseln wurde kein kostenpflichtiger Aufruf ausgeführt.

Für CapCut ist keine verifizierte öffentliche Schnitt-API angebunden. Der Videoschnitt erfolgt mit manueller Schnittliste oder einem separat geprüften lokalen Werkzeug. Ein gespeicherter CapCut-Schlüssel bewirkt keine Automatisierung.

## Separate Hermes-Skills

Die vier zugehörigen Skills liegen im separaten Repository `rogueki/friday-skills` auf `main` unter `skills/media/`. Der lokale Arbeitsordner ist `C:\Users\RogueKI\Downloads\JARVIS_Installer\Skills`:

| Skill | Aufgabe |
| --- | --- |
| `friday-content-planning` | Plan und `plan.json`-Validierung |
| `friday-kie-media` | Bild-/Videoauftrag und Prüfung |
| `friday-elevenlabs-voice` | Sprechertext und MP3-Prüfung |
| `friday-video-editing` | Schnittliste und manueller CapCut-Workflow |

Eine Hermes-Installation muss das externe Skills-Verzeichnis über `skills.external_dirs` laden. Das separate Skills-Repository enthält einen optionalen `friday_content_studio`-Plugin-Bridge-Adapter. Er verbindet Hermes mit der lokalen Control API nur bei expliziter Installation, Sitzung/CSRF des Hosts und einem exakten Bestätigungsentscheid vor jedem bezahlten Auftrag. Ein interaktiver Terminalmodus und ein injizierter Host-Callback sind dokumentiert; ohne Bindung bleibt das Plugin gesperrt. Provider-Schlüssel bleiben ausschließlich in der Control API.

## Prüfen

`node packages/contracts/scripts/check.mjs`, Typechecks, API-/Mock-Vertragstests, gezielte Content-Studio-Tests und Builds prüfen die lokale Integration. Die visuellen und mobilen Gold-Baselines werden hier nicht verändert.
