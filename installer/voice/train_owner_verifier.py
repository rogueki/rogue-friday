"""Wake-Word-Training nach dem Enrollment.

Wake Phrase "Hey Jarvis": trainiert den openWakeWord-Custom-Verifier (Owner sagt "Hey Jarvis" vs. Owner sagt etwas
anderes) und schreibt models/openwakeword/hey_jarvis_owner_verifier.joblib - unveraendert.
Jede andere Phrase (Standard "Hey Friday"): der Verifier kann nur ein vorhandenes Basismodell neu bewerten, keine neue
Phrase erkennen. Stattdessen entsteht das persoenliche Wake Word (build_personal_wake.py).
"""
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
INSTALL_ROOT = os.path.dirname(ROOT)
sys.path.insert(0, ROOT)

import personal_wake  # noqa: E402

PHRASE = personal_wake.resolve_wake_phrase(os.path.join(INSTALL_ROOT, "config"))
if not personal_wake.is_pretrained_phrase(PHRASE):
    sys.exit(subprocess.call([sys.executable, os.path.join(ROOT, "build_personal_wake.py"), INSTALL_ROOT]))

import openwakeword  # noqa: E402

RAW = os.path.join(ROOT, "profiles", "owner", "raw")
OWW = os.path.join(INSTALL_ROOT, "models", "openwakeword")

# Trotz Docstring ("directory") erwartet train_custom_verifier Listen von WAV-Pfaden.
positives = sorted(glob.glob(os.path.join(RAW, "wake_hey_jarvis", "*.wav")))
negatives = sorted(glob.glob(os.path.join(RAW, "speech", "*.wav"))) + sorted(
    glob.glob(os.path.join(RAW, "negatives", "*.wav")))

openwakeword.train_custom_verifier(
    positive_reference_clips=positives,
    negative_reference_clips=negatives,
    output_path=os.path.join(OWW, "hey_jarvis_owner_verifier.joblib"),
    model_name=os.path.join(OWW, "hey_jarvis_v0.1.onnx"),
    inference_framework="onnx",
    melspec_model_path=os.path.join(OWW, "melspectrogram.onnx"),
    embedding_model_path=os.path.join(OWW, "embedding_model.onnx"),
)
print("Verifier gespeichert")
