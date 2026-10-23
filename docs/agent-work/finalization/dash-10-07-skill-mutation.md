# DASH-10.07 — Recovery: atomar oder wiederherstellbar, alter Zustand gemeldet

Stand: 2026-10-23. Umgesetzt als **wiederherstellbarer Schnappschuss** in der Bridge; die Variante „atomar" ist mit
der echten CLI nicht erreichbar, weil `hermes skills install|update|uninstall` mehrere Dateien schreibt und keinen
Transaktionsschalter kennt.

## 1. Auftrag

> **DASH-10.07** **Recovery:** Installation/Update ist atomar oder hat einen wiederherstellbaren Snapshot;
> fehlgeschlagene Aktivierung meldet den alten Zustand; Entfernen löscht keine gemeinsam genutzten Accounts.

## 2. Ablauf einer Mutation

`POST /api/v1/skills/{name}/mutations` → Bridge-Aktion `skill-mutate`:

1. **Prüfen, bevor etwas läuft.** Aktion ∈ {install, update, uninstall}; Name gegen `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`;
   Kennung nur beim Installieren (3…300 Zeichen, kein Whitespace); `force` muss ein Boolean sein. Verstöße enden als
   `invalid_request` → im Dienst `VALIDATION_FAILED`, **ohne** CLI-Aufruf.
2. **Zustand vorher lesen.** `skills list --source all` mit demselben strengen Parser wie das Inventar.
3. **Schnappschuss.** Das installierte Skill-Verzeichnis wird nach
   `~/.hermes/friday-snapshots/<UTC>-<aktion>-<name>[-n]/skill/<i>/` kopiert, die Fundorte stehen in `state.json`.
   Existiert nichts, entsteht kein Schnappschuss (Installation ins Leere).
4. **CLI ausführen** (180 s Limit), Ausgabe auf 4096 Zeichen gekürzt.
5. **Zustand nachher lesen.** Erwartet: Name vorhanden bei install/update, abwesend bei uninstall.
6. **Bei Abweichung oder Rückgabecode ≠ 0:** Schnappschuss zurückspielen; hat die CLI ein Verzeichnis halb angelegt,
   wird es entfernt. Antwort `skill_mutation_failed` mit `restored`, `previousPresent` und dem CLI-Text (gekürzt),
   im Dienst `ADAPTER_UNAVAILABLE` mit dem Satz „der alte Stand wurde wiederhergestellt".
7. **Bei Erfolg:** `action`, `name`, `installed`, `enabled`, `snapshot`, `text`, `bytes`; das Audit hängt
   `skills.<aktion>ed` samt Snapshot und `force` an.

Damit ist „fehlgeschlagene Aktivierung meldet den alten Zustand" doppelt abgedeckt: die Antwort nennt
`previousPresent`/`restored`, und `enabled`/`installed` werden **nach** der Mutation erneut gelesen, nicht behauptet.

## 3. Nachweise

| Nachweis | Ergebnis |
|---|---|
| `installer/wsl/tests/test_skill_mutate.py` (neu) | 15 Prüfungen mit echtem Unterprozess als CLI: Erfolg mit Snapshot-Inhalt, Fehler stellt die Datei byte-gleich wieder her, Install ohne Snapshot, fehlgeschlagener Install hinterlässt kein Verzeichnis, Uninstall verifiziert die Abwesenheit, fünf abgelehnte Anfragen ohne CLI-Aufruf |
| `apps/control-api/test/skills-mutation-route.test.ts` (neu) | 4 Tests: 200 für install/update/uninstall inkl. Snapshot, 422 für unbekannte/fehlende Aktion, 400 für überlangen Namen, Kennung nur beim Installieren, nie eine unbestätigte Mutation gemeldet |
| Vertrag | `SkillMutationRequest`, `SkillMutation`, `SkillMutationResponse`; 280 Operationen, Wächter in `contract.test.ts`, `openapi-additions.test.ts`, `mock-data/test/api.test.ts` |
| Gates | volle node-Suite 200 Dateien / 2829 Tests grün (60 übersprungen), `contracts:check`, `typecheck`, `lint`, `build` = 0 |

## 4. Was der Auftrag zusätzlich verlangt und wie es beantwortet ist

- **„Entfernen löscht keine gemeinsam genutzten Accounts."** Die Bridge entfernt ausschließlich das Skill-Verzeichnis
  (`shutil.rmtree` auf den gefundenen Skill-Pfad) — keine Credentials, keine Konfiguration, keine Accounts. Hermes
  selbst legt bei `skills install` keine Accounts an; geteilte Zugänge liegen in `~/.hermes/.env`/`config.toml` und
  werden von dieser Aktion nicht angefasst. Ein Beleg am echten Profil steht noch aus (siehe Abschnitt 5).
- **„Nicht still überschrieben."** `force` ist der einzige Weg, lokale Änderungen zu überschreiben; ohne `force`
  überspringt die CLI sie (belegt in `dash-10-06-acceptance.md`, Abschnitt 3).

## 5. Live-Beleg im wegwerfbaren Profil (2026-10-23)

Wegwerfprofil in WSL (`hermes profile create friday-mut2`, danach geloescht und `purge-identity` ausgefuehrt), echte
CLI v0.22.2, Aufruf ueber die Bridge mit `home=~/.hermes/profiles/friday-mut2` und `cli=~/.local/bin/friday-mut2`:

| Schritt | Ergebnis |
|---|---|
| Install `skills-sh/anthropics/skills/skill-creator` | rc 0, `installed: true`, `snapshot: null` (vorher nichts da); Text enthaelt Quarantaene und Sicherheitsscan (Verdict CAUTION, HIGH exfiltration in `scripts/improve_description.py:33`) |
| Update ohne `force` | rc 0, `No updates available.`, die lokale Zeile bleibt stehen |
| Update mit `force` | rc 0, `No updates available.` — es gab keine Upstream-Aenderung zu ueberschreiben (der Skip-Fall mit echter Aenderung ist in `dash-10-06-acceptance.md` belegt) |
| Uninstall | rc 0, `installed: false`, Verzeichnis weg, Schnappschuss `…-uninstall-skill-creator` mit vollstaendigem `skill/0`-Payload |
| Zugaenge | SHA-256 von `.env` vor und nach allen Schritten identisch (`7abdeac1cde97548…`), `config.toml` gibt es im Profil nicht — **Entfernen fasst geteilte Zugaenge nicht an** |
| Bilanz | 53 Skills vorher, 53 nachher; acht Schnappschuesse, jeder mit Payload |

## 6. Zwei echte Fehler, die erst dieser Lauf gezeigt hat

1. **Inventar-Tabelle war versionsspezifisch geparst.** v0.22.2 zeichnet den Kopf mit schweren Rahmen (`┃`) und
   nennt in `Source`/`Trust` Registrierungsnamen und Vertrauensstufen (`skills.sh`, `trusted`), nicht die feste Menge
   `builtin|local|hub`. Der strenge Parser lehnte deshalb ab — sobald ein Hub-Skill installiert war, wurde das
   **gesamte** Inventar unlesbar. Der Parser akzeptiert jetzt beide Rahmenarten und prueft `Source`/`Trust` gegen ein
   begrenztes Token (`^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$`); der Vertrag (`skill.schema.json`) wurde von `enum` auf
   dasselbe Muster gewidmet, damit die Antwort nicht an der Validierung scheitert. Die Oberflaeche zeigt unbekannte
   Tokens im Klartext statt „Unbekannt". Ledger **N-057**.
2. **Bestaetigungsflags unterscheiden sich pro Aktion.** `install` und `uninstall` brauchen `--yes`; `update` kennt
   das Flag nicht und endet damit als Fehler (real beobachtet: rc 6, Wiederherstellung des Schnappschusses). Die
   Bridge setzt es jetzt nur fuer `install` und `uninstall`. Ledger **N-058**.

## 7. Offen (bewusst nicht behauptet)

- **Toggle-Rollback** (Aktivierung schlaegt fehl, Deaktivierung greift) ist nicht Teil dieses Schnitts.
- **Update mit echter Upstream-Aenderung** im Live-Profil wurde nicht erzeugt; belegt ist der Skip-Fall aus einem
  frueheren Lauf und das Verhalten „keine Aenderung" aus diesem.
