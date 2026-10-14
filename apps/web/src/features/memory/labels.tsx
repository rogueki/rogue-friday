import type { Memory, MemorySensitivity, MemoryType } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";
import { BookOpen, Building2, FolderKanban, Gavel, History, Link2, ListChecks, SlidersHorizontal, UserRound, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/i18n";

/** The ten memory types of PLAN §30.1, in display order. */
export const MEMORY_TYPES: readonly MemoryType[] = ["profile", "preference", "fact", "person", "company", "project", "relationship", "instruction", "episode", "decision"];
export const MEMORY_SENSITIVITIES: readonly MemorySensitivity[] = ["normal", "sensitive", "restricted"];

export const TYPE_ICON: Record<MemoryType, LucideIcon> = {
  profile: UserRound,
  preference: SlidersHorizontal,
  fact: BookOpen,
  person: UserRound,
  company: Building2,
  project: FolderKanban,
  relationship: Link2,
  instruction: ListChecks,
  episode: History,
  decision: Gavel,
};

export const TYPE_TONE: Record<MemoryType, Tone> = {
  profile: "cyan",
  preference: "teal",
  fact: "blue",
  person: "violet",
  company: "amber",
  project: "green",
  relationship: "violet",
  instruction: "cyan",
  episode: "muted",
  decision: "amber",
};

export const typeKey = (type: MemoryType): MessageKey => `memory.type.${type}` as MessageKey;
export const sensitivityKey = (sensitivity: MemorySensitivity): MessageKey => `memory.sensitivity.${sensitivity}` as MessageKey;

export function sensitivityTone(sensitivity: MemorySensitivity): Tone {
  return sensitivity === "restricted" ? "red" : sensitivity === "sensitive" ? "amber" : "muted";
}


/** Title for a row: explicit title, else the first line of the content. */
export function memoryTitle(memory: Pick<Memory, "title" | "content">): string {
  const title = memory.title?.trim();
  if (title) return title;
  const firstLine = memory.content.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine;
}

export function hasPendingConflict(memory: Pick<Memory, "conflicts">): boolean {
  return memory.conflicts.some((conflict) => conflict.resolution === "pending");
}

export const percent = (confidence: number): number => Math.round(Math.min(1, Math.max(0, confidence)) * 100);
