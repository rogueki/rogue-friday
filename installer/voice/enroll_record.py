"""Gefuehrte Aufnahme fuer JARVIS: Wake-Word-Samples, Sprecher-Enrollment, harte Negativbeispiele.

Speichert 16 kHz Mono WAVs unter profiles/owner/raw/<block>/. Biometrische Daten bleiben lokal.
"""
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
RAW = os.path.join(ROOT, "profiles", "owner", "raw")
MANIFEST = os.path.join(RAW, "manifest.jsonl")

WAKE_BLOCKS = [
    ("wake_hey_jarvis", "Hey Jarvis", [
        ("normal, ca. 50 cm vom Laptop", 8),
        ("leise", 4),
        ("laut / bestimmt", 4),
        ("ca. 1-2 m entfernt (aufstehen oder zuruecklehnen)", 6),
        ("schnell/beilaeufig, wie im Alltag", 4),
    ]),
    ("wake_jarvis", "Jarvis", [
        ("normal", 8),
        ("leise oder aus 1-2 m", 6),
        ("fragend, z. B. 'Jarvis?'", 4),
    ]),
]

NEGATIVES = [
    "Hey Charles", "Harvest", "Hey Davis", "Service", "Hey Travis", "Jahres", "Hey Chris",
    "Marvin", "Hey Janis", "Paris", "Carlos", "Garnix", "Hey Jakob", "Hier ja", "Hey, wie geht's",
]

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
    "Jarvis, starte bitte den Hintergrundtask und melde dich, sobald das Ergebnis da ist. "
    "Jarvis, stopp. Jarvis, abbrechen. Jarvis, wie ist der Status?",
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
    print("=" * 70)
    print(" JARVIS - Stimmaufnahme (alles bleibt lokal auf diesem Rechner)")
    print("=" * 70)
    print(f" Mikrofon: {sd.query_devices(kind='input')['name']}")
    print(" Ruhige Umgebung, normal sprechen. Nach jedem Piepton sprechen.")

    pause("SCHRITT 0: Pegeltest - nach dem Piepton 3 Sekunden normal sprechen.")
    beep()
    peak, rms = level(record(3))
    print(f"  Pegel: peak {peak:.2f}, rms {rms:.3f}")
    if peak < 0.05:
        print("  WARNUNG: sehr leise. Mikrofon in Windows-Soundeinstellungen pruefen (Pegel ~80-100%).")

    for block, text, phases in WAKE_BLOCKS:
        idx = len([f for f in os.listdir(os.path.join(RAW, block))]) if os.path.isdir(os.path.join(RAW, block)) else 0
        for hint, count in phases:
            pause(f"SCHRITT Wake Word '{text}' - Variante: {hint}  ({count} Aufnahmen)")
            for _ in range(count):
                idx += 1
                capture_short(block, idx, text, hint)

    pause("SCHRITT Gegenbeispiele: aehnlich klingende Woerter, NICHT das Wake Word (je 2 s).")
    for i, word in enumerate(NEGATIVES, 1):
        capture_short("negatives", i, word, "Gegenbeispiel")

    pause("SCHRITT Sprecherprofil: 8 Texte vorlesen, je 20 Sekunden. Natuerlich sprechen; "
          "wenn der Text vor Ablauf fertig ist, einfach frei weiterreden.")
    for i, text in enumerate(PASSAGES, 1):
        print(f"\n  Text {i}/{len(PASSAGES)}:\n\n    {text}\n")
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
