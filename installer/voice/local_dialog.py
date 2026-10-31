"""Lokaler Gespraechsmodus mit den Werkzeugen der Gespraechsschicht (LG-3.01/LG-3.03)."""

import json
import re

from conversation import DATA_PREFIX, local_reply

# "Antworte: ..." / "Sag dem Agenten: ..." passes the rest to the agent that asked; works without a local model (ElevenLabs).
REPLY_COMMAND = re.compile(
    r"^\s*(?:antworte|antwort|sag(?:e)?\s+(?:dem\s+agenten|ihm|ihr))\s*[:,]?\s+(?P<answer>\S.*?)\s*$", re.IGNORECASE)
THINK = re.compile(r"<think>.*?</think>", re.DOTALL)
MODEL_NAME = "qwen3-router"
TOOL_CALL_TOKENS = 128
ANSWER_TOKENS = 200


class LocalToolDialog:
    """Gives the local modes the tools of the Qwen mode: rules first, then the local model picks a tool."""

    def __init__(self, orchestrator, chat=None, *, assistant_name: str = "F.R.I.D.A.Y.", address: str | None = None,
                 persona: str = "", max_rounds: int = 3, log=None):
        # chat: callable(payload) -> OpenAI chat-completions response; None means no local model, rules only.
        self._orchestrator = orchestrator
        self._chat = chat
        self._assistant_name = assistant_name
        self._address = address
        self._persona = persona
        self._max_rounds = max_rounds
        self._log = log

    @property
    def model_available(self) -> bool:
        return self._chat is not None

    def turn(self, text: str, history: list | None = None) -> str | None:
        """Spoken answer when a tool handled the utterance; None leaves it to the caller's normal flow."""
        text = " ".join(str(text or "").split())
        if not text:
            return None
        self._orchestrator.begin_user_turn()
        reply = REPLY_COMMAND.match(text)
        if reply:
            return self._spoken("task_antwort", self._orchestrator.call_tool("task_antwort", {"antwort": reply["answer"]}))
        if self._chat is None:
            return None
        rules = self._orchestrator.instructions(self._assistant_name, self._address)
        messages = [{"role": "system", "content": f"{self._persona}\n{rules}" if self._persona else rules},
                    *[entry for entry in (history or [])[-6:]
                      if isinstance(entry, dict) and entry.get("role") in ("user", "assistant")],
                    {"role": "user", "content": text}]
        payload = {"model": MODEL_NAME, "messages": messages, "tools": self._orchestrator.tool_specs(),
                   "tool_choice": "auto", "temperature": 0.2, "chat_template_kwargs": {"enable_thinking": False}}
        last = None
        for _ in range(self._max_rounds):
            # Without a tool the free text is discarded, so the first round only needs room for a tool call.
            payload["max_tokens"] = ANSWER_TOKENS if last else TOOL_CALL_TOKENS
            try:
                message = self._chat(payload)["choices"][0]["message"]
            except Exception as exc:
                if self._log is not None:
                    self._log(event="local_dialog_unavailable", error=type(exc).__name__)
                return self._spoken(*last) if last else None
            calls = message.get("tool_calls") or []
            if not calls:
                if last is None:
                    # Free text without a tool stays with the router/Hermes flow, which answers general questions better.
                    return None
                content = THINK.sub("", str(message.get("content") or "")).strip()
                return content or self._spoken(*last)
            messages.append({"role": "assistant", "content": message.get("content") or "", "tool_calls": calls})
            for call in calls:
                call = call if isinstance(call, dict) else {}
                function = call.get("function") if isinstance(call.get("function"), dict) else {}
                name = str(function.get("name") or "")
                result = self._orchestrator.call_tool(name, self._arguments(function.get("arguments")))
                last = (name, result)
                messages.append({"role": "tool", "tool_call_id": str(call.get("id") or ""),
                                 "content": json.dumps(result, ensure_ascii=False)})
                if self._log is not None:
                    self._log(event="local_dialog_tool", tool=name)
        return self._spoken(*last) if last else None

    @staticmethod
    def _arguments(raw) -> dict:
        if isinstance(raw, dict):
            return raw
        try:
            parsed = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    @staticmethod
    def _spoken(name: str, result) -> str:
        """Sentence for a tool result when the model gives none."""
        if not isinstance(result, dict):
            return "Erledigt."
        text = local_reply(name, result)
        if text:
            return text
        if result.get("error"):
            return str(result["error"])
        if name == "task_create" and result.get("status") == "angenommen":
            return f"Auftrag angenommen: {result.get('agent', 'Agent')}. Ich melde mich mit dem Ergebnis."
        if name == "task_status":
            running = result.get("laufend") or []
            if running:
                return "Es läuft: " + "; ".join(
                    f"{entry.get('auftrag', '')} ({entry.get('stand', 'arbeitet')})" for entry in running[:3]
                    if isinstance(entry, dict)) + "."
            return str(result["hinweis"]) if result.get("hinweis") else "Gerade läuft kein Auftrag."
        if name == "task_cancel" and result.get("status") == "abgebrochen":
            return f"Abgebrochen: {result.get('auftrag', '')}. {result.get('hinweis', '')}".strip()
        if name == "task_antwort" and result.get("status") == "weitergegeben":
            return f"Ich habe deine Antwort an „{result.get('auftrag', '')}“ weitergegeben."
        if name == "friday_lesen":
            if result.get("antwort"):
                return str(result["antwort"]).removeprefix(DATA_PREFIX).strip()
            if result.get("hinweis"):
                return str(result["hinweis"])
        if name == "zeit_datum":
            return f"Es ist {result.get('uhrzeit', '--:--')} Uhr, {result.get('datum', '')}."
        return "Erledigt."
