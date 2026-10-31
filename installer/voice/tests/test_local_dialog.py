import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from conversation import DATA_PREFIX
from local_dialog import LocalToolDialog


class FakeOrchestrator:
    def __init__(self, results=None):
        self.results = results or {}
        self.calls = []
        self.turns = 0

    def begin_user_turn(self):
        self.turns += 1

    def instructions(self, name, address=None):
        return "REGELN"

    def tool_specs(self):
        return [{"type": "function", "function": {"name": "task_status"}}]

    def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return self.results.get(name, {"status": "ok"})


class FakeChat:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.payloads = []

    def __call__(self, payload):
        # The dialog keeps appending to its message list; a snapshot shows what each round really sent.
        self.payloads.append(json.loads(json.dumps(payload)))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return {"choices": [{"message": response}]}


def tool_call(name, arguments, call_id="c1"):
    return {"tool_calls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}]}


class LocalToolDialogTest(unittest.TestCase):
    def test_tool_round_sends_result_back_and_speaks_the_model_answer(self):
        orchestrator = FakeOrchestrator({"task_status": {"laufend": [], "fertig": []}})
        chat = FakeChat(tool_call("task_status", '{"auftrag": ""}'), {"content": "Die Recherche läuft noch."})
        dialog = LocalToolDialog(orchestrator, chat, persona="Du bist hilfsbereit.")
        self.assertEqual(dialog.turn("Was macht die Recherche?"), "Die Recherche läuft noch.")
        self.assertEqual(orchestrator.calls, [("task_status", {"auftrag": ""})])
        self.assertEqual(orchestrator.turns, 1)
        first, second = chat.payloads
        self.assertEqual(first["model"], "qwen3-router")
        self.assertEqual(first["tool_choice"], "auto")
        self.assertEqual(first["tools"], orchestrator.tool_specs())
        self.assertEqual(first["chat_template_kwargs"], {"enable_thinking": False})
        self.assertEqual((first["max_tokens"], second["max_tokens"]), (128, 200))
        self.assertIn("REGELN", first["messages"][0]["content"])
        self.assertIn("Du bist hilfsbereit.", first["messages"][0]["content"])
        self.assertEqual(first["messages"][-1], {"role": "user", "content": "Was macht die Recherche?"})
        assistant, tool = second["messages"][-2:]
        self.assertEqual(assistant["role"], "assistant")
        self.assertEqual(assistant["tool_calls"][0]["function"]["name"], "task_status")
        self.assertEqual(tool, {"role": "tool", "tool_call_id": "c1",
                                "content": json.dumps({"laufend": [], "fertig": []}, ensure_ascii=False)})

    def test_free_text_without_tool_leaves_the_turn_to_the_caller(self):
        orchestrator = FakeOrchestrator()
        dialog = LocalToolDialog(orchestrator, FakeChat({"content": "Mir geht es gut, danke!"}))
        self.assertIsNone(dialog.turn("Wie geht es dir?"))
        self.assertEqual(orchestrator.calls, [])

    def test_empty_model_answer_after_a_tool_uses_the_fallback_sentence(self):
        orchestrator = FakeOrchestrator({"task_create": {"status": "angenommen", "agent": "Recherche"}})
        chat = FakeChat(tool_call("task_create", '{"text": "Suche Hotels"}'), {"content": ""})
        self.assertEqual(LocalToolDialog(orchestrator, chat).turn("Such mir Hotels in Rom"),
                         "Auftrag angenommen: Recherche. Ich melde mich mit dem Ergebnis.")

    def test_unreachable_model_before_and_after_a_tool(self):
        logged = []
        dialog = LocalToolDialog(FakeOrchestrator(), FakeChat(OSError("down")), log=lambda **fields: logged.append(fields))
        self.assertIsNone(dialog.turn("Was läuft gerade?"))
        self.assertEqual(logged, [{"event": "local_dialog_unavailable", "error": "OSError"}])
        orchestrator = FakeOrchestrator({"zeit_datum": {"uhrzeit": "09:30", "datum": "Samstag, 31. Oktober 2026"}})
        chat = FakeChat(tool_call("zeit_datum", "{}"), OSError("down"))
        self.assertEqual(LocalToolDialog(orchestrator, chat).turn("Wie spät ist es?"),
                         "Es ist 09:30 Uhr, Samstag, 31. Oktober 2026.")

    def test_arguments_as_dict_and_as_broken_json(self):
        orchestrator = FakeOrchestrator()
        chat = FakeChat({"tool_calls": [
            {"id": "a", "function": {"name": "task_status", "arguments": {"auftrag": "Rom"}}},
            {"id": "b", "function": {"name": "task_status", "arguments": "{kaputt"}},
            {"id": "c", "function": {"name": "task_status", "arguments": "[1, 2]"}}]}, {"content": "Fertig."})
        LocalToolDialog(orchestrator, chat).turn("Status?")
        self.assertEqual(orchestrator.calls, [("task_status", {"auftrag": "Rom"}), ("task_status", {}), ("task_status", {})])

    def test_exhausted_rounds_speak_the_last_tool_result(self):
        orchestrator = FakeOrchestrator({"task_status": {"laufend": [{"auftrag": "Rom-Reise", "stand": "arbeitet"}]}})
        chat = FakeChat(tool_call("task_status", "{}"), tool_call("task_status", "{}", "c2"))
        dialog = LocalToolDialog(orchestrator, chat, max_rounds=2)
        self.assertEqual(dialog.turn("Status?"), "Es läuft: Rom-Reise (arbeitet).")
        self.assertEqual(len(chat.payloads), 2)

    def test_reply_rule_works_without_a_local_model(self):
        orchestrator = FakeOrchestrator({"task_antwort": {"status": "weitergegeben", "auftrag": "Ordner sortieren"}})
        dialog = LocalToolDialog(orchestrator)
        self.assertEqual(dialog.turn("Antworte: nimm den blauen Ordner"),
                         "Ich habe deine Antwort an „Ordner sortieren“ weitergegeben.")
        self.assertEqual(dialog.turn("Sag dem Agenten, morgen früh"),
                         "Ich habe deine Antwort an „Ordner sortieren“ weitergegeben.")
        self.assertEqual(orchestrator.calls, [("task_antwort", {"antwort": "nimm den blauen Ordner"}),
                                              ("task_antwort", {"antwort": "morgen früh"})])
        for text in ("Antwort", "Antworten sind wichtig"):
            self.assertIsNone(dialog.turn(text))
        self.assertEqual(len(orchestrator.calls), 2)

    def test_without_model_ordinary_sentences_stay_with_the_caller(self):
        orchestrator = FakeOrchestrator()
        dialog = LocalToolDialog(orchestrator)
        self.assertFalse(dialog.model_available)
        self.assertIsNone(dialog.turn("Wie wird das Wetter morgen?"))
        self.assertIsNone(dialog.turn("   "))
        self.assertEqual(orchestrator.calls, [])
        self.assertTrue(LocalToolDialog(orchestrator, FakeChat()).model_available)

    def test_thinking_block_is_not_spoken(self):
        chat = FakeChat(tool_call("task_status", "{}"), {"content": "<think>x</think>Fertig."})
        self.assertEqual(LocalToolDialog(FakeOrchestrator(), chat).turn("Status?"), "Fertig.")

    def test_history_keeps_only_the_last_six_dialog_messages(self):
        history = [{"role": "user", "content": f"u{i}"} for i in range(8)]
        history[-2] = {"role": "system", "content": "fremd"}
        history.append("kein dict")
        chat = FakeChat({"content": "egal"})
        LocalToolDialog(FakeOrchestrator(), chat).turn("Hallo", history)
        messages = chat.payloads[0]["messages"]
        self.assertEqual([m["content"] for m in messages[1:-1]], ["u3", "u4", "u5", "u7"])

    def test_fallback_sentences_for_data_and_errors(self):
        spoken = LocalToolDialog._spoken
        self.assertEqual(spoken("friday_lesen", {"antwort": DATA_PREFIX + "Drei Termine."}), "Drei Termine.")
        self.assertEqual(spoken("task_create", {"error": "Unbekannter Agent."}), "Unbekannter Agent.")
        self.assertEqual(spoken("task_status", {"laufend": []}), "Gerade läuft kein Auftrag.")
        self.assertEqual(spoken("task_cancel", {"status": "abgebrochen", "auftrag": "Rom", "hinweis": "Schritte bleiben."}),
                         "Abgebrochen: Rom. Schritte bleiben.")
        self.assertEqual(spoken("unbekannt", ["kein dict"]), "Erledigt.")
        self.assertEqual(spoken("ruhemodus", {"status": "an", "bis": "08:00"}), "Ruhemodus bis 08:00 Uhr.")


if __name__ == "__main__":
    unittest.main()
