"""Static, read-only P0 inventory for the pinned Hermes and Friday source trees."""

from __future__ import annotations

import ast
import argparse
import csv
import json
import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
HERMES: Path
HERMES_REV = "d923a5eb487a17c0a68801bba9ef0f56c81040a8"
FRIDAY_REV = "841f0771f52c81b78ea57fd4012161c11c4efbf3"


def configured_hermes_root() -> Path:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes-root", default=os.environ.get("FRIDAY_HERMES_ROOT"),
                        help="path to the pinned Hermes source tree (or set FRIDAY_HERMES_ROOT)")
    value = parser.parse_args().hermes_root
    if not value:
        parser.error("provide --hermes-root or FRIDAY_HERMES_ROOT; no machine-specific default is used")
    root = Path(value).expanduser().resolve()
    if not root.is_dir():
        parser.error(f"Hermes source root does not exist or is not a directory: {root}")
    return root


HERMES = configured_hermes_root()


def source(path: Path, line: int | None = None) -> str:
    prefix = "hermes:" if path.is_relative_to(HERMES) else "friday:"
    rel = path.relative_to(HERMES if prefix == "hermes:" else ROOT).as_posix()
    return f"{prefix}{rel}" + (f":{line}" if line else "")


def plain(node: ast.AST) -> object:
    try:
        return ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError, MemoryError):
        return {"expression": ast.unparse(node)[:240]}


def dict_items(node: ast.AST, prefix: str = ""):
    if isinstance(node, ast.Dict):
        for key_node, value_node in zip(node.keys, node.values):
            key = plain(key_node) if key_node else "**spread"
            key = str(key)
            current = f"{prefix}.{key}" if prefix else key
            if isinstance(value_node, ast.Dict):
                yield from dict_items(value_node, current)
            else:
                yield current, value_node


def schema_fields(path: Path, prefix: str = "", seen: frozenset[Path] = frozenset()):
    if path in seen or not path.exists():
        return
    obj = json.loads(path.read_text(encoding="utf-8"))
    yield from schema_node(obj, path, prefix, seen | {path})


def schema_node(definition: dict, path: Path, prefix: str, seen: frozenset[Path]):
    if "$ref" in definition:
        yield from schema_fields((path.parent / definition["$ref"]).resolve(), prefix, seen)
    elif "oneOf" in definition or "anyOf" in definition:
        yield prefix, definition, path
        for variant in definition.get("oneOf", definition.get("anyOf", [])):
            if "properties" in variant:
                yield from schema_node(variant, path, prefix, seen)
    elif "properties" in definition:
        for key, child in definition["properties"].items():
            name = f"{prefix}.{key}" if prefix else key
            yield from schema_node(child, path, name, seen)
    elif definition.get("type") == "array" and isinstance(definition.get("items"), dict):
        yield from schema_node(definition["items"], path, prefix + "[]", seen)
    else:
        yield prefix, definition, path


def schema_type(definition: dict) -> str:
    value = definition.get("type")
    if isinstance(value, list):
        return "|".join(value)
    if isinstance(value, str):
        return value
    for union in ("oneOf", "anyOf"):
        if union in definition:
            return "|".join(dict.fromkeys(schema_type(item) for item in definition[union]))
    return "UNKNOWN"


inventory: list[dict] = []
config = HERMES / "hermes_cli/config_defaults.py"
tree = ast.parse(config.read_text(encoding="utf-8"))
for statement in tree.body:
    if not isinstance(statement, ast.Assign):
        continue
    if not any(isinstance(target, ast.Name) and target.id in {"DEFAULT_CONFIG", "OPTIONAL_ENV_VARS"} for target in statement.targets):
        continue
    group = statement.targets[0].id
    for name, value in dict_items(statement.value):
        default = plain(value)
        secret = bool(re.search(r"(secret|token|password|api_key|credential)", name, re.I))
        if secret and isinstance(default, str) and default:
            default = "REDACTED_NONEMPTY_DEFAULT"
        inventory.append({
            "id": f"hermes.config.{name}" if group == "DEFAULT_CONFIG" else f"hermes.env.{name}",
            "kind": "config" if group == "DEFAULT_CONFIG" else "optional_env",
            "source": source(config, value.lineno), "source_revision": HERMES_REV,
            "default": default, "secret": secret,
            "granularity": "leaf_option" if isinstance(value, ast.Dict) else "scalar_or_collection_default",
            "range": "UNKNOWN_VALIDATION", "dependencies": [], "platform": "UNKNOWN",
            "friday_ui": "UNMAPPED", "read_interface": "UNMAPPED", "write_interface": "UNMAPPED",
            "runtime_consumer": "UNMAPPED", "apply_behavior": "UNKNOWN", "voice_action": "UNMAPPED",
            "permission": "UNKNOWN", "test_id": "NOT_ASSIGNED", "status": "UNMAPPED",
        })

for kind, directory, pattern in [
    ("bundled_skill", HERMES / "skills", "SKILL.md"),
    ("optional_skill", HERMES / "optional-skills", "SKILL.md"),
    ("plugin", HERMES / "plugins", "__init__.py"),
    ("plugin_manifest", HERMES / "plugins", "plugin.yaml"),
    ("plugin_manifest", HERMES / "plugins", "manifest.json"),
    ("plugin_catalog", HERMES / "plugin-catalog", "*.yaml"),
    ("plugin_schema", HERMES / "plugins", "*schema*.py"),
    ("gateway_platform", HERMES / "gateway/platforms", "*.py"),
    ("tool", HERMES / "tools", "*.py"),
    ("cli_module", HERMES / "hermes_cli/subcommands", "*.py"),
]:
    if not directory.exists():
        continue
    for path in sorted(directory.rglob(pattern)):
        if "__pycache__" in path.parts or path.name.startswith("test_"):
            continue
        rel = path.relative_to(directory).with_suffix("").as_posix()
        if path.name == "SKILL.md" or path.name == "__init__.py":
            rel = path.parent.relative_to(directory).as_posix()
        inventory.append({
            "id": f"hermes.{kind}.{rel.replace('/', '.')}", "kind": kind,
            "source": source(path, 1), "source_revision": HERMES_REV,
            "default": None, "secret": False, "range": "N/A", "dependencies": [],
            "platform": "UNKNOWN", "friday_ui": "UNMAPPED", "read_interface": "UNMAPPED",
            "write_interface": "UNMAPPED", "runtime_consumer": "UNMAPPED",
            "apply_behavior": "UNKNOWN", "voice_action": "UNMAPPED",
            "permission": "UNKNOWN", "test_id": "NOT_ASSIGNED", "status": "UNMAPPED",
        })

inventory.sort(key=lambda item: item["id"])

# Installed skill directory names only. No private skill text or user configuration is read.
installed_skill_root = HERMES.parent / "skills"
if installed_skill_root.exists():
    for path in sorted(installed_skill_root.rglob("SKILL.md")):
        if not any(part.startswith(".") for part in path.relative_to(installed_skill_root).parts):
            rel = path.parent.relative_to(installed_skill_root).as_posix()
            inventory.append({
                "id": f"hermes.installed_skill.{rel.replace('/', '.')}", "kind": "installed_skill",
                "source": "installed:~/.hermes/skills/" + rel + "/SKILL.md", "source_revision": "LOCAL_INSTALLATION",
                "default": None, "secret": False, "range": "N/A", "dependencies": [], "platform": "WSL",
                "friday_ui": "UNMAPPED", "read_interface": "UNMAPPED", "write_interface": "UNMAPPED",
                "runtime_consumer": "UNMAPPED", "apply_behavior": "UNKNOWN", "voice_action": "UNMAPPED",
                "permission": "UNKNOWN", "test_id": "NOT_ASSIGNED", "status": "UNMAPPED",
            })
installed_plugin_root = HERMES.parent / "plugins"
if installed_plugin_root.exists():
    for path in sorted(installed_plugin_root.iterdir()):
        if path.is_dir() and not path.name.startswith(".") and path.name != "__pycache__":
            inventory.append({
                "id": f"hermes.installed_plugin.{path.name}", "kind": "installed_plugin",
                "source": "installed:~/.hermes/plugins/" + path.name, "source_revision": "LOCAL_INSTALLATION",
                "default": None, "secret": False, "range": "N/A", "dependencies": [], "platform": "WSL",
                "friday_ui": "UNMAPPED", "read_interface": "UNMAPPED", "write_interface": "UNMAPPED",
                "runtime_consumer": "UNMAPPED", "apply_behavior": "UNKNOWN", "voice_action": "UNMAPPED",
                "permission": "UNKNOWN", "test_id": "NOT_ASSIGNED", "status": "UNMAPPED",
            })
inventory.sort(key=lambda item: item["id"])
(OUT / "hermes-feature-inventory.json").write_text(json.dumps({
    "scope": "static source candidate inventory; config leaves, collection defaults, modules and catalog entries are distinct; all integration mappings require P1/P7 validation",
    "limitations": [
        "Plugin catalog entries are available offerings, not installed or active plugins.",
        "A Python module is a feature candidate, not proof that every function in it is exposed or active.",
        "Collection defaults are not independently writable keys; validators and runtime consumers remain unmapped.",
        "Installed skill/plugin paths are names only; private contents and credentials were not read.",
        "No provider, device, gateway or end-to-end runtime check was performed.",
    ],
    "hermes_revision": HERMES_REV, "friday_revision": FRIDAY_REV,
    "items": inventory,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

settings = []
consumer_roots = [ROOT / "apps/control-api/src", ROOT / "adapters", ROOT / "installer/voice"]
consumer_files = []
for consumer_root in consumer_roots:
    consumer_files.extend(path for path in consumer_root.rglob("*")
                          if path.suffix in {".ts", ".tsx", ".py"}
                          and ".test." not in path.name
                          and not any(part in {"node_modules", "generated", "dist", "build", "__pycache__"} for part in path.parts))
consumer_text = {}
for path in consumer_files:
    try:
        consumer_text[path] = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        pass
ui_files = [path for path in (ROOT / "apps/web/src/features/settings").glob("*.tsx") if ".test." not in path.name]
ui_text = {path: path.read_text(encoding="utf-8").splitlines() for path in ui_files}
for name, definition, path in schema_fields(ROOT / "packages/contracts/schemas/settings/settings.schema.json"):
    leaf = name.split(".")[-1]
    hits = []
    if leaf not in {"version", "updatedAt"}:
        pattern = re.compile(r"\b" + re.escape(leaf) + r"\b")
        consumer_pattern = re.compile(r"\." + re.escape(leaf) + r"\b|\[['\"]" + re.escape(leaf) + r"['\"]\]") if len(leaf) >= 5 else None
        for candidate, lines in consumer_text.items():
            if candidate.name in {"settings.ts", "adapter-settings.ts", "route-table.generated.ts", "integration-status.ts"}:
                continue
            for lineno, line in enumerate(lines, 1):
                if consumer_pattern and consumer_pattern.search(line):
                    hits.append(source(candidate, lineno))
                    if len(hits) >= 8:
                        break
            if len(hits) >= 8:
                break
    ui_hits = []
    if leaf not in {"version", "updatedAt"}:
        for candidate, lines in ui_text.items():
            for lineno, line in enumerate(lines, 1):
                if pattern.search(line):
                    ui_hits.append(source(candidate, lineno))
                    if len(ui_hits) >= 5:
                        break
            if len(ui_hits) >= 5:
                break
    settings.append({
        "field": name, "kind": "metadata" if name in {"version", "updatedAt"} else "configurable_schema_field",
        "schema_source": source(path),
        "type": schema_type(definition),
        "default": str(definition["default"]) if "default" in definition else "UNSPECIFIED_IN_SCHEMA",
        "ui": "; ".join(ui_hits) if ui_hits else "NO_STATIC_UI_HIT",
        "storage": "metadata in settings DB" if name in {"version", "updatedAt"} else ("adapter override/secret store; inspect AdapterSettingsService" if name.startswith("adapters[]") else "settings DB via SettingsService.patch (area replacement)"),
        "api": "GET /settings (metadata only)" if name in {"version", "updatedAt"} else ("GET/PATCH /settings/adapters/{id}" if name.startswith("adapters[]") else "GET/PATCH /settings; If-Match version"),
        "runtime_consumer": "; ".join(hits) if hits else "NO_STATIC_HIT",
        "apply": "UNVERIFIED", "readback": "stored settings only; effective runtime UNVERIFIED",
        "restart": "UNVERIFIED", "test": "NOT_RUN", "status": "CANDIDATE_HIT_REVIEW" if hits else "NO_CONSUMER_HIT",
    })
with (OUT / "settings-runtime-map.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=list(settings[0]))
    writer.writeheader(); writer.writerows(settings)

dashboard = []
routes = ROOT / "apps/web/src/app/(dashboard)"
for path in sorted(routes.rglob("page.tsx")):
    area = path.parent.relative_to(routes).as_posix()
    page_text = path.read_text(encoding="utf-8")
    feature = re.search(r'from ["\']@/features/([^"\']+)["\']', page_text)
    feature_path = ROOT / "apps/web/src/features" / (feature.group(1) + ".tsx") if feature else None
    feature_dir = feature_path.parent if feature_path and feature_path.exists() else None
    api_hits = []
    if feature_dir:
        domain_paths = set()
        for candidate in sorted(feature_dir.rglob("*.tsx")):
            if ".test." in candidate.name:
                continue
            for lineno, line in enumerate(candidate.read_text(encoding="utf-8").splitlines(), 1):
                for domain in re.findall(r'@/lib/api/domains/([\w-]+)', line):
                    domain_path = ROOT / "apps/web/src/lib/api/domains" / (domain + ".ts")
                    if domain_path.exists():
                        domain_paths.add(domain_path)
                if re.search(r"@/lib/api|\.GET\(|\.POST\(|\.PATCH\(|\.DELETE\(", line):
                    api_hits.append(source(candidate, lineno))
                    if len(api_hits) >= 12:
                        break
            if len(api_hits) >= 12:
                break
        api_hits = [source(item, 1) for item in sorted(domain_paths)] + api_hits
    handler_hits = []
    for domain_path in sorted(domain_paths) if feature_dir else []:
        handler = ROOT / "apps/control-api/src/handlers" / domain_path.name
        if handler.exists():
            handler_hits.append(source(handler, 1))
    if api_hits and not handler_hits:
        handler_hits.append(source(ROOT / "apps/control-api/src/handlers/domain-ops.ts", 1))
    forms = {
        ".": "settings:dashboard,voice,orb", "communication": "settings:mail,messaging,telegram",
        "calendar": "page:CalDavCreateDialog; no unified account form verified", "memory": "settings:skillAccounts#obsidian",
        "voice": "settings:voice", "content-studio": "settings:contentStudioKeys",
        "alerts": "settings:notifications", "settings": "settings:all",
        "system": "settings:adapters,backups", "skills": "settings:skillAccounts",
    }
    dashboard.append({
        "area": area, "source": source(path, 1), "feature": source(feature_path, 1) if feature_path and feature_path.exists() else "UNRESOLVED_PAGE_IMPORT",
        "settings_form": forms.get(area, "NO_DIRECT_FORM_MAPPED"),
        "api": "; ".join(api_hits) if api_hits else "NO_STATIC_API_HIT",
        "handler_candidates": "; ".join(handler_hits) if handler_hits else "NO_HANDLER_MATCH",
        "runtime_consumer": "UNVERIFIED",
        "voice_action": "UNMAPPED", "test": "NOT_RUN", "status": "REVIEW_REQUIRED",
    })
with (OUT / "dashboard-coverage.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=list(dashboard[0]))
    writer.writeheader(); writer.writerows(dashboard)

print(f"Hermes inventory: {len(inventory)}; Friday setting fields: {len(settings)}; dashboard routes: {len(dashboard)}")
