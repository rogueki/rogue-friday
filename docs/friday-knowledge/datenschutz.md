# Datenschutz

## Was auf diesem PC bleibt
Stichworte: lokal, auf dem pc, daten lokal, datenschutz, wake word lokal, speicherort, privat, eigene daten
Bereich: datenschutz
Die Kernfunktionen laufen auf deinem PC. Das Wake Word hört lokal zu, und die Sprecherprüfung läuft ebenfalls lokal. Auch die Aufnahmen zum Einlernen des Wake Words bleiben lokal und werden nach dem Training gelöscht. Im lokalen Betrieb läuft die Spracherkennung mit einem lokal vorhandenen Whisper-Modell. Das Dashboard speichert seine Daten in einer lokalen Datenbank, und das Obsidian-Gedächtnis liegt in deinem lokalen Vault. Ins Internet gehen Daten nur für Funktionen, die du wählst oder einrichtest, etwa Qwen, Mail, Kalender, Messenger oder das Wetter, und für Updates.

## Was an Qwen Audio geht
Stichworte: qwen daten, alibaba, cloud audio, token plan, übertragung, was wird gesendet, gast audio
Bereich: datenschutz
Nur wenn du im Bereich Sprache das Gespräch auf Qwen Audio stellst, geht Sprache an Alibaba Cloud über den Token Plan. Gesendet wird die Äußerung eines bestätigten Sprechers, also die Frage selbst. Die Stimme eines Gastes ohne Sprecherprüfung geht nie an Qwen und bleibt lokal. Ergebnisse von Aufträgen und Antworten aus der Abfrage gehen als Text an das Gesprächsmodell, damit Rückfragen funktionieren. Die Antwort kommt als Text zurück und wird lokal gesprochen. Wake Word, Sprecherprüfung und die Stimme bleiben auf deinem PC.

## Standort und Wetter
Stichworte: standort, wetter, koordinaten, ortsname, open-meteo, bigdatacloud, position, ort speichern
Bereich: datenschutz
Für das Wetter speicherst du einen Ort. Die Ortssuche und die Wetterdaten fragt der Server bei Open-Meteo ab. Wenn du die automatische Standorterkennung nutzt, fragt dein Browser nach deiner Freigabe die Position ab. Für den Ortsnamen sendet der Browser gerundete Koordinaten und seine IP-Adresse an BigDataCloud. Das passiert erst nach deiner ausdrücklichen Bestätigung. Den gespeicherten Ort entfernst du mit Standort entfernen. Danach wird kein Wetter mehr abgefragt.

## Suche und Recherche
Stichworte: suche, recherche, anbieter, cloud modell, lokaler suchdienst, searxng, anfragen, modellanbieter
Bereich: datenschutz
Die Recherche sendet die Suchanfrage an den Anbieter, den du gewählt hast. Dabei werden bis zu drei Seiten abgerufen. Der Suchdienst SearXNG läuft lokal, muss aber eingerichtet sein. Ist für ein Gespräch oder eine Aufgabe ein Cloud-Modell gewählt, gehen die Anfragen an dessen Anbieter. Wählst du ein lokales Modell, bleibt die Anfrage auf deinem PC. Im Bereich Modelle und Routing steht, welches Modell für welche Aufgabenart genutzt wird. So kannst du gezielt steuern, was extern verarbeitet wird.

## Schlüssel und Zugangsdaten
Stichworte: schlüssel, passwort, zugangsdaten, verschlüsselt, dpapi, token, gespeichert, geheimnis
Bereich: datenschutz
Zugangsschlüssel für Sprachdienste speichert Windows verschlüsselt für deinen Benutzer. Unter Linux liegen sie in einer Datei mit eingeschränkten Rechten. Der Qwen-Schlüssel wird erst nach einer erfolgreichen Prüfung gespeichert. Mail- und Kalenderpasswörter werden gespeichert und nie zurückgegeben. Schlüssel für das Content Studio liegen verschlüsselt in der lokalen Datenbank. Das Bot-Token für Telegram bleibt im lokalen Hermes-Profil. Das Dashboard-Passwort wird nur als Hash gespeichert. Der Qwen-Schlüssel erscheint nicht in Logs, im Audit oder in Fehlermeldungen.

## Audit-Protokoll
Stichworte: audit, protokoll, nachweis, was wird protokolliert, export, geheimnisse entfernt, verlauf
Bereich: datenschutz
Das Audit protokolliert wichtige Aktionen mit Zeit, Akteur und Ergebnis, und die Einträge sind durch eine Hashkette gesichert. Beim Export entfernt das System Passwörter, Tokens, Schlüssel und Stimm-Fingerabdrücke. Die Antwort auf eine Agenten-Rückfrage per Sprache wird ohne ihren Text protokolliert. Ruhemodus-Ansagen werden nicht als Text im Audit festgehalten. Beim Export gelten die Filter der Tabelle nicht, er umfasst immer den ganzen Zeitraum.

## Sprachaufnahmen und Verlauf
Stichworte: aufnahmen, sprachverlauf, transkripte, rohaufnahmen, voice history, löschen, sprachdaten
Bereich: datenschutz
Standardmäßig speichert F.R.I.D.A.Y. nur Transkripte und keine Rohaufnahmen. Den Sprachverlauf kannst du im Bereich Sprache abschalten. Die gespeicherten Einträge kannst du auf der Seite Sprache löschen, das darf nur der Owner. Das Löschen ist endgültig und wird protokolliert. Sprecherprofile und Einstellungen bleiben dabei erhalten. Die Aufnahmen für das Einlernen eines Wake Words werden nach dem Training oder Verwerfen gelöscht.

## Aufbewahrung und Bereinigung
Stichworte: aufbewahrung, fristen, bereinigung, löschen nach tagen, automatisch, archiv, temporäre dateien
Bereich: datenschutz
Unter Einstellungen → Datenaufbewahrung legst du Fristen in Tagen fest. Sie gelten für Sprachverlauf, Audit im aktiven Speicher, Benachrichtigungen und temporäre Dateien. Vor jedem Lauf zeigt Betroffene Einträge zählen, was entfernt würde. Die automatische Bereinigung ist standardmäßig aus, alte Daten verschwinden also nicht von selbst. Ältere Audit-Einträge gehen in ein dauerhaftes lokales Archiv. Das Obsidian-Gedächtnis wird nicht begrenzt und bleibt erhalten.

## Backups
Stichworte: backup, sicherung, inhalt, konfiguration, datenbank, zielordner, schutz, wiederherstellung
Bereich: datenschutz
Ein Backup enthält die Windows-Konfiguration, die SQLite-Datenbank, den Obsidian-Vault und die Daten der Friday-Ubuntu-Konten mit dem Hermes-Zustand. Es landet im Zielordner, den du festlegst. Bewahre diesen Ordner deshalb nur an einem Ort auf, auf den nur du Zugriff hast. Der Restore-Test läuft immer in einem getrennten Ordner und verändert deine echten Daten nicht. Das Dashboard-Update lädt den Quellcode von GitHub main herunter und sichert vor der Installation die geänderten Dateien.
