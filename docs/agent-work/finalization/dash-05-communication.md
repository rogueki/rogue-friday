# DASH-05 - E-Mail-Postfach als integrierter Kanal

Stand: 2026-10-22. Grundlage: `FRIDAY_FINALER_UMSETZUNGSPLAN.md`, Abschnitt 8.1, Zeilen DASH-05.01 bis 05.06.

## 1. Ausgangslage (Ist-Stand vor dieser Runde)

- `features/communication/CommunicationPage.tsx` rendete `<HimalayaMailbox />` und `<MessengerCompose />`
  als zwei globale Bloecke **oberhalb** von Kanalleiste und Threadliste. Damit existierten genau die
  "oberen Doppelbloecke", die DASH-Kontext 2 und DASH-05.02 ausschliessen.
- Die Kanalleiste zeigte alle vom Backend gelieferten Kanaele. Der Mock-Seed
  (`packages/mock-data/src/seed/communication.ts`) enthielt fuenf Kanaele inklusive **SMS** und ohne
  Discord; der E-Mail-Kanal hiess "GMX Postfach".
- `ChannelKind` im Vertrag kannte kein `discord` (`email | telegram | whatsapp | sms | phone | other`).
  Eine sechste Navigationszeile "Discord" war damit nicht typisiert darstellbar.
- `HimalayaAccountSetup.tsx` ist ein flaches Sammelformular (Adresse, Anzeigename, IMAP/SMTP, Ordner,
  Speichern) mit anschliessenden getrennten Verifizierungen - **kein** gefuehrter Wizard.

## 2. Umsetzung DASH-05.02 (Kanalnavigation und Integration)

- Neue reine Auswahllogik `features/communication/channelList.ts`:
  - `VISIBLE_CHANNEL_KINDS = ["email", "telegram", "whatsapp", "phone", "discord"]` in fester Reihenfolge,
  - `partitionChannels()` liefert `visible` (sortiert nach Art, dann Ungelesen, dann Name) und `hidden`
    (SMS, `other`) - versteckt, nicht geloescht,
  - `channelGroup()` ordnet einen Kanal dem Einrichtungsfluss zu (`email`, `messenger`, `phone`, `none`).
- `ChannelRail.tsx` rendert ausschliesslich `visible`; bei unterdrueckten Kanaelen erscheint der Hinweis
  "Weitere Kanaele wie SMS sind unter Einstellungen -> Erweitert konfigurierbar und erscheinen hier nicht."
- `CommunicationPage.tsx` zeigt
  - `<HimalayaMailbox />` nur, wenn der gewaehlte Kanal `email` ist,
  - `<MessengerCompose />` nur bei `telegram | whatsapp | discord`,
  - ohne Kanalauswahl keine der beiden Sektionen,
  - `ComposeDialog` bekommt nur die sichtbaren Kanaele als Auswahl.
- Labels: `HimalayaMailbox` heisst jetzt "E-Mail Postfach" (statt "Mail Postfach (IMAP/SMTP)"),
  `MessengerCompose` "Nachricht ueber den gewaehlten Kanal" (statt "Messenger-Nachricht"); beide
  erscheinen nur noch innerhalb der Kanalauswahl.
- Mock-Seed: E-Mail-Kanal heisst "E-Mail Postfach"; neuer Discord-Kanal (`status: not_configured`,
  keine Faehigkeiten) ergaenzt; SMS bleibt als Datenbestand erhalten.
- `CHANNEL_KINDS` in `labels.ts`, `CHANNEL_ICON` in `memory/kit/channelStatus.tsx` und die i18n-Dateien
  (`b.de.ts`/`b.en.ts`) kennen `discord`; neuer i18n-Schluessel `communication.channels.hiddenHint`.

### Vertragsaenderung

`packages/contracts/schemas/communication/channel-kind.schema.json` Enum additiv um `discord` erweitert
(keine Werte entfernt oder umbenannt), danach `pnpm contracts:generate`. `pnpm --filter @friday/contracts check`
meldet lint / validate / check-generated / breaking alle gruen.

## 3. Nachweise (alle in dieser Runde real ausgefuehrt)

| Pruefung | Ergebnis |
| --- | --- |
| `vitest --project web communication` | 4 Dateien, 29 Tests gruen (`channelList.test.ts` neu, `communication.test.tsx` um 2 Tests erweitert) |
| `vitest --project web --maxWorkers=2` | 81 Dateien, 648 Tests gruen |
| `vitest --project node --maxWorkers=2` | 191 Dateien, 2789 Tests gruen, 60 skipped |
| `tsc -p apps/web`, `tsc -p apps/control-api` | je exit 0 |
| `pnpm contracts:check` | lint/validate/check-generated/breaking gruen |
| `pnpm build:app` | exit 0 |
| `playwright test tests/e2e/communication.spec.ts` | 2 Tests gruen in 23.7 s |

Neue Tests im Detail:

- `apps/web/src/features/communication/channelList.test.ts` (4): feste Reihenfolge, Ausblenden von SMS
  und `other`, Sortierung innerhalb einer Art, Gruppierung in Einrichtungsfluesse.
- `apps/web/src/features/communication/communication.test.tsx` (+2): genau sechs Eintraege in der
  Reihenfolge "Alle Kanaele, E-Mail Postfach, Telegram, WhatsApp, Telefon, Discord", kein SMS-Eintrag,
  Hinweis auf versteckte Kanaele; Postfach nur im E-Mail-Kanal, Messenger-Schritt nur im Messenger-Kanal.
- `tests/e2e/communication.spec.ts` (2, Browser): dieselbe Liste im echten Stack inklusive
  `aria`-Struktur, keine oberen Formulare vor der Auswahl, Postfach/Messenger an der richtigen Stelle,
  kein horizontaler Overflow bei 390 / 1024 / 1920 px.

## 4. Offene Punkte (bewusst nicht abgehakt)

- **DASH-05.03** Wizard-Reihenfolge (Adresse -> Absendername -> erkannte, bearbeitbare Servervorschlaege ->
  Authentifizierung -> getrennte Tests -> Ordner/Standard -> Zusammenfassung/Uebernehmen) fehlt; heute
  existiert nur das flache Formular. Ebenso fehlen die "erkannten" Vorschlaege, die eine Ableitung aus
  der Domaene ohne Raten belegen muessten.
- **DASH-05.04** Mehrere Konten mit eigenen Namen, Alias-/Antwortkonto, UIDVALIDITY-gebundene Ordner,
  Anhaenge/UTF-8 sowie das Versandjournal sind im Backend teilweise vorhanden
  (`mail-accounts`, `HimalayaMailbox`, `MailCompose`), aber nicht als Ganzes gegen die Anforderung
  geprueft. "Lesen markiert nicht als gelesen" ist im UI-Text zugesagt (`HimalayaMailbox`), der
  Nachweis ueber den Adapter steht aus.
- **DASH-05.05** Zwei echte kontrollierte Testpostfaecher benoetigen echte Zugangsdaten und sind in
  dieser Umgebung nicht ausfuehrbar; Fehlerbilder (falsches Passwort, TLS, Tokenablauf) sind bisher nur
  als Textpfade, nicht gegen echte Server belegt. Der UI-Neustart-Teil (Konten und Quelle bleiben) ist
  durch die bestehenden account-basierten Queries abgedeckt, aber nicht neu als Browsertest gefahren.
- **DASH-05.06** Wizardabbruch/Recovery und der Sendetimeout-Status "unbekannt" haengen am noch nicht
  gebauten Wizard bzw. am Nachweis gegen einen echten SMTP-Server.

## 5. Fallstricke fuer spaetere Sessions

- Die Kanalleiste filtert in der Komponente **und** die Seite uebergibt bereits die sichtbaren Kanaele;
  `hiddenCount` muss deshalb explizit von der Seite kommen, sonst ist der Hinweis unsichtbar.
- Der Hinweis auf versteckte Kanaele steht **hinter** der `<ul>`; `within(rail)` findet ihn nicht,
  `screen.getByText` schon.
- `HimalayaMailbox` und `MessengerCompose` rendern nur fuer `role === "owner"`. Tests, die deren Inhalt
  sehen wollen, brauchen eine Session-Route im Fixture (`GET /api/v1/auth/session`).
- `getAllByRole("button")` in der Kanalleiste zaehlt die "Adapter konfigurieren"-Knoepfe mit; fuer die
  sechs Navigationseintraege `button.com-channel` selektieren.