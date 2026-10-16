import os
import json
import sqlite3
import sys

VOICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if VOICE not in sys.path:
    sys.path.insert(0, VOICE)

from model_routing import load_dashboard_voice_routing, route_request


def test_routine_default_and_credential_state_are_separate():
    decision = route_request("Wie spät ist es?")
    assert decision["route"] == "cloud_low"
    assert decision["model"] == "kimi-for-coding"
    assert decision["tier"] == "routine"
    assert decision["credential_status"] == "unknown"
    assert not decision["needs_confirmation"]


def test_complex_request_uses_configured_provider_model():
    decision = route_request(
        "Analysiere diesen Fehler und begründe die Ursache",
        provider="openai",
        models={"openai": {"cloud_high": "configured-fast-reasoner"}},
        credentials_available=True,
    )
    assert decision["tier"] == "complex"
    assert decision["route"] == "cloud_high"
    assert decision["model"] == "configured-fast-reasoner"
    assert decision["credential_status"] == "available"


def test_high_impact_request_routes_max_and_requires_confirmation():
    decision = route_request(
        "Kritische Entscheidung: buche den Termin und sende die Bestätigung",
        provider="anthropic",
        models={"cloud_max": "chosen-model"},
        credentials_available=False,
    )
    assert decision["route"] == "cloud_max"
    assert decision["tier"] == "critical"
    assert decision["needs_confirmation"]
    assert decision["priority"] == "P1"
    assert decision["credential_status"] == "missing"
    assert "confirmation" in decision["answer"].lower()


def test_side_effect_confirmation_does_not_require_complex_cue():
    decision = route_request("Ruf Alex an", models={"cloud_low": "fast"})
    assert decision["tier"] == "routine"
    assert decision["needs_confirmation"]
    assert decision["route"] == "cloud_low"
    assert route_request("Schicke eine Mail")["needs_confirmation"]


def test_background_and_missing_provider_model_are_reported():
    decision = route_request("Erledige das im Hintergrund", provider="openai")
    assert decision["background"]
    assert decision["model"] is None
    assert "No model ID" in decision["answer"]


def test_invalid_provider_is_rejected():
    try:
        route_request("Hello", provider="kimi")
    except ValueError as exc:
        assert "provider" in str(exc)
    else:
        raise AssertionError("unknown provider should fail closed")


def test_document_and_presentation_creation_use_complex_tier():
    decision = route_request("Erstelle eine PowerPoint-Präsentation und einen Bericht")
    assert decision["route"] == "cloud_high" and decision["tier"] == "complex"


def test_financial_calendar_and_posting_actions_require_confirmation():
    for text in (
        "Überweise 20 Euro",
        "Zahle die Rechnung",
        "Verschiebe den Termin",
        "Poste die Nachricht",
    ):
        assert route_request(text)["needs_confirmation"], text
    assert not route_request("Teile mir mit, wann du Zeit hast")["needs_confirmation"]


def test_unknown_long_and_multistep_requests_use_complex_tier():
    long_request = (
        "Bitte prüfe alle verfügbaren Informationen zu diesem Thema und fasse danach "
        "die wichtigsten Unterschiede, Hintergründe und möglichen nächsten Schritte "
        "für mich in einer verständlichen Übersicht zusammen"
    )
    assert route_request(long_request)["route"] == "cloud_high"
    assert route_request("Ordne diese Aufgaben und erledige sie danach in Reihenfolge") ["tier"] == "complex"


def test_dashboard_voice_routes_are_read_only_and_provider_specific(tmp_path):
    db_path = tmp_path / "dashboard.sqlite"
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE settings_areas (area TEXT PRIMARY KEY, json TEXT NOT NULL)")
        db.execute(
            "INSERT INTO settings_areas VALUES (?, ?)",
            ("modelsRouting", json.dumps({
                "defaultModel": "openai:user-selected-fast",
                "routes": [
                    {"taskKind": "voice-complex", "model": "anthropic:user-selected-strong"},
                    {"taskKind": "voice-critical", "model": "not-a-provider:model"},
                ],
            })),
        )
    targets = load_dashboard_voice_routing(db_path)
    assert targets == {
        "cloud_low": ("openai", "user-selected-fast"),
        "cloud_high": ("anthropic", "user-selected-strong"),
        "cloud_max": ("openai", "user-selected-fast"),
    }
    assert not (tmp_path / "dashboard.sqlite-journal").exists()


def test_dashboard_voice_routes_fall_back_when_database_is_missing_or_old(tmp_path):
    db_path = tmp_path / "missing.sqlite"
    fallback = {"cloud_low": "custom-fast", "cloud_high": "custom-strong"}
    expected = {
        "cloud_low": ("kimi-coding", "custom-fast"),
        "cloud_high": ("kimi-coding", "custom-strong"),
        "cloud_max": ("kimi-coding", "k3"),
    }
    assert load_dashboard_voice_routing(db_path, fallback_models=fallback) == expected
    assert not db_path.exists()
    with sqlite3.connect(db_path) as db:
        db.execute("CREATE TABLE settings_areas (area TEXT PRIMARY KEY, json TEXT NOT NULL)")
        db.execute("INSERT INTO settings_areas VALUES (?, ?)", ("modelsRouting", json.dumps({"defaultModel": "Kimi K3", "routes": []})))
    assert load_dashboard_voice_routing(db_path, fallback_models=fallback) == expected
