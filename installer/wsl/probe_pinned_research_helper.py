#!/usr/bin/env python3
"""Offline probe of the exact pinned Hermes bootstrap and research helper."""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from research_hermes_synthesis import PINNED_SOURCE, run_bounded_child


def main() -> int:
    source = Path(os.environ["FRIDAY_PINNED_HERMES_SOURCE"]).resolve()
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != PINNED_SOURCE:
        raise ValueError(f"wrong pinned source: {revision}")
    site_packages = Path(os.environ["FRIDAY_PINNED_HERMES_SITE_PACKAGES"]).resolve()
    if not site_packages.is_dir():
        raise ValueError("missing existing Hermes dependencies")
    sys.path.insert(0, str(source))
    from hermes_cli._launchers import runtime_command

    helper = Path(__file__).with_name("research_hermes_synthesis.py")
    fixture = f"""
import runpy, sys
sys.path.insert(0, {str(site_packages)!r})
from unittest.mock import patch
from cli import HermesCLI
from run_agent import AIAgent
def credentials(cli):
    cli.model = 'fixture-model'
    return True
def route(cli, prompt):
    return {{'model': 'fixture-model', 'runtime': {{'provider': 'fixture',
        'requested_provider': 'fixture', 'api_key': 'fixture',
        'base_url': 'http://127.0.0.1:9', 'api_mode': 'chat_completions'}}}}
def answer(agent, **kwargs):
    assert agent.tools == [], agent.tools
    assert agent._api_max_retries == 1
    assert agent._auto_recovery_cycles == 0
    return {{'final_response': '{{"observations":[]}}', 'failed': False}}
with patch.object(HermesCLI, '_ensure_runtime_credentials', credentials), \\
     patch.object(HermesCLI, '_resolve_turn_agent_config', route), \\
     patch.object(AIAgent, 'run_conversation', answer):
    runpy.run_path({str(helper)!r}, run_name='__main__')
"""
    with tempfile.TemporaryDirectory(prefix="friday-research-hermes-probe-") as home:
        prior_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = home
        try:
            command = runtime_command(source, code=fixture, python=sys.executable, home=home)
            result = json.loads(run_bounded_child(command, b'{"prompt":"offline probe"}'))
            assert result == {"output": '{"observations":[]}', "provider": "fixture", "model": "fixture-model"}, result
            print(json.dumps({"revision": revision, "result": result,
                              "profile_entries": sorted(p.name for p in Path(home).iterdir())}))
        finally:
            if prior_home is None:
                os.environ.pop("HERMES_HOME", None)
            else:
                os.environ["HERMES_HOME"] = prior_home
    return 0


if __name__ == "__main__":
    sys.exit(main())
