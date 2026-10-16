# Skills und Ersteinrichtung

Stand: 2026-10-16. Auftrag: Friday soll die installierten Hermes-Skills und die 105 Skills aus `friday-skills` im Dashboard erklären, ihren tatsächlichen Zustand anzeigen und den Besitzer bei der ersten Nutzung durch Profil, Fähigkeiten und nötige Konten führen. Diese Datei hält Anforderungen und Prüfkriterien fest; ein grüner Strukturtest allein bedeutet keine funktionierende Anbieterintegration.

## Anforderungen und Nachweise

| ID | Ergebnis | Nachweis |
| --- | --- | --- |
| SK-01 | Der Katalog enthält alle aktuell paketierten Friday-Skills sowie die tatsächlich gefundenen Hermes-Standardskills, mit Herkunft und Version. Fehlende Laufzeitdaten werden als unbekannt angezeigt. | Registry-Parität, Hermes-Abgleich und UI-Test für fehlende/alte Laufzeitdaten. |
| SK-02 | Ein Menüpunkt „Skills“ bietet Suche, Filter, Detailseite, Aktivstatus, Voraussetzungen, verknüpfte Einstellungen und eine verständliche Fehleranzeige. | Desktop-/Mobilansicht und Interaktionstests. |
| SK-03 | „Paketiert“, „gefunden“, „aktiviert“, „Konto eingerichtet“, „Verbindung geprüft“, „ausführbar“ und „live getestet“ bleiben getrennte Zustände mit Zeit und Quelle. | API-Vertrag, Tests mit widersprüchlichen und ausgefallenen Quellen. |
| SK-04 | Zu jedem Skill sind nötige und optionale Konten, Berechtigungen, Kostenhinweise und Einrichtungswege strukturiert. Kein Konto wird aus einem Skillnamen abgeleitet. | Metadaten-Parität über 105 IDs und fachliche Stichproben. |
| SK-05 | Einstellungen bieten für tatsächlich unterstützte Integrationen gezielte Einrichtung und lesenden Verbindungstest. Secrets bleiben serverseitig verschlüsselt oder bei Hermes und erscheinen nie im Katalog, Export oder Log. Fehlende Adapter zeigen einen konkreten Einrichtungs- oder Entwicklungsstatus. | Auth-/CSRF-/Secret-Tests und gezielte Laufzeitprobe. |
| SK-06 | Ein fortsetzbares Onboarding beginnt nach der Besitzeranlage, lernt Name, Ziele und gewünschte Fähigkeiten kennen, erklärt Friday und führt durch vorhandene Skills und Konten. Schritte können übersprungen und später geändert werden. | Neuinstallation/Erstlogin, Wiederaufnahme und bestehendes Konto als Regression. |
| SK-07 | Friday kennt den aktuellen Skillzustand über dieselbe autoritative Quelle wie das Dashboard und kann Onboarding und Status per Sprache erklären, ohne fehlende Fähigkeiten zu behaupten. Sprachänderungen mit Seiteneffekt benötigen dieselben Rechte wie UI-Aktionen. | isolierter Voice-Test, API-Berechtigungstest und später echter Hörtest. |
| SK-08 | Hermes-Standardskills für Präsentationen und Computer Use werden, wenn installiert, mit den passenden Friday-Skills verknüpft. Obsidian, Telefonie und Coding-CLIs erhalten reale Capability- und Setup-Checks; fehlende Laufzeit wird sichtbar blockiert. | installierte Hermes-Version und Liste, Integrations-/Negativtests pro Capability. |
| SK-09 | Der Installer richtet die Friday-Skills reproduzierbar ein, ohne Benutzeränderungen zu überschreiben; Updates und Neustarts erhalten Zustand und Zugangsdaten. | frischer isolierter Installationslauf und Updateprobe. |
| SK-10 | Beide Repositories enthalten die geprüften Änderungen auf GitHub. Die laufende D:-Installation zeigt den neuen Stand, ohne kostenpflichtige oder externe Aktionen auszulösen. | Git-Refs, CI, Health, Browser- und API-Probe nach Deployment. |
| SK-11 | Nach Abnahme und Merge sind `rogueki/rogue-friday` und `rogueki/friday-skills` öffentlich, MIT-lizenziert und mit passenden GitHub-Repository-Einstellungen versehen. | Lizenzdateien, Secret-/History-Check, GitHub-Visibility und Repository-Metadaten nach der Umstellung prüfen. |

## Vertragsentscheidungen

- Die Control API liefert den Katalog und den beobachteten Hermes-Zustand. Das Frontend verwendet ausschließlich das generierte SDK. Die Skills-Registry ist Paketquelle, kein Beweis für Laufzeitbereitschaft.
- Aktivieren/Deaktivieren, Kontobindung und Tests sind getrennte Operationen. Keine beliebigen CLI-Befehle oder Pfade aus Browser-Eingaben ausführen.
- Konten mit fehlenden offiziellen Apps, OAuth-Clients oder Adaptern bleiben als „Einrichtung erforderlich“ beziehungsweise „noch nicht unterstützt“ sichtbar. Sie gelten nicht durch einen gespeicherten API-Key als live geprüft.
- Ein Onboarding-Abschluss bedeutet, dass die Einführung bearbeitet oder bewusst übersprungen wurde. Er bedeutet nicht, dass alle 105 Skills nutzbar sind.

## Lieferfolge

1. Hermes- und Friday-Inventar mit Versionsstand und Datenvertrag festhalten. Voraussetzungen für die 105 Skills maschinenlesbar und validiert bereitstellen.
2. Control-API-Katalog, Laufzeitabgleich und persistierten Onboarding-Zustand mit Rollen-/Fehlerfällen implementieren; Vertrag zuerst in `packages/contracts`, dann SDK generieren.
3. Skills-Seite, Einstellungen und Erststartführung auf dem stabilen Vertrag bauen; Desktop/Mobil und Accessibility prüfen.
4. Sprachführung und konkrete Integrationen für Präsentationen, Computer Use, Obsidian, Telefonie und Coding-CLIs anbinden; jeden fehlenden Host/Account als echten Fehlerzustand behandeln.
5. Installer, lokale D:-Laufzeit, beide Repositories und Dokumentation mit gezielten kritischen Tests abnehmen. Nach Merge MIT-/Secret-Gate prüfen, beide Repositories veröffentlichen und GitHub-Einstellungen verifizieren. Keine bezahlte Medienerzeugung und kein Social-Posting als Testnebenwirkung. Eine Beta-Abnahme verlangt einen funktionierenden Kernablauf, keine Vollausführung jedes Skills.

## Aktuelle Evidenz und Grenzen

- `friday-skills` bei `0cdf7b8`: 105 paketierte Skills. Alte Texte nennen teils 101. Laufzeitaktivierung folgt daraus nicht.
- `rogue-friday` bei `e2ccf1d`: Dashboard und Content-Studio-API vorhanden; ein Skills-Menü und fortsetzbares Onboarding fehlen.
- Auf der aktuellen Friday-Ubuntu-Installation läuft Hermes v0.22.2. `hermes skills list --source builtin` meldete 53 eingebaute Skills als aktiviert, darunter `powerpoint`, `computer-use`, `obsidian`, `opencode`, `codex` und `claude-code`. Der Status der 105 Friday-Skills muss mit dem laufenden Hermes-Profil abgeglichen werden. Das Hermes-Dashboard läuft auf Port 43791; `/api/skills` verlangt Authentifizierung.
- `telephony` ist nicht installiert. OpenCode läuft in Friday-Ubuntu; Codex zeigt auf einen dort nicht ausführbaren Windows-Shim, Claude Code ist nicht im WSL-PATH. PowerPoint ist als Skill aktiv, aber `python-pptx` fehlt in Friday-Ubuntu; ein Obsidian-Vault ist nicht verifiziert. Diese Unterschiede müssen als Voraussetzungen oder Fehlerzustände sichtbar sein.
- Offizielle Hermes-Verträge: `GET /api/skills` liefert Name/Beschreibung/Kategorie/Aktivstatus, `PUT /api/skills/toggle` schaltet einen Skill um. Der Control-API-Server verwendet dafür den bereits vorgesehenen serverseitigen Hermes-Dashboard-Tokenpfad, niemals ein Browser-Secret.
