"""Gefuehrte Aufnahme fuer den Assistenten: Wake-Word-Samples, Sprecher-Enrollment, harte Negativbeispiele.

Aufruf: python enroll_record.py [--name Friday]   (ohne --name: assistant_name aus ../config/persona.json, sonst Friday)
Speichert 16 kHz Mono WAVs unter profiles/owner/raw/<block>/. Biometrische Daten bleiben lokal.
Ordner der Wake-Blocks: wake_hey_<slug> und wake_<slug> (slug = ASCII-Kleinschreibung des Namens, "Jarvis" -> jarvis).
"""
import argparse
import datetime
import json
import os
import sys
import time
import winsound

import numpy as np
import sounddevice as sd
import soundfile as sf

SR = 16000
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
RAW = os.path.join(ROOT, "profiles", "owner", "raw")
MANIFEST = os.path.join(RAW, "manifest.jsonl")
DEFAULT_NAME = "Friday"

import personal_wake  # noqa: E402  (gleicher Ordner: slugify, hard_negatives)


def assistant_name() -> str:
    """--name, sonst persona.json, sonst Friday. Ungueltige Namen brechen ab (der Installer prueft sie vorher)."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--name")
    name = ap.parse_args().name
    if not name:
        try:
            with open(os.path.join(ROOT, "..", "config", "persona.json"), encoding="utf-8-sig") as f:
                name = json.load(f).get("assistant_name")
        except (OSError, ValueError):
            name = None
    name = (name or DEFAULT_NAME).strip()
    if not personal_wake.valid_name(name):
        raise SystemExit(f"Ungueltiger Assistentenname '{name}' (2-20 Buchstaben).")
    return personal_wake.display_name(name)


def wake_blocks(name: str, slug: str) -> list:
    return [
        (f"wake_hey_{slug}", personal_wake.wake_phrase(name), [
            ("normal, ca. 50 cm vom Laptop", 8),
            ("leise", 4),
            ("laut / bestimmt", 4),
            ("ca. 1-2 m entfernt (aufstehen oder zuruecklehnen)", 6),
            ("schnell/beilaeufig, wie im Alltag", 4),
        ]),
        (f"wake_{slug}", name, [
            ("normal", 8),
            ("leise oder aus 1-2 m", 6),
            (f"fragend, z. B. '{name}?'", 4),
        ]),
    ]


def passages(name: str) -> list:
    """Lesetexte. Der Name kommt nur beim Jarvis-Weg (Verifier-Training, unveraendert) im Text vor: beim persoenlichen
    Wake Word wuerden Namensnennungen in den Lesetexten als falsche Negativbeispiele kalibriert."""
    texts = list(PASSAGES)
    if personal_wake.slugify(name) == "jarvis":
        texts[-1] = (f"{name}, starte bitte den Hintergrundtask und melde dich, sobald das Ergebnis da ist. "
                     f"{name}, stopp. {name}, abbrechen. {name}, wie ist der Status?")
    return texts


PASSAGES = [
    "Guten Morgen. Bitte fasse mir die wichtigsten E-Mails von heute zusammen und sag mir, "
    "welche Termine am Nachmittag anstehen. Wenn ein Kunde dringend geantwortet hat, markiere das bitte.",
    "Ich moechte eine Recherche zu drei Wettbewerbern starten. Vergleiche Preise, Sortiment und "
    "Bewertungen und erstelle daraus eine kurze Uebersicht mit einer klaren Empfehlung.",
    "Erinnere mich morgen um acht Uhr an den Anruf mit dem Steuerberater. Danach brauche ich "
    "eine Liste aller offenen Rechnungen und die Fristen fuer Skonto.",
    "Wie wird das Wetter am Wochenende? Falls es regnet, verschiebe den Ausflug auf Sonntag "
    "und schreib eine kurze Nachricht an die Familie.",
    "Oeffne die Praesentation vom letzten Quartal, aktualisiere die Umsatzzahlen und passe "
    "die Diagramme an. Die Folien sollen schlicht und professionell aussehen.",
    "Zaehle bitte langsam: eins, zwei, drei, vier, fuenf, sechs, sieben, acht, neun, zehn. "
    "Und jetzt das Alphabet: A, B, C, D, E, F, G, H, I, J, K, L, M.",
    "Erzaehl mir frei etwas: Was hast du heute gemacht, was steht diese Woche noch an, "
    "und worauf freust du dich? Sprich einfach natuerlich weiter, bis die Zeit abgelaufen ist.",
    "Starte bitte den Hintergrundtask und melde dich, sobald das Ergebnis da ist. "
    "Stopp. Abbrechen. Wie ist der Status? Und wie viel Uhr ist es gerade?",
]


def beep() -> None:
    winsound.Beep(1200, 120)


def record(seconds: float) -> np.ndarray:
    audio = sd.rec(int(seconds * SR), samplerate=SR, channels=1, dtype="float32")
    sd.wait()
    return audio[:, 0]


def save(block: str, idx: int, audio: np.ndarray, meta: dict) -> str:
    os.makedirs(os.path.join(RAW, block), exist_ok=True)
    path = os.path.join(RAW, block, f"{block}_{idx:03d}.wav")
    sf.write(path, audio, SR, subtype="PCM_16")
    with open(MANIFEST, "a", encoding="utf-8") as f:
        f.write(json.dumps({"file": os.path.relpath(path, RAW), "block": block,
                            "time": datetime.datetime.now().isoformat(timespec="seconds"), **meta},
                           ensure_ascii=False) + "\n")
    return path


def level(audio: np.ndarray) -> tuple[float, float]:
    return float(np.max(np.abs(audio))), float(np.sqrt(np.mean(audio ** 2)))


def capture_short(block: str, idx: int, text: str, hint: str, seconds: float = 2.0) -> None:
    while True:
        print(f"\n  [{idx:02d}] ({hint})  Gleich sagen:  >>> {text} <<<")
        time.sleep(0.8)
        beep()
        print("      JETZT sprechen ...", flush=True)
        audio = record(seconds)
        peak, rms = level(audio)
        if peak < 0.03:
            print(f"      Zu leise/nichts gehoert (peak {peak:.3f}) - nochmal.")
            continue
        if peak > 0.99:
            print("      Uebersteuert - etwas leiser oder weiter weg, nochmal.")
            continue
        save(block, idx, audio, {"text": text, "hint": hint, "peak": round(peak, 3), "rms": round(rms, 4)})
        print(f"      ok (peak {peak:.2f})")
        return


def pause(msg: str) -> None:
    input(f"\n{msg}\n  -> Enter druecken, wenn bereit ... ")


def main() -> None:
    name = assistant_name()
    slug = personal_wake.slugify(name)
    texts = passages(name)
    print("=" * 70)
    print(f" {name} - Stimmaufnahme (alles bleibt lokal auf diesem Rechner)")
    print("=" * 70)
    print(f" Mikrofon: {sd.query_devices(kind='input')['name']}")
    print(" Ruhige Umgebung, normal sprechen. Nach jedem Piepton sprechen.")

    pause("SCHRITT 0: Pegeltest - nach dem Piepton 3 Sekunden normal sprechen.")
    beep()
    peak, rms = level(record(3))
    print(f"  Pegel: peak {peak:.2f}, rms {rms:.3f}")
    if peak < 0.05:
        print("  WARNUNG: sehr leise. Mikrofon in Windows-Soundeinstellungen pruefen (Pegel ~80-100%).")

    for block, text, phases in wake_blocks(name, slug):
        idx = len([f for f in os.listdir(os.path.join(RAW, block))]) if os.path.isdir(os.path.join(RAW, block)) else 0
        for hint, count in phases:
            pause(f"SCHRITT Wake Word '{text}' - Variante: {hint}  ({count} Aufnahmen)")
            for _ in range(count):
                idx += 1
                capture_short(block, idx, text, hint)

    pause("SCHRITT Gegenbeispiele: aehnlich klingende Woerter, NICHT das Wake Word (je 2 s).")
    for i, word in enumerate(personal_wake.hard_negatives(name), 1):
        capture_short("negatives", i, word, "Gegenbeispiel")

    pause("SCHRITT Sprecherprofil: 8 Texte vorlesen, je 20 Sekunden. Natuerlich sprechen; "
          "wenn der Text vor Ablauf fertig ist, einfach frei weiterreden.")
    for i, text in enumerate(texts, 1):
        print(f"\n  Text {i}/{len(texts)}:\n\n    {text}\n")
        input("  -> Enter, dann nach dem Piepton vorlesen ... ")
        beep()
        print("      Aufnahme laeuft (20 s) ...", flush=True)
        audio = record(20)
        peak, rms = level(audio)
        save("speech", i, audio, {"text": text, "peak": round(peak, 3), "rms": round(rms, 4)})
        print(f"      gespeichert (peak {peak:.2f})")

    print("\n" + "=" * 70)
    print(" FERTIG - danke! Dieses Fenster kann geschlossen werden.")
    print("=" * 70)
    winsound.Beep(800, 150)
    winsound.Beep(1200, 250)
    input()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
