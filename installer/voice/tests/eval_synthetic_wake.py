"""Synthetischer Benchmark fuer die persoenliche Wake-Word-Erkennung (Stufe 1) - KEIN Ersatz fuer Echtaufnahmen.

Eine Piper-Stimme ("Owner") spielt den Nutzer: 26x "Hey <Name>", 18x "<Name>" (Tempo, Tonhoehe, Lautstaerke, Rauschen,
Hall variiert), 15 aehnlich klingende Gegenbeispiele und 8 Lesetexte werden wie beim Enrollment verarbeitet
(`build_personal_wake.py`: Kreuzvalidierung -> Schwelle -> Training). Optional liefert eine zweite Piper-Stimme
("Helfer", wie die Standardstimme im Installer) Zusatzbeispiele. Gemessen wird auf zurueckgehaltenen Daten.

Aufruf (Venv mit openwakeword, onnxruntime, piper-tts, scipy, scikit-learn):
  python eval_synthetic_wake.py --models <dir mit melspectrogram.onnx+embedding_model.onnx> --voices <dir mit *.onnx> \\
      --owner-voice <stem> [--helper-voice <stem>] [--name Friday] [--seed 7] [--json out.json]
"""
import argparse
import glob
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import negative_texts  # noqa: E402
import personal_wake as pw  # noqa: E402

SR = 16000
REAL_WEIGHT = 3.0
ENROLL_PASSAGES = [
    "Guten Morgen. Bitte fasse mir die wichtigsten E-Mails von heute zusammen und sag mir, welche Termine am "
    "Nachmittag anstehen. Wenn ein Kunde dringend geantwortet hat, markiere das bitte.",
    "Ich moechte eine Recherche zu drei Wettbewerbern starten. Vergleiche Preise, Sortiment und Bewertungen und "
    "erstelle daraus eine kurze Uebersicht mit einer klaren Empfehlung.",
    "Erinnere mich morgen um acht Uhr an den Anruf mit dem Steuerberater. Danach brauche ich eine Liste aller "
    "offenen Rechnungen und die Fristen fuer Skonto.",
    "Wie wird das Wetter am Wochenende? Falls es regnet, verschiebe den Ausflug auf Sonntag und schreib eine kurze "
    "Nachricht an die Familie.",
    "Oeffne die Praesentation vom letzten Quartal, aktualisiere die Umsatzzahlen und passe die Diagramme an. Die "
    "Folien sollen schlicht und professionell aussehen.",
    "Zaehle bitte langsam: eins, zwei, drei, vier, fuenf, sechs, sieben, acht, neun, zehn. Und jetzt das Alphabet: "
    "A, B, C, D, E, F, G, H, I, J, K, L, M.",
    "Erzaehl mir frei etwas: Was hast du heute gemacht, was steht diese Woche noch an, und worauf freust du dich? "
    "Sprich einfach natuerlich weiter, bis die Zeit abgelaufen ist.",
    "Starte bitte den Hintergrundtask und melde dich, sobald das Ergebnis da ist. Stopp. Abbrechen. Wie ist der "
    "Status? Und wie viel Uhr ist es gerade?",
]
TEST_TEXTS_DE = [   # nicht im Training (weder Enrollment noch negative_texts)
    "Am Donnerstag habe ich einen Termin beim Optiker, danach gehe ich noch kurz in die Stadtbibliothek.",
    "Ob wir den Urlaub im Norden oder im Sueden verbringen, wollen wir erst im Maerz entscheiden.",
    "Die Tomatensuppe war ausgezeichnet, ich haette gern noch einen kleinen Teller davon gehabt.",
    "Er hat das Fahrrad repariert, jetzt laufen die Bremsen wieder ganz leise und zuverlaessig.",
    "Sag mir bitte Bescheid, wenn die Pakete angekommen sind, dann hole ich sie direkt ab.",
    "Waehrend draussen der Wind pfiff, haben wir drinnen Karten gespielt und Tee getrunken.",
]
TEST_TEXTS_EN = ["The quick brown fox jumps over the lazy dog while the evening traffic slowly builds up downtown.",
                 "Please remind me to call the pharmacy tomorrow morning and then send the report to the team."]


def run(args):
    t_all = time.time()
    rng = np.random.default_rng(args.seed)
    name = args.name
    voices = {os.path.splitext(os.path.basename(p))[0]: p
              for p in glob.glob(os.path.join(args.voices, "**", "*.onnx"), recursive=True)}
    owner = pw.PiperSynth(voices[args.owner_voice])
    helper = pw.PiperSynth(voices[args.helper_voice]) if args.helper_voice else None
    others = [pw.PiperSynth(p) for s, p in sorted(voices.items()) if s not in (args.owner_voice, args.helper_voice)]
    embedder = pw.ClipEmbedder(os.path.join(args.models, "melspectrogram.onnx"),
                               os.path.join(args.models, "embedding_model.onnx"))

    def embed(audio, positive=False, weight=1.0):
        rows, start = embedder.embed(audio, rng)
        return pw.Clip(rows, start, pw.voiced_bounds(audio) if positive else None, weight)

    def say(voice, text, **kw):
        return pw.augment(voice.say(text, rng), rng, **kw)

    # ---- Enrollment des "Nutzers"
    hey = [embed(say(owner, pw.wake_phrase(name)), True, REAL_WEIGHT) for _ in range(26)]
    bare = [embed(say(owner, pw.display_name(name)), True, REAL_WEIGHT) for _ in range(18)]
    words = [embed(say(owner, w), False, REAL_WEIGHT) for w in pw.hard_negatives(name)]
    speech = [embed(say(owner, t, place=False), False, REAL_WEIGHT) for t in ENROLL_PASSAGES]
    extra = ([], [], [])
    if helper:
        extra = pw.synthetic_clips(helper, embedder, name, negative_texts.SENTENCES_DE, rng)

    t = time.time()
    cal = pw.cross_validate(hey, bare, words, speech, extra=extra)
    model = pw.train_window_model(hey + extra[0], bare + extra[1], words + speech + extra[2])
    train_s = time.time() - t
    thr = cal["threshold"]

    def peak(audio):
        rows, start = embedder.embed(audio, rng)
        return model.peak(rows, start + 8)

    # ---- zurueckgehaltene Tests
    t_hey = [peak(say(owner, pw.wake_phrase(name))) for _ in range(60)]
    t_bare = [peak(say(owner, pw.display_name(name))) for _ in range(40)]
    t_sent = [peak(say(owner, f"{pw.wake_phrase(name)}, wie spaet ist es?")) for _ in range(20)]
    o_hey = [peak(say(v, pw.wake_phrase(name))) for v in others for _ in range(10)]
    t_neg = [peak(say(owner, w)) for w in pw.hard_negatives(name) * 3]
    o_neg = [peak(say(v, w)) for v in others for w in pw.hard_negatives(name)]
    noise = [peak(rng.standard_normal(2 * SR).astype(np.float32) * s) for s in (0.001, 0.01, 0.05, 0.2)]
    seconds, triggers = 0.0, 0
    for v in [owner] + others:
        for text in TEST_TEXTS_DE + (TEST_TEXTS_EN if v is not owner else []):
            audio = say(v, text, place=False)
            rows, start = embedder.embed(audio, rng)
            sc = model.window_scores(rows, np.arange(start + 8, len(rows)))
            seconds += len(sc) * pw.FRAME_S
            triggers += int(np.sum((sc[1:] >= thr) & (sc[:-1] < thr)) + (sc[0] >= thr))

    def acc(xs):
        return round(float(np.mean(np.asarray(xs) >= thr)), 3)

    result = {
        "SYNTHETIC": True, "name": name, "owner_voice": args.owner_voice, "helper_voice": args.helper_voice,
        "other_voices": [v.stem for v in others], "seed": args.seed, "threshold_logit": thr, "calibration": cal,
        "accept_owner_hey_name": {"n": len(t_hey), "rate": acc(t_hey)},
        "accept_owner_bare_name": {"n": len(t_bare), "rate": acc(t_bare)},
        "accept_owner_hey_name_plus_command": {"n": len(t_sent), "rate": acc(t_sent)},
        "accept_other_voices_hey_name": {"n": len(o_hey), "rate": acc(o_hey),
                                         "note": "Stufe 1 ist nicht sprecherspezifisch, ECAPA filtert danach"},
        "false_accept_similar_words_owner": {"n": len(t_neg), "rate": acc(t_neg)},
        "false_accept_similar_words_other_voices": {"n": len(o_neg), "rate": acc(o_neg)},
        "false_accept_noise_clips": {"n": len(noise), "rate": acc(noise)},
        "running_speech": {"seconds": round(seconds), "stage1_triggers": triggers,
                           "triggers_per_hour": round(triggers / seconds * 3600, 1)},
        "train_seconds": round(train_s), "runtime_seconds": round(time.time() - t_all),
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--owner-voice", required=True)
    ap.add_argument("--helper-voice")
    ap.add_argument("--name", default="Friday")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--json")
    run(ap.parse_args())
