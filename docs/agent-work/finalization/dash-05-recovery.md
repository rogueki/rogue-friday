# DASH-05.05 / DASH-05.06 - Fehlererklaerung, Neustart, Abbruch und Timeout

Stand: 2026-10-22. Nachweisbasis: aktueller Arbeitsbaum auf `feat/friday-finalization-20261021`.

## 1 DASH-05.06 - Recovery

### 1.1 Wizardabbruch hinterlaesst keine teilaktivierte Verbindung

- Neu: der Wizard hat einen sichtbaren Knopf **"Einrichtung verwerfen"**. Er setzt den Entwurf auf den
  Ausgangszustand zurueck (Adresse, Server, Anmeldung, Testergebnisse, Standardkonto) und meldet
  "Einrichtung verworfen. Es wurde nichts gespeichert."
- Konstruktiv wird vor dem letzten Schritt nichts geschrieben; der Abbruch ist damit immer folgenlos. Neuer Test:
  `MailAccountWizard.test.tsx` fuellt Adresse, Namen, Server und Passwort, fuehrt eine IMAP-Pruefung aus und
  verwirft dann. Geprueft wird: Schritt 1 ist wieder aktiv, das Adressfeld ist leer, es gab **keinen**
  `POST /integrations/mail/accounts`, **keinen** Standardkonto-Aufruf und keinen `onCreated`-Ruf.
- Der Testschritt selbst speichert nie; ein fehlgeschlagener Test laesst den Schritt geschlossen (bereits in
  DASH-05.03 belegt).

### 1.2 Sendetimeout ergibt "unbekannt" statt Wiederholung

- Der gestufte Schreibpfad (`stagedWrite.tsx`) meldet Fehler jetzt ueber den optionalen Haken `onFailed` an den
  Aufrufer, sowohl vor als auch nach der Bestaetigung.
- `MailCompose` nutzt das: Ein bestaetigter Versand, der im Transport scheitert (Timeout, Netzabbruch), setzt
  "Antwort unbekannt. Bitte beim Anbieter pruefen, bevor du erneut sendest.", markiert den Versand als
  `uncertain` und invalidiert die Versandbelege, damit das Journal neu geladen wird. Ein Fehler mit
  4xx-Antwort (z. B. Validierung) wird stattdessen mit der Servermeldung erklaert.
- Neuer Test: Die Bestaetigung wird ausgefuehrt, der zweite Aufruf wirft einen Netzwerkfehler. Geprueft wird:
  der unbekannte Text erscheint, der Dialog schliesst, und es bleibt bei genau zwei Send-Aufrufen (Vorschau +
  ein Ausfuehrungsversuch). Kein automatischer dritter Versuch.
- Der Versandbeleg bleibt getrennt pruefbar (Journal: "Gesendet-Ordner pruefen" ruft nur `review`).

### 1.3 Bestehende Nachrichten und Entwuerfe werden nie geloescht

- Der Brueckentest prueft den Quelltext und das Verhalten: kein `EXPUNGE`, kein `\Deleted`, genau ein
  `store`-Aufruf und der setzt ausschliesslich `\Flagged`; Entwuerfe entstehen nur per `append`.
- Eine Nachricht-Aktion `delete-message` wird als `invalid_action` abgelehnt. Die einzige `delete`-Aktion der
  Bruecke entfernt ein **Konto** samt Secrets aus dem Manifest und beruehrt keine Mailbox.

## 2 DASH-05.05 - Teilstand

Abgenommen sind:

- Genau sechs Kanal-Labels, kein SMS-Filter, keine Formulare oberhalb der Kanaele (DASH-05.01/05.02, dort
  belegt; Browserlauf unveraendert 2/2).
- Falsches Passwort und TLS-Fehler werden im Wizard erklaert (`reasonText`, getestet in
  `MailAccountWizard.test.tsx`: auth, tls, protocol, network sowie der ehrliche 503-Fall).
- Tokenablauf und fehlende OAuth-Berechtigung werden erklaert: `mail-account-errors.test.ts` belegt
  "OAuth-Token konnte nicht erneuert werden. Konto erneut verbinden." und "OAuth-Berechtigung fuer IMAP und SMTP
  fehlt." fuer beide Fehlerpfade (Ausnahme und `{error}`-Antwort). Dabei ergaenzt: der `{error}`-Zweig kannte
  die OAuth-Faelle vorher nicht und meldete faelschlich "nicht erreichbar".
- UI-Neustart: neuer Test rendert das Postfach, waehlt Konto und Ordner, haengt die Komponente ab und rendert
  neu. Konten und Ordner kommen erneut von der API (mindestens zwei Listenaufrufe), die Nachricht erscheint
  wieder. Es haengt nichts an Komponentenzustand.

**Offen und nicht in dieser Umgebung loesbar:** zwei echte kontrollierte Testpostfaecher getrennt lesen, suchen
und beantworten. Dafuer fehlen Zugangsdaten und erreichbare IMAP-/SMTP-Server; ein Mock wuerde die Zusage nicht
belegen. Der Punkt bleibt deshalb TEIL, bis echte Testkonten bereitstehen. Alles davor Genannte ist unabhaengig
davon belegt.

## 3 Nachweise (2026-10-22, aktueller Baum)

| Pruefung | Ergebnis |
| --- | --- |
| `py -3.11 installer/wsl/tests/test_mail_accounts_bridge.py` | 25 Zusicherungen inklusive kein Loeschpfad, nur `\Flagged`, Entwuerfe nur per `append`, `delete-message` -> `invalid_action` |
| `vitest --project web MailAccountWizard` | 7 Tests inklusive Abbruch ohne Speichern |
| `vitest --project web MailCompose` | 8 Tests inklusive Timeout nach Bestaetigung ohne Wiederholung |
| `vitest --project web HimalayaMailbox` | 4 Tests inklusive Neustart mit erneuter Konten-/Ordnerabfrage |
| `vitest --project node mail-account-errors` | 5 Tests inklusive OAuth-Ablauf und fehlender Berechtigung |
| `vitest --project web --maxWorkers=2` | 84 Dateien / 669 Tests gruen |
| `vitest --project node --maxWorkers=2` | 2801 Tests gruen, 60 skipped, Exitcode 0 |
| `pnpm lint` / `pnpm typecheck` / `pnpm build:app` | 0 Fehler / 0 / 0 |
| `playwright test tests/e2e/mail-wizard.spec.ts` | 2/2 in 24,4 s |

## 4 Offene Punkte

- DASH-05.05: zwei echte Testpostfaecher (siehe oben). Sobald Zugangsdaten vorliegen: getrennt lesen, suchen,
  antworten, falsches Passwort und TLS am echten Server, danach Neustart der UI.
- Die Timeout-Meldung ist bewusst nicht "fehlgeschlagen": der Aufruf kann den Anbieter erreicht haben. Ein
  Abgleich erfolgt ausschliesslich ueber das Versandjournal, nie durch erneutes Senden.
- Der Abbruchknopf verwirft den Entwurf sofort und ohne Rueckfrage. Das ist beabsichtigt (nichts ist
  gespeichert); bei bereits gespeicherten Konten bleibt das Bearbeitungsformular unveraendert.

## 5 Fallstricke

- `onFailed` wird auch fuer Fehler **vor** der Vorschau gerufen. Deshalb unterscheidet `MailCompose` nach
  Statusklasse: 4xx = erklaerte Ablehnung, alles andere = "unbekannt".
- Ein Spion auf eine Service-Methode umgeht deren Fehlerabbildung; OAuth-Abbildungen deshalb mit injizierter
  Bruecke testen.
- Der Brueckentest prueft den Quelltext auf `EXPUNGE`/`\Deleted`. Die Zeichenfolge muss korrekt escaped werden,
  sonst sucht der Test nach dem falschen Literal.
- In jsdom loest `link.click()` eine Navigation aus; im Test wird `HTMLAnchorElement.prototype.click` gestubbt.