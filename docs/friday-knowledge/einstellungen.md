# Einstellungen

## Profil
Stichworte: profil, name, assistentenname, anzeigename, sprache, zeitzone, datumsformat, zeitformat, wochenbeginn
Bereich: einstellungen:profile
Im Bereich Profil legst du deinen Anzeigenamen und den Namen des Assistenten fest. Der Assistentenname erscheint im Menü, an den Orb-Beschriftungen und in allen Texten. Lässt du das Feld leer, gilt der Standardname F.R.I.D.A.Y. Eine Vorschau zeigt dir, wie die Marke danach aussieht. Unter Sprache und Format stellst du die Sprache der Oberfläche ein, die Zeitzone, das Datumsformat, das Zeitformat mit 24 oder 12 Stunden und den ersten Tag der Woche. Die Zeitzone gilt auch für Kalenderzeiten und für die Nachtruhe. Änderungen am Assistentennamen wirken nach dem Speichern sofort, ohne Neustart.

## Dashboard
Stichworte: dashboard, darstellung, schriftgröße, raster, kompakt, startseite, wetter, dashboard updates
Bereich: einstellungen:dashboard
Der Bereich Dashboard regelt Darstellung und Verhalten der Oberfläche. Du stellst Schriftgröße, Raster, Kompaktmodus und Soundeffekte ein. Die automatische Aktualisierung in Sekunden greift als Rückfall, wenn der Ereignisstrom nicht verfügbar ist. Die Startseite wird zusammen mit der Navigation gespeichert. Mit dem Schalter Content Studio aktivieren erscheint der Menüpunkt Content Studio. Im selben Bereich findest du Standort und Wetter. Darunter stehen die Dashboard-Updates, die nur der Owner sieht. Das aktive Layout der Übersicht bearbeitest du im Bereich Dashboard-Layout.

## Dashboard-Layout
Stichworte: layout, widgets, übersicht anordnen, verschieben, ausblenden, größe, layout datei
Bereich: einstellungen:layout
Mit dem Layout-Editor ordnest du die Widgets der Übersicht neu an. Du verschiebst Widgets, änderst ihre Größe oder blendest sie aus. Ein Widget, das noch nicht im Layout steht, fügst du hinzu, dann landet es unten. Der Editor zeigt an, wenn sichtbare Widgets sich überlappen, weil sie sonst übereinanderliegen. Das Raster hat zwölf Spalten und höchstens vierzig Zeilen. Ein Layout kannst du als Datei exportieren und wieder importieren. Unbekannte Widgets werden beim Import nicht angezeigt, und ein Layout, das über den Rand ragt, wird abgewiesen.

## Theme
Stichworte: theme, farben, design, erscheinungsbild, bibliothek, vorschau, import, export
Bereich: einstellungen:theme
Der Bereich Theme verwaltet das Erscheinungsbild. Du wählst ein Theme aus der Bibliothek, die eingebaute Themes und Themes vom Server enthält. Im Editor passt du Farben an und siehst die Änderungen sofort in einer Live-Vorschau. Die Vorschau bleibt ein Entwurf, bis du speicherst. Verlässt du die Seite, wird das gespeicherte Theme wiederhergestellt. Eine Theme-Datei importierst du nur, wenn sie das Format einhält und die Farbregeln erfüllt. Ungültige Dateien werden abgewiesen, und das bisherige Theme bleibt aktiv.

## Orb
Stichworte: orb, kern, darstellung, preset, 2d, 3d, intensität, audio reaktion, partikel
Bereich: einstellungen:orb
Der Bereich Orb steuert die Darstellung des AI-Core-Orbs. Du wählst ein Preset wie Gold, Bernstein, Ruhig oder Dicht und passt Größe, Intensität, Geschwindigkeit und Partikeldichte an. Die Darstellung kann automatisch zwischen 3D und 2D wechseln, und ohne WebGL zeigt der Orb die zweidimensionale Variante. Mit der Audio-Reaktivität bewegt sich der Orb mit dem Mikrofon- und Sprachpegel. Der goldene Kern bleibt immer erhalten, nur Verhalten und Intensität ändern sich. Ein Leistungs-Overlay zur Diagnose findest du im Bereich Entwickler.

## Navigation
Stichworte: navigation, menü, reihenfolge, sichtbarkeit, seiten ausblenden, startseite, menüpunkte
Bereich: einstellungen:navigation
Im Bereich Navigation bestimmst du, welche Menüpunkte erscheinen und in welcher Reihenfolge. Du kannst Seiten ausblenden. Die Einstellungsseite bleibt immer erreichbar, damit du Ausblendungen wieder rückgängig machen kannst. Das Content Studio erscheint nur, wenn es aktiviert ist. Hier steht auch die Startseite. Nur die Startseite folgt dieser Einstellung beim Öffnen des Dashboards. Direkte Links auf andere Seiten bleiben erhalten. Die Startseite wird zusammen mit diesem Bereich gespeichert.

## Adapter
Stichworte: adapter, verbindungen, verbindungstest, schema, kalender, aktivieren, konfiguration, dienste
Bereich: einstellungen:adapters
Im Bereich Adapter richtest du die Verbindungen zu externen Diensten ein. Jeder Adapter hat seine Einstellungen, die aus seinem Schema erzeugt werden. Mit dem Schalter Adapter aktiv schaltest du ihn ein oder aus. Verbindungstest prüft die gespeicherte Konfiguration auf dem Server, und Geheimnisse verlassen den Server dabei nie. Für den Kalender gibt es hier den Assistenten Kalender verbinden. Einige Adapter sind nur für den Owner sichtbar. Ist kein Adapter konfigurierbar, zeigt die Seite das ausdrücklich an.

## Skill-Konten
Stichworte: skill konten, mail postfach, telegram, discord, whatsapp, kopplung, cloudtalk, telefonie, zugänge
Bereich: einstellungen:skillAccounts
Hier hinterlegst du die Konten und Voraussetzungen der Skills. Links stehen die Skills mit ihrem Zustand, rechts ihre Konten. Darunter richtest du E-Mail-Postfächer ein, und zwar mit einem Assistenten, der Servervorschläge macht und die Verbindungen getrennt prüft. Außerdem gibt es die Einrichtung für Telegram, Discord und WhatsApp über Hermes, die Freigabe von Kopplungsanfragen, CloudTalk, Telefonie und den Pfad des lokalen Markdown-Wikis. Telegram, Discord, WhatsApp und die Kopplungen richtet nur der Owner ein. Ein gespeicherter Schlüssel belegt noch keine erfolgreiche Anmeldung.

## Content Studio Zugänge
Stichworte: content studio zugänge, medienanbieter, api schlüssel, anbieter, verschlüsselt, zugänge
Bereich: einstellungen:contentStudioKeys
Dieser Bereich verwaltet die Zugänge für Medienanbieter, die das Content Studio nutzt. Du trägst den Schlüssel für einen Anbieter ein. Er wird verschlüsselt in der lokalen Datenbank gespeichert und danach nicht mehr angezeigt. Wenn hier kein Schlüssel steht, dienen Umgebungsvariablen des Servers als Ersatz. Die Verschlüsselung hängt an der Schlüsseldatei auth.key im Datenverzeichnis. Geht diese Datei verloren oder wird sie ersetzt, lassen sich die gespeicherten Schlüssel nicht mehr entschlüsseln. Sichere die Datei deshalb zusammen mit dem Datenverzeichnis.

## Modelle & Routing
Stichworte: modelle, routing, standardmodell, routen, denkstufe, fallback, lokal zuerst, budget
Bereich: einstellungen:modelsRouting
Im Bereich Modelle und Routing legst du das Standardmodell fest. Mit der Option Lokale Verarbeitung zuerst entscheidet der lokale Router, bevor ein Cloud-Aufruf erfolgt. Eine feste Uhrzeitantwort bleibt immer lokal. Unter Routen ordnest du einer Aufgabenart ein Modell zu, dazu eine Denkstufe und optional ein Fallback-Modell im Format Anbieter:Modell. Bei Agentenaufgaben gibt es kein Fallback. Die Zugänge zu den Modellanbietern richtest du unter Hermes-Konfiguration ein.

## Hermes-Konfiguration
Stichworte: hermes, agent, zeitpläne, modellanbieter, mcp server, befehlsfreigabe, gerätecode, katalog
Bereich: einstellungen:hermesConfig
Dieser Bereich zeigt die wirksamen Einstellungen von Hermes, dem Unterbau der Agenten, und die freigegebenen Änderungen daran. Du findest hier Zeitpläne für wiederkehrende Aufträge, die Zugänge der Modellanbieter mit Schlüsselprüfung, den Modellkatalog und die MCP-Server. Unter KI-Zugänge meldest du Anbieter an, die Hermes per Gerätecode anmeldet. Eine Befehlsfreigabe kannst du vorab prüfen. Die Vorschau führt den Befehl nicht aus und ändert keine Erlaubnis. Ist die installierte Hermes-Version nicht unterstützt, nimmt der Bereich keine Konfigurationsänderungen vor.

## Sprache
Stichworte: sprache, wake word, aktivierung, gespräch, qwen, spracherkennung, whisper, sprecherprüfung, stimme
Bereich: einstellungen:voice
Der Bereich Sprache steuert Aktivierung, Gespräch und Ausgabe. Unter Aktivierung schaltest du das Wake Word ein, legst es fest und bestimmst, ob eine Sprecherprüfung nötig ist. Mit eingeschalteter Sprecherprüfung reagiert F.R.I.D.A.Y. nur auf die eingelernte Stimme. Unbekannte Stimmen bekommen lokale Antworten ohne Verlauf, ohne Werkzeuge und ohne Zugriff auf verbundene Dienste. Unter Gespräch wählst du Lokal oder Qwen Audio. Bei der Spracherkennung wählst du Deutsch oder Englisch und ein bereits lokal vorhandenes Whisper-Modell. Im Abschnitt Datenschutz entscheidest du, ob der Sprachverlauf gespeichert wird und ob Rohaufnahmen bleiben. Zuletzt stellst du Stimme, Tempo und die Geräte für Ein- und Ausgabe ein.

## Benachrichtigungen
Stichworte: benachrichtigungen, ruhemodus, nachtruhe, ruhezeiten, kanäle, eskalation, priorität, schlummern
Bereich: einstellungen:notifications
Hier legst du fest, welche Kanäle Meldungen bekommen und ab welcher Priorität. Verfügbar sind Dashboard, Telegram, WhatsApp, SMS, Anruf und E-Mail. Unter Ruhemodus startest und beendest du die befristete Ruhe, zum Beispiel für 30 Minuten oder bis morgen 7 Uhr. Darunter stellst du die Ruhezeiten ein, also die Nachtruhe, mit Von und Bis. Außerdem legst du fest, welche Arten auch bei Nur Stimme aus als Text kommen, welcher Textempfänger gilt und wie die Standard-Eskalation abläuft. Ohne Textempfänger findet kein Textversand statt.

## Sicherheit
Stichworte: sicherheit, anmeldung, sitzung, timeout, abmelden, fernzugriff, origins, audit hash
Bereich: einstellungen:security
Der Bereich Sicherheit betrifft Anmeldung und Sitzungen. Mit Anmeldung erforderlich verlangst du beim Öffnen des Dashboards eine Anmeldung. Das Sitzungs-Timeout legt fest, wie lange eine Sitzung in Minuten gilt. Das Fenster für erneute Anmeldung bestimmt, wie lange eine erneute Anmeldung gültig bleibt. Mit Alle Sitzungen beenden meldest du alle Sitzungen ab. Der Schalter Fernzugriff ist derzeit nicht umschaltbar und dient nur der Anzeige. Auch die Audit-Hashkette wird nur angezeigt. Vertrauenswürdige Ursprünge trägst du als Adressen ein.

## Freigaben
Stichworte: freigaben, ablauf, frist, entwurf, bestätigung, stufe, benachrichtigung, sicherheitsstufe
Bereich: einstellungen:approvals
Hier stellst du ein, wie Freigaben funktionieren. Offene Freigaben haben eine Ablauffrist, die du in Minuten einträgst. Der Schalter Standardmäßig nur Entwürfe legt fest, dass Nachrichten zunächst nur als Entwurf entstehen. Stufe 2 bestätigen verlangt eine ausdrückliche Bestätigung. Stufe 3 verlangt eine erneute Anmeldung, dieser Schalter ist aber fest eingestellt und nicht änderbar. Mit Bei neuer Anfrage benachrichtigen erhältst du eine Meldung, sobald eine neue Freigabe wartet.

## Datenaufbewahrung
Stichworte: aufbewahrung, löschen, fristen, bereinigung, audit archiv, sprachverlauf, temporäre dateien, tage
Bereich: einstellungen:dataRetention
Hier legst du fest, wie lange Daten bleiben. Du stellst Fristen in Tagen für Sprachverlauf, Audit im aktiven Speicher, Benachrichtigungen und temporäre Dateien ein. Die Standardlebensdauer für Gedächtniseinträge wird hier nur angezeigt. Mit Betroffene Einträge zählen siehst du vorab, was entfernt würde. Mit Bereinigung jetzt ausführen startest du den Lauf. Ältere Audit-Einträge wandern dabei in ein dauerhaftes lokales Archiv und sparen keinen Speicherplatz. Das Obsidian-Gedächtnis bleibt unbegrenzt erhalten. Die automatische Bereinigung ist standardmäßig aus.

## Backups
Stichworte: backup, sicherung, zeitplan, cron, zielordner, aufbewahren, wiederherstellung, restore test
Bereich: einstellungen:backups
Im Bereich Backups schaltest du automatische Sicherungen ein. Du legst den Zeitplan im Cron-Format fest, zum Beispiel täglich um 3 Uhr, den Zielordner und die Anzahl der aufbewahrten Sicherungen. Ältere Sicherungen werden danach automatisch gelöscht. Hier siehst du auch, wann das letzte Backup lief und ob es erfolgreich war. Die Backup-Prüfung sieht nur der Owner. Dort prüfst du Ziel und Platzbedarf, startest eine Sicherung, kontrollierst das letzte Backup oder testest die Wiederherstellung in einem getrennten Ordner. Eine echte Wiederherstellung braucht zusätzlich die Neuinstallation von Hermes.

## Entwickler
Stichworte: entwickler, debug, rohdaten, json, log level, orb overlay, leistung, diagnose
Bereich: einstellungen:developer
Der Bereich Entwickler enthält Optionen für die Fehlersuche. Mit dem Debug-Modus schaltest du zusätzliche Diagnoseausgaben ein. Der Schalter Rohdaten (JSON) anzeigen macht die Antworten der Oberfläche als Rohdaten sichtbar. Das Orb-Performance-Overlay zeigt die Leistung des Orbs an. Das Log-Level bestimmt, wie ausführlich protokolliert wird. Diese Optionen sind für die Diagnose gedacht. Lass sie im Alltag aus, wenn du sie nicht brauchst.
