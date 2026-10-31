# Fehlerbilder

## F.R.I.D.A.Y. hört nicht
Stichworte: hört nicht, mikrofon, keine reaktion, audiogerät, stumm, mikrofon aus, sprachsteuerung tot
Bereich: fehlerbild
Prüfe zuerst auf der Seite Sprache, ob das Mikrofon aufnimmt, nicht verbunden ist oder auf ein Audiogerät wartet. Steht dort Wartet auf Audiogerät, ist das gewählte Gerät getrennt. Schließe es an oder wähle unter Einstellungen → Sprache ein anderes Eingabegerät. Mit Audiogeräte neu suchen aktualisierst du die Liste. Prüfe danach, ob unten in der Leiste Pause aktiv ist. Dann klickst du auf Fortsetzen. Steht im Laufzeitstatus des Bereichs Sprache, dass der Sprachdienst nicht verbunden ist, läuft der Dienst nicht. Dann prüfst du den Sprachadapter auf der Systemseite.

## Wake Word reagiert nicht
Stichworte: wake word, aktivierungswort, reagiert nicht, keine antwort auf wake word, sprecherprüfung, falsche phrase
Bereich: fehlerbild
Öffne Einstellungen → Sprache und prüfe im Abschnitt Aktivierung, ob der Schalter Wake Word aktiv eingeschaltet ist. Vergleiche die Phrase im Feld Wake Word mit dem, was du sagst. Wurde die Phrase geändert, musst du die Einstellungen speichern, sonst gilt noch die alte Phrase. Ist die Sprecherprüfung eingeschaltet, reagiert F.R.I.D.A.Y. nur auf die eingelernte Stimme. Im Laufzeitstatus steht dann, ob Einstellungen wirken. Erscheint Wirkung nicht bestätigt, speichere erneut oder prüfe den Sprachdienst auf der Systemseite.

## Keine Antwort im Qwen-Modus
Stichworte: qwen keine antwort, qwen fehler, kontingent, schlüssel abgelehnt, qwen audio hängt, lokal antworten
Bereich: fehlerbild
Öffne Einstellungen → Sprache und lies den Statustext im Abschnitt Gespräch. Dort steht die Ursache, etwa Schlüssel wird nicht akzeptiert, Kontingent aufgebraucht, Anfragen werden gedrosselt oder nicht erreichbar. Bei einem solchen Fehler antwortet der Assistent lokal und sagt die Ursache einmal an. Bei einem abgelehnten Schlüssel klickst du auf Schlüssel ersetzen und trägst einen neuen ein. Der Schlüssel wird vor dem Speichern bei Qwen geprüft. Bei Kontingent oder Drosselung prüfst du das Kontingent beim Anbieter oder wartest ab.

## Hermes oder Agenten nicht erreichbar
Stichworte: hermes nicht erreichbar, agenten offline, agent antwortet nicht, adapter offline, verbindung fehlt, healthcheck
Bereich: fehlerbild
Öffne die Systemseite und suche in der Adapter-Matrix den Eintrag für Hermes oder den Agenten-Adapter. Der Status zeigt, ob er online, eingeschränkt oder offline ist, und der Letzte Fehler nennt die Ursache. Wähle die Zeile aus und starte den Healthcheck. Ist die Aktion ausgegraut, fehlt dir die Berechtigung oder die Funktion. Mit Reconnect oder Adapter neu starten versuchst du die Verbindung neu aufzubauen. Unter Einstellungen → Hermes-Konfiguration siehst du, ob die installierte Hermes-Version unterstützt wird.

## Update fehlgeschlagen
Stichworte: update fehlgeschlagen, dashboard update, rollback, github update, update fehler, vorheriger stand
Bereich: fehlerbild
Öffne Einstellungen → Dashboard und schau in den Abschnitt Dashboard-Updates. Dort steht Letztes Update fehlgeschlagen, zusammen mit der Meldung des fehlgeschlagenen Schritts. Prüfe bei Installiert und GitHub main, welche Version läuft und welche verfügbar ist. Steht dort Vorheriger Stand wird wiederhergestellt, hat das Update zurückgerollt. Ein Klick auf Jetzt prüfen aktualisiert den Status. Versuche das Update erst erneut, wenn die Ursache aus dem Fehlertext behoben ist. Das Update ist nur für den Owner sichtbar.

## Kalender zeigt keine Termine
Stichworte: kalender leer, keine termine, termine fehlen, abgleich, kalender verbinden, zeitraum, zeitzone
Bereich: fehlerbild
Prüfe auf der Kalenderseite zuerst den Zeitraum. Mit Heute oder Weiter und Zurück stellst du den richtigen Tag ein, denn Keine Termine in diesem Zeitraum bedeutet nur, dass dieser Zeitraum frei ist. Kontrolliere die Zeitzone unter Einstellungen → Profil. Unter Einstellungen → Adapter prüfst du, ob der Kalender-Adapter aktiv ist und Verbindung testen erfolgreich war. Nach dem Speichern eines Kalenderkontos erscheinen Termine erst nach dem nächsten Abgleich.

## Nachricht wird nicht versendet
Stichworte: nachricht nicht gesendet, versand fehlt, nachricht hängt, freigabe offen, telegram sendet nicht, textempfänger
Bereich: fehlerbild
Prüfe zuerst die Seite Freigaben. Ein Versand von Entwürfen wartet dort auf deine Entscheidung, bis du ihn genehmigst. Dann schaust du auf Mail & Kommunikation, ob der Kanal das Recht Senden hat. Bei Telegram oder WhatsApp kontrollierst du unter Einstellungen → Skill-Konten, ob die Kopplung besteht und die Anfrage freigegeben ist. Liegt die Ruhemodus-Stufe Still an, wird nichts versendet. Beende dann den Ruhemodus unter Einstellungen → Benachrichtigungen.

## Ansagen kommen nicht (Ruhemodus aktiv)
Stichworte: keine ansagen, ruhemodus aktiv, nachtruhe, nichts gesagt, stumm, ansage fehlt, ruhe beenden
Bereich: fehlerbild
Öffne Einstellungen → Benachrichtigungen und lies die Statuszeile im Abschnitt Ruhemodus. Dort steht, bis wann die Ruhe läuft und ob es die Nachtruhe ist. Unter Während der Ruhe findest du die Meldungen, die zurückgehalten wurden. Ist die Stufe Still, wird nichts laut angesagt und nichts versendet. Mit Ruhemodus beenden endet die befristete Ruhe sofort. Für die Nachtruhe schaltest du Ruhezeiten aktiv aus oder passt Von und Bis an. Zurückgehaltene Ansagen kommen danach gesammelt. Nach der Nachtruhe kommen sie erst, wenn du wieder sprichst.
