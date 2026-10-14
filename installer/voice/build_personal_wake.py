"""Baut das persoenliche Wake Word (Engine "personal") aus den Enrollment-Aufnahmen.

Ersetzt train_owner_verifier.py fuer jeden Namen ausser "Jarvis" (dafuer bleibt der vortrainierte
openWakeWord-Weg samt Owner-Verifier). Eingaben (profiles/owner/raw): wake_hey_<slug>, wake_<slug>, negatives, speech.
Ausgaben (models/openwakeword): personal_wake.npz (Fenstermodell) und personal_wake.json (Schwelle, Kalibrierung).
Biometrische Daten und Aufnahmen bleiben lokal.

Aufruf: python build_personal_wake.py [<C:\\Jarvis>]
"""
import datetime
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import negative_texts  # noqa: E402
import personal_wake as pw  # noqa: E402

JARVIS = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(ROOT)
RAW = os.path.join(ROOT, "profiles", "owner", "raw")
OWW = os.path.join(JARVIS, "models", "openwakeword")
MIN_HEY, MIN_BARE = 12, 8
REAL_WEIGHT = 3.0   # eigene Aufnahmen zaehlen dreifach gegenueber den mit Piper erzeugten Zusatzbeispielen


def load(path: str) -> np.ndarray:
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != pw.SR:
        raise SystemExit(f"{path}: {sr} Hz statt {pw.SR} Hz")
    return audio


def embed_dir(embedder, pattern: str, positive: bool) -> list:
    clips = []
    for path in sorted(glob.glob(pattern)):
        audio = load(path)
        bounds = pw.voiced_bounds(audio) if positive else None
        if positive and bounds is None:
            print(f"   uebersprungen (nichts gehoert): {os.path.basename(path)}")
            continue
        rows, start = embedder.embed(audio)
        clips.append(pw.Clip(rows, start, bounds, weight=REAL_WEIGHT))
    return clips


def piper_extras(embedder, name: str):
    """Zusatzbeispiele mit der installierten Piper-Stimme (Positive "Hey <Name>"/"<Name>", Negative: aehnliche Woerter
    und neutrale Saetze). Fehlt die Stimme oder scheitert die Synthese, laeuft das Training nur mit den eigenen
    Aufnahmen weiter - mit sichtbarem Hinweis."""
    try:
        with open(os.path.join(JARVIS, "config", "voice.json"), encoding="utf-8-sig") as f:
            voice_path = json.load(f)["tts_voice"]
        print("   Erzeuge Zusatzbeispiele mit der lokalen Piper-Stimme ...", flush=True)
        synth = pw.PiperSynth(voice_path)
        return pw.synthetic_clips(synth, embedder, name, negative_texts.SENTENCES_DE, np.random.default_rng(1234))
    except Exception as exc:  # noqa: BLE001  Zusatzdaten sind optional, der Grund wird gemeldet
        print(f"   Hinweis: Piper-Zusatzbeispiele nicht verfuegbar ({type(exc).__name__}: {str(exc)[:120]}) - "
              "Training nur mit den eigenen Aufnahmen.")
        return [], [], []


def main() -> None:
    name = pw.resolve_assistant_name(os.path.join(JARVIS, "config"))
    slug = pw.slugify(name)
    if slug == "jarvis":
        raise SystemExit("Name 'Jarvis' nutzt das vortrainierte Modell (train_owner_verifier.py), nicht dieses Skript.")
    print(f"Persoenliches Wake Word fuer '{name}' ({pw.wake_phrase(name)}) ...", flush=True)
    embedder = pw.ClipEmbedder(os.path.join(OWW, "melspectrogram.onnx"), os.path.join(OWW, "embedding_model.onnx"))
    hey = embed_dir(embedder, os.path.join(RAW, f"wake_hey_{slug}", "*.wav"), True)
    bare = embed_dir(embedder, os.path.join(RAW, f"wake_{slug}", "*.wav"), True)
    words = embed_dir(embedder, os.path.join(RAW, "negatives", "*.wav"), False)
    speech = embed_dir(embedder, os.path.join(RAW, "speech", "*.wav"), False)
    print(f"   Aufnahmen: {len(hey)}x '{pw.wake_phrase(name)}', {len(bare)}x '{pw.display_name(name)}', "
          f"{len(words)} Gegenbeispiele, {len(speech)} Lesetexte")
    if len(hey) < MIN_HEY or len(bare) < MIN_BARE or not speech:
        raise SystemExit(f"Zu wenige Aufnahmen (mind. {MIN_HEY}x '{pw.wake_phrase(name)}', {MIN_BARE}x "
                         f"'{pw.display_name(name)}', Lesetexte) - enroll_record.py vollstaendig durchlaufen.")

    extra = piper_extras(embedder, name)
    print(f"   Zusatzbeispiele: {len(extra[0]) + len(extra[1])} positiv, {len(extra[2])} negativ", flush=True)
    print("   Kalibriere die Schwelle (Kreuzvalidierung auf ungesehenen Aufnahmen) ...", flush=True)
    cal = pw.cross_validate(hey, bare, words, speech, extra=extra)
    model = pw.train_window_model(hey + extra[0], bare + extra[1], words + speech + extra[2])
    os.makedirs(OWW, exist_ok=True)
    model.save(os.path.join(OWW, "personal_wake.npz"))
    pw.save_meta(os.path.join(OWW, "personal_wake.json"), {
        "assistant_name": name, "slug": slug, "wake_phrase": pw.wake_phrase(name), "engine": "personal",
        "threshold": cal["threshold"], "quality": cal["quality"], "calibration": cal,
        "clips": {"hey": len(hey), "bare": len(bare), "negatives": len(words), "speech": len(speech),
                  "synthetic_pos": len(extra[0]) + len(extra[1]), "synthetic_neg": len(extra[2])},
        "created": datetime.datetime.now().isoformat(timespec="seconds"),
    })
    print(f"   Schwelle {cal['threshold']} | Trefferquote ungesehen ~{(1 - cal['frr_cv']) * 100:.0f} % | "
          f"aehnliche Woerter durchgelassen {(cal['far_words_cv'] or 0) * 100:.0f} % | Qualitaet: {cal['quality']}")
    print(f"WAKE_QUALITY={cal['quality']}")
    print("Wake-Word-Modell gespeichert")


if __name__ == "__main__":
    main()
