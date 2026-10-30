"""Erzeugt das Owner-Sprecherprofil (SpeechBrain ECAPA) aus den Enrollment-Texten.

Profil = normierter Mittelwert der Embeddings aus 3-s-Fenstern der speech-Aufnahmen.
Danach Selbsttest: Cosine-Score jeder Wake-Word-Aufnahme gegen das Profil.
"""
import datetime
import glob
import hashlib
import json
import os
import sys

import numpy as np
import soundfile as sf
import torch
from speechbrain.inference.speaker import EncoderClassifier

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
STATE = os.environ.get("FRIDAY_STATE_ROOT", os.path.dirname(ROOT)) if sys.platform == "linux" else os.path.dirname(ROOT)
CONFIG = os.environ.get("FRIDAY_CONFIG_DIR", "/etc/friday") if sys.platform == "linux" else os.path.join(ROOT, "..", "config")
OWNER = os.path.join(STATE, "voice", "profiles", "owner") if sys.platform == "linux" else os.path.join(ROOT, "profiles", "owner")
SR = 16000

import personal_wake  # noqa: E402

PHRASE = personal_wake.resolve_wake_phrase(CONFIG)
WAKE_BLOCKS = [block for block, _, _ in personal_wake.enrollment_blocks(PHRASE)]

enc = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb",
                                     savedir=os.path.join(STATE, "models", "ecapa"))


def embed(audio: np.ndarray) -> np.ndarray:
    with torch.no_grad():
        e = enc.encode_batch(torch.from_numpy(audio).unsqueeze(0)).squeeze().numpy()
    return e / np.linalg.norm(e)


def voiced(audio: np.ndarray, frame: int = 400, thresh: float = 0.01) -> np.ndarray:
    frames = [audio[i:i + frame] for i in range(0, len(audio) - frame, frame)]
    keep = [f for f in frames if np.sqrt(np.mean(f ** 2)) > thresh]
    return np.concatenate(keep) if keep else audio


embs = []
for path in sorted(glob.glob(os.path.join(OWNER, "raw", "speech", "*.wav"))):
    audio, _ = sf.read(path, dtype="float32")
    audio = voiced(audio)
    for start in range(0, len(audio) - 3 * SR, int(1.5 * SR)):
        embs.append(embed(audio[start:start + 3 * SR]))

if len(embs) < 4:
    raise SystemExit("Zu wenige verwertbare Lesefenster fuer das Sprecherprofil")
profile = np.mean(embs, axis=0)
profile /= np.linalg.norm(profile)
wake_embs = []
for block in WAKE_BLOCKS:
    for path in sorted(glob.glob(os.path.join(OWNER, "raw", block, "*.wav"))):
        audio, _ = sf.read(path, dtype="float32")
        frames = [audio[i:i + 320] for i in range(0, len(audio) - 320, 320)]
        live_frames = [f for f in frames if np.sqrt(np.mean(f ** 2)) > 0.02]
        if len(live_frames) >= 25:
            wake_embs.append(embed(np.concatenate(live_frames)))
if wake_embs:
    # Short commands embed differently from 3-s reading windows. Keep both in the owner profile.
    wake_profile = np.mean(wake_embs, axis=0)
    wake_profile /= np.linalg.norm(wake_profile)
    profile += wake_profile
    profile /= np.linalg.norm(profile)
os.makedirs(os.path.join(OWNER, "embeddings"), exist_ok=True)
np.save(os.path.join(OWNER, "embeddings", "owner_ecapa.npy"), profile)
print(f"Profil aus {len(embs)} Lesefenstern und {len(wake_embs)} kurzen Wake-Proben erstellt")
# Kreuzvalidierung: jede Aufnahme gegen Profil aus den uebrigen 7 (Fenster 1,5 s wie im Live-Betrieb)
paths = sorted(glob.glob(os.path.join(OWNER, "raw", "speech", "*.wav")))
cv = []
for i, p in enumerate(paths):
    rest = []
    for j, q in enumerate(paths):
        if j == i:
            continue
        a, _ = sf.read(q, dtype="float32")
        a = voiced(a)
        rest += [embed(a[s:s + 3 * SR]) for s in range(0, len(a) - 3 * SR, 3 * SR)]
    prof = np.mean(rest, axis=0)
    prof /= np.linalg.norm(prof)
    a, _ = sf.read(p, dtype="float32")
    a = voiced(a)
    cv += [float(np.dot(embed(a[s:s + int(1.5 * SR)]), prof)) for s in range(0, len(a) - int(1.5 * SR), int(1.5 * SR))]
cv = np.array(cv)
if not len(cv):
    raise SystemExit("Zu wenige verwertbare Lesefenster fuer die Kreuzvalidierung")
print(f"Kreuzvalidierung 1,5-s-Fenster: n={len(cv)} min={cv.min():.3f} p10={np.percentile(cv, 10):.3f} median={np.median(cv):.3f}")

# Messwerte fuer das Dashboard: Qualitaet = 10-%-Quantil der Kreuzvalidierung (90 % der Live-Fenster liegen darueber).
# Die Pruefsumme bindet die Werte an genau dieses Embedding; ein spaeter ersetztes Profil verliert sie dadurch.
profile_file = os.path.join(OWNER, "embeddings", "owner_ecapa.npy")
with open(profile_file, "rb") as handle:
    profile_sha256 = hashlib.sha256(handle.read()).hexdigest()
meta = {
    "format": 1,
    "profile_sha256": profile_sha256,
    "sample_count": len(embs) + len(wake_embs),
    "quality": round(float(min(1.0, max(0.0, np.percentile(cv, 10)))), 3),
    "calibrated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
meta_file = os.path.join(OWNER, "embeddings", "owner_profile.json")
with open(meta_file + ".tmp", "w", encoding="utf-8") as handle:
    json.dump(meta, handle)
os.replace(meta_file + ".tmp", meta_file)

# Wake-Blocks heissen wake_<slug der Phrase> (+ wake_<slug der Kurzform>), z. B. wake_hey_friday / wake_friday.
for block in (*WAKE_BLOCKS, "negatives"):
    scores = []
    for path in sorted(glob.glob(os.path.join(OWNER, "raw", block, "*.wav"))):
        audio, _ = sf.read(path, dtype="float32")
        scores.append(float(np.dot(embed(voiced(audio, frame=320, thresh=0.02)), profile)))
    if not scores:
        print(f"{block:<18} keine Aufnahmen")
        continue
    s = np.array(scores)
    print(f"{block:<18} n={len(s):<3} score min={s.min():.3f} p10={np.percentile(s, 10):.3f} median={np.median(s):.3f}")
