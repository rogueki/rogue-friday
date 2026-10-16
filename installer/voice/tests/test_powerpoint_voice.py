import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from powerpoint_voice import PowerPointVoice, parse_command


COMMAND = ("Erstelle eine PowerPoint mit Titel Quartalsbericht und Folie Ergebnisse "
           "mit Punkt eins Umsatz gestiegen und Punkt zwei Kosten gesunken")


def test_parse_readback_and_confirmation_after_tts(tmp_path):
    voice = PowerPointVoice(str(tmp_path))
    calls = []
    voice._request = lambda body, key: calls.append((body, key)) or {"id": "11111111-1111-4111-8111-111111111111"}
    expected = {"title": "Quartalsbericht", "slides": [{"title": "Ergebnisse", "bullets": ["Umsatz gestiegen", "Kosten gesunken"]}]}
    assert parse_command(COMMAND) == expected
    preview = voice.handle(COMMAND)
    assert all(part in preview for part in ("Quartalsbericht", "Ergebnisse", "Umsatz gestiegen", "Kosten gesunken"))
    assert not calls
    assert "unterbrochen" in voice.handle("ja")
    assert not calls
    voice.handle(COMMAND)
    voice.arm_confirmation()
    assert "erstellt" in voice.handle("ja")
    assert len(calls) == 1 and calls[0][0] == expected
    assert voice.handle("ja") is None


def test_cancel_cross_command_expiry_and_uncertain_retry(tmp_path):
    clock = [0.0]
    voice = PowerPointVoice(str(tmp_path), now=lambda: clock[0])
    calls = []

    def request(body, key):
        calls.append(key)
        if len(calls) == 1:
            raise TimeoutError("response lost")
        return {"id": "11111111-1111-4111-8111-111111111111"}

    voice._request = request
    voice.handle(COMMAND)
    voice.arm_confirmation()
    assert "unklar" in voice.handle("ja")
    assert "erstellt" in voice.handle("ja")
    assert len(calls) == 2 and calls[0] == calls[1]
    voice.handle(COMMAND)
    assert "verworfen" in voice.handle("nein")
    assert voice.pending is None
    voice.handle(COMMAND)
    assert voice.handle("Wie spät ist es?") is None
    assert voice.pending is None
    voice.handle(COMMAND)
    clock[0] = 20
    voice.arm_confirmation()
    clock[0] = 111
    assert "abgelaufen" in voice.handle("ja")
    assert len(calls) == 2


def test_rejects_nonsequential_or_oversized_points():
    assert parse_command(COMMAND) is not None
    try:
        parse_command(COMMAND.replace("Punkt zwei", "Punkt vier"))
        assert False, "missing point should fail"
    except ValueError:
        pass
    try:
        parse_command(COMMAND + " und Punkt drei " + "x" * 241)
        assert False, "oversized point should fail"
    except ValueError:
        pass
    try:
        parse_command(COMMAND + " und Punkt sechs zu viel")
        assert False, "sixth point should fail"
    except ValueError:
        pass
