"use client";

import type { Memory } from "@friday/sdk";
import { IconTile, TagPill } from "@friday/ui";
import { AlertTriangle, Lock, Pin, ShieldAlert } from "lucide-react";
import { useT } from "@/i18n";
import { useFormat } from "./kit/hooks";
import { hasPendingConflict, memoryTitle, percent, sensitivityKey, sensitivityTone, TYPE_ICON, TYPE_TONE, typeKey } from "./labels";

const ICON = { size: 16, strokeWidth: 1.5 } as const;
const MAX_TAGS = 3;

export interface MemoryRowProps {
  memory: Memory;
  selected: boolean;
  onOpen: (id: string) => void;
  /** Relevance of a semantic search hit (0..1). */
  score?: number;
  highlights?: readonly string[];
}

/** One memory in the list. Nothing is hidden: type, confidence, flags, sensitivity and conflicts are visible without opening it. */
export function MemoryRow({ memory, selected, onOpen, score, highlights }: MemoryRowProps) {
  const { t } = useT();
  const format = useFormat();
  const Icon = TYPE_ICON[memory.type];
  const conflict = hasPendingConflict(memory);
  const snippet = highlights && highlights.length > 0 ? highlights.join(" … ") : memory.content;
  return (
    <li>
      <button
        type="button"
        className={`mk-row mem-row${selected ? " mk-row--selected" : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(memory.id)}
        data-memory-id={memory.id}
      >
        <IconTile icon={<Icon {...ICON} />} tone={TYPE_TONE[memory.type]} size="md" />
        <span className="mk-row__main">
          <span className="mk-row__title">{memoryTitle(memory)}</span>
          <span className="mk-row__text">{snippet}</span>
          <span className="mk-row__meta">
            <TagPill tone={TYPE_TONE[memory.type]}>{t(typeKey(memory.type))}</TagPill>
            <span title={t("memory.confidence")}>{t("memory.confidence.value", { value: percent(memory.confidence) })}</span>
            {memory.tags.slice(0, MAX_TAGS).map((tag) => (
              <span key={tag} className="mem-tag">
                #{tag}
              </span>
            ))}
            {memory.tags.length > MAX_TAGS ? <span>+{memory.tags.length - MAX_TAGS}</span> : null}
          </span>
        </span>
        <span className="mk-row__side">
          <span className="mem-flags">
            {memory.pinned ? <Pin size={13} strokeWidth={1.75} aria-label={t("memory.flag.pinned")} /> : null}
            {memory.locked ? <Lock size={13} strokeWidth={1.75} aria-label={t("memory.flag.locked")} /> : null}
            {memory.sensitivity !== "normal" ? (
              <TagPill tone={sensitivityTone(memory.sensitivity)} icon={<ShieldAlert size={11} strokeWidth={1.75} aria-hidden="true" />}>
                {t(sensitivityKey(memory.sensitivity))}
              </TagPill>
            ) : null}
            {conflict ? (
              <TagPill tone="red" icon={<AlertTriangle size={11} strokeWidth={1.75} aria-hidden="true" />}>
                {t("memory.flag.conflict")}
              </TagPill>
            ) : null}
          </span>
          {score !== undefined ? <span className="mk-mono">{t("memory.relevance", { value: percent(score) })}</span> : null}
          <span title={format.dateTime(memory.updatedAt)}>{format.relative(memory.updatedAt)}</span>
        </span>
      </button>
    </li>
  );
}
