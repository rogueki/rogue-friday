# Content Studio: Sprachaufträge und Veröffentlichung

## Stand

Der Planer speichert Ideen und Postings lokal im Browser. Ein Posting kann `ziele` mit LinkedIn, Instagram, Facebook, TikTok und YouTube enthalten. Der Schalter im Planer wählt Instagram und Facebook gemeinsam. Das ist **keine Veröffentlichung**. Die bisherigen kie.ai/ElevenLabs-Checkboxen sind durch eine auf den genauen Auftrag bezogene Vorschau und eine Startaktion ersetzt. Der Hermes-Sprachdialog und echte Social-Verbindungen sind noch nicht angeschlossen.

## Zielablauf

1. „Lade eine neue Story hoch“: F.R.I.D.A.Y. ermittelt die fertige Mediendatei, die Zielkonten und das Format. Fehlt etwas, fragt er gezielt danach. Eine bloße Idee oder eine kie.ai-Ergebnis-URL wird nicht als veröffentlichungsfertige Datei behandelt.
2. F.R.I.D.A.Y. zeigt und spricht eine kurze Vorschau: Datei, Zielkonten, sichtbarer Text, Öffentlichkeit und mögliche Kosten. Eine Antwort wie „Ja, genau diese Story auf Instagram und Facebook veröffentlichen“ bindet die Entscheidung an diese Vorschau. Eine Änderung von Datei, Text oder Zielen macht sie ungültig. Für bezahlte Generierung wird eine eigene Entscheidung eingeholt.
3. Das Control API legt **einen lokalen Auftrag mit getrenntem Status je Ziel** an. Instagram und Facebook werden jeweils über die eigene unterstützte Publishing-Schnittstelle angesprochen. Ein Erfolg auf einer Plattform gilt nicht als Erfolg auf der anderen.
4. Vor dem externen Effekt wird eine dauerhafte Ziel-ID/Idempotenzmarke gespeichert. Bei Timeout oder unbekanntem Ausgang wird zuerst der Providerstatus abgeglichen. Kein blindes erneutes Posten.
5. Das Dashboard zeigt `Entwurf`, `wartet auf Freigabe`, `wird gesendet`, `veröffentlicht`, `fehlgeschlagen` oder `Ausgang unbekannt` pro Ziel. F.R.I.D.A.Y. meldet nur bestätigte Resultate als veröffentlicht.

## Plattformvoraussetzungen

| Ziel | Verbindung und veröffentlichungsfähiger Weg | Besondere Grenze |
| --- | --- | --- |
| Instagram | Meta-App, autorisiertes professionelles Instagram-Konto; Mediencontainer und `media_publish` über die Instagram API | Story-Publishing hängt vom Kontotyp und den erteilten Rechten ab. |
| Facebook | Autorisierte Facebook-Seite mit passender Page-Berechtigung; separater Page-Post/Reel-Upload | Die Auswahl „auch auf Facebook“ ist ein zweiter kontrollierter Auftrag, kein angenommener automatischer Crosspost. |
| TikTok | Registrierte TikTok-Developer-App, Content Posting API, `video.publish`-Freigabe und Nutzerautorisierung | Ohne TikTok-Audit sind Direct Posts auf private Sichtbarkeit beschränkt. Creator-Info und zulässige Sichtbarkeit müssen vor dem Senden geprüft werden. |
| YouTube | Google-OAuth mit `youtube.upload`, YouTube Data API `videos.insert` und prüfbarem Uploadstatus | Veröffentlichungsstatus und Sichtbarkeit werden ausdrücklich gesetzt und nach dem Upload geprüft. |
| LinkedIn | Bestehende Planungsoption; Publishing-API und Berechtigungen müssen vor einer Live-Schaltung separat geprüft werden. | Planung ist noch keine Live-Funktion. |

## Umsetzungsgrenzen

- OAuth-Codes und Refresh-Tokens gehören verschlüsselt in den lokalen Control-API-Datenspeicher, nie in Browser-LocalStorage, `plan.json`, Hermes-Skilltext oder Logs.
- Ein Konto wird über den Anbieter-Login verbunden. Ein API-Key für kie.ai oder ElevenLabs ersetzt keine Social-Autorisierung.
- Der Assistent kann die Freigabe per Sprache führen, sofern die lokale Sprecherprüfung erfolgreich war. Plattformregeln, die eine eigene Zustimmung oder Sichtbarkeitsauswahl verlangen, bleiben Teil des Flows.
- Es werden keine echten Veröffentlichungen oder kostenpflichtigen Generierungen als Test ausgelöst. Provider-Testkonten und Developer-App-Freigaben werden für den Live-Nachweis benötigt.

## Nachweise für die nächsten Stufen

1. Persistente Auftrags- und Zielzustände mit Tests für Doppelsendung, Neustart, Timeout und Teilerfolg.
2. Konto-Verbindung und Token-Erneuerung pro Anbieter; widerrufene Rechte und CSRF/OAuth-State negativ testen.
3. Adapter-Vertragstests mit offiziellen Beispielen und isolierten Fake-Providern.
4. Browser- und Sprachtest: dieselbe Vorschau ohne Checkbox, einmalige Freigabe, Ergebnis je Plattform.
5. Live-Probe nur mit autorisierten Testkonten und klar erkennbarer Sichtbarkeit.

## Primärquellen

- [Meta Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [TikTok Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [TikTok Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [YouTube `videos.insert`](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert)
