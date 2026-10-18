import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from mail_voice import MailVoice


def test_mail_selection_reply_preview_and_armed_confirmation():
    now = [100.0]
    voice = MailVoice("/synthetic", now=lambda: now[0])
    requests = []

    def fake(method, path, body=None, key=None):
        requests.append((method, path, body, key))
        if path == "mailboxes":
            return {"mailboxes": [{"id": "Inbox", "name": "Inbox", "role": "inbox"}]}, None
        if path.startswith("envelopes?"):
            return {"items": [{"id": "504", "subject": "Synthetic", "from": [{"email": "sender@example.test"}], "flags": []}]}, None
        if path == "voice/preview":
            return {"token": "a" * 40, "fingerprint": "f" * 64,
                    "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=60)).isoformat(),
                    "action": "reply", "to": ["sender@example.test"], "subject": "Re: Synthetic", "body": "Antwort",
                    "mailbox": "Inbox", "id": "504", "destination": ""}, None
        if path == "voice/confirm":
            return {"state": "sent", "replayed": False}, None
        raise AssertionError(path)

    voice._safe = fake
    assert "Synthetic" in voice.handle("Zeige ungelesene Mails")
    assert "Sage Ja oder Nein" in voice.handle("Antworte auf Mail eins mit Antwort")
    assert voice.handle("Ja") == "Die Mailvorschau wurde unterbrochen. Bitte erneut beginnen."
    assert not any(path == "voice/confirm" for _, path, _, _ in requests)
    voice.handle("Antworte auf Mail eins mit Antwort")
    voice.arm_confirmation()
    assert voice.handle("Ja") == "Die E-Mail wurde gesendet."
    assert sum(path == "voice/confirm" for _, path, _, _ in requests) == 1


def test_selection_expires_and_wrong_folder_is_not_guessed():
    now = [100.0]
    voice = MailVoice("/synthetic", now=lambda: now[0])
    voice.results = [{"mailbox": "Inbox", "id": "504"}]
    voice.results_expires = 101.0
    now[0] = 102.0
    assert "suche zuerst" in voice.handle("Markiere Mail eins als wichtig")
    assert voice.results == []


def test_spoken_address_is_normalized_and_read_back_before_confirmation():
    voice = MailVoice("/synthetic")
    assert voice._recipient("max punkt mustermann at example punkt test") == "max.mustermann@example.test"
    assert voice._recipient("Name ät Beispiel dot de") == "name@beispiel.de"
    def fake(method, path, body=None, key=None):
        assert path == "voice/preview"
        assert body["to"] == ["max.mustermann@example.test"]
        return {"token": "a" * 40, "fingerprint": "f" * 64,
                "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=60)).isoformat(),
                "action": "compose", "to": body["to"], "subject": body["subject"], "body": body["body"],
                "mailbox": "", "id": "", "destination": ""}, None
    voice._safe = fake
    answer = voice.handle("Schreibe Mail an max punkt mustermann at example punkt test Betreff Test Text Hallo")
    assert "An max.mustermann@example.test" in answer
    assert voice.pending["armed"] is False


def test_search_sentence_punctuation_and_quoted_phrase_select_same_message():
    voice = MailVoice("/synthetic")
    def fake(method, path, body=None, key=None):
        if path == "mailboxes":
            return {"mailboxes": [{"id": "Inbox", "name": "Inbox", "role": "inbox"}]}, None
        if path.startswith("envelopes?"):
            return {"items": [{"id": "504", "subject": "Friday Sprachtest intern", "from": [], "flags": []}]}, None
        raise AssertionError(path)
    voice._safe = fake
    for utterance in ("Suche Mails mit Friday Sprachtest", "Suche Mails mit Friday Sprachtest.",
                      "Suche Mails mit Friday Sprachtest?", 'Suche Mails mit "Friday Sprachtest".',
                      "Suche Mails mit „Friday Sprachtest“."):
        assert "Friday Sprachtest intern" in voice.handle(utterance)
        assert voice.results == [{"mailbox": "Inbox", "id": "504"}]
    assert "Suchbegriff" in voice.handle("Suche Mails mit ...")


def test_move_folder_sentence_punctuation_does_not_change_destination():
    voice = MailVoice("/synthetic")
    voice.results = [{"mailbox": "Inbox", "id": "504"}]
    voice.results_expires = voice.now() + 120
    requests = []
    def fake(method, path, body=None, key=None):
        if path == "mailboxes":
            return {"mailboxes": [{"id": "Archive", "name": "Archiv", "role": None}]}, None
        if path == "voice/preview":
            requests.append(body)
            return {"token": "a" * 40, "fingerprint": "f" * 64,
                    "expiresAt": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=60)).isoformat(),
                    "action": "move", "to": [], "subject": "Synthetic", "body": "", "mailbox": "Inbox",
                    "id": "504", "destination": "Archive"}, None
        raise AssertionError(path)
    voice._safe = fake
    assert "Sage Ja oder Nein" in voice.handle("Verschiebe Mail eins in Archiv.")
    assert requests == [{"action": "move", "mailbox": "Inbox", "id": "504", "destination": "Archive"}]
