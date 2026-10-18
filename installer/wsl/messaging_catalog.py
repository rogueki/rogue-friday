#!/usr/bin/env python3
"""Read the pinned Hermes native messaging inventory without exposing credentials."""
import json
from pathlib import Path
import subprocess
import sys

from messaging_runtime import platform_state

ROOT = Path.home() / ".hermes" / "hermes-agent"
HOME = ROOT.parent
PINNED = "d923a5eb"
INTERNAL = {"local", "api_server", "webhook", "msgraph_webhook", "relay", "wecom_callback"}
PROTOCOL = {"a2a", "raft"}
CORE_ONLY = {
    "whatsapp_cloud": (("WHATSAPP_CLOUD_PHONE_NUMBER_ID", False), ("WHATSAPP_CLOUD_ACCESS_TOKEN", True)),
    "signal": (("SIGNAL_HTTP_URL", False), ("SIGNAL_ACCOUNT", False)),
    "weixin": (("WEIXIN_TOKEN", True), ("WEIXIN_ACCOUNT_ID", False)),
    "bluebubbles": (("BLUEBUBBLES_SERVER_URL", False), ("BLUEBUBBLES_PASSWORD", True)),
    "qqbot": (("QQ_APP_ID", False), ("QQ_CLIENT_SECRET", True)),
    "yuanbao": (("YUANBAO_APP_ID", False), ("YUANBAO_APP_SECRET", True)),
}


def catalog(runner=subprocess.run):
    pin = runner(["git", "-C", str(ROOT), "rev-parse", "--short=8", "HEAD"],
                 capture_output=True, text=True, timeout=3, check=False)
    if pin.returncode != 0 or pin.stdout.strip() != PINNED:
        return {"state": "unavailable", "reason": "hermes_version_changed", "items": []}
    import yaml
    sys.path.insert(0, str(ROOT))
    from hermes_cli._launchers import runtime_command
    running = runner(["systemctl", "--user", "is-active", "hermes-gateway.service"],
                     capture_output=True, text=True, timeout=3, check=False)
    service_running = running.returncode == 0 and running.stdout.strip() == "active"
    manifests = {}
    for path in (ROOT / "plugins" / "platforms").glob("*/plugin.yaml"):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("kind") == "platform":
            manifests[path.parent.name] = data
    names = (set(CORE_ONLY) | set(manifests)) - INTERNAL - PROTOCOL - {"email"}
    fields_needed = sorted({field["name"] for data in manifests.values()
                            for field in data.get("requires_env", []) + data.get("optional_env", [])} |
                           {field for required in CORE_ONLY.values() for field, _ in required})
    path = Path(__file__).with_name("messaging_catalog_probe.py")
    command = runtime_command(ROOT, code=f"import runpy; runpy.run_path({str(path)!r}, run_name='__main__')")
    probed = runner(command, input=json.dumps({"fields": fields_needed}), capture_output=True,
                    text=True, timeout=15, check=False)
    if probed.returncode != 0:
        return {"state": "unavailable", "reason": "config_probe_unavailable", "items": []}
    try:
        runtime = json.loads(probed.stdout)
    except ValueError:
        runtime = {}
    if runtime.get("state") != "available" or not isinstance(runtime.get("configured"), list) or not isinstance(runtime.get("present"), dict):
        return {"state": "unavailable", "reason": "config_probe_unavailable", "items": []}
    configured = set(runtime["configured"])
    present = runtime["present"]
    items = []
    for name in sorted(names):
        if name in manifests:
            source = "bundled_plugin"
            required = [(field["name"], field.get("password") is True)
                        for field in manifests[name].get("requires_env", [])]
            optional = [(field["name"], field.get("password") is True)
                        for field in manifests[name].get("optional_env", [])]
        else:
            source = "builtin"
            required = CORE_ONLY.get(name, ())
            optional = []
        fields = [{"name": field, "secret": secret, "required": True, "present": present.get(field) is True}
                  for field, secret in required]
        fields += [{"name": field, "secret": secret, "required": False, "present": present.get(field) is True}
                   for field, secret in optional]
        items.append({"platform": name, "source": source, "fields": fields,
                      "configured": name in configured, "gatewayRunning": service_running,
                      "connectionState": platform_state(HOME, name) if service_running else "unknown"})
    return {"state": "available", "pin": PINNED, "items": items}


if __name__ == "__main__":
    try:
        print(json.dumps(catalog()))
    except Exception:
        print(json.dumps({"state": "unavailable", "reason": "catalog_failed", "items": []}))
