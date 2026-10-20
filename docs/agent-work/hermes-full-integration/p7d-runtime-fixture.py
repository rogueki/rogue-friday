#!/usr/bin/env python3
"""Exercise pinned Hermes consumers with a disposable, local-only profile."""

import os
import hashlib
from importlib.metadata import version
from pathlib import Path
import sys
import tempfile


source = Path(os.environ["HERMES_PIN_SOURCE"]).resolve()
PINNED_FILES = {
    "tools/code_kernel.py": "b29daa95d3bd7b49d40c4139a88d7f644727e6321155b41a38d1764b773600a6",
    "tools/browser_tool.py": "9ac7722d4c403e0a30ee777802f723795da49eba1639bc95adf3d74a4d29b8b8",
    "tools/computer_use/tool.py": "0f61a487c96ef94fde4e1ecfb52df6efafbd37c055433618a6d6f8aebb2d28fc",
    "hermes_cli/config_defaults.py": "3770f92378e37093720040de6d4813202a88edc7a196415dfc7be7b4e88064d7",
}
for relative_path, expected_hash in PINNED_FILES.items():
    assert hashlib.sha256((source / relative_path).read_bytes()).hexdigest() == expected_hash, relative_path
assert sys.version_info[:2] == (3, 14), "use the pinned Hermes Python 3.14 runtime"
assert version("ruamel.yaml") == "0.18.16"
assert version("requests") == "2.33.0"

with tempfile.TemporaryDirectory(prefix="friday-p7d-runtime-") as profile:
    os.environ["HERMES_HOME"] = profile
    Path(profile, "config.yaml").write_text(
        "code_execution:\n  max_session_kernels: 2\n  kernel_idle_timeout: 600\n"
        "browser:\n  inactivity_timeout: 240\n"
        "computer_use:\n  capture_after_mode: ax\n",
        encoding="utf-8",
    )
    sys.path.insert(0, str(source))
    from tools.code_kernel import _lifecycle_limits
    from tools.computer_use.tool import _capture_after_mode
    from tools.browser_tool import _get_session_inactivity_timeout
    from hermes_cli.config import load_config_readonly

    assert load_config_readonly()["code_execution"]["max_session_kernels"] == 2
    assert _lifecycle_limits() == (2, 600)
    assert _get_session_inactivity_timeout() == 240
    assert _capture_after_mode() == "ax"
    print("pinned Hermes consumers: code kernels, browser idle, Computer Use capture = OK")
