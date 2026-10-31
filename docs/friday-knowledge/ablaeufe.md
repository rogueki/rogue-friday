# Abläufe

## Sprachbetrieb wechseln
Stichworte: sprachbetrieb wechseln, qwen aktivieren, lokal umstellen, gesprächsmodus, qwen audio, token plan, sprache umschalten
Bereich: ablauf
Öffne Einstellungen → Sprache und gehe zum Abschnitt Gespräch. Im Feld Gespräch wählst du Lokal oder Qwen Audio Live-Gespräch. Lokal bedeutet, dass das Gespräch auf diesem PC läuft. Für Qwen brauchst du einen Alibaba-Token-Plan-Schlüssel. Fehlt er, meldet das Feld das, und darunter erscheint das Eingabefeld für den Schlüssel. Trage ihn dort ein und klicke auf Prüfen und speichern. Der Schlüssel wird vor dem Speichern bei Qwen geprüft. Danach speicherst du die Einstellungen unten mit Speichern. Der Statustext zeigt, ob Qwen aktiv ist oder ob lokal geantwortet wird.

## Stimme anlernen
Stichworte: stimme anlernen, sprecherprofil, sprecherprüfung, stimmprofil, einlernen, stimme neu aufnehmen, change voice
Bereich: ablauf
Das Einlernen der Stimme läuft über den Installer, nicht über das Dashboard. Öffne im Installationsordner, standardmäßig C:\Friday\installer, die Datei change-assistant-name.bat. Sie nimmt Name und Wake Word erneut auf und wiederholt die Stimmaufnahme. Bleiben Name und Wake Word gleich, kannst du nur die Aufnahme wiederholen. Danach prüfst du unter Sprache → Sprecherprofile, ob ein Profil mit Qualität und Schwellwert vorliegt. Zeigt die Anzeige Profilstand unbekannt, kann das Profil trotzdem aktiv sein. Schalte anschließend die Sprecherprüfung im Bereich Sprache ein.

## Wake Word im Dashboard einlernen
Stichworte: wake word ändern, aktivierungswort, aktivierungsphrase, einlernen, hey friday, sprachaktivierung, phrase trainieren
Bereich: ablauf
Öffne Einstellungen → Sprache und gehe zum Abschnitt Aktivierung. Schalte den Schalter Wake Word aktiv ein. Trage im Feld Wake Word die neue Phrase ein, zum Beispiel Hey Friday. Danach erscheint der Button Aktivierungsphrase einlernen. Im Dialog startest du die Aufnahme und sprichst die Phrase, die Kurzform und ähnliche andere Wörter, bis alle Zähler voll sind. Danach startest du das Training. Das bisherige Wake Word bleibt aktiv, bis du speicherst. Speichere deshalb zum Schluss unten mit Speichern. Die Aufnahmen bleiben lokal und werden nach dem Training gelöscht.

## Name und Wake Word über den Installer ändern
Stichworte: name ändern, wake word installer, change assistant name, assistentenname, installer skript, wake word neu
Bereich: ablauf
Wenn du auch den Namen des Assistenten ändern willst, nutzt du den Installer. Öffne im Installationsordner, standardmäßig C:\Friday\installer, die Datei change-assistant-name.bat per Doppelklick. Das Skript fragt den neuen Namen und das neue Wake Word. Mit Enter behältst du den bisherigen Wert. Danach passt es die Persönlichkeit an, wiederholt die Stimmaufnahme und das Training des Wake Words und startet den Sprachdienst neu. Das dauert einige Minuten.

## Wetterort festlegen
Stichworte: wetter, wetterort, standort, ort festlegen, stadt, postleitzahl, standort aktivieren, wetter einstellen
Bereich: ablauf
Öffne Einstellungen → Dashboard und scrolle zum Abschnitt Standort & Wetter. Du hast zwei Wege. Mit Standort aktivieren bestätigst du zuerst eine Abfrage. Danach ermittelt dein Browser einmal die Position, und der Ortsname wird übernommen. Alternativ tippst du unter Stadt oder Postleitzahl einen Ort ein und klickst auf Ort suchen. Wähle den passenden Treffer aus und bestätige mit Standort übernehmen und speichern. Die automatische Standorterkennung braucht HTTPS oder localhost. Mit Standort entfernen löschst du den gespeicherten Ort wieder. Das Wetter für diesen Ort erscheint danach im Dashboard.

## E-Mail-Konto verbinden
Stichworte: e-mail verbinden, postfach einrichten, mail konto, imap, smtp, app-passwort, gmail, mail einrichten
Bereich: ablauf
Öffne Einstellungen → Skill-Konten und scrolle zu Mail Postfach. Mit Neues Konto startest du den Assistenten. Trage zuerst deine E-Mail-Adresse ein. Bei bekannten Anbietern schlägt der Assistent Server vor, die du prüfen und ändern kannst. Danach folgen Kontoname, Absendername, die IMAP- und SMTP-Server und die Anmeldung mit Passwort oder App-Passwort. Im Schritt Verbindungen prüfen testest du IMAP und SMTP getrennt. Der SMTP-Test sendet keine Nachricht. Gespeichert wird erst im letzten Schritt, mit Postfach übernehmen. OAuth für Gmail und Microsoft richtest du unter Erweitert an einem bestehenden Konto ein.

## Kalender verbinden
Stichworte: kalender verbinden, caldav, ics, google kalender, outlook, termine anzeigen, kalenderkonto, abgleich
Bereich: ablauf
Öffne Einstellungen → Adapter und wähle in der Liste den Kalender-Adapter aus. Im Abschnitt Kalender verbinden wählst du zuerst die Anbieterhilfe, etwa Google Kalender, Outlook.com, Windows Kalender, einen ICS-Kalender oder CalDAV. Dann öffnet sich der Assistent. Bei einem ICS-Feed trägst du die private Adresse ein, sie wird nur gelesen. Bei CalDAV gibst du die Kalendersammlung, Benutzername und Passwort oder App-Passwort ein. Danach suchst du die Kalender, legst Standard und Abgleich fest und übernimmst. Anschließend klickst du in der Adapterliste auf Verbindung testen. Erst der erfolgreiche Test bestätigt den Zugriff.

## Telegram einrichten
Stichworte: telegram einrichten, telegram bot, botfather, bot token, kopplung, telegram gateway, telegram nachrichten
Bereich: ablauf
Öffne Einstellungen → Skill-Konten und scrolle zu Telegram-Bot für Hermes. Erstelle in Telegram über BotFather einen Bot mit dem Befehl /newbot und kopiere das Token. Füge es in das Feld Bot-Token ein. F.R.I.D.A.Y. prüft das Token bei Telegram, bevor es gespeichert wird. Ein abgelehntes Token ersetzt das bisherige nicht. Optional trägst du deine numerische Telegram-ID ein. Ohne IDs läuft der Bot im Kopplungsmodus. Wer ihm schreibt, bekommt einen Code, und du gibst die Anfrage unter Kopplungsanfragen frei. In Gruppen kannst du festlegen, dass nur auf Erwähnung oder Befehl geantwortet wird.

## WhatsApp oder Discord einrichten
Stichworte: whatsapp verbinden, discord bot, qr code kopplung, verknüpfte geräte, discord token, messenger einrichten
Bereich: ablauf
Für Discord öffnest du Einstellungen → Skill-Konten und gehst zum Abschnitt Discord-Gateway für Hermes. Erstelle im Discord Developer Portal einen Bot, aktiviere den Message Content Intent und lade ihn auf deinen Server ein. Trage das Bot-Token und die erlaubten User-IDs ein. Für WhatsApp startest du im Abschnitt WhatsApp-Gateway mit Kopplung starten. Ein QR-Code erscheint, den du in WhatsApp unter Verknüpfte Geräte scannst. Der Code läuft nach kurzer Zeit ab, dann forderst du einen neuen an. Gruppen werden nur freigegeben, wenn du sie ausdrücklich auswählst. Einrichten kann das nur der Owner.

## Benachrichtigungen aufs Handy schicken
Stichworte: benachrichtigungen per telegram, textempfänger, kanal aktivieren, meldungen aufs handy, nur stimme aus, messenger ziel
Bereich: ablauf
Öffne Einstellungen → Benachrichtigungen. Im Abschnitt Kanäle schaltest du Telegram, WhatsApp, SMS, Anruf oder E-Mail ein und wählst die Priorität, ab der Meldungen dorthin gehen. Bei Telegram und WhatsApp trägst du den Empfänger ein. Für die Stufe Nur Stimme aus brauchst du zusätzlich einen Textempfänger, den du im Feld Textempfänger auswählst. Ist dort noch kein Ziel registriert, öffnest du die Seite Kommunikation, wählst links einen Messenger-Kanal wie Telegram und klickst auf Empfänger-ID registrieren. Speichere danach unten mit Speichern. Ohne Textempfänger wird nichts als Text versendet.

## Freigaben bearbeiten
Stichworte: freigabe bearbeiten, genehmigen, ablehnen, freigabe erteilen, entwurf ändern, kontext anfordern, approval
Bereich: ablauf
Öffne die Seite Freigaben und wähle die Freigabe aus. Die Vorschau zeigt, was ausgeführt werden soll, und die Begründung. Mit Genehmigen erteilst du die Freigabe nach einer Bestätigung im Dialog Freigabe erteilen. Mit Ablehnen beendest du sie. Eine Begründung ist optional, und nichts wird ausgeführt. Mit Bearbeiten und genehmigen änderst du Titel oder Inhalt und gibst die geänderte Fassung frei, sofern die Freigabe bearbeitbar ist. Brauchst du mehr Informationen, fragst du mit Mehr Kontext anfordern nach. Der Agent ergänzt die Freigabe, bis dahin passiert nichts.

## Ruhemodus und Nachtruhe einstellen
Stichworte: ruhemodus, nachtruhe, ruhezeit, nicht stören, stille, ansagen aus, ruhe einstellen, bis morgen
Bereich: ablauf
Für eine befristete Ruhe öffnest du Einstellungen → Benachrichtigungen und gehst zum Abschnitt Ruhemodus. Wähle die Stufe Still oder Nur Stimme aus und die Dauer, zum Beispiel 1 Stunde oder Bis morgen 7:00. Mit Ruhemodus starten beginnt die Ruhe sofort, mit Ruhemodus beenden endet sie. Für eine tägliche Nachtruhe schaltest du im Abschnitt Ruhezeiten die Option Ruhezeiten aktiv ein und trägst Von und Bis ein. Unter Zusammenfassung nach der Nachtruhe legst du fest, ob die gesammelten Meldungen beim ersten Gespräch am Morgen oder am Ende der Nachtruhe kommen. Diese Felder speicherst du mit Speichern.

## Dashboard-Update installieren
Stichworte: update, dashboard aktualisieren, github, update installieren, version, neue version, aktualisieren
Bereich: ablauf
Das Update ist dem Owner vorbehalten. Öffne Einstellungen → Dashboard und scrolle zu Dashboard-Updates. Mit Jetzt prüfen holst du den aktuellen Stand von GitHub main. Ist ein Update verfügbar, erscheint der Hinweis Update verfügbar und der Button Update installieren. Im Bestätigungsdialog siehst du die alte und die neue Version. Nach der Bestätigung läuft das Update in festen Schritten: Download, Prüfung, Abhängigkeiten, Build, Sicherung, Installation und Neustart mit Prüfung. Das Dashboard startet dabei kurz neu. Schlägt ein Schritt fehl, stellt das Update den vorherigen Stand wieder her und meldet das.

## Backup erstellen
Stichworte: backup, sicherung, backup erstellen, sichern, wiederherstellung, zielordner, backup prüfen
Bereich: ablauf
Öffne Einstellungen → Backups. Lege dort den Zielordner fest und die Anzahl der Sicherungen, die bleiben sollen. Speichere mit Speichern. Für automatische Sicherungen schaltest du Automatische Backups ein und trägst den Zeitplan ein. Für eine sofortige Sicherung brauchst du die Owner-Rolle. Im Abschnitt Backup-Prüfung klickst du zuerst auf Ziel und Platz prüfen und danach auf Backup jetzt erstellen. Mit Letztes Backup prüfen kontrollierst du die Integrität. Ein Restore-Test läuft in einem neuen, noch nicht vorhandenen Ordner und verändert deine Daten nicht.

## Befehl per Text geben
Stichworte: befehl eingeben, textbefehl, befehlsleiste, befehlspalette, tippen, befehl senden, schnellsuche
Bereich: ablauf
Unten im Dashboard findest du die Befehlsleiste mit dem Feld Befehl eingeben. Schreibe deinen Befehl, zum Beispiel Tagesbriefing, und klicke auf Befehl senden. Die Befehlspalette öffnest du mit Strg und K oder mit dem Schrägstrich, solange du nicht schon in einem Feld tippst. Dort suchst du Seiten, Aktionen und Automationen und führst sie mit Enter aus. Bei Änderungen siehst du vorher eine Vorschau und musst bestätigen. Freitext, der eine Aufgabe auslösen soll, geht nach deiner Bestätigung als Hintergrundauftrag an den passenden Agenten.

## Mit der Stimme sprechen
Stichworte: sprechen, sprachsteuerung starten, mit friday sprechen, push to talk, mikrofon starten, sprachbefehl, stopp
Bereich: ablauf
Unten in der Leiste steht die Schaltfläche, die den Namen deines Assistenten trägt, im Standardfall MIT F.R.I.D.A.Y. SPRECHEN. Damit startest du die Sprachsteuerung. Ist das Wake Word aktiv, reicht auch das Wake Word. In der Befehlspalette findest du den Eintrag Sprachsteuerung starten und stoppen. Zum Anhalten nutzt du Stopp in der Leiste oder sagst das Stoppwort. Pause hält alle laufenden Aktivitäten an, Fortsetzen startet sie wieder. Die Push-to-talk-Taste stellst du unter Einstellungen → Sprache ein. Sie funktioniert mit Browser-Audio und auf dem Windows-Gerätedesktop.
