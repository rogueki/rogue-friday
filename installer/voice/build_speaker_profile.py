"""Erzeugt das Owner-Sprecherprofil (SpeechBrain ECAPA) aus den Enrollment-Texten.

Profil = normierter Mittelwert der Embeddings aus 3-s-Fenstern der speech-Aufnahmen.
Danach Selbsttest: Cosine-Score jeder Wake-Word-Aufnahme gegen das Profil.
"""
import glob
import os
import sys

import numpy as np
import soundfile as sf
import torch
from speechbrain.inference.speaker import EncoderClassifier

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
OWNER = os.path.join(ROOT, "profiles", "owner")
SR = 16000

import personal_wake  # noqa: E402

SLUG = personal_wake.slugify(personal_wake.resolve_assistant_name(os.path.join(ROOT, "..", "config")))

enc = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb",
                                     savedir=os.path.join(ROOT, "..", "models", "ecapa"))


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

profile = np.mean(embs, axis=0)
profile /= np.linalg.norm(profile)
os.makedirs(os.path.join(OWNER, "embeddings"), exist_ok=True)
np.save(os.path.join(OWNER, "embeddings", "owner_ecapa.npy"), profile)
print(f"Profil aus {len(embs)} Fenstern erstellt")
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
print(f"Kreuzvalidierung 1,5-s-Fenster: n={len(cv)} min={cv.min():.3f} p10={np.percentile(cv, 10):.3f} median={np.median(cv):.3f}")

# Wake-Blocks heissen wake_hey_<slug> / wake_<slug> (Jarvis: wake_hey_jarvis / wake_jarvis).
for block in (f"wake_hey_{SLUG}", f"wake_{SLUG}", "negatives"):
    scores = []
    for path in sorted(glob.glob(os.path.join(OWNER, "raw", block, "*.wav"))):
        audio, _ = sf.read(path, dtype="float32")
        scores.append(float(np.dot(embed(voiced(audio, frame=320, thresh=0.02)), profile)))
    if not scores:
        print(f"{block:<18} keine Aufnahmen")
        continue
    s = np.array(scores)
    print(f"{block:<18} n={len(s):<3} score min={s.min():.3f} p10={np.percentile(s, 10):.3f} median={np.median(s):.3f}")
