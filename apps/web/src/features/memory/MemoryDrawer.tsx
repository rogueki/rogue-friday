"use client";

import type { Memory, MemoryConflict, MemoryConflictResolveRequest, MemoryHistoryEntry } from "@jarvis/sdk";
import { Button, ConfirmDialog, Drawer, TagPill, Tabs, useToast } from "@jarvis/ui";
import { BadgeCheck, Download, GitMerge, Lock, LockOpen, Pencil, Pin, PinOff, Trash2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT, type MessageKey } from "@/i18n";
import { useDeleteMemory, useMemory, useResolveMemoryConflict, useUpdateMemory } from "@/lib/api/domains/memory";
import { useCapability } from "@/lib/capabilities";
import { DataBadges } from "./kit/Badges";
import { downloadJson, stamp } from "./kit/download";
import { useFormat } from "./kit/hooks";
import { QueryBoundary } from "./kit/QueryBoundary";
import { MemoryFormDialog } from "./MemoryFormDialog";
import { memoryTitle, percent, sensitivityKey, sensitivityTone, typeKey, TYPE_TONE } from "./labels";

export interface MemoryDrawerProps {
  id: string | null;
  onClose: () => void;
  /** Opens another memory (conflict partner) in the same drawer. */
  onOpenOther: (id: string) => void;
}

export function MemoryDrawer({ id, onClose, onOpenOther }: MemoryDrawerProps) {
  const { t } = useT();
  const query = useMemory(id);
  const memory = query.data?.data;
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={memory ? memoryTitle(memory) : t("memory.drawer.title")}
      subtitle={memory ? `${t(typeKey(memory.type))} · ${memory.id}` : undefined}
      closeLabel={t("common.close")}
      width={560}
    >
      <QueryBoundary query={query}>
        {(response) => <MemoryDetail memory={response.data} freshness={response.freshness} onClose={onClose} onOpenOther={onOpenOther} />}
      </QueryBoundary>
    </Drawer>
  );
}

interface DetailProps {
  memory: Memory;
  freshness: { state: "fresh" | "stale" | "unknown" | "offline-cache"; asOf: string | null };
  onClose: () => void;
  onOpenOther: (id: string) => void;
}

function MemoryDetail({ memory, freshness, onClose, onOpenOther }: DetailProps) {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const format = useFormat();
  const canWrite = useCapability("memory", "write");
  const canLock = useCapability("memory", "lock");
  const canDelete = useCapability("memory", "delete");
  const canRead = useCapability("memory", "read");
  const canResolve = useCapability("memory", "resolveConflict");
  const update = useUpdateMemory();
  const remove = useDeleteMemory();
  const resolve = useResolveMemoryConflict();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replacing, setReplacing] = useState<MemoryConflict | null>(null);

  const resolveConflict = (conflict: MemoryConflict, resolution: MemoryConflictResolveRequest["resolution"]): void =>
    resolve.mutate(
      { id: memory.id, conflictId: conflict.memoryId, version: memory.version, resolution },
      {
        onSuccess: () => {
          setReplacing(null);
          toast({ title: t(`memory.conflicts.resolved.${resolution}` as MessageKey), tone: "green", duration: 3500 });
        },
        onError: () => setReplacing(null),
      },
    );

  const patch = (changes: Parameters<typeof update.mutate>[0]["patch"], done?: () => void): void =>
    update.mutate({ id: memory.id, version: memory.version, patch: changes }, { onSuccess: done });

  const pendingConflicts = memory.conflicts.filter((conflict) => conflict.resolution === "pending").length;
  const exportMemory = (): void => downloadJson(`gedaechtnis-${memory.id}-${stamp()}.json`, memory);

  const details = (
    <div className="mk-stack">
      <section>
        <h3 className="mk-section-title">{t("memory.field.content")}</h3>
        <div className="mk-block">
          <p className="mem-content">{memory.content}</p>
        </div>
      </section>
      <dl className="mk-dl">
        <dt>{t("memory.field.type")}</dt>
        <dd>
          <TagPill tone={TYPE_TONE[memory.type]}>{t(typeKey(memory.type))}</TagPill>
        </dd>
        <dt>{t("memory.field.source")}</dt>
        <dd>
          {t(`memory.provenance.${memory.provenance.kind}` as MessageKey)} · {memory.source.system}
        </dd>
        <dt>{t("memory.confidence")}</dt>
        <dd>
          <span className="mem-confidence" role="img" aria-label={t("memory.confidence.value", { value: percent(memory.confidence) })}>
            <span className="mem-confidence__bar">
              <span style={{ width: `${percent(memory.confidence)}%` }} />
            </span>
            <span className="mk-mono">{percent(memory.confidence)} %</span>
          </span>
        </dd>
        <dt>{t("memory.field.createdAt")}</dt>
        <dd>{format.dateTime(memory.createdAt)}</dd>
        <dt>{t("memory.field.confirmedAt")}</dt>
        <dd>{memory.confirmedAt ? format.dateTime(memory.confirmedAt) : t("memory.neverConfirmed")}</dd>
        <dt>{t("memory.field.expires")}</dt>
        <dd>
          {memory.expiresAt ? format.dateTime(memory.expiresAt) : t("memory.noExpiry")}
          {memory.ttlSeconds ? <span className="mk-muted"> · {t("memory.ttl", { days: Math.max(1, Math.round(memory.ttlSeconds / 86_400)) })}</span> : null}
        </dd>
        <dt>{t("memory.field.tags")}</dt>
        <dd>
          {memory.tags.length === 0 ? (
            <span className="mk-muted">—</span>
          ) : (
            <span className="mk-tags">
              {memory.tags.map((tag) => (
                <TagPill key={tag} tone="cyan">
                  #{tag}
                </TagPill>
              ))}
            </span>
          )}
        </dd>
        <dt>{t("memory.field.entities")}</dt>
        <dd>
          {memory.entities.length === 0 ? (
            <span className="mk-muted">—</span>
          ) : (
            <span className="mk-tags">
              {memory.entities.map((entity) => (
                <TagPill key={`${entity.kind}:${entity.id}`} tone="violet">
                  {t(`memory.entity.${entity.kind}` as MessageKey)}: {entity.label}
                </TagPill>
              ))}
            </span>
          )}
        </dd>
        <dt>{t("memory.field.sensitivity")}</dt>
        <dd>
          <TagPill tone={sensitivityTone(memory.sensitivity)}>{t(sensitivityKey(memory.sensitivity))}</TagPill>
        </dd>
        <dt>{t("memory.field.protection")}</dt>
        <dd>
          <span className="mk-tags">
            <TagPill tone={memory.pinned ? "cyan" : "muted"}>{memory.pinned ? t("memory.flag.pinned") : t("memory.flag.notPinned")}</TagPill>
            <TagPill tone={memory.locked ? "amber" : "muted"}>{memory.locked ? t("memory.flag.locked") : t("memory.flag.notLocked")}</TagPill>
          </span>
        </dd>
      </dl>
    </div>
  );

  const provenance = (
    <div className="mk-stack">
      <p className="mk-note">{t("memory.provenance.intro")}</p>
      <dl className="mk-dl">
        <dt>{t("memory.provenance.kind")}</dt>
        <dd>{t(`memory.provenance.${memory.provenance.kind}` as MessageKey)}</dd>
        {memory.provenance.description ? (
          <>
            <dt>{t("memory.provenance.description")}</dt>
            <dd>{memory.provenance.description}</dd>
          </>
        ) : null}
        {memory.provenance.referenceId ? (
          <>
            <dt>{t("memory.provenance.reference")}</dt>
            <dd className="mk-mono">{memory.provenance.referenceId}</dd>
          </>
        ) : null}
        <dt>{t("memory.provenance.adapter")}</dt>
        <dd>
          {memory.source.system} <span className="mk-mono">({memory.source.adapterId})</span>
        </dd>
        <dt>{t("memory.provenance.synced")}</dt>
        <dd>{format.dateTime(memory.source.lastSyncedAt)}</dd>
        <dt>{t("memory.usage")}</dt>
        <dd>{t("memory.usage.count", { count: memory.usageCount })}</dd>
        <dt>{t("memory.usage.last")}</dt>
        <dd>{memory.lastUsedAt ? format.dateTime(memory.lastUsedAt) : t("memory.usage.never")}</dd>
      </dl>
    </div>
  );

  const history = (
    <ol className="mk-list mem-history" aria-label={t("memory.tab.history")}>
      {memory.history.length === 0 ? <li className="mk-note">{t("memory.history.empty")}</li> : null}
      {memory.history
        .slice()
        .sort((a, b) => b.version - a.version)
        .map((entry) => (
          <HistoryItem key={`${entry.version}:${entry.changedAt}`} entry={entry} />
        ))}
    </ol>
  );

  const conflicts = (
    <ul className="mk-list">
      {memory.conflicts.length === 0 ? <li className="mk-note">{t("memory.conflicts.empty")}</li> : null}
      {memory.conflicts.map((conflict) => (
        <li key={`${conflict.memoryId}:${conflict.detectedAt}`} className={`mk-block${conflict.resolution === "pending" ? " mk-block--red" : ""}`}>
          <p className="mk-strong">{conflict.reason}</p>
          <p className="mk-muted">
            {t("memory.conflicts.detected", { when: format.dateTime(conflict.detectedAt) })} · {t(`memory.conflicts.${conflict.resolution}` as MessageKey)}
          </p>
          <p>
            <button type="button" className="mk-link" onClick={() => onOpenOther(conflict.memoryId)}>
              {t("memory.conflicts.open")}
            </button>
          </p>
          {conflict.resolution === "pending" ? (
            <div className="mk-actions" role="group" aria-label={t("memory.conflicts.resolve")}>
              <Button size="sm" variant="ghost" icon={<GitMerge size={14} />} disabled={!canResolve || resolve.isPending} onClick={() => resolveConflict(conflict, "keep_both")}>
                {t("memory.conflicts.action.keep_both")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={14} />}
                disabled={!canResolve || resolve.isPending}
                onClick={() => setReplacing(conflict)}
              >
                {t("memory.conflicts.action.replace")}
              </Button>
              <Button size="sm" variant="ghost" icon={<XCircle size={14} />} disabled={!canResolve || resolve.isPending} onClick={() => resolveConflict(conflict, "dismiss")}>
                {t("memory.conflicts.action.dismiss")}
              </Button>
              {canResolve ? null : <span className="mk-muted">{t("memory.conflicts.unavailable")}</span>}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mk-stack mem-detail">
      <DataBadges sources={[memory.source]} freshness={freshness} />
      {memory.locked ? <p className="mk-block mk-block--amber mk-note">{t("memory.lockedHint")}</p> : null}
      {memory.sensitivity !== "normal" ? <p className="mk-block mk-block--amber mk-note">{t("memory.sensitiveHint")}</p> : null}
      <div className="mk-actions" role="group" aria-label={t("memory.actions")}>
        <Button size="sm" variant="ghost" icon={<BadgeCheck size={14} />} disabled={!canWrite || update.isPending} onClick={() => patch({ confirm: true })}>
          {t("memory.action.confirm")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Pencil size={14} />}
          disabled={!canWrite || memory.locked}
          title={memory.locked ? t("memory.lockedHint") : !canWrite ? t("memory.kit.noWrite") : undefined}
          onClick={() => setEditing(true)}
        >
          {t("memory.action.edit")}
        </Button>
        <Button size="sm" variant="ghost" icon={memory.pinned ? <PinOff size={14} /> : <Pin size={14} />} disabled={!canWrite || update.isPending} onClick={() => patch({ pinned: !memory.pinned })}>
          {memory.pinned ? t("memory.action.unpin") : t("memory.action.pin")}
        </Button>
        <Button size="sm" variant="ghost" icon={memory.locked ? <LockOpen size={14} /> : <Lock size={14} />} disabled={!canLock || update.isPending} onClick={() => patch({ locked: !memory.locked })}>
          {memory.locked ? t("memory.action.unlock") : t("memory.action.lock")}
        </Button>
        <Button size="sm" variant="ghost" icon={<Download size={14} />} disabled={!canRead} onClick={exportMemory}>
          {t("memory.action.export")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 size={14} />}
          disabled={!canDelete || memory.locked}
          title={memory.locked ? t("memory.deleteLocked") : !canDelete ? t("memory.kit.noDelete") : undefined}
          onClick={() => setConfirmDelete(true)}
        >
          {t("memory.action.forget")}
        </Button>
      </div>
      <Tabs
        label={t("memory.drawer.tabs")}
        items={[
          { id: "details", label: t("memory.tab.details"), content: details },
          { id: "provenance", label: t("memory.tab.provenance"), content: provenance },
          { id: "history", label: t("memory.tab.history"), count: memory.history.length, content: history },
          { id: "conflicts", label: t("memory.tab.conflicts"), count: pendingConflicts > 0 ? pendingConflicts : undefined, content: conflicts },
        ]}
      />
      <MemoryFormDialog
        open={editing}
        onOpenChange={setEditing}
        memory={memory}
        busy={update.isPending}
        onUpdate={(changes) => patch(changes, () => setEditing(false))}
      />
      <ConfirmDialog
        open={replacing !== null}
        onOpenChange={(open) => {
          if (!open) setReplacing(null);
        }}
        tone="danger"
        title={t("memory.conflicts.replace.title")}
        description={t("memory.conflicts.replace.description", { title: memoryTitle(memory) })}
        details={[t("memory.conflicts.replace.detail.forget"), t("memory.conflicts.replace.detail.locked"), t("memory.conflicts.replace.detail.audit")]}
        confirmLabel={t("memory.conflicts.replace.confirm")}
        cancelLabel={t("common.cancel")}
        loading={resolve.isPending}
        onConfirm={() => {
          if (replacing) resolveConflict(replacing, "replace");
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title={t("memory.forget.title")}
        description={t("memory.forget.description", { title: memoryTitle(memory) })}
        details={[t("memory.forget.detail.audit"), t("memory.forget.detail.final"), t("memory.forget.detail.export")]}
        confirmLabel={t("memory.forget.confirm")}
        cancelLabel={t("common.cancel")}
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(
            { id: memory.id, version: memory.version },
            {
              onSuccess: () => {
                setConfirmDelete(false);
                onClose();
                toast({
                  title: t("memory.forget.done"),
                  description: t("memory.forget.doneDescription"),
                  tone: "green",
                  action: { label: t("memory.forget.openAudit"), onClick: () => router.push("/audit") },
                });
              },
            },
          )
        }
      />
    </div>
  );
}

function HistoryItem({ entry }: { entry: MemoryHistoryEntry }) {
  const { t } = useT();
  const format = useFormat();
  const actor = entry.actor.name ?? entry.actor.id;
  return (
    <li className="mk-block">
      <p className="mk-strong">
        v{entry.version} · {t(`memory.history.${entry.change}` as MessageKey)}
      </p>
      <p className="mk-muted">
        {format.dateTime(entry.changedAt)} · {t(`memory.actor.${entry.actor.type}` as MessageKey)}: {actor}
      </p>
      <p>{entry.summary}</p>
      {entry.before !== null || entry.after !== null ? (
        <p className="mem-diff">
          {entry.before !== null ? <span className="mem-diff__before">− {entry.before}</span> : null}
          {entry.after !== null ? <span className="mem-diff__after">+ {entry.after}</span> : null}
        </p>
      ) : null}
    </li>
  );
}
