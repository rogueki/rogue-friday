# Automatische Content-Produktion

Stand: 16. Oktober 2026. Autor: RogueKI.

## Gewünschter Ablauf

Nach der einmaligen Einrichtung der Anbieter und Zielkonten wählt der Nutzer eine
Idee oder ein Posting und beschreibt das gewünschte Ergebnis. F.R.I.D.A.Y. erstellt
eine auftragsgebundene Vorschau mit Zielplattformen, Text, Medienformat und
voraussichtlich kostenpflichtigen Schritten. Eine Bestätigung im Dashboard oder
im verifizierten Sprachdialog startet **einen** dauerhaften Produktionsauftrag.
Der Nutzer muss keine `plan.json` exportieren, keine fremde Engine starten und
keine Datei von Hand zwischen Diensten kopieren.

Die Produktionskette lautet:

1. Den aktuellen Serverplan und die gewählte Posting-ID samt Revision lesen.
2. Das angeforderte Format in ein konkretes Ausgabeprofil umsetzen. Unbekannte
   oder unvereinbare Zielkombinationen vor bezahlten Aufrufen ablehnen.
3. Bild oder Clip bei kie.ai erzeugen, Task-ID dauerhaft speichern und den
   Anbieterstatus bis zum Abschluss abgleichen. Bei unbekanntem Ausgang wird
   der Auftrag angehalten; es gibt keine zweite bezahlte Anfrage auf Verdacht.
4. Sprechertext bei ElevenLabs erzeugen und die Audiodatei lokal im privaten
   Auftragsordner speichern. Auch hier gilt: keine erneute kostenpflichtige
   Anfrage nach einem unklaren Ausgang.
5. Medien kontrolliert herunterladen, Typ und Größe prüfen und lokal mit FFmpeg
   zu einem MP4 oder Bildpaket im Zielseitenverhältnis zusammenfügen. Untertitel,
   Ton und Enddauer werden am erzeugten Artefakt geprüft.
6. Das fertige Artefakt mit Herkunft, Auftragsstatus und Fehlern im Dashboard
   anzeigen. Erst ein bestätigtes, verbundenes Zielkonto darf einen getrennten
   Veröffentlichungsauftrag erhalten; jeder Plattformstatus bleibt separat.

Der lokale F.R.I.D.A.Y.-Server ist das System of Record für Auftrag, Provider-ID,
Artefakt und Zielstatus. Ein Browser-Reload oder Dienstneustart darf den Auftrag
nicht verlieren. Der exportierte Plan ist nur ein Backup- und Austauschformat.

## Anbieterzugang

kie.ai und ElevenLabs nehmen serverseitige API-Schlüssel an. Das Dashboard
speichert diese verschlüsselt; Schlüssel gelangen nie in Plan, Browser-Bundle,
Hermes-Prompt oder Log. Die vorhandenen Einzelaufrufe müssen zu einer
persistenten Jobkette verbunden werden.

Für CapCut wurde am 16. Oktober 2026 keine öffentliche, dokumentierte
Schnitt-API mit einem verifizierbaren Editier- und Exportendpunkt gefunden. Die
[offizielle CapCut-Seite zum „AI Video Editor API“](https://www.capcut.com/features/ai-video-editor-api)
beschreibt einen Browser-Editor-Workflow, aber keinen nutzbaren API-Vertrag für
Timeline und Export. **Daraus folgt für diese Implementierung:** automatischer
Schnitt erfolgt lokal mit FFmpeg. CapCut kann für optionale Nachbearbeitung
verwendet werden; ein dort gespeicherter Schlüssel beweist keine Integration.
Diese Entscheidung ist erneut zu prüfen, falls CapCut eine dokumentierte API
bereitstellt.

Instagram/Facebook, TikTok und YouTube verlangen zusätzlich zur Betreiber-App
eine Autorisierung des jeweiligen Zielkontos. Ein kie.ai- oder ElevenLabs-Key
ersetzt diesen Schritt nicht. F.R.I.D.A.Y. soll den Anbieter-Login einmalig im
Onboarding anbieten, Token serverseitig erneuern und danach die Veröffentlichung
selbst erledigen. Ohne verbundene Konten bleibt Produktion möglich, Publikation
aber gesperrt. [TikTok verlangt eine freigegebene App und `video.publish`](https://developers.tiktok.com/docs/en/content-posting-api-get-started),
[YouTube verlangt OAuth für Uploads](https://developers.google.com/youtube/v3/docs/videos/insert).

## Abnahmekriterien

- Ein ausgewählter Planpost wird ohne Datei-Export in genau einen Produktionsjob
  überführt; eine geänderte Planrevision macht die alte Vorschau ungültig.
- Ein Fake-Provider-Lauf erzeugt nach Kie-Status, ElevenLabs-Audio und FFmpeg
  ein lokal abrufbares Artefakt. Auftragsstatus übersteht einen Serverneustart.
- Timeout unmittelbar nach einem bezahlten Sendeschritt führt zu „Ausgang
  unbekannt“ und keiner automatischen Zweitsendung.
- Fehlender Schlüssel, deaktiviertes Content Studio, ungültiger Zielmix und
  ungeprüfte Ergebnis-URL erzeugen vor weiteren Seiteneffekten einen klaren
  Fehlerstatus.
- Eine Wiederholung mit derselben Auftrags-ID sendet keine neue Provideranfrage.
- Ein Social-Post gilt erst nach belegtem Anbietererfolg als veröffentlicht;
  Teilerfolge von Instagram/Facebook werden einzeln angezeigt.
- Nach Einrichtung der Konten kann der Nutzer den Ablauf per Dashboard oder
  verifiziertem Sprachdialog steuern, ohne technische Zwischenschritte.

## Primärquellen

- [kie.ai Text-zu-Bild](https://docs.kie.ai/market/grok-imagine/text-to-image)
- [kie.ai Text-zu-Video](https://docs.kie.ai/market/kling/text-to-video)
- [ElevenLabs Text-to-Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [YouTube Video-Upload](https://developers.google.com/youtube/v3/docs/videos/insert)
