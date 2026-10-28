"""Gefuehrte Aufnahme fuer den Assistenten: Wake-Word-Samples, Sprecher-Enrollment, harte Negativbeispiele.

Aufruf: python enroll_record.py [--name Friday] [--phrase "Hey Friday"] [--gui] [--interaction-file PFAD]
Ohne Angaben gelten assistant_name/wake_phrase aus ../config/persona.json, sonst Friday / "Hey <Name>".
Speichert 16 kHz Mono WAVs unter profiles/owner/raw/<block>/. Biometrische Daten bleiben lokal.
Ordner der Wake-Blocks: wake_<slug der Phrase> (z. B. wake_hey_friday) und, wenn die Phrase mit einem Grusswort beginnt,
wake_<slug der Kurzform> (wake_friday). Gegenbeispiele leiten sich aus den Woertern der Phrase ab (negatives).

Interaktion: mit --interaction-file laeuft die gesamte Fuehrung ueber die Datei, die der grafische Assistent
liest (Aktionen ok/replay/skip/cancel). Ohne diese Datei bleibt --gui bei kleinen Dialogen und der Rest bei stdin.
"""
import argparse
import datetime
import json
import os
import sys
import time

import numpy as np
import sounddevice as sd
import soundfile as sf

SR = 16000
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
RAW = os.path.join(ROOT, "profiles", "owner", "raw")
MANIFEST = os.path.join(RAW, "manifest.jsonl")
DEFAULT_NAME = "Friday"
GUI_MODE = "--gui" in sys.argv
ARGS = None
CLIENT = None
LAST_SAVED = None


def replay_last() -> None:
    """Spielt die zuletzt gespeicherte Aufnahme erneut ab (Samplewiederholung ohne neues Sprechen)."""
    if not LAST_SAVED or not os.path.isfile(LAST_SAVED):
        print("      Noch keine Aufnahme zum Anhoeren.")
        return
    audio, rate = sf.read(LAST_SAVED, dtype="float32")
    sd.play(audio, rate, blocking=True)


def ready(message: str, *, block: str = "", index: int = 0, total: int = 0,
          detail: str = "", actions: tuple = ("ok", "replay", "cancel")) -> str:
    """Wartet auf die Aktion des Assistenten und gibt sie zurueck ('ok' oder 'skip').

    Mit Interaktionsdatei fuehrt der grafische Assistent; ohne sie bleibt der bisherige Weg
    (kleine Dialoge bei --gui, sonst Enter auf der Konsole). Ein Abbruch beendet die Aufnahme mit 2.
    """
    if CLIENT is not None:
        while True:
            action = CLIENT.ask(message, title="Stimmaufnahme", kind="record", block=block, index=index,
                                total=total, detail=detail, actions=actions, timeout=1800.0)
            if action == "cancel":
                raise SystemExit(2)
            if action == "replay":
                replay_last()
                continue
            return action
    if GUI_MODE:
        from tkinter import messagebox
        if not messagebox.askokcancel("F.R.I.D.A.Y. Stimmaufnahme", message + "\n\nOK startet diese Aufnahme. Abbrechen beendet die Stimmaufnahme."):
            raise SystemExit(2)
        return "ok"
    input(message + "\n  -> Enter druecken, wenn bereit ... ")
    return "ok"

import negative_texts  # noqa: E402
import personal_wake  # noqa: E402  (gleicher Ordner: slugify, hard_negatives, enrollment_blocks)


def _persona_field(key: str):
    try:
        with open(os.path.join(ROOT, "..", "config", "persona.json"), encoding="utf-8-sig") as f:
            return json.load(f).get(key)
    except (OSError, ValueError):
        return None


def assistant_identity() -> tuple[str, str]:
    """(Name, Wake Phrase): --name/--phrase, sonst persona.json, sonst Friday / "Hey <Name>". Ungueltige Angaben brechen
    ab (der Installer prueft sie vorher)."""
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--name")
    ap.add_argument("--phrase")
    ap.add_argument("--gui", action="store_true")
    ap.add_argument("--interaction-file")
    args = ap.parse_args()
    ARGS = args
    name = (args.name or _persona_field("assistant_name") or DEFAULT_NAME).strip()
    if not personal_wake.valid_name(name):
        raise SystemExit(f"Ungueltiger Assistentenname '{name}' (2-20 Buchstaben).")
    name = personal_wake.display_name(name)
    phrase = (args.phrase or _persona_field("wake_phrase") or personal_wake.wake_phrase(name)).strip()
    if not personal_wake.valid_phrase(phrase):
        raise SystemExit(f"Ungueltige Wake Phrase '{phrase}' (1-4 Woerter, Buchstaben/Bindestrich, 3-30 Zeichen).")
    return name, personal_wake.display_phrase(phrase)


def passages(phrase: str) -> list:
    """Lesetexte. Der Name steht nur beim Weg "Hey Jarvis" (Verifier-Training, unveraendert) im Text. Beim persoenlichen
    Wake Word entfallen Saetze mit Woertern der Phrase: sonst wuerden sie als falsche Negativbeispiele gelernt."""
    texts = list(PASSAGES)
    if personal_wake.is_pretrained_phrase(phrase):
        name = personal_wake.short_form(phrase)
        texts[-1] = (f"{name}, starte bitte den Hintergrundtask und melde dich, sobald das Ergebnis da ist. "
                     f"{name}, stopp. {name}, abbrechen. {name}, wie ist der Status?")
        return texts
    return negative_texts.without_phrase_words(texts, phrase)


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


def beep(frequency: int = 1200, duration_ms: int = 550) -> None:
    """Play a Bluetooth-safe cue through the selected default audio output."""
    sample_rate = int(sd.query_devices(kind="output")["default_samplerate"])
    duration_ms = max(duration_ms, 550)
    count = max(1, int(sample_rate * duration_ms / 1000))
    samples = np.arange(count, dtype=np.float32)
    tone = 0.35 * np.sin(2 * np.pi * frequency * samples / sample_rate)
    fade = min(count // 2, int(sample_rate * 0.005))
    if fade:
        envelope = np.linspace(0, 1, fade, dtype=np.float32)
        tone[:fade] *= envelope
        tone[-fade:] *= envelope[::-1]
    # A short silent lead keeps Bluetooth headsets from clipping the cue.
    lead = np.zeros(int(sample_rate * 0.25), dtype=np.float32)
    tail = np.zeros(int(sample_rate * 0.15), dtype=np.float32)
    sd.play(np.concatenate((lead, tone.astype(np.float32), tail)), sample_rate, blocking=True)


def record(seconds: float) -> np.ndarray:
    audio = sd.rec(int(seconds * SR), samplerate=SR, channels=1, dtype="float32")
    sd.wait()
    return audio[:, 0]


def save(block: str, idx: int, audio: np.ndarray, meta: dict) -> str:
    global LAST_SAVED
    os.makedirs(os.path.join(RAW, block), exist_ok=True)
    path = os.path.join(RAW, block, f"{block}_{idx:03d}.wav")
    sf.write(path, audio, SR, subtype="PCM_16")
    with open(MANIFEST, "a", encoding="utf-8") as f:
        f.write(json.dumps({"file": os.path.relpath(path, RAW), "block": block,
                            "time": datetime.datetime.now().isoformat(timespec="seconds"), **meta},
                           ensure_ascii=False) + "\n")
    LAST_SAVED = path
    return path


def level(audio: np.ndarray) -> tuple[float, float]:
    return float(np.max(np.abs(audio))), float(np.sqrt(np.mean(audio ** 2)))


def capture_short(block: str, idx: int, text: str, hint: str, seconds: float = 2.0, total: int = 0) -> bool:
    """Eine kurze Aufnahme. Gibt False zurueck, wenn sie im Assistenten uebersprungen wurde."""
    while True:
        print(f"\n  [{idx:02d}] ({hint})  Gleich sagen:  >>> {text} <<<")
        action = ready(f"Aufnahme {idx}{f' von {total}' if total else ''}: {hint}\n\nSage nach dem Signal: {text}",
                       block=block, index=idx, total=total, detail=hint,
                       actions=("ok", "replay", "skip", "cancel"))
        if action == "skip":
            print("      uebersprungen")
            return False
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
        return True


def pause(msg: str, *, block: str = "", index: int = 0, total: int = 0) -> None:
    ready(msg, block=block, index=index, total=total, actions=("ok", "cancel"))


def main() -> None:
    global CLIENT
    name, phrase = assistant_identity()
    if GUI_MODE:
        try:
            with open(os.path.join(ROOT, "..", "config", "voice.json"), encoding="utf-8") as handle:
                audio_config = json.load(handle)
            sd.default.device = (audio_config.get("input_device"), audio_config.get("output_device"))
        except (OSError, ValueError) as exc:
            raise SystemExit(f"Audiogeraete konnten nicht geladen werden: {exc}")
    if ARGS.interaction_file:
        import gui_interaction
        CLIENT = gui_interaction.InteractionClient(ARGS.interaction_file)
    texts = passages(phrase)
    print("=" * 70)
    print(f" {name} - Stimmaufnahme (alles bleibt lokal auf diesem Rechner)")
    print(f" Wake Word: {phrase}")
    print("=" * 70)
    print(f" Mikrofon: {sd.query_devices(kind='input')['name']}")
    print(" Ruhige Umgebung, normal sprechen. Nach jedem Piepton sprechen.")

    pause("SCHRITT 0: Pegeltest - nach dem Piepton 3 Sekunden normal sprechen.")
    beep()
    peak, rms = level(record(3))
    print(f"  Pegel: peak {peak:.2f}, rms {rms:.3f}")
    if peak < 0.05:
        print("  WARNUNG: sehr leise. Mikrofon in Windows-Soundeinstellungen pruefen (Pegel ~80-100%).")

    for block, text, phases in personal_wake.enrollment_blocks(phrase):
        idx = len([f for f in os.listdir(os.path.join(RAW, block))]) if os.path.isdir(os.path.join(RAW, block)) else 0
        target = 0
        for hint, count in phases:
            target += count
            remaining = max(0, target - idx)
            if not remaining:
                continue
            pause(f"SCHRITT Wake Word '{text}' - Variante: {hint}  ({remaining} Aufnahmen)",
                  block=block, index=idx, total=target)
            for _ in range(remaining):
                idx += 1
                capture_short(block, idx, text, hint, total=target)

    negatives = [(i, word) for i, word in enumerate(personal_wake.hard_negatives(phrase), 1)
                 if not os.path.isfile(os.path.join(RAW, "negatives", f"negatives_{i:03d}.wav"))]
    if negatives:
        pause("SCHRITT Gegenbeispiele: aehnlich klingende Woerter bzw. Teile der Phrase, NICHT das Wake Word (je 2 s).",
              block="negatives", total=len(negatives))
    for i, word in negatives:
        capture_short("negatives", i, word, "Gegenbeispiel", total=len(negatives))

    remaining_texts = [(i, text) for i, text in enumerate(texts, 1)
                       if not os.path.isfile(os.path.join(RAW, "speech", f"speech_{i:03d}.wav"))]
    if remaining_texts:
        pause("SCHRITT Sprecherprofil: 8 Texte vorlesen, je 20 Sekunden. Natuerlich sprechen; "
              "wenn der Text vor Ablauf fertig ist, einfach frei weiterreden.", block="speech", total=len(texts))
    for i, text in remaining_texts:
        print(f"\n  Text {i}/{len(texts)}:\n\n    {text}\n")
        ready(f"Text {i} von {len(texts)}:\n\n{text}", block="speech", index=i, total=len(texts))
        beep()
        print("      Aufnahme laeuft (20 s) ...", flush=True)
        audio = record(20)
        peak, rms = level(audio)
        save("speech", i, audio, {"text": text, "peak": round(peak, 3), "rms": round(rms, 4)})
        print(f"      gespeichert (peak {peak:.2f})")

    print("\n" + "=" * 70)
    print(" FERTIG - danke! Dieses Fenster kann geschlossen werden.")
    print("=" * 70)
    beep(800, 150)
    beep(1200, 250)
    if not GUI_MODE and CLIENT is None:
        input()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
    finally:
        if CLIENT is not None:
            CLIENT.close()
