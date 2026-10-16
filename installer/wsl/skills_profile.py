#!/usr/bin/env python3
"""Validate the Friday skill checkout and reconcile one Hermes profile setting."""
import argparse
import json
import os
from pathlib import Path
import sys

import yaml


def validate(checkout: Path) -> int:
    registry = json.loads((checkout / "registry/skills.json").read_text(encoding="utf-8-sig"))
    entries = registry["skills"]
    names = [entry["name"] for entry in entries]
    expected = {checkout / entry["path"] for entry in entries}
    actual = set((checkout / "skills").rglob("SKILL.md"))
    if len(names) != len(set(names)) or expected != actual:
        raise ValueError(f"registry/SKILL.md mismatch: registry={len(entries)}, files={len(actual)}")
    for entry in entries:
        skill_file = checkout / entry["path"]
        if not skill_file.is_file() or skill_file.parent.name != entry["name"]:
            raise ValueError(f"invalid skill path: {entry['name']}")
        lines = skill_file.read_text(encoding="utf-8-sig").splitlines()
        if not lines or lines[0].strip() != "---":
            raise ValueError(f"missing frontmatter: {skill_file}")
        end = next((i for i, line in enumerate(lines[1:], 1) if line.strip() == "---"), None)
        if end is None or yaml.safe_load("\n".join(lines[1:end])).get("name") != entry["name"]:
            raise ValueError(f"frontmatter name mismatch: {skill_file}")
    catalog = checkout / "registry/integration_setup.json"
    if not catalog.is_file():
        raise ValueError("registry/integration_setup.json missing")
    setup = json.loads(catalog.read_text(encoding="utf-8-sig"))
    if setup.get("inventory_source") != "registry/skills.json" or setup.get("inventory_count") != len(names):
        raise ValueError("integration inventory source/count mismatch")
    if set(setup.get("skills", {})) != set(names):
        raise ValueError("integration skill IDs do not match registry")
    return len(entries)


def reconcile_config(config_path: Path, skills_dir: Path) -> None:
    if config_path.is_symlink():
        raise ValueError("Hermes config may not be a symlink")
    original = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    config = yaml.safe_load(original) or {}
    if not isinstance(config, dict):
        raise ValueError("Hermes config root is not a mapping")
    skills = config.setdefault("skills", {})
    if not isinstance(skills, dict):
        raise ValueError("Hermes skills config is not a mapping")
    external = skills.get("external_dirs", [])
    if isinstance(external, str):
        external = [external]
    if not isinstance(external, list) or any(not isinstance(item, str) for item in external):
        raise ValueError("Hermes skills.external_dirs must be a path list")
    target = str(skills_dir.resolve())
    if target in external:
        return
    external.append(target)
    skills["external_dirs"] = external
    # Hermes owns its built-in skills. Only add this external checkout.
    config_path.parent.mkdir(parents=True, exist_ok=True)
    if original:
        backup = config_path.with_name(config_path.name + ".friday-skills.bak")
        if not backup.exists():
            backup.write_text(original, encoding="utf-8")
            os.chmod(backup, 0o600)
    temp = config_path.with_name(config_path.name + ".friday-skills.tmp")
    temp.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding="utf-8")
    os.chmod(temp, 0o600)
    temp.replace(config_path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("configure", "status"))
    parser.add_argument("checkout", type=Path)
    args = parser.parse_args()
    count = validate(args.checkout)
    skills_dir = args.checkout / "skills"
    config_path = Path.home() / ".hermes/config.yaml"
    if args.mode == "configure":
        reconcile_config(config_path, skills_dir)
    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
    external = (config or {}).get("skills", {}).get("external_dirs", [])
    if str(skills_dir.resolve()) not in external:
        raise ValueError("Hermes profile does not reference Friday skills")
    print(f"FRIDAY_SKILLS_READY count={count} catalog={args.checkout / 'registry/integration_setup.json'}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, yaml.YAMLError) as exc:
        print(f"FRIDAY_SKILLS_ERROR {exc}", file=sys.stderr)
        sys.exit(1)
