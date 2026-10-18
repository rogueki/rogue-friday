"""Resolve Windows audio endpoint labels to PortAudio devices after sounddevice is installed."""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import sounddevice as sd


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
        raise ValueError(f"{direction.title()}gerät '{label}' wurde nicht als nutzbares Audiogerät gefunden. Windows-Standardgerät wählen und erneut starten.")
    _, name, host = sorted(choices)[0]
    selection = f"{name}, {host}"
    sd.query_devices(selection, direction)
    return selection


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
    selected_input = resolve(args.input_name, "input") if args.input_name else config.get("input_device")
    selected_output = resolve(args.output_name, "output") if args.output_name else config.get("output_device")
    config["input_device"] = selected_input
    config["output_device"] = selected_output
    with args.config.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"Audiogeräte: Mikrofon={selected_input or 'Windows-Standard'}, Lautsprecher={selected_output or 'Windows-Standard'}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, sd.PortAudioError) as exc:
        print(f"Audiogeräte konnten nicht ausgewählt werden: {exc}", file=sys.stderr)
        raise SystemExit(1)
