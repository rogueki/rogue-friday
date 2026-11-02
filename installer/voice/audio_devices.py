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


def windows_default_endpoints():
    """(capture id, render id) of the current Windows default endpoints, or None where they cannot be read.

    PortAudio's own default is frozen at initialization, so a headset that becomes the Windows default later is never
    noticed while the old stream keeps delivering (silent) audio. The endpoint ids come straight from the Core Audio
    device enumerator, which is cheap enough to poll.
    """
    try:
        import ctypes
        import uuid
        from ctypes import POINTER, byref, c_void_p, c_wchar_p
        ole32 = ctypes.OleDLL("ole32")
    except (ImportError, OSError, AttributeError):
        return None

    def guid(text):
        return (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID(text).bytes_le)

    def method(pointer, index, *argtypes):
        table = ctypes.cast(pointer, POINTER(POINTER(c_void_p))).contents
        return ctypes.WINFUNCTYPE(ctypes.HRESULT, c_void_p, *argtypes)(table[index])

    try:
        ole32.CoInitializeEx(None, 0)
    except OSError:
        return None
    enumerator = c_void_p()
    try:
        clsid, iid = guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), guid("A95664D2-9614-4F35-A746-DE8DB63617E6")
        ole32.CoCreateInstance(byref(clsid), None, 1, byref(iid), byref(enumerator))
        ids = []
        for flow in (1, 0):  # eCapture, eRender; role eConsole
            device = c_void_p()
            method(enumerator, 4, ctypes.c_int, ctypes.c_int, POINTER(c_void_p))(enumerator, flow, 0, byref(device))
            try:
                endpoint = c_wchar_p()
                method(device, 5, POINTER(c_wchar_p))(device, byref(endpoint))
                ids.append(endpoint.value)
                ole32.CoTaskMemFree(endpoint)
            finally:
                method(device, 2)(device)
        return tuple(ids)
    except OSError:
        return None  # e.g. no default endpoint at all while every device is unplugged
    finally:
        if enumerator:
            method(enumerator, 2)(enumerator)
        ole32.CoUninitialize()
