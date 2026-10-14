# Skills

Platz für separate F.R.I.D.A.Y.-Skills (eigenständige Fähigkeiten, die später über Adapter an die Control API
angebunden werden).

Konvention für neue Skills:

- Ein Ordner pro Skill: `skills/<skill-name>/` mit eigener `README.md` (Zweck, Eingaben, Ausgaben, benötigte
  Berechtigungen und Freigabestufe nach PLAN §32).
- Ein Skill spricht nie direkt mit dem Dashboard-Frontend, sondern wird über einen Adapter bzw. die Control API
  eingebunden (Contract-First, siehe `docs/CONTRACT_FIRST.md` und `docs/ADAPTER_SDK.md`).
- Keine Secrets im Repository; Zugangsdaten nur über Umgebungsvariablen oder den Windows Credential Manager.
