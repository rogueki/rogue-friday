"use client";

import { isJarvisApiError, type AdapterLogEntry } from "@jarvis/sdk";
import { Button, Dialog, EmptyState, ErrorState, Select, Skeleton, Switch, TagPill, type Tone } from "@jarvis/ui";
import { FileText, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useT, type MessageKey } from "@/i18n";
import { useAdapterLogs } from "@/lib/api/domains/system";
import { StatusStrip, useFormatters } from "./common";

const LEVELS: readonly AdapterLogEntry["level"][] = ["debug", "info", "warn", "error"];
const LIMITS = [50, 100, 200, 500] as const;
const LEVEL_TONE: Record<AdapterLogEntry["level"], Tone> = { debug: "muted", info: "cyan", warn: "amber", error: "red" };
const LIVE_MS = 5_000;

interface AdapterLogsDialogProps {
  adapterId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function timeOf(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString(locale, { hour12: false });
}

/** "Logs öffnen" (PLAN §40.4): the newest redacted log lines of one adapter, filterable by level, optionally followed live. */
export function AdapterLogsDialog({ adapterId, name, open, onOpenChange }: AdapterLogsDialogProps) {
  const { t, locale } = useT();
  const formatters = useFormatters();
  const [level, setLevel] = useState<AdapterLogEntry["level"]>("info");
  const [limit, setLimit] = useState<number>(100);
  const [live, setLive] = useState(false);
  const query = useAdapterLogs(adapterId, { level, limit }, { enabled: open, refetchMs: live ? LIVE_MS : false });
  const items = query.data?.items ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("system.logs.title", { name })}
      description={t("system.logs.description")}
      icon={<FileText size={16} strokeWidth={1.5} />}
      size="lg"
      className="sy-logs-dialog"
      footer={
        <>
          <StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      <div className="sy-logs-toolbar">
        <Select
          label={t("system.logs.level")}
          value={level}
          onChange={(event) => setLevel(event.target.value as AdapterLogEntry["level"])}
          options={LEVELS.map((entry) => ({ value: entry, label: t(`system.logs.level.${entry}` as MessageKey) }))}
        />
        <Select
          label={t("system.logs.limit")}
          value={String(limit)}
          onChange={(event) => setLimit(Number(event.target.value))}
          options={LIMITS.map((entry) => ({ value: String(entry), label: String(entry) }))}
        />
        <Switch label={t("system.logs.live")} checked={live} onCheckedChange={setLive} stateLabels={[t("system.logs.liveOn"), t("system.logs.liveOff")]} />
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} strokeWidth={1.5} />} loading={query.isFetching && !query.isPending} onClick={() => void query.refetch()}>
          {t("system.logs.refresh")}
        </Button>
      </div>
      {query.isPending ? (
        <Skeleton lines={6} />
      ) : query.isError && query.data === undefined ? (
        <ErrorState
          compact
          title={t("system.logs.error")}
          description={isJarvisApiError(query.error) ? query.error.message : t("system.logs.errorDescription")}
          {...(isJarvisApiError(query.error) ? { code: query.error.code, correlationId: query.error.correlationId } : {})}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState compact title={t("system.logs.empty")} description={t("system.logs.emptyDescription")} />
      ) : (
        <ol className="sy-logs" aria-label={t("system.logs.list", { name })}>
          {items.map((entry, index) => (
            <li key={`${entry.timestamp}-${index}`} className="sy-log" data-level={entry.level}>
              <time className="sy-log__time mc-mono" dateTime={entry.timestamp} title={formatters.dateTime(entry.timestamp)}>
                {timeOf(entry.timestamp, locale)}
              </time>
              <TagPill tone={LEVEL_TONE[entry.level]}>{t(`system.logs.level.${entry.level}` as MessageKey)}</TagPill>
              <span className="sy-log__message">
                {entry.message}
                {Object.keys(entry.context).length > 0 ? (
                  <span className="sy-log__context mc-mono">
                    {Object.entries(entry.context)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(" ")}
                  </span>
                ) : null}
                {entry.correlationId ? <span className="sy-log__correlation mc-mono">{entry.correlationId}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
