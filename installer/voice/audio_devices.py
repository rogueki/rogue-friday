"""Host audio inventory and stable selections for the running voice process."""

import hashlib
import re
from collections import Counter


def _entries(sd):
    devices = sd.query_devices()
    apis = sd.query_hostapis()
    defaults = sd.default.device
    result = []
    for index, device in enumerate(devices):
        api = str(apis[device["hostapi"]]["name"])
        name = str(device["name"])
        for direction in ("input", "output"):
            channels = int(device[f"max_{direction}_channels"])
            if channels < 1:
                continue
            identity = "\0".join((api, name, direction))
            stable_id = "vdev_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:26]
            bluetooth = re.search(r"\(([^();\r\n]+)\)\s*\)\s*$", name)
            display = f"{bluetooth.group(1)} (Bluetooth Hands-Free)" if bluetooth and "bthhfenum.sys" in name else name
            result.append({"id": stable_id, "name": display, "rawName": name, "hostApi": api, "kind": direction,
                           "index": index, "channels": channels, "sampleRateHz": round(device["default_samplerate"]),
                           "isDefault": index == defaults[0 if direction == "input" else 1]})
    return result


def _split(sd):
    entries = _entries(sd)
    counts = Counter(item["id"] for item in entries)
    return [item for item in entries if counts[item["id"]] == 1], {key for key, count in counts.items() if count > 1}


def inventory(sd):
    # Two endpoints with the same name on the same backend (e.g. nameless "Input ()" WDM-KS pins of Realtek drivers)
    # cannot be told apart across a re-enumeration. They are left out instead of failing the whole list: one such
    # pair used to stop the installer and the voice service although nobody had selected it (2026-11-01).
    return _split(sd)[0]


def resolve(sd, selected, direction):
    items, ambiguous = _split(sd)
    if selected is None or selected == "":
        return None, next((item for item in items if item["kind"] == direction and item["isDefault"]), None)
    if selected in ambiguous:
        raise ValueError(f"Mehrdeutiges {direction}-Geraet ({selected}); bitte ein anderes Geraet oder den Windows-Standard waehlen")
    candidates = [item for item in items if item["kind"] == direction and item["id"] == selected]
    if len(candidates) != 1:
        raise ValueError(f"Ausgewaehltes {direction}-Geraet ist nicht verbunden: {selected}")
    return candidates[0]["index"], candidates[0]


def legacy_id(sd, selection, direction):
    if selection is None or selection == "":
        return None
    candidates = [item for item in inventory(sd) if item["kind"] == direction and
                  (selection == item["index"] or selection == f'{item["rawName"]}, {item["hostApi"]}')]
    if len(candidates) != 1:
        raise ValueError(f"Alte {direction}-Auswahl kann nicht eindeutig zugeordnet werden: {selection}")
    return candidates[0]["id"]


def refresh(sd):
    # PortAudio enumerates devices only when it initializes; a plugged or removed headset becomes visible only after a
    # re-initialization, which also invalidates every open stream, so callers must close their streams first.
    sd._terminate()
    sd._initialize()
