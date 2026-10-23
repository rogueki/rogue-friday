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

## 5. Offen (bewusst nicht behauptet)

- **Kein echter CLI-Lauf gegen ein wegwerfbares Profil in dieser Runde.** Der Versuch, `HERMES_HOME` als Isolation zu
  nutzen, brach an der Shell-Quotierung ab und wurde verworfen; die Bridge- und API-Beweise oben nutzen einen echten
  Unterprozess, aber nicht die echte Hermes-CLI. Der Lauf ist der nächste Schritt.
- **`enabled` nach einer Mutation** wird aus der Liste gelesen; ein Toggle-Rollback (Aktivierung schlägt fehl,
  Deaktivierung greift) ist nicht Teil dieses Schnitts.

Ergebnis: **TEIL** — der wiederherstellbare Schnappschuss ist implementiert, getestet und über die API erreichbar;
der echte CLI-Lauf und der Nachweis „keine geteilten Accounts angetastet" fehlen noch.