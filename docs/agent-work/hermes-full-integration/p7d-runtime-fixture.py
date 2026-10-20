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
    "tools/approval.py": "aaf3c2956a7f031e4f61ee58536bedfb2b50901d7158ff03560ee5977f4049e2",
    "tools/file_tools_write_guards.py": "315a33d6735c4d1f0b328bf57c5a8021b9592fa4aa00677ea69fbc6a69b71598",
    "tools/browser_tool_eval_policy.py": "d015e62ddc19350bce4823058c87a4928a66b276959725d9d05299d5abe6bbc1",
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
        "browser:\n  inactivity_timeout: 240\n  restrict_evaluate: true\n"
        "  allow_private_urls: false\n"
        "  allow_unsafe_evaluate: false\n"
        "computer_use:\n  capture_after_mode: ax\n"
        "terminal:\n  backend: docker\n  container_cpu: 1.5\n"
        "  container_memory: 4096\n  container_disk: 16384\n"
        "approvals:\n  single_query_mode: approve\n  unattended_mode: deny\n",
        encoding="utf-8",
    )
    sys.path.insert(0, str(source))
    from tools.code_kernel import _lifecycle_limits
    from tools.computer_use.tool import _capture_after_mode
    from tools import browser_tool as browser_runtime
    from tools.browser_tool import _get_session_inactivity_timeout
    from tools.browser_tool_eval_policy import _enforce_browser_eval_policy
    from tools import browser_tool_cloud as browser_cloud
    from hermes_cli.config import load_config_readonly
    from tools.environments.docker import DockerEnvironment
    from tools.approval_context import _get_single_query_approval_mode, _get_unattended_approval_mode
    from tools.approval import request_tool_approval
    from tools.file_tools_write_guards import _protected_instruction_config, _protected_instruction_reason

    assert load_config_readonly()["code_execution"]["max_session_kernels"] == 2
    assert _lifecycle_limits() == (2, 600)
    assert _get_session_inactivity_timeout() == 240
    assert _enforce_browser_eval_policy("document.cookie") is not None
    assert _enforce_browser_eval_policy("document.title") is None
    with patch.object(browser_cloud, "_is_local_backend", return_value=False):
        assert browser_runtime.evaluate_url_safety("http://127.0.0.1/") is not None
        Path(profile, "config.yaml").write_text(
            Path(profile, "config.yaml").read_text().replace("allow_private_urls: false", "allow_private_urls: true"),
            encoding="utf-8",
        )
        browser_runtime._allow_private_urls_resolved = False
        assert browser_runtime.evaluate_url_safety("http://127.0.0.1/") is None
        assert browser_runtime.evaluate_url_safety("http://169.254.169.254/") is not None
    Path(profile, "config.yaml").write_text(
        Path(profile, "config.yaml").read_text().replace("allow_unsafe_evaluate: false", "allow_unsafe_evaluate: true"),
        encoding="utf-8",
    )
    assert _enforce_browser_eval_policy("document.cookie") is None
    assert _capture_after_mode() == "ax"
    assert _get_single_query_approval_mode() == "approve"
    assert _get_unattended_approval_mode() == "deny"
    os.environ["HERMES_SINGLE_QUERY_SESSION"] = "1"
    try:
        assert request_tool_approval("fixture-tool", "synthetic flagged action")["approved"] is True
        Path(profile, "config.yaml").write_text(
            Path(profile, "config.yaml").read_text().replace("single_query_mode: approve", "single_query_mode: deny"),
            encoding="utf-8",
        )
        assert request_tool_approval("fixture-tool", "synthetic flagged action")["approved"] is False
    finally:
        os.environ.pop("HERMES_SINGLE_QUERY_SESSION", None)
    os.environ["HERMES_SESSION_PLATFORM"] = "webhook"
    try:
        assert request_tool_approval("fixture-tool", "synthetic flagged action")["approved"] is False
        Path(profile, "config.yaml").write_text(
            Path(profile, "config.yaml").read_text().replace("unattended_mode: deny", "unattended_mode: approve"),
            encoding="utf-8",
        )
        assert request_tool_approval("fixture-tool", "synthetic flagged action")["approved"] is True
    finally:
        os.environ.pop("HERMES_SESSION_PLATFORM", None)
    Path(profile, "config.yaml").write_text(
        Path(profile, "config.yaml").read_text().replace(
            "approvals:\n", "approvals:\n  mode: 'off'\n") +
        "security:\n  protected_instruction_files: false\n",
        encoding="utf-8",
    )
    assert request_tool_approval("fixture-tool", "synthetic flagged action")["approved"] is True
    assert _protected_instruction_config()[0] is False
    assert _protected_instruction_reason("/tmp/AGENTS.md", enabled=True, extra_patterns=[]) is not None
    assert _protected_instruction_reason("/tmp/AGENTS.md", enabled=False, extra_patterns=[]) is None
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
    print("pinned Hermes consumers: code kernels, browser guards, Computer Use capture, conditional Docker resource args, approval and write-guard dispatch = OK")
