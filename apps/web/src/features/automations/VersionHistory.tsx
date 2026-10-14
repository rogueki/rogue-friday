"use client";

import { Button, EmptyState, ErrorState, Skeleton, TagPill } from "@jarvis/ui";
import { useState } from "react";
import { DataBadges } from "@/features/memory/kit/Badges";
import { useFormat } from "@/features/memory/kit/hooks";
import { useT, type MessageKey } from "@/i18n";
import { useAutomationVersions, type AutomationVersionDto } from "@/lib/api/domains/automations";
import { useCapability } from "@/lib/capabilities";

type Snapshot = AutomationVersionDto["snapshot"];
export type SnapshotPart = "name" | "description" | "state" | "trigger" | "conditions" | "actions" | "escalation";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Parts of the definition that differ between two versions (`previous` null = first version: nothing to compare). */
export function changedParts(previous: Snapshot | null, current: Snapshot): SnapshotPart[] {
  if (!previous) return [];
  const parts: SnapshotPart[] = [];
  if (previous.name !== current.name) parts.push("name");
  if ((previous.description ?? "") !== (current.description ?? "")) parts.push("description");
  if (previous.enabled !== current.enabled || previous.paused !== current.paused) parts.push("state");
  if (!same(previous.trigger, current.trigger)) parts.push("trigger");
  if (!same(previous.conditions, current.conditions)) parts.push("conditions");
  if (!same(previous.actions, current.actions)) parts.push("actions");
  if (!same(previous.escalation, current.escalation)) parts.push("escalation");
  return parts;
}

function SnapshotDetails({ snapshot }: { snapshot: Snapshot }) {
  const { t } = useT();
  const list = (items: readonly { description: string }[]) =>
    items.length === 0 ? (
      <span className="mk-muted">{t("automations.versions.none")}</span>
    ) : (
      <ul className="aut-version__list">
        {items.map((item, index) => (
          <li key={`${index}-${item.description}`}>{item.description}</li>
        ))}
      </ul>
    );
  return (
    <dl className="mk-dl aut-version__snapshot">
      <dt>{t("automations.versions.state")}</dt>
      <dd>{`${snapshot.enabled ? t("automations.enabled") : t("automations.disabled")} · ${snapshot.paused ? t("automations.state.paused") : t("automations.state.active")}`}</dd>
      <dt>{t("automations.versions.trigger")}</dt>
      <dd>{snapshot.trigger.description}</dd>
      <dt>{t("automations.versions.conditions")}</dt>
      <dd>{list(snapshot.conditions)}</dd>
      <dt>{t("automations.versions.actions")}</dt>
      <dd>{list(snapshot.actions)}</dd>
      <dt>{t("automations.versions.escalation")}</dt>
      <dd>{list(snapshot.escalation)}</dd>
    </dl>
  );
}

/** Version history of one automation (PLAN §35.3 "Versionierung"), newest first, with what changed per version. */
export function VersionHistory({ automationId }: { automationId: string }) {
  const { t } = useT();
  const format = useFormat();
  const available = useCapability("automations", "versions");
  const query = useAutomationVersions(automationId, { limit: 50 }, available);
  const [open, setOpen] = useState<number | null>(null);

  if (!available) return <p className="mk-note mk-block mk-block--amber">{t("automations.versions.unavailable")}</p>;
  if (query.isPending) return <Skeleton lines={4} />;
  if (query.isError && query.data === undefined) {
    return <ErrorState compact title={t("automations.versions.error")} onRetry={() => void query.refetch()} />;
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) return <EmptyState compact title={t("automations.versions.empty")} />;

  return (
    <div className="mk-stack">
      <DataBadges sources={query.data?.sources} freshness={query.data?.freshness} />
      <ol className="mk-list aut-versions" aria-label={t("automations.versions.list")}>
        {items.map((entry, index) => {
          const previous = items[index + 1]?.snapshot ?? null;
          const parts = changedParts(previous, entry.snapshot);
          const expanded = open === entry.version;
          return (
            <li key={entry.version} className={`mk-block aut-version${entry.current ? " aut-version--current" : ""}`}>
              <p className="mk-strong">
                v{entry.version} {entry.current ? <TagPill tone="green">{t("automations.versions.current")}</TagPill> : null}
              </p>
              <p className="mk-muted">
                {format.dateTime(entry.createdAt)} · {t(`memory.actor.${entry.changedBy.type}` as MessageKey)}: {entry.changedBy.name ?? entry.changedBy.id}
              </p>
              <p>{entry.summary}</p>
              {parts.length > 0 ? (
                <p className="aut-version__changes">
                  {parts.map((part) => (
                    <TagPill key={part} tone="amber">
                      {t(`automations.versions.part.${part}` as MessageKey)}
                    </TagPill>
                  ))}
                </p>
              ) : null}
              <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : entry.version)}>
                {expanded ? t("automations.versions.hide") : t("automations.versions.show")}
              </Button>
              {expanded ? <SnapshotDetails snapshot={entry.snapshot} /> : null}
            </li>
          );
        })}
      </ol>
      {query.data?.pageInfo.hasNextPage ? <p className="mk-note">{t("automations.versions.more", { count: items.length })}</p> : null}
    </div>
  );
}
