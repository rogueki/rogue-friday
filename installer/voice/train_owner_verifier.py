"""Trainiert den openWakeWord-Custom-Verifier (Owner sagt "Hey Jarvis" vs. Owner sagt etwas anderes)
und schreibt models/openwakeword/hey_jarvis_owner_verifier.joblib."""
import glob
import os

import openwakeword

ROOT = os.path.dirname(os.path.abspath(__file__))
JARVIS = os.path.dirname(ROOT)
RAW = os.path.join(ROOT, "profiles", "owner", "raw")
OWW = os.path.join(JARVIS, "models", "openwakeword")

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
