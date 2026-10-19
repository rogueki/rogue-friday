import { describe, expect, it } from "vitest";
import { parseAgentActionIntent } from "../src/services/agent-action-intent";

describe("agent action intents (German NL)", () => {
  it.each([
    ["Pausiere den Recherche-Agenten", "Recherche-Agenten"],
    ["Bitte pausiert den Coding-Agenten", "Coding-Agenten"],
    ["Halte den Memory-Agenten an", "Memory-Agenten"],
    ["Leg den Browser-Agenten still", "Browser-Agenten"],
  ])("parses a pause imperative: %s", (text, ref) => {
    expect(parseAgentActionIntent(text)).toEqual({ kind: "agent.pause", ref });
  });

  it.each([
    ["Starte den Recherche-Agenten", "Recherche-Agenten"],
    ["Aktiviere den Browser-Agenten", "Browser-Agenten"],
    ["Lass den Recherche-Agenten weiterarbeiten", "Recherche-Agenten"],
    ["Lass den Coding-Agenten arbeiten", "Coding-Agenten"],
    ["Setz den Task-Agenten fort", "Task-Agenten"],
  ])("parses a resume imperative: %s", (text, ref) => {
    expect(parseAgentActionIntent(text)).toEqual({ kind: "agent.resume", ref });
  });

  it.each([
    ["Stoppe den Coding-Agenten", "Coding-Agenten"],
    ["Beende den System-Agenten", "System-Agenten"],
    ["Fahr den Browser-Agenten runter", "Browser-Agenten"],
  ])("parses a stop imperative: %s", (text, ref) => {
    expect(parseAgentActionIntent(text)).toEqual({ kind: "agent.stop", ref });
  });

  it.each([
    ["Brich den Lauf ab"],
    ["Brich den laufenden Coding-Lauf ab"],
    ["Bitte brich den Run ab"],
    ["Stoppe den Coding-Run"],
    ["Beende den laufenden Coding-Lauf"],
  ])("parses a coding-run stop: %s", (text) => {
    expect(parseAgentActionIntent(text)).toEqual({ kind: "codingrun.stop" });
  });

  it.each([
    ["Weise die Aufgabe Bericht prüfen dem Recherche-Agenten zu", "Recherche-Agenten", "Bericht prüfen"],
    ["Gib die Aufgabe „Release vorbereiten“ an den Coding-Agenten", "Coding-Agenten", "Release vorbereiten"],
    ["Lass den Recherche-Agenten an der Aufgabe Quellencheck arbeiten", "Recherche-Agenten", "Quellencheck"],
  ])("parses an assignment: %s", (text, agentRef, taskRef) => {
    expect(parseAgentActionIntent(text)).toEqual({ kind: "agent.assign", agentRef, taskRef });
  });

  it.each([
    "Pausiere die Musik",
    "Starte den Computer",
    "Stoppe den Countdown",
    "Brich den Versuch ab",
    "Stoppe den Lauf",
    "Der Recherche-Agent arbeitet gerade",
    "Erzähl mir etwas über den Recherche-Agenten",
    "Wie geht es dem Coding-Agenten?",
    "Weise die Aufgabe Bericht zu",
    "Lass den Agenten",
    "Pausiere den Agenten",
  ])("ignores non-actions and empty references: %s", (text) => {
    expect(parseAgentActionIntent(text)).toBeNull();
  });
});
