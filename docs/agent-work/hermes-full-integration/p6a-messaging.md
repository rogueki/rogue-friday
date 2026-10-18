# P6a Messenger: Implementierung und Prüfnachweis

Stand: 2026-10-18 23:08 UTC. Geprüft im lokalen Quellbaum auf `fc53c58afc3e2e1f96ab0ea392f70873acb8131e` mit noch nicht committeten P6a-Änderungen. Das ist kein Nachweis für eine installierte Friday-Instanz oder ein verbundenes Telefon/Bot-Konto.

## Native Pfade und Quellbindung

Die Implementierung ist an den tatsächlich gelesenen Hermes-Quellstand `~/.hermes/hermes-agent`, Version 0.22.2, Commit `d923a5eb48` gebunden. `installer/wsl/messaging_pairing.py` verweigert den Start, wenn das erwartete Short-Commit `d923a5eb` oder `scripts/whatsapp-bridge/bridge.js` fehlt. Die Kopplung startet dessen vorhandenes `--pair-only --pair-json`-Protokoll mit Hermeseigenem Node und einem festen Sessionpfad. Fehlende Bridge-Abhängigkeiten werden im Pairing-Worker per `npm ci --silent` vorbereitet. `whatsapp_logout.mjs` ruft für eine bestehende Baileys-Session `sock.logout()` auf. Ein Hermes-Upgrade benötigt erneute Protokoll- und Kompatibilitätsprüfung.

| Friday-API | Tatsächlicher Ablauf |
| --- | --- |
| `GET /api/v1/settings/whatsapp-pairing` | Liest den lokalen Pairing-Zustand einschließlich kurzlebigem QR und separatem Bridge-Verbindungszustand. |
| `POST /api/v1/settings/whatsapp-pairing` | Startet oder erneuert die Kopplung mit typisiertem Modus `bot` oder `self-chat`; ein neuer Versuch ersetzt den vorigen Worker. |
| `DELETE /api/v1/settings/whatsapp-pairing` | Bricht nur eine laufende QR-Kopplung ab; meldet das bestehende Konto nicht ab. |
| `POST /api/v1/settings/whatsapp-session/reconnect` | Verlangt eine aus Session-Credentials abgeleitete verknüpfte Identität und startet `hermes-gateway.service` neu. |
| `DELETE /api/v1/settings/whatsapp-session` | Stoppt das Gateway, fordert Remote-Logout über Baileys an und entfernt lokale Sessiondaten erst nach bestätigtem `loggedOut:true`; anschließend deaktiviert es den Adapter und startet das Gateway. Bei unbestätigtem Logout bleiben Credentials erhalten. |
| `GET/PUT /api/v1/settings/whatsapp-gateway` | Liest/schreibt Modus, Allowlist und Aktivierung über die bestehende Hermes-Konfiguration. `self-chat` wird nur mit der aus verknüpften Credentials abgeleiteten Telefonnummer in der Allowlist aktiviert. |
| `GET/PUT /api/v1/settings/telegram-gateway` | Liest/schreibt Bot-Token, erlaubte User-IDs und Aktivierung. Das Token geht über WSL-stdin, erscheint nicht in der Antwort. `getMe` prüft Bot-ID/Username und Authentifizierung; `getWebhookInfo` zeigt Polling/Webhook an. Bekannter Webhook-Konflikt oder ungültiges Token verhindert Aktivierung. |

`apps/web/src/features/settings/MessagingGatewaySetup.tsx` rendert den QR-Code nativ und bietet Start, Status-Polling, Erneuern, Abbrechen, Reconnect und Logout. `TelegramGatewaySetup.tsx` zeigt Bot-Identität, Authentifizierung, Empfangsmodus und Verbindungszustand. Ein gespeichertes Token oder eine vorhandene Session allein werden nicht als verbundener Kanal bezeichnet. Discord behält in P6a seine vorhandene Token-/Allowlist-Konfiguration; eine vollständige Discord-Domänenintegration ist offen.

## Sicherheits- und Statussemantik

Alle genannten Settings-Routen verlangen eine Owner-Session; mutierende Routen verlangen CSRF. Telegram-Updates verwenden zusätzlich eine Revisionsprüfung gegen parallele Änderungen. Der QR liegt nur im lokalen Zustand unter `~/.hermes/friday-whatsapp-pairing` (Verzeichnis `0700`, State/Lock `0600`) und in der Owner-Antwort mit `Cache-Control: no-store`; Audit-Einträge enthalten nur Zustand, niemals QR oder Token. Pairing-Versuche laufen nach 600 Sekunden ab, ein QR nach 60 Sekunden. Refresh und Cancel beenden nur den über PID, `/proc`-Startzeit, Kommandozeile, Pairing-ID und Prozessgruppe zugeordneten Worker. Fehlerausgaben der Bridge werden nicht als QR/API- oder Audit-Inhalt übernommen.

`connected` beim Pairing ist zunächst ein Bridge-Protokollereignis. Ohne aus `creds.json` ableitbare Identität wird der sichtbare Pairing-Zustand `unverified`. Der separate WhatsApp-`connectionState` stammt aus `127.0.0.1:3000/health` und gilt nur für den erwarteten Sessionpfad. Telegram- und allgemeine Gateway-Zustände lesen `gateway_state.json` nur mit frischem Zeitstempel (maximal 120 Sekunden), passendem `systemd`-MainPID, `/proc`-Startzeit, Hermes-Home und Writer-Identität. Fehlende, veraltete oder nicht zuordenbare Laufzeitbelege ergeben `unknown`, nicht `connected`. `applied`, `gatewayRunning`, `tokenConfigured` und `sessionPresent` sind getrennte Signale; keines beweist Empfang oder Zustellung. Ein realer Pairing-/Gateway-Lauf gegen WhatsApp oder Telegram wurde nicht ausgeführt.

## Ausgeführte Prüfungen

Alle Befehle aus `rogue-friday-clean`. Für Windows-`pnpm` wurde der fehlerhaft quotierte Prozess-`PATH` mit `$env:Path=$env:Path.Replace('"','')` bereinigt. Ohne Bereinigung scheiterten beide Vitest-Aufrufe bereits vor Teststart an `node` nicht gefunden; die anschließenden Läufe bestanden.

| Befehl | Ergebnis |
| --- | --- |
| `$repoWsl = (wsl -d Friday-Ubuntu --exec wslpath -u "$PWD").Trim(); wsl -d Friday-Ubuntu --cd "$repoWsl/installer/wsl" -- python3 -m unittest -q test_messaging_pairing.py test_messaging_runtime.py test_configure_telegram.py test_configure_messaging_gateway.py` | 12/12 bestanden. Fake-Baileys-Protokoll, QR-Ablauf/Refresh/Cancel, Fake-Remote-Logout und Fehlschlag, Telegram-Methoden/Webhook-Konflikt, Allowlist und konservativer Laufzeitstatus. Aus PowerShell im Repository-Root ausführen. |
| `pnpm --filter @friday/control-api test -- test/messaging-gateways.test.ts test/telegram-gateway.test.ts test/whatsapp-pairing.test.ts` | 3 Dateien, 7/7 Tests bestanden; Owner/CSRF, WSL-stdin und Geheimnis-/QR-Redaktion. |
| `pnpm --filter @friday/web test -- src/features/settings/MessagingGatewaySetup.test.tsx src/features/settings/TelegramGatewaySetup.test.tsx` | 2 Dateien, 4/4 Tests bestanden; Owner-UI, native WhatsApp-Kopplung, keine Token-Rückanzeige. |
| `pnpm --filter @friday/contracts check`; `pnpm --filter @friday/control-api typecheck`; `pnpm --filter @friday/web typecheck`; Changed-file ESLint; `git diff --check` | In der P6a-Implementierungsrunde bestanden; Contracts damals 233 Operationen. Danach fügte P4 eine unabhängige Mail-Operation hinzu (234); diese Checks wurden für diesen Dokumentationsschritt nicht erneut ausgeführt. |

Die Tests verwenden lokale Fake-Upstreams und prüfen den Bridge-/API-Pfad, keine externe Verbindung. Smartphone-QR-Scan, echtes Telegram-Bot-Konto, Gateway-Neustart auf einer installierten Friday-Instanz, echter Empfang, gezielter Versand und tatsächlicher Remote-Logout sind **NOT_RUN**. MSG-01/03 sind daher nur lokal teilweise belegt; MSG-02/04/05/06 und DOD-07 bleiben offen. Der Akzeptanzstatus in `acceptance-ledger.md` wird dadurch nicht auf PASS gesetzt.

## Nächste Paketgrenzen

1. **P6a Abschluss gegen kontrollierte Konten:** WhatsApp physisch koppeln, QR-Ablauf/Entzug/Neustart und Logout am echten Gerät prüfen; Telegram mit eigenem Bot/Owner-ID testen; beide Kanäle mit erlaubtem und abgewiesenem Sender empfangen, gezielt senden und tatsächliche Statusübergänge nachweisen. Keine Fremdnachrichten als Testdaten verwenden.
2. **Messenger-Domänenaktionen:** Kanal- und empfängergebundene Vorschau/Freigabe mit Inhalts-Hash, sichere Auflösung mehrdeutiger Empfänger, einmalige oder als `uncertain` markierte Zustellung mit dauerhaftem Idempotenzjournal und Reconciliation. Eine Settings-Konfiguration allein erfüllt MSG-02 oder MSG-06 nicht. Keine generische Shell-/URL-Dispatchroute.
3. **Identität und Memory:** Für jeden Kanal einen expliziten authentifizierten Sender-zu-Friday-Identitätslink, Gruppen-/Fremdsender-Ausschluss und eigene Gateway-Bridge-Autorisierung ergänzen. Erst danach `post_gateway_admission` mit stabiler Event-ID aus Plattform, Message-ID und Sender an P3 anbinden und kanalübergreifende Trennung prüfen. Der Hermes-CLI-Memory-Key darf nicht für Gateway-Ereignisse verwendet werden.
4. **P6b Connectorfamilien:** Aus der gepinnten Hermes-Inventarliste echte Gateway-Transporte von nur protokollinternen Einträgen trennen; für jeden tatsächlich angebotenen Connector eigene typisierte Voraussetzungen, Secrets, Allowlist, Status, Empfang/Senden und Tests bauen. Discord gehört dazu. Weder generische Konfigurationsfelder noch ein externer Dashboard-Link schließen die jeweilige Inventarzeile.
