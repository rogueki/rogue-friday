"""Speaker-gated CloudTalk Desktop Auto-Dial handoff; caller verifies each utterance."""

import os
import re
import time


COMMAND = re.compile(r"^(?:friday[, ]+)?ruf(?:e)?\s+(.+?)\s+(?:über|ueber|mit)\s+cloudtalk\s+an[.!?]?\s*$", re.I)
YES = re.compile(r"^\s*(?:ja|ja bitte|bestätige|bestaetige|okay|ok)[.!?\s]*$", re.I)
NO = re.compile(r"^\s*(?:nein|abbrechen|stopp|stop|verwerfen)[.!?\s]*$", re.I)
E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")


def normalize_number(raw):
    number = re.sub(r"[\s().-]", "", raw)
    if number.startswith("00"):
        number = "+" + number[2:]
    elif number.startswith("0"):
        number = "+49" + number[1:]
    if not E164.fullmatch(number):
        raise ValueError("invalid telephone number")
    return number


class CloudTalkVoice:
    def __init__(self, now=time.monotonic, open_url=None):
        self.now = now
        self.open_url = open_url or os.startfile
        self.pending = None

    def arm_confirmation(self):
        if self.pending and self.pending["expires"] is None:
            self.pending["expires"] = self.now() + 90

    def handle(self, text):
        """Caller must speaker-verify both the request and the confirmation."""
        words = text.strip()
        if self.pending and self.pending["expires"] is not None and self.now() > self.pending["expires"]:
            self.pending = None
            if YES.fullmatch(words):
                return "Die CloudTalk-Bestätigung ist abgelaufen. Bitte nenne die Nummer erneut."
        if self.pending and NO.fullmatch(words):
            self.pending = None
            return "CloudTalk-Ruf verworfen."
        if self.pending and YES.fullmatch(words):
            pending = self.pending
            self.pending = None
            if pending["expires"] is None:
                return "Die Vorschau wurde unterbrochen. Bitte nenne die Nummer erneut."
            try:
                self.open_url("ct+tel:" + pending["number"])
            except OSError:
                return "CloudTalk konnte nicht geöffnet werden. Prüfe die Desktop-App und Windows-Protokollzuordnung."
            return ("Nummer an CloudTalk übergeben. Bei aktivem Automatically dial Click-to-call numbers "
                    "wird der Wahlvorgang ausgelöst. Ich kann den Gesprächsstatus hier nicht prüfen.")
        if self.pending:
            self.pending = None
        match = COMMAND.fullmatch(words)
        if not match:
            return None
        try:
            number = normalize_number(match.group(1))
        except ValueError:
            return "Bitte nenne eine eindeutige deutsche oder internationale Telefonnummer für CloudTalk."
        self.pending = {"number": number, "expires": None}
        spoken = " ".join(number)
        return (f"Ich übergebe die Nummer {spoken} an CloudTalk Desktop. "
                "Automatically dial Click-to-call numbers muss in CloudTalk aktiviert sein. "
                "Soll ich genau diese Nummer wählen lassen? Sage Ja oder Nein.")
