# Adapter-Vorlage

Kopieren nach `adapters/<name>/`, danach (siehe `docs/ADAPTER_SDK.md`, Abschnitt "Neue Anbindung erstellen"):

1. `package.json`: `name` auf `@jarvis/adapter-<name>` setzen, `pnpm install` ausführen.
2. `src/index.ts`: Manifest (`id`, `name`, `category`) anpassen.
3. Config-Schema definieren (Secrets als `writeOnly` und in `manifest.secretFields` eintragen).
4. `healthCheck()` auf einen billigen Endpunkt des Fremdsystems richten.
5. Nur tatsächlich implementierte Capabilities deklarieren.
6. Mapper (`defineMapper`) und Port-Methoden schreiben; Fremdfelder bleiben im Adapter.
7. Events mappen (`defineEventMapper`, siehe `adapters/example-http`).
8. `test/conformance.test.ts` auf das Fremdsystem (Fake-Upstream) anpassen und `pnpm test:conformance` ausführen.
9. Provider-ID in der Allowlist und in `config/adapters.yaml` eintragen.
10. Mock-Adapter der Kategorie in `config/adapters.yaml` deaktivieren (`provider` wechseln).

Die Vorlage selbst wird vom Workspace nicht gebaut oder getestet (`packages/adapter-core/template` liegt außerhalb von `pnpm-workspace.yaml`).
Zum Prüfen die Vorlage nach `adapters/` kopieren und `pnpm install && pnpm test:conformance` ausführen (siehe `docs/ADAPTER_SDK.md`, Schritt 1).
