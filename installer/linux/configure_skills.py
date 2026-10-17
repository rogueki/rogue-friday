#!/usr/bin/env python3
"""Validate local Friday skills and add their stable path to a Hermes profile."""
from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wsl"))
from skills_profile import validate  # noqa: E402


def configure(checkout: Path, stable_dir: Path) -> int:
    count = validate(checkout)
    config_path = Path.home() / ".hermes" / "config.yaml"
    if config_path.is_symlink():
        raise ValueError("Hermes config must not be a symlink")
    original = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    profile = yaml.safe_load(original) or {}
    if not isinstance(profile, dict):
        raise ValueError("Hermes config root must be a mapping")
    skills = profile.setdefault("skills", {})
    if not isinstance(skills, dict):
        raise ValueError("Hermes skills must be a mapping")
    external = skills.get("external_dirs", [])
    if isinstance(external, str):
        external = [external]
    if not isinstance(external, list) or any(not isinstance(path, str) for path in external):
        raise ValueError("Hermes skills.external_dirs must be a path list")
    stable = str(stable_dir)
    # Paths from an older Linux release point at immutable historical copies.
    external = [path for path in external if not (
        path.startswith("/opt/friday/releases/") and path.endswith("/skills/friday-skills/skills")
    )]
    skills["external_dirs"] = list(dict.fromkeys([*external, stable]))
    rendered = yaml.safe_dump(profile, allow_unicode=True, sort_keys=False)
    if rendered != original:
        config_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if original:
            backup = config_path.with_name("config.yaml.friday-skills.bak")
            if not backup.exists():
                backup.write_text(original, encoding="utf-8")
                backup.chmod(0o600)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=config_path.parent, delete=False) as tmp:
            temp_path = Path(tmp.name)
            os.chmod(temp_path, 0o600)
            tmp.write(rendered)
        temp_path.replace(config_path)
    print(f"FRIDAY_SKILLS_READY count={count}")
    return count


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "--check-only":
            print(f"FRIDAY_SKILLS_VALID count={validate(Path(sys.argv[2]))}")
        elif len(sys.argv) == 3:
            configure(Path(sys.argv[1]), Path(sys.argv[2]))
        else:
            raise ValueError("usage: configure_skills.py [--check-only] CHECKOUT [STABLE_SKILLS_DIR]")
    except (OSError, KeyError, TypeError, ValueError, yaml.YAMLError) as exc:
        print(f"FRIDAY_SKILLS_ERROR {exc}", file=sys.stderr)
        raise SystemExit(1) from None
