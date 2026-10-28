# INS-03 — Anbieterfähigkeiten aus dem installierten Hermes (Teilnachweis)

Stand: 2026-10-22, Hermes **0.22.2** (`d923a5eb487a17c0a68801bba9ef0f56c81040a8`), gelesen direkt aus der laufenden
Installation und über den neuen Bridge-Aufruf `provider-auth` belegt.

## 1. Was die installierte Version tatsächlich anbietet

- **52 Anbieter im Picker** (`listed_canonical_providers()`), u. a. `openai-api`, `anthropic`, `kimi-coding`,
  `custom`, daneben OAuth-Anbieter wie `openai-codex`, `xai-oauth`, `qwen-oauth`, `minimax-oauth`.
- **Autharten** aus `hermes_cli/providers.py`: `api_key`, `oauth_device_code`, `oauth_external`,
  `external_process`, `aws_sdk`, `vertex`, `virtual`.
- **Key-Präfixe** aus `hermes_cli/auth.py`: `KNOWN_PROVIDER_KEY_PREFIXES = {"openrouter": ("sk-or-",)}` — sonst
  nichts. Für `kimi-coding` existiert **kein** Präfix; `sk-kimi-` wird dort nur als Basis-URL-Hinweis benutzt
  (`doctor_connectivity.py:235`, `model_setup_flows.py:626`), nicht zur Anbietererkennung.
- **Alias-Falle**: `normalize_provider("openai")` ergibt in dieser Version `openrouter`, `normalize_provider(
  "kimi-coding")` ergibt `kimi-for-coding`. Wer Anbieternamen über den Runtime-Resolver auflöst, konfiguriert
  also still den falschen Anbieter. Der Picker-Name bleibt maßgeblich.

## 2. Änderungen

1. **Neue Sonde** `installer/wsl/hermes_provider_auth.py`: liefert für angefragte Picker-IDs `offered`, `authType`,
   `apiKeyEnvVars`, `baseUrlEnvVar` und `runtimeAlias` sowie die Key-Präfix-Tabelle der installierten Version.
   Strenge Eingabeprüfung (1–8 Namen, `[A-Za-z0-9_.-]{1,64}`), Fehler als `invalid_request`, `unknown_provider`,
   `capability_unavailable`; 7 Unit-Tests grün, inklusive Nachweis, dass `openai` nicht still akzeptiert wird.
2. **Bridge-Aufruf** `provider-auth` in `hermes_config_bridge.py` (nur lesend, 25 s Limit, Pinned-Source-Prüfung);
   die bestehende Bridge-Suite bleibt mit 43 Tests grün.
3. **`setup_hermes.sh` prüft statt zu raten**: Anbieter muss im installierten Katalog stehen, kein OAuth-Anbieter
   sein (im Installer nicht anmeldbar → klarer Abbruch), und die Env-Variable kommt aus der Sonde. `openai` wird
   abgelehnt, `openai-api`/`anthropic`/`kimi-coding`/`custom` werden aufgelöst; für `kimi-coding` und `custom`
   meldet die Version keine Env-Variable, dort bleibt eine dokumentierte Fallback-Variable (`KIMI_API_KEY` bzw.
   `OPENAI_API_KEY`) und der Verbindungstest entscheidet.
4. **`install-friday.ps1` schreibt den Katalognamen**: `openai-api` statt `openai` (Bestandswerte `openai` werden
   beim Lauf kanonisiert). Der `sk-kimi-`-Reroute bleibt als ausdrücklich benannte Installer-Heuristik bestehen und
   wird jetzt vom Katalogcheck abgesichert statt still zu greifen.

## 3. Beleg (Live-Lauf gegen die Installation)

`openai-api → id=openai-api keyVar=OPENAI_API_KEY`, `anthropic → id=anthropic keyVar=ANTHROPIC_API_KEY`,
`kimi-coding → id=kimi-coding keyVar=KIMI_API_KEY(Fallback) baseEnv=KIMI_BASE_URL`,
`custom → id=custom keyVar=OPENAI_API_KEY(Fallback)`, `openai → FAIL`, `moonshot-legacy → FAIL`.

## 4. Noch offen (INS-03 bleibt offen)

- Echte Anmeldung je Anbieter (OpenAI/Anthropic/Kimi/Custom) mit realem Key und Modellaufruf; heute ist nur
  Kimi-K3 real belegt, und dessen Credential meldet 403 (N-008).
- OAuth-Erfolg, -Ablehnung und -Timeout im Installer (OAuth-Anbieter sind derzeit bewusst gesperrt, nicht geführt).
- `kimi-coding`/`custom` ohne Env-Variable: der Key gehört in den Credential-Pool (`hermes auth add … --type
  api-key`), der Installer schreibt weiterhin `.env` und verlässt sich auf den Verbindungstest.

## 5. OAuth-Messung: warum sie isoliert (noch) nicht belegbar ist

Versuch am 2026-10-22, `hermes auth add openai-codex --type oauth --no-browser --timeout 5` in einem eigenen
`HERMES_HOME` (`mktemp -d`) auszufuehren: die CLI bootstrapet fuer ein fremdes Datenverzeichnis zuerst die
komplette Python-Laufzeit ("Preparing the isolated Hermes runtime … Installing Python dependencies") und laeuft
dann in den 40-s-Abbruch — kein verwertbarer OAuth-Abbruchbeleg.

Wichtig fuer die Sicherheit: die **Live-Konfiguration blieb unveraendert**, `sha256` von `~/.hermes/auth.json` war
vor und nach dem Versuch identisch (`3470107d…597b`). Der Installer selbst fuehrt keinen OAuth-Flow aus; OAuth
gehoert damit zu DASH-07.04 (Command Center) bzw. zu einem spaeteren INS-03-Schritt mit vorbereitetem Profil.
