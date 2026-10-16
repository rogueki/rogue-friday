# Content-Studio: Integrationsaudit

Stand: 16. Oktober 2026. Autor: RogueKI. Geprüft wurden der lokale Ordner
`Content-Studio`, der Arbeitsbranch `codex/friday-main-refresh-20261016` von
`rogue-friday` und `friday-skills/main`. Der lokale Quellordner hat keine
Git-Revision. Es wurden weder echte Social-Posts noch kostenpflichtige
Medienaufträge ausgeführt.

## Abdeckung

- Statisch geprüft: lokale Python-Engine (`content_engine.py`, `poster.py`,
  `niche_finder.py`, `engine_common.py`), HTML-Planer, Dashboard-Plan,
  Content-Studio-API, vier Hermes-Skills und die optionale Control-API-Brücke.
- Laufzeit geprüft: Das installierte Dashboard antwortete mit `online`; der
  Content-Studio-Menüpunkt und Modulschalter wurden zuvor im Browser geprüft.
  Die Bridge bestand fünf Tests gegen einen synthetischen Control-API-Transport.
- Offen: echte Anbieter- und Social-Konten, kostenpflichtige Kie-/ElevenLabs-
  Aufrufe, vollständiger Medien-Export, CapCut-Automation, Sprachpublikation
  und ein frischer Installer-Lauf aus dem aktuellen Branch.

## Befunde

| ID | Priorität | Beleg und Auswirkung | Maßnahme |
| --- | --- | --- | --- |
| CS-01 | Hoch | `ContentStudioPage.tsx` plant Ziele für LinkedIn, Instagram, Facebook, TikTok und YouTube, speichert aber nur im Browser und weist ausdrücklich darauf hin, dass nichts veröffentlicht wird. `poster.py` aus dem alten Ordner kann nur LinkedIn/Instagram. Die Control API hat keine Social-OAuth- oder Publishing-Route. Eine gesprochene Upload-Anweisung kann deshalb noch keinen Post auslösen. | Kontoanbindung, Medien-Upload, Veröffentlichungsstatus und Rückabgleich je Plattform als eigene serverseitige Auftragskette implementieren. Vorher offizielle aktuelle API-Verträge und Berechtigungen prüfen. |
| CS-02 | Mittel | Der Web-Plan erzeugt UUIDs; `poster.py post --id` akzeptiert nur Ganzzahlen. Der Aufruf mit einer UUID scheitert bereits im Argumentparser. Außerdem verwendet der Web-Plan Formate wie `Reel` und `YouTube-Short`, während die alte Engine nur `reel`, `story`, `feed`, `linkedin` rendert. Ein Export ist damit kein durchgehender Produktionsvertrag. | Einen versionierten Adapter zwischen Web-Plan und Renderer/Poster bauen, IDs und Formate explizit abgleichen und unbekannte Ziele vor jedem Seiteneffekt ablehnen. |
| CS-03 | Mittel | Der Browserplan liegt in `localStorage`; Hermes und die Control API besitzen dafür keinen serverseitigen Lese- oder Schreibpfad. Die vier Skills können Entwürfe beschreiben, aber einen Sprachentwurf nicht sichtbar im geöffneten Dashboard speichern. | Plan als versioniertes serverseitiges Objekt mit Owner-Zuordnung, Revision und Importmigration bereitstellen; erst dann Sprachbefehle daran binden. |
| CS-04 | Mittel | Der lokale Legacy-Renderer benutzt ffmpeg, edge-tts und Kimi für Captions; die neue Medienoberfläche benutzt getrennt kie.ai und ElevenLabs. `Content-Studio/engine` wird vom Dashboard-Installer nicht als ausführbarer Produktionsdienst eingebunden. CapCut ist laut `docs/CONTENT_STUDIO.md` nur ein manueller Schnittpfad. | Einen klaren Produktionspfad auswählen und den Renderer über einen begrenzten lokalen Job-Adapter einbinden. CapCut erst nach verifizierter Schnittschnittstelle als automatisch bezeichnen. |
| CS-05 | Niedrig | Die Legacy-Engine deklariert Mindestversionen in `requirements.txt`, aber keine gesperrten Versionen; der lokale Quellordner enthält keine erkennbare Lizenzdatei. Ihr `config.json`-Format enthält Social-Tokens als lokale Klartextwerte, falls Nutzer es befüllen. Die neue Control API verschlüsselt Kie-/ElevenLabs-/CapCut-Schlüssel serverseitig, ersetzt aber die Legacy-Konfiguration nicht. | Für eine veröffentlichte Integration Abhängigkeiten festlegen, Herkunft/Lizenz des Altordners klären und Social-Tokens ausschließlich über die serverseitige Kontoverwaltung führen. |

## Bereits behoben

- Die vier Content-Studio-Skills samt optionaler Bridge wurden in
  `friday-skills/main` übernommen; der Validator erkennt 105 Skills.
- Die Bridge sendete zunächst `jarvis_session`; die aktuelle Control API
  erwartet laut `packages/auth/src/cookies.ts` `friday_session`. Adapter,
  Tests und Anleitung sind auf den aktuellen Cookie-Namen korrigiert.
- Kostenpflichtige Medienaufträge verwenden im Dashboard eine auftragsgebundene
  Vorschau mit explizitem Start; der optionale Hermes-Adapter verlangt einen
  getrennten, vertrauenswürdig gebundenen Bestätigungsentscheid. Ein reiner
  Sprachbefehl hat derzeit noch keinen Live-Aufrufpfad.

## Prüfnachweise

- `python scripts/validate.py`: 105 Skills gültig.
- `python -m unittest discover -s tests -p test_content_studio_bridge.py -v`:
  fünf Tests bestanden (synthetische Transportantworten).
- `python -m ruff check adapters/content_studio_control.py tests/test_content_studio_bridge.py`:
  bestanden.
- `python engine/poster.py post --id 123e4567-e89b-12d3-a456-426614174000
  --plan NUL`: Argumentparser lehnt die UUID als `invalid int value` ab,
  ohne einen API-Aufruf auszuführen.

Diese Prüfungen belegen weder eine gültige Social-API-Verbindung noch eine
erfolgreiche Veröffentlichung. Die Umsetzung sollte mit dem serverseitigen
Planvertrag beginnen und erst danach Anbieter und Sprachbefehle verbinden.
