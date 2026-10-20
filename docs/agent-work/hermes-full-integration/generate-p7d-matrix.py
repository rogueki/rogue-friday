#!/usr/bin/env python3
"""Reconcile the pinned P7-D inventory against the native bridge allowlist."""

import ast
import csv
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PREFIXES = ("terminal.", "browser.", "computer_use.", "code_execution.",
            "approvals.", "security.")
SINGLES = {"toolsets", "command_allowlist"}
CONSUMER_SOURCES = {
    "terminal.container_cpu": "tools/terminal_tool.py:722;tools/environments/docker.py:786",
    "terminal.container_memory": "tools/terminal_tool.py:723;tools/environments/docker.py:786",
    "terminal.container_disk": "tools/terminal_tool.py:724;tools/environments/docker.py:786",
    "browser.inactivity_timeout": "tools/browser_tool.py:397",
    "browser.dialog_policy": "tools/browser_tool_cdp.py:73",
    "browser.dialog_timeout_s": "tools/browser_tool_cdp.py:73",
    "code_execution.kernel_idle_timeout": "tools/code_kernel.py:409",
    "code_execution.max_session_kernels": "tools/code_kernel.py:409",
    "computer_use.max_image_dimension": "tools/computer_use/cua_backend.py:117",
    "computer_use.ax_max_elements": "tools/computer_use/cua_backend_capture.py:251",
    "computer_use.capture_after_mode": "tools/computer_use/tool.py:908",
}
RUNTIME_FIXTURE_KEYS = {"browser.inactivity_timeout", "code_execution.kernel_idle_timeout",
                        "code_execution.max_session_kernels", "computer_use.capture_after_mode",
                        "terminal.container_cpu", "terminal.container_memory", "terminal.container_disk"}


def native_fields():
    tree = ast.parse((ROOT / "installer/wsl/hermes_config_bridge.py").read_text(encoding="utf-8"))
    assignment = next(node for node in tree.body if isinstance(node, ast.Assign) and
                      any(isinstance(target, ast.Name) and target.id == "FIELDS" for target in node.targets))
    return set(ast.literal_eval(assignment.value))


def main():
    inventory = json.loads((HERE / "hermes-feature-inventory.json").read_text(encoding="utf-8"))
    fields = native_fields()
    rows = []
    for item in inventory["items"]:
        item_id = item["id"]
        if not item_id.startswith("hermes.config."):
            continue
        key = item_id.removeprefix("hermes.config.")
        if not key.startswith(PREFIXES) and key not in SINGLES:
            continue
        typed = key in fields
        rows.append({
            "key": key,
            "source_revision": item["source_revision"],
            "source": item["source"],
            "native_default": json.dumps(item.get("default"), ensure_ascii=False, separators=(",", ":")),
            "bridge_status": "typed_config_readback_runtime_unverified" if typed else "open_native_mapping",
            "consumer_source": CONSUMER_SOURCES.get(key, ""),
            "runtime_proof": "pinned_disposable_consumer_fixture" if key in RUNTIME_FIXTURE_KEYS else "",
            "remaining_gate": "disposable_runtime_consumer_proof" if typed else
                              "trace_validator_consumer_platform_and_native_ui_or_operation",
        })
    assert len(rows) == 97, f"P7-D source inventory changed: {len(rows)} keys"
    with (HERE / "p7d-config-matrix.csv").open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda row: row["key"]))


if __name__ == "__main__":
    main()
