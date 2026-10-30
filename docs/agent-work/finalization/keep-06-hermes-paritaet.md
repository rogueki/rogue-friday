# KEEP-06 - Hermes-Paritaet: Abdeckung des Inventars (Stand 2026-10-30)

Quelle: `../hermes-full-integration/hermes-feature-inventory.json` (Hermes `d923a5eb`, 2522 Eintraege, alle
`status: UNMAPPED`, weil `generate_inventory.py` keine Zuordnung schreibt). Die Zuordnung unten ist eine Code-Pruefung je
Eintragsart, keine Zeile-fuer-Zeile-Zuordnung. KEEP-06 bleibt offen.

| Art | Anzahl | Allgemeiner Consumer im Dashboard | Abdeckung | Lesen / Schreiben | Test |
|---|---:|---|---|---|---|
| config | 814 | Einstellungen > Hermes (`HermesConfigArea.tsx`, `GET/PATCH /settings/hermes-config`, `hermes_config_bridge.py`) | nur die typisierte Allowlist `HERMES_CONFIG_FIELDS` (rund 85 Inventarschluessel); p7d (97) und p7f (75) dokumentieren weitere Schluessel ohne UI-Weg | Lesen + Schreiben mit If-Match, Laufzeitwirkung `unverified` | `hermes-config.test.ts`, `hermes-config-routes.test.ts`, `test_hermes_config_bridge.py` |
| plugin_catalog | 614 | keiner | 0 | - | - |
| tool | 350 | keiner (Eintraege sind Python-Module unter `tools/`, keine Nutzerwerkzeuge); nur die Toolset-Liste ist einstellbar | 0 | - | - |
| optional_env | 153 | kein allgemeiner Editor; je Bereich eigene Allowlist (Skill-Schluessel, Modellzugang, Telegram, Discord/WhatsApp, Messenger-Anbieter, Content Studio) | etwa 28 (Namensabgleich, nicht maschinell gezaehlt) | nur "konfiguriert ja/nein" lesen, Schreiben je Schluessel | `hermes-skill-keys.test.ts`, `messenger-provider-routes.test.ts` |
| optional_skill | 153 | Skill-Registry-Suche (`SkillRegistryPanel.tsx`, `/skills/hub/search`) | nur Suchtreffer (max. 50), keine Aufzaehlung; Installieren bewusst nicht in der Oberflaeche | Lesen; Install-Route ohne UI | `skills-hub-route.test.ts`, `SkillRegistryPanel.test.tsx` |
| plugin | 108 | Hermes-Bereich, Liste installierter Benutzer-Plugins mit Schalter | nur, was `hermes plugins list --user` meldet | Lesen + Aktivieren mit Rueckleseprobe | `hermes-config.test.ts`, `test_hermes_config_bridge.py` |
| plugin_manifest | 102 | Messenger-Katalog (`messaging_catalog.py`, `MessengerCatalogPanel.tsx`) | 18 Plattform-Manifeste im 24er-Katalog; die uebrigen ohne Leser | Lesen; Einrichten fuer 21 Anbieter | `messenger-send-routes.test.ts`, `test_messaging_catalog.py` |
| cli_module | 65 | keiner; Friday ruft gezielte CLI-Befehle auf | 0; Kandidaten fuer "nicht uebertragbar" (completion, skin, acp, gui, update/uninstall, login/logout) sind nur nach Namen eingeordnet | - | - |
| bundled_skill / installed_skill | 58 / 58 | Skills-Seite (`SkillsService.list()`, Hermes-Dashboard + `hermes skills list`) | alles, was die Laufzeit meldet; die Inventarliste selbst wird nicht gelesen (CLI meldete am 23.10. 72 Builtins, Inventar 58 - nicht abgeglichen) | Lesen + Aktivieren mit Rueckleseprobe; Install/Update/Deinstallation nur als API | `skills-inventory-route.test.ts`, `SkillsPage.test.tsx`, `SelectedSkillActivation.test.tsx` |
| gateway_platform | 44 | keiner nach Kennung (Eintraege sind Module unter `gateway/platforms/`); echte Plattformen ueber den Messenger-Katalog | 0 nach Kennung | - | - |
| installed_plugin | 2 | wie plugin | beide, sofern die CLI sie meldet | wie plugin | wie plugin |
| plugin_schema | 1 | keiner gefunden (Gedaechtnis-Einrichtung laeuft getrennt ueber `configure_memory_bridge.py`) | 0 | - | - |

## Offene Entscheidungen fuer den Owner

1. Sollen alle 814 Hermes-Einstellungen im Dashboard aenderbar werden (allgemeiner, schemagesteuerter Editor) oder bleibt
   es bei der typisierten Allowlist mit begruendeter Auswahl? Ein allgemeiner Editor schreibt beliebige Schluessel in die
   Live-Konfiguration und braucht je Typ Validierung und Rueckweg.
2. Plugin-Katalog (614) und optionale Skills: Installieren aus dem Dashboard anbieten oder bewusst nur ueber die CLI?
3. Nicht uebertragbare CLI-/Desktop-Funktionen formal kennzeichnen (Liste oben) - Vorschlag, nicht im Code belegt.

## Generatorfehler

Vier Kennungen haben einen leeren Namen (`hermes.tool..`, `hermes.plugin..`, `hermes.cli_module..`,
`hermes.gateway_platform..`), vermutlich aus Paket-`__init__.py`-Dateien.
