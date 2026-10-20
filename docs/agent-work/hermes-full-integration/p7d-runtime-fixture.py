#!/usr/bin/env python3
"""Exercise pinned Hermes consumers with a disposable, local-only profile."""

import os
import hashlib
from importlib.metadata import version
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch


source = Path(os.environ["HERMES_PIN_SOURCE"]).resolve()
PINNED_FILES = {
    "tools/code_kernel.py": "b29daa95d3bd7b49d40c4139a88d7f644727e6321155b41a38d1764b773600a6",
    "tools/browser_tool.py": "9ac7722d4c403e0a30ee777802f723795da49eba1639bc95adf3d74a4d29b8b8",
    "tools/computer_use/tool.py": "0f61a487c96ef94fde4e1ecfb52df6efafbd37c055433618a6d6f8aebb2d28fc",
    "hermes_cli/config_defaults.py": "3770f92378e37093720040de6d4813202a88edc7a196415dfc7be7b4e88064d7",
    "tools/environments/docker.py": "571cdeedd40076fd32d246f22fac804a899732659e0d486a045b14a126d19df1",
    "tools/approval_context.py": "016e6eb6330a0d83adc5bbd260e8d9995e415a2cbff00e0a98f6ab627a6bb413",
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
        "computer_use:\n  capture_after_mode: ax\n"
        "terminal:\n  backend: docker\n  container_cpu: 1.5\n"
        "  container_memory: 4096\n  container_disk: 16384\n"
        "approvals:\n  single_query_mode: approve\n  unattended_mode: deny\n",
        encoding="utf-8",
    )
    sys.path.insert(0, str(source))
    from tools.code_kernel import _lifecycle_limits
    from tools.computer_use.tool import _capture_after_mode
    from tools.browser_tool import _get_session_inactivity_timeout
    from hermes_cli.config import load_config_readonly
    from tools.environments.docker import DockerEnvironment
    from tools.approval_context import _get_single_query_approval_mode, _get_unattended_approval_mode

    assert load_config_readonly()["code_execution"]["max_session_kernels"] == 2
    assert _lifecycle_limits() == (2, 600)
    assert _get_session_inactivity_timeout() == 240
    assert _capture_after_mode() == "ax"
    assert _get_single_query_approval_mode() == "approve"
    assert _get_unattended_approval_mode() == "deny"
    limits = load_config_readonly()["terminal"]
    docker = DockerEnvironment.__new__(DockerEnvironment)
    with patch("tools.environments.docker._cgroup_limits_available", return_value=True), \
            patch.object(DockerEnvironment, "_storage_opt_supported", return_value=True):
        args = docker._resource_args("test-image", limits["container_cpu"],
                                     limits["container_memory"], limits["container_disk"],
                                     False, "1g", [])
    assert ["--cpus", "1.5"] == args[:2], args
    assert ["--memory", "4096m"] == args[2:4], args
    assert ["--storage-opt", "size=16384m"] == args[8:10], args
    assert "--network=none" in args, args
    with patch("tools.environments.docker._cgroup_limits_available", return_value=False), \
            patch.object(DockerEnvironment, "_storage_opt_supported", return_value=False), \
            patch("tools.environments.docker.logger.warning"):
        unsupported = docker._resource_args("test-image", limits["container_cpu"],
                                             limits["container_memory"], limits["container_disk"],
                                             False, "1g", [])
    assert "--cpus" not in unsupported and "--memory" not in unsupported and \
        "--storage-opt" not in unsupported, unsupported
    print("pinned Hermes consumers: code kernels, browser idle, Computer Use capture, conditional Docker resource args, approval modes = OK")
