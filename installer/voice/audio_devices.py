"""Host audio inventory and stable selections for the running voice process."""

import hashlib
import re


def inventory(sd):
    devices = sd.query_devices()
    apis = sd.query_hostapis()
    defaults = sd.default.device
    result = []
    duplicates = {}
    for index, device in enumerate(devices):
        api = str(apis[device["hostapi"]]["name"])
        name = str(device["name"])
        for direction in ("input", "output"):
            channels = int(device[f"max_{direction}_channels"])
            if channels < 1:
                continue
            key = (api, name, direction)
            if key in duplicates:
                raise ValueError(f"Mehrdeutiges {direction}-Geraet '{name}' ({api}); eindeutige Windows-Endpunkt-ID erforderlich")
            duplicates[key] = True
            identity = "\0".join(key)
            stable_id = "vdev_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:26]
            bluetooth = re.search(r"\(([^();\r\n]+)\)\s*\)\s*$", name)
            display = f"{bluetooth.group(1)} (Bluetooth Hands-Free)" if bluetooth and "bthhfenum.sys" in name else name
            result.append({"id": stable_id, "name": display, "rawName": name, "hostApi": api, "kind": direction,
                           "index": index, "channels": channels, "sampleRateHz": round(device["default_samplerate"]),
                           "isDefault": index == defaults[0 if direction == "input" else 1]})
    return result


def resolve(sd, selected, direction):
    if selected is None or selected == "":
        return None, next((item for item in inventory(sd) if item["kind"] == direction and item["isDefault"]), None)
    candidates = [item for item in inventory(sd) if item["kind"] == direction and item["id"] == selected]
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
