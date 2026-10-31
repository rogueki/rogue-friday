# Sprachbetrieb

## So funktioniert die Sprache
Stichworte: sprache, sprechen, wake word, befehl, antwort, ablauf, sprachsteuerung, gespräch
Bereich: sprache
Du sprichst das Wake Word, etwa Hey Friday, dann hörst du einen kurzen Piepton. Danach sagst du deine Frage oder deinen Befehl. F.R.I.D.A.Y. antwortet mit Sprache und zeigt den Verlauf im Dashboard. Fragen nach Uhrzeit und Datum beantwortet der Assistent direkt. Fragen nach Wetter, Terminen, offenen Aufgaben, Freigaben oder dem Systemzustand beantwortet er ebenfalls direkt, ohne einen Agenten zu starten. Alles, was etwas erledigt, sucht, sendet oder ändert, gibt er an einen Hintergrundagenten weiter und sagt dir, dass es läuft. Du kannst auch über die Schaltfläche im Dashboard sprechen, statt das Wake Word zu nutzen.

## Wake Word und Sprecherprüfung
Stichworte: wake word, sprecherprüfung, stimme erkennen, gast, fremde stimme, befehle, aktivierungswort
Bereich: sprache
Das Wake Word lauscht lokal auf deinen Aktivierungssatz und löst aus, wenn es erkannt wird. Mit der Sprecherprüfung reagiert F.R.I.D.A.Y. nur auf die eingelernte Stimme. Eine unbekannte Stimme erhält lediglich lokale Antworten, ohne Verlauf, ohne Werkzeuge und ohne Zugriff auf verbundene Dienste wie Mail oder Kalender. Die Stimme eines Gastes geht nie an Qwen. Ein eigenes Wake Word braucht eigene Aufnahmen, die du im Dashboard unter Sprache einlernst oder im Installer neu aufnimmst.

## Lokal oder Qwen
Stichworte: lokal, qwen, qwen audio, gesprächsmodus, cloud, token plan, fallback, antwort lokal, region, singapur, peking
Bereich: sprache
Im Modus Lokal läuft das gesamte Gespräch auf diesem PC. Im Modus Qwen Audio führt das Gespräch ein Sprachmodell über das Internet. Qwen beantwortet dann jede geprüfte Äußerung eines bestätigten Sprechers. Wake Word, Sprecherprüfung und die Stimme bleiben trotzdem auf diesem PC. Fällt Qwen aus, etwa wegen eines abgelehnten Schlüssels, eines aufgebrauchten Kontingents oder fehlender Verbindung, antwortet der Assistent lokal. Vor der lokalen Antwort sagt er einmal an, was los ist. Nach einem erfolgreichen Gespräch wird eine neue Störung wieder angesagt. Die Qwen-Region (International über Singapur oder Festlandchina über Peking) muss zu deinem Token Plan passen; ein Schlüssel aus der anderen Region wird abgelehnt. Nutzt das Denkmodell bereits einen Alibaba Token Plan, übernimmt der Knopf „Schlüssel des Denkmodells übernehmen“ unter Einstellungen → Sprache → Gespräch dessen Schlüssel direkt auf diesem PC, ohne dass du ihn noch einmal eintippen musst. Ist ein Schlüssel gespeichert, prüft „Verbindung prüfen“ ihn mit einer kurzen Qwen-Sitzung gegen die gespeicherte Region und nennt das Ergebnis, etwa „Kontingent aufgebraucht“; geändert wird dabei nichts.

## Sprachbetrieb wechseln: lokal oder ElevenLabs
Stichworte: sprachbetrieb, elevenlabs, lokale stimme, grafikkarte, gpu, wechseln, cloud-stimme, installer, administratorrechte
Bereich: sprache
Der Sprachbetrieb legt fest, woher die Stimme kommt: Lokal laufen Spracherkennung und Stimme auf der NVIDIA-Grafikkarte dieses PCs, mit ElevenLabs kommt die Stimme aus der ElevenLabs-Cloud. Wake Word und Sprecherprüfung bleiben in beiden Fällen auf diesem PC. Den aktuellen Sprachbetrieb zeigt Einstellungen → Sprache → Sprachbetrieb. Der Knopf zum Wechseln öffnet nach einer Rückfrage am PC den Installer; Windows fragt dabei nach Administratorrechten, und diese Abfrage muss am PC bestätigt werden. Der Installer richtet nur die Sprachteile neu ein, Name, Konten, KI-Zugang und Dashboard bleiben unverändert. Für lokal braucht der PC eine NVIDIA-Grafikkarte mit mindestens 6 GB Speicher, fehlende Sprachmodelle werden geladen (mehrere GB). Für ElevenLabs fragt der Installer nach dem ElevenLabs-Schlüssel und der Stimme; gesprochene Antworten gehen dann zur Sprachausgabe an ElevenLabs. Bis der Installer fertig ist, bleibt der bisherige Sprachbetrieb aktiv, danach zeigt das Dashboard den neuen von selbst. Der Gesprächsmodus Lokal oder Qwen ist davon unabhängig.

## Folgefragen und Unterbrechen
Stichworte: folgefrage, unterbrechen, stopp, abbrechen, nachfragen, gesprächsfenster, pause, gespräch beenden, danke das war's, tschüss
Bereich: sprache
Nach einer Antwort kannst du im lokalen Ablauf eine Folgefrage stellen, ohne das Wake Word erneut zu sagen. Standardmäßig bleibt dafür 20 Sekunden Zeit; die Dauer stellst du unter Einstellungen → Sprache → Gespräch ein. Mit „Danke, das war's“, „Das ist alles“ oder „Tschüss“ beendest du das Gespräch sofort; danach brauchst du wieder das Wake Word. Während der Assistent spricht, unterbrichst du ihn, indem du das Wake Word sagst. Das Stoppwort Stopp, Stop, Abbrechen, Halt, Ruhe oder Sei still beendet nur den Dialog und die Ausgabe. Ein laufender Auftrag läuft weiter, und sein Ergebnis wird später angesagt. Einen laufenden Auftrag kannst du per Sprache abbrechen, indem du ihn beim Namen oder Thema nennst.

## Hintergrundaufträge und Ansagen
Stichworte: ansagen, ergebnisse, aufträge, hintergrund, zusammenfassung, recherche, agent, ergebnis vorlesen, ansagen aus, von sich aus
Bereich: sprache
Gibst du einen Auftrag, etwa Recherchiere, welche Laptops neu erschienen sind, läuft er im Hintergrund bei einem der Agenten für Recherche, Aufgaben, Warnungen oder Prüfung. Bis zu fünf Aufträge laufen parallel. Fertige Ergebnisse sagt F.R.I.D.A.Y. an. Hast du unter Einstellungen → Sprache die Ansagen von sich aus ausgeschaltet, hebt sie sie bis nach deiner nächsten Anfrage auf und beginnt dann mit „Seit unserem letzten Gespräch“. Ab drei Ergebnissen fasst er sie zusammen. Lange Ergebnisse werden nach 1.500 Zeichen gekürzt, den Rest findest du im Dashboard. Ergebnisse gelten als Daten und nicht als Anweisungen. Wer gerade spricht, bekommt die Ansage erst nach einer Pause. Während eines Ruhemodus werden Ansagen zurückgehalten und danach mit Hinweis nachgeholt. Nach einer Ansage außerhalb eines Gesprächs kannst du direkt antworten, ohne das Aktivierungswort zu sagen, etwa auf eine Rückfrage des Auftrags; F.R.I.D.A.Y. prüft dabei wie immer deine Stimme. Das Antwortfenster ist so lang wie die Zeit für Folgefragen.

## Rückfragen von Agenten beantworten
Stichworte: rückfrage, nachfrage agent, antworten, task antwort, offene frage, eingabe, auftrag ergänzen
Bereich: sprache
Braucht ein Agent eine Information, stellt er eine Rückfrage. Der Assistent sagt sie dir einmal an. Du antwortest einfach in deinen Worten, zum Beispiel Ja, nimm die Variante mit Montag. Die Antwort geht an den Agenten, der damit weiterarbeitet. Gibt es mehrere offene Fragen, fragt F.R.I.D.A.Y. nach, zu welcher Aufgabe deine Antwort gehört. Beantwortest du eine Frage im Dashboard, ist das ebenfalls möglich. Nach einem Neustart des Sprachdienstes kennt die Sprachsteuerung offene Fragen nicht mehr. Die Aufgabe wartet aber weiter und lässt sich im Dashboard beantworten.

## Ruhemodus per Stimme
Stichworte: ruhemodus, nicht stören, ruhe, nachtruhe, stille, ansagen pausieren, stimme aus, heute nacht, nicht gestört werden, zusammenfassung, ruhemodus aus
Bereich: sprache
Du kannst den Ruhemodus per Sprache einschalten, etwa mit Ruhemodus für eine Stunde, Ruhemodus bis 15:40 oder Die nächste Stunde will ich nicht gestört werden. Die Endzeit rechnet das System selbst aus. Mit Läuft gerade der Ruhemodus fragst du den aktuellen Stand ab. Ruhemodus heute Nacht setzt die Ruhe bis morgen 7 Uhr. Die Stufe bestimmst du mit still oder stimme aus, zum Beispiel Die nächste Stunde nur Stimme aus. Bei still wird nichts versendet, bei stimme aus kommt Wichtiges als Text an dich. Die tägliche Nachtruhe stellst du per Sprache mit Nachtruhe ist von 22 bis 7 Uhr ein. Bestätigt wird immer die Endzeit. Endet der Ruhemodus von selbst, fasst F.R.I.D.A.Y. sofort zusammen, was in der Zwischenzeit fertig wurde, welche Rückfragen offen sind und welche Freigaben und Termine anstanden; nach der Nachtruhe kommt die Zusammenfassung beim ersten Gespräch oder zur Endzeit, je nach Einstellung. Mit Ruhemodus aus endet die Ruhe sofort und die Zusammenfassung folgt direkt in derselben Antwort. Ein Neustart beendet den Ruhemodus nicht.

## Dashboard-Tour und Bereiche öffnen
Stichworte: tour, dashboard zeigen, führung, rundgang, bereich öffnen, seite öffnen, navigation, zeig mir, öffne
Bereich: sprache
Mit „Zeig mir das Dashboard“, „Starte die Tour“ oder über den Kompass oben in der Leiste startest du eine geführte Tour durch alle sichtbaren Bereiche des Dashboards, in der Reihenfolge der Seitenleiste. Auch am Ende der Einführung gibt es den Knopf „Dashboard-Tour starten“. Jeder Schritt öffnet den Bereich und zeigt eine kurze Erklärung; ist „Vorlesen“ an, erklärt F.R.I.D.A.Y. den Bereich auch mit ihrer Stimme. Danach kannst du direkt eine Frage stellen, ohne das Aktivierungswort zu sagen. Mit Weiter und Zurück wechselst du die Bereiche, Escape oder Schließen beendet die Tour. Mit „Öffne den Kalender“ oder „Zeig mir die Einstellungen“ öffnet die Stimme einen Bereich direkt. Die Tour und diese Befehle wechseln nur die Ansicht und ändern keine Einstellung.

## Beispielsätze
Stichworte: beispiele, beispielsätze, sprachbefehle, was kann ich sagen, sätze, formulierungen
Bereich: sprache
Nach dem Wake Word kannst du zum Beispiel sagen: Wie spät ist es? Oder: Wie weit sind meine Aufgaben? Was steht heute an? Welche Freigaben sind offen? Ruhemodus für eine Stunde. Recherchiere ein Thema, dann meldet sich der Assistent, sobald das Ergebnis fertig ist. Sprich möglichst in ganzen, klaren Sätzen. Einstellungen ändert der Assistent per Sprache nur bei der Nachtruhe. Alle anderen Einstellungen änderst du im Dashboard.

## Selbstdiagnose: Prüf dich
Stichworte: selbstdiagnose, selbsttest, prüf dich, hörst mich nicht, antwortest nicht, keine ansagen, funktioniert alles, fehler finden
Bereich: sprache
Sag „Prüf dich“ oder „Selbsttest“, dann prüft F.R.I.D.A.Y. sich mit Live-Werten und nennt zuerst, was auffällt: ob das Mikrofon aufnimmt, ob das Wake Word an ist, ob die Sprecherprüfung ein Profil hat oder viele Befehle abgelehnt hat, ob der Qwen-Gesprächsmodus seinen Schlüssel hat, ob das Dashboard erreichbar ist, ob gerade Ruhemodus oder Nachtruhe gilt, wie der Systemstatus aussieht und ob das Gedächtnis Einträge nicht übertragen kann. Findet sie nichts, sagt sie das. Die Antwort kommt direkt, ohne Agent und ohne Rohfehlertexte. Die Prüfschritte zu einem Befund erklärt die Hilfe, etwa mit der Frage „Wie prüfe ich das Mikrofon?“.
