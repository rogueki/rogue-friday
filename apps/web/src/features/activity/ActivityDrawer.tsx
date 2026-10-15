"use client";

import type { ActivityEvent } from "@friday/sdk";
import { Button, Drawer, EmptyState, ErrorState, Skeleton, TagPill } from "@friday/ui";
import { isFridayApiError } from "@friday/sdk";
import { Bot, ExternalLink, Filter, ListChecks } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CopyButton, DataOrigin, FactList, useDateFormatter } from "@/features/tasks/moduleKit";
import { useT, type MessageKey } from "@/i18n";
import { useMeta } from "@/lib/api/domains/core";
import { useActivityEvent } from "@/lib/api/domains/activity";
import { useSession } from "@/lib/session";
import { KIND_TONE, SEVERITY_TONE, STATUS_TONE } from "./model";
import "./activity.css";

/** Raw JSON is a debug/admin view (PLAN §29.5): the `rawJsonView` feature flag or the owner role. */
export function useRawJsonAllowed(): boolean {
  const meta = useMeta();
  const { role } = useSession();
  return meta.data?.features.rawJsonView === true || role === "owner";
}

export interface ActivityDrawerProps {
  eventId: string | null;
  /** Events of the live buffer; the detail endpoint is only used for ids that are not part of it. */
  events: readonly ActivityEvent[];
  agentNames: ReadonlyMap<string, string>;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** Narrow the feed to one flow (correlation id). */
  onFilterCorrelation: (correlationId: string) => void;
}

/** Detail drawer of `/activity?event=…`: all fields of §29.2, jump targets, copy correlation id, raw JSON for admins. */
export function ActivityDrawer({ eventId, events, agentNames, onClose, onSelect, onFilterCorrelation }: ActivityDrawerProps) {
  const { t } = useT();
  const router = useRouter();
  const format = useDateFormatter();
  const rawAllowed = useRawJsonAllowed();
  const [showRaw, setShowRaw] = useState(false);
  const buffered = useMemo(() => (eventId ? events.find((event) => event.id === eventId) : undefined), [events, eventId]);
  const query = useActivityEvent(buffered ? null : eventId);
  const event = buffered ?? query.data?.data;
  const parent = event?.parentId ? events.find((candidate) => candidate.id === event.parentId) : undefined;
  const children = useMemo(() => (event ? events.filter((candidate) => candidate.parentId === event.id) : []), [events, event]);

  let body;
  if (!eventId) body = null;
  else if (!event && query.isPending) body = <Skeleton variant="block" height={200} label={t("common.loading")} />;
  else if (!event && query.isError) {
    body =
      isFridayApiError(query.error) && query.error.code === "NOT_FOUND" ? (
        <EmptyState compact title={t("activity.drawer.notFound")} description={t("activity.drawer.notFoundHint")} />
      ) : (
        <ErrorState compact title={t("common.loadError")} onRetry={() => void query.refetch()} retryLabel={t("common.retry")} />
      );
  } else if (event) {
    const agentLabel = event.agentId ? (agentNames.get(event.agentId) ?? event.agentId) : null;
    body = (
      <div className="ac-detail">
        <div className="mod-heading">
          <h3 className="mod-heading__title">{event.title}</h3>
          <DataOrigin sources={[event.source]} />
        </div>
        <div className="ac-detail__tags">
          <TagPill tone={KIND_TONE[event.kind]}>{t(`activity.kind.${event.kind}` as MessageKey)}</TagPill>
          <TagPill tone={SEVERITY_TONE[event.severity]}>{t(`activity.severity.${event.severity}` as MessageKey)}</TagPill>
          <TagPill tone={STATUS_TONE[event.status]}>{t(`activity.status.${event.status}` as MessageKey)}</TagPill>
        </div>
        {event.summary ? <p className="ac-detail__text">{event.summary}</p> : null}
        <FactList
          items={[
            { label: t("activity.field.time"), value: format.dateTime(event.occurredAt) },
            { label: t("activity.field.duration"), value: event.durationMs === null ? t("activity.field.running") : format.duration(event.durationMs) },
            { label: t("activity.field.agent"), value: agentLabel ?? "—" },
            { label: t("activity.field.task"), value: event.taskId ? <code>{event.taskId}</code> : "—" },
            { label: t("activity.field.tool"), value: event.tool ?? "—" },
            { label: t("activity.field.adapter"), value: event.adapterId ?? event.source.adapterId },
            { label: t("activity.field.model"), value: event.model ?? "—" },
            { label: t("activity.field.actor"), value: event.actor ? (event.actor.name ?? event.actor.id) : "—" },
            {
              label: t("activity.field.correlation"),
              wide: true,
              value: (
                <span className="ac-detail__corr">
                  <code>{event.correlationId}</code>
                  <CopyButton value={event.correlationId} label={t("activity.copyCorrelation")} />
                </span>
              ),
            },
            { label: t("activity.field.sequence"), value: <code>{event.sequence}</code> },
            { label: t("activity.field.id"), value: <code>{event.id}</code> },
          ]}
        />
        {event.result ? (
          <div className="ac-detail__block">
            <h3 className="ac-detail__h">{t("activity.field.result")}</h3>
            <p className="ac-detail__text">{event.result}</p>
          </div>
        ) : null}
        {event.error ? (
          <div className="ac-detail__block ac-detail__error" role="alert">
            <h3 className="ac-detail__h">{t("activity.field.error")}</h3>
            <p className="ac-detail__text">
              <strong>{event.error.code}</strong> · {event.error.message}
            </p>
            <span className="ac-detail__corr">
              <code>{event.error.correlationId}</code>
              <CopyButton value={event.error.correlationId} label={t("activity.copyCorrelation")} />
            </span>
          </div>
        ) : null}
        <div className="ac-detail__block">
          <h3 className="ac-detail__h">{t("activity.field.flow")}</h3>
          <div className="ac-detail__actions">
            {event.taskId ? (
              <Button size="sm" variant="ghost" icon={<ListChecks size={14} />} onClick={() => router.push(`/tasks?task=${encodeURIComponent(event.taskId ?? "")}`)}>
                {t("activity.jump.task")}
              </Button>
            ) : null}
            {event.agentId ? (
              <Button size="sm" variant="ghost" icon={<Bot size={14} />} onClick={() => router.push(`/agents?agent=${encodeURIComponent(event.agentId ?? "")}`)}>
                {t("activity.jump.agent")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon={<Filter size={14} />} onClick={() => onFilterCorrelation(event.correlationId)}>
              {t("activity.filterFlow")}
            </Button>
            {parent ? (
              <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => onSelect(parent.id)}>
                {t("activity.jump.parent")}
              </Button>
            ) : null}
          </div>
          {children.length > 0 ? (
            <ul className="ac-detail__children" aria-label={t("activity.field.children")}>
              {children.slice(0, 12).map((child) => (
                <li key={child.id}>
                  <button type="button" className="ac-detail__child" onClick={() => onSelect(child.id)}>
                    <TagPill tone={KIND_TONE[child.kind]}>{t(`activity.kind.${child.kind}` as MessageKey)}</TagPill>
                    <span>{child.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {event.details && Object.keys(event.details).length > 0 ? (
          <div className="ac-detail__block">
            <h3 className="ac-detail__h">{t("activity.field.details")}</h3>
            <FactList items={Object.entries(event.details).map(([key, value]) => ({ label: key, value: typeof value === "object" ? JSON.stringify(value) : String(value), wide: true }))} />
          </div>
        ) : null}
        {rawAllowed ? (
          <div className="ac-detail__block">
            <div className="ac-detail__rawhead">
              <h3 className="ac-detail__h">{t("activity.raw.title")}</h3>
              <Button size="sm" variant="ghost" aria-expanded={showRaw} onClick={() => setShowRaw((open) => !open)}>
                {showRaw ? t("activity.raw.hide") : t("activity.raw.show")}
              </Button>
              {showRaw ? <CopyButton value={JSON.stringify(event, null, 2)} label={t("activity.raw.copy")} /> : null}
            </div>
            {showRaw ? <pre className="ac-detail__raw" tabIndex={0} aria-label={t("activity.raw.title")}>{JSON.stringify(event, null, 2)}</pre> : <p className="tk-muted">{t("activity.raw.hint")}</p>}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Drawer
      open={eventId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("activity.drawer.title")}
      subtitle={event ? <code className="tk-muted">{event.id}</code> : undefined}
      className="mod-drawer"
      width={600}
      closeLabel={t("common.close")}
    >
      {body}
    </Drawer>
  );
}
