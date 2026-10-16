#!/usr/bin/env python3
"""Owner-only Asterisk bridge. JSON on stdin/stdout; never print credentials."""
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path.home() / ".config" / "friday" / "telephony"
PROFILE = ROOT / "profile.json"
ASTERISK_CONFIG = Path("/etc/asterisk")
CONFIG_FILES = ("ari.friday.conf", "http.friday.conf", "pjsip.friday.conf", "extensions.friday.conf")
NUMBER = re.compile(r"^\+[1-9][0-9]{6,14}$")
EXTENSION = re.compile(r"^[1-9][0-9]{2,5}$")
LABEL = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]{0,39}$")
HOST = re.compile(r"^[a-zA-Z0-9.-]{1,253}$")


def read_profile():
    try:
        return json.loads(PROFILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return None


def ari(profile, method, path, body=None):
    url = "http://127.0.0.1:%d/ari/%s" % (profile["ariPort"], path)
    request = urllib.request.Request(url, method=method)
    credential = (profile["ariUser"] + ":" + profile["ariPassword"]).encode()
    request.add_header("Authorization", "Basic " + base64.b64encode(credential).decode())
    if body is not None:
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
        request.data = urllib.parse.urlencode(body).encode()
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            raw = response.read(65536)
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        error.read(65536)
        return error.code, {}
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, {}


def asterisk(command):
    try:
        result = subprocess.run(["asterisk", "-rx", command], capture_output=True,
                                text=True, timeout=4, check=False)
        return result.stdout if result.returncode == 0 else ""
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return ""


def installed_matches():
    try:
        return all(hashlib.sha256((ROOT / name).read_bytes()).digest() ==
                   hashlib.sha256((ASTERISK_CONFIG / name).read_bytes()).digest()
                   for name in CONFIG_FILES)
    except (FileNotFoundError, PermissionError, OSError):
        return False


def status():
    profile = read_profile()
    if not profile:
        return dict(configured=False, mode=None, ariReachable=False, registration="unavailable",
                    ownerEndpoint="unknown", configurationApplied=False, dialplanLoaded=False,
                    ready=False, revision=0, callerId=None)
    code, _ = ari(profile, "GET", "asterisk/info")
    reachable = code == 200
    endpoint = "unknown"
    if reachable:
        code, data = ari(profile, "GET", "endpoints/PJSIP/" + urllib.parse.quote(profile["ownerEndpoint"]))
        endpoint = "online" if code == 200 and data.get("state") == "online" else "offline"
    registration = "not_required" if profile["mode"] == "local" else "unavailable"
    if profile["mode"] == "trunk" and reachable:
        output = asterisk("pjsip show registration friday-trunk-reg")
        # The exact registration object must report Registered; the summary for other trunks is insufficient.
        lines = [line for line in output.splitlines() if "friday-trunk-reg" in line]
        registration = "registered" if any(re.search(r"\bRegistered\b", line) for line in lines) else (
            "unregistered" if lines else "unknown")
    applied = installed_matches()
    dialplan = asterisk("dialplan show friday-outbound")
    expected = "PJSIP/${EXTEN}@friday-trunk" if profile["mode"] == "trunk" else "PJSIP/${EXTEN}"
    dialplan_loaded = "friday-outbound" in dialplan and expected in dialplan
    ready = reachable and endpoint == "online" and applied and dialplan_loaded and registration in ("registered", "not_required")
    return dict(configured=True, mode=profile["mode"], ariReachable=reachable,
                registration=registration, ownerEndpoint=endpoint, configurationApplied=applied,
                dialplanLoaded=dialplan_loaded, ready=ready,
                revision=profile["revision"], callerId=profile["callerId"])


def validate(profile):
    if not isinstance(profile, dict) or profile.get("mode") not in ("local", "trunk"):
        raise ValueError("mode")
    for field in ("ariUser", "ownerEndpoint"):
        if not isinstance(profile.get(field), str) or not LABEL.fullmatch(profile[field]):
            raise ValueError(field)
    if not isinstance(profile.get("ariPassword"), str) or not re.fullmatch(r"[A-Za-z0-9!@#$%^&*()_+,.?/-]{12,200}", profile["ariPassword"]):
        raise ValueError("ariPassword")
    if not isinstance(profile.get("ariPort"), int) or not 1 <= profile["ariPort"] <= 65535:
        raise ValueError("ariPort")
    if not isinstance(profile.get("callerId"), str) or not (NUMBER if profile["mode"] == "trunk" else EXTENSION).fullmatch(profile["callerId"]):
        raise ValueError("callerId")
    if profile["mode"] == "trunk":
        if not isinstance(profile.get("sipHost"), str) or not HOST.fullmatch(profile["sipHost"]):
            raise ValueError("sipHost")
        for field in ("sipUser", "sipPassword"):
            if not isinstance(profile.get(field), str) or not re.fullmatch(r"[A-Za-z0-9!@#$%^&*()_+,.?/-]{1,200}", profile[field]):
                raise ValueError(field)


def write_private(name, content):
    target = ROOT / name
    temporary = ROOT / (name + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, target)
    os.chmod(target, 0o600)


def provision_files(profile):
    ari_user = profile["ariUser"]
    ari_password = profile["ariPassword"]
    write_private("ari.friday.conf", f"[general]\nenabled = yes\npretty = no\n\n[{ari_user}]\ntype = user\nread_only = no\npassword = {ari_password}\n")
    write_private("http.friday.conf", f"[general]\nenabled = yes\nbindaddr = 127.0.0.1\nbindport = {profile['ariPort']}\n")
    if profile["mode"] == "trunk":
        host = profile["sipHost"]
        username = profile["sipUser"]
        password = profile["sipPassword"]
        pjsip = f"""[friday-trunk-auth]
type=auth
auth_type=userpass
username={username}
password={password}

[friday-trunk-aor]
type=aor
contact=sip:{host}

[friday-trunk]
type=endpoint
context=friday-inbound-block
disallow=all
allow=ulaw,alaw
outbound_auth=friday-trunk-auth
aors=friday-trunk-aor
from_user={username}

[friday-trunk-reg]
type=registration
outbound_auth=friday-trunk-auth
server_uri=sip:{host}
client_uri=sip:{username}@{host}
contact_user={username}
retry_interval=60
"""
        dial = "[friday-outbound]\nexten => _X.,1,Dial(PJSIP/${EXTEN}@friday-trunk,60)\n same => n,Hangup()\n"
    else:
        pjsip = "; Local mode uses existing owner and destination PJSIP endpoints.\n"
        dial = "[friday-outbound]\nexten => _X.,1,Dial(PJSIP/${EXTEN},60)\n same => n,Hangup()\n"
    write_private("pjsip.friday.conf", pjsip)
    write_private("extensions.friday.conf", dial)


def configure(data):
    previous = read_profile()
    if data.get("revision") != (previous or {}).get("revision", 0):
        raise RuntimeError("revision_conflict")
    profile = data.get("profile")
    validate(profile)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ROOT, 0o700)
    profile["revision"] = (previous or {}).get("revision", 0) + 1
    provision_files(profile)
    write_private("profile.json", json.dumps(profile, separators=(",", ":")))
    # Provisioning remains explicit: never edit an unrelated Asterisk instance's global config.
    return status()


def channel(call_id):
    profile = read_profile()
    if not profile or not re.fullmatch(r"call_[a-f0-9]{32}", call_id):
        raise ValueError("callId")
    code, data = ari(profile, "GET", "channels/" + call_id)
    return dict(found=code == 200, state=data.get("state") if code == 200 else None,
                adapterReachable=code not in (0, 401, 403), adapterStatus=code)


def originate(data):
    profile = read_profile()
    if not profile or not status()["ready"]:
        raise RuntimeError("adapter_unavailable")
    call_id, number = data.get("callId"), data.get("number")
    if not isinstance(call_id, str) or not re.fullmatch(r"call_[a-f0-9]{32}", call_id):
        raise ValueError("callId")
    if not isinstance(number, str) or not (NUMBER if profile["mode"] == "trunk" else EXTENSION).fullmatch(number):
        raise ValueError("number")
    # The owner leg answers first. The fixed Friday dialplan then dials the external destination.
    destination = number[1:] if profile["mode"] == "trunk" else number
    code, _ = ari(profile, "POST", "channels", dict(endpoint="PJSIP/" + profile["ownerEndpoint"],
        context="friday-outbound", extension=destination, priority="1", timeout="30",
        callerId=profile["callerId"], channelId=call_id))
    if code not in (200, 201):
        raise RuntimeError("originate_%s" % code)
    return dict(accepted=True, adapterStatus=code)


def hangup(call_id):
    profile = read_profile()
    if not profile or not re.fullmatch(r"call_[a-f0-9]{32}", call_id):
        raise ValueError("callId")
    code, _ = ari(profile, "DELETE", "channels/" + call_id)
    return dict(accepted=code in (200, 204), alreadyGone=code == 404, adapterStatus=code)


def main():
    action = sys.argv[1] if len(sys.argv) >= 2 else ""
    data = json.load(sys.stdin) if action in ("configure", "originate") else None
    if action == "status": result = status()
    elif action == "configure": result = configure(data)
    elif action == "channel" and len(sys.argv) == 3: result = channel(sys.argv[2])
    elif action == "originate": result = originate(data)
    elif action == "hangup" and len(sys.argv) == 3: result = hangup(sys.argv[2])
    else: raise ValueError("action")
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(4)
    except RuntimeError as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(3)
