"""Resolve Windows audio endpoint labels to PortAudio devices after sounddevice is installed."""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import sounddevice as sd
from audio_devices import legacy_id


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", value).casefold())


def resolve(label: str, direction: str) -> str:
    target = normalized(label)
    if len(label) > 256 or len(target) < 4:
        raise ValueError(f"Ungültige {direction}-Auswahl")
    channel_key = f"max_{direction}_channels"
    choices = []
    for device in sd.query_devices():
        if device[channel_key] <= 0:
            continue
        name = str(device["name"])
        name_key = normalized(name)
        if target == name_key or (len(name_key) >= 12 and target.startswith(name_key)):
            host = str(sd.query_hostapis(device["hostapi"])["name"])
            priority = {"MME": 0, "Windows WASAPI": 1, "Windows DirectSound": 2}.get(host, 3)
            choices.append((priority, name, host))
    if not choices:
        raise ValueError(f"{direction.title()}gerät '{label}' wurde nicht als nutzbares Audiogerät gefunden")
    last_error = None
    # MME truncates names to 31 characters, so two endpoints can collapse into one ambiguous MME name; the next
    # backend (WASAPI, DirectSound) usually still tells them apart.
    for _, name, host in sorted(choices):
        selection = f"{name}, {host}"
        try:
            sd.query_devices(selection, direction)
            return selection, legacy_id(sd, selection, direction)
        except (ValueError, sd.PortAudioError) as exc:
            last_error = exc
    raise ValueError(f"{direction.title()}gerät '{label}' ist nicht eindeutig nutzbar: {last_error}")


def choose(label: str, direction: str):
    # A device that cannot be resolved must not stop the installation: the Windows default works everywhere and the
    # device can be changed later in the dashboard (Einstellungen -> Sprache). Seen on a real fresh install 2026-11-01.
    try:
        return resolve(label, direction)
    except (ValueError, sd.PortAudioError) as exc:
        print(f"Hinweis: {exc}. Verwende das Windows-Standardgerät; änderbar im Dashboard unter Einstellungen > Sprache.")
        return None, None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    parser.add_argument("--input-name", default="")
    parser.add_argument("--output-name", default="")
    args = parser.parse_args()
    if not args.input_name and not args.output_name:
        return
    with args.config.open(encoding="utf-8") as handle:
        config = json.load(handle)
    for direction, label in (("input", args.input_name), ("output", args.output_name)):
        if not label:
            continue
        selection, device_id = choose(label, direction)
        config[f"{direction}_device"] = selection
        config[f"{direction}_device_id"] = device_id
    selected_input = config.get("input_device")
    selected_output = config.get("output_device")
    with args.config.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"Audiogeräte: Mikrofon={selected_input or 'Windows-Standard'}, Lautsprecher={selected_output or 'Windows-Standard'}")


if __name__ == "__main__":
    # The installer pipes this output through a cp1252 console; a character outside it must not crash the step.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(errors="replace")
    try:
        main()
    except (OSError, ValueError, sd.PortAudioError) as exc:
        print(f"Audiogeräte konnten nicht ausgewählt werden: {exc}", file=sys.stderr)
        raise SystemExit(1)
