"use client";

import type { AuditEvent, Severity } from "@friday/sdk";
import {
  Button,
  DataTable,
  Drawer,
  EmptyState,
  StatusChip,
  TagPill,
  TextField,
  Select,
  useMediaQuery,
  useToast,
  type DataTableColumn,
  type Tone,
} from "@friday/ui";
import { Copy, Download, ExternalLink, FileText, Fingerprint, History, Link2, RotateCcw, ShieldCheck, ShieldAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { KeyValue, StatusStrip, useFormatters, useQueryPanelState } from "@/features/system/common";
import { saveText } from "@/features/system/download";
import { formatMs, MISSING } from "@/features/system/format";
import { useT, type MessageKey } from "@/i18n";
import { useAgents } from "@/lib/api/domains/agents";
import { useAuditEvent, useAuditEvents, useAuditExport, type AuditCategory, type AuditExportFormat, type AuditFilters, type AuditResult } from "@/lib/api/domains/audit";
import { useAdapters } from "@/lib/api/domains/system";
import { useCapability } from "@/lib/capabilities";
import { checkChain, diffSnapshots, formatDiffValue, shortHash, type DiffEntry } from "./logic";
import "./audit.css";

const ICON = { size: 18, strokeWidth: 1.5 } as const;
const PAGE_SIZE = 100;

const CATEGORIES: readonly AuditCategory[] = ["user_action", "agent_action", "tool_call", "approval", "system", "security"];
const RESULTS: readonly AuditResult[] = ["success", "failure", "denied", "pending"];
const SEVERITIES: readonly Severity[] = ["info", "warning", "error", "critical"];

const SEVERITY_TONE: Record<Severity, Tone> = { info: "cyan", warning: "amber", error: "red", critical: "red" };
const RESULT_TONE: Record<AuditResult, Tone> = { success: "green", failure: "red", denied: "amber", pending: "blue" };

type TextFilterKey = "action" | "actor" | "taskId" | "tool";

interface FormState {
  action: string;
  actor: string;
  taskId: string;
  tool: string;
  agentId: string;
  adapterId: string;
  category: AuditCategory | "";
  severity: Severity | "";
  result: AuditResult | "";
  from: string;
  to: string;
}

const EMPTY_FORM: FormState = { action: "", actor: "", taskId: "", tool: "", agentId: "", adapterId: "", category: "", severity: "", result: "", from: "", to: "" };

/** Local `datetime-local` value -> ISO string; invalid input is dropped instead of sent. */
export function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function buildAuditFilters(form: FormState, limit: number): AuditFilters {
  const filters: AuditFilters = { limit };
  const text = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);
  const set = <K extends keyof AuditFilters>(key: K, value: AuditFilters[K] | undefined): void => {
    if (value !== undefined) filters[key] = value;
  };
  set("action", text(form.action));
  set("actor", text(form.actor));
  set("taskId", text(form.taskId));
  set("tool", text(form.tool));
  set("agentId", text(form.agentId));
  set("adapterId", text(form.adapterId));
  if (form.category) filters.category = [form.category];
  if (form.severity) filters.severity = [form.severity];
  if (form.result) filters.result = [form.result];
  set("from", toIso(form.from));
  set("to", toIso(form.to));
  return filters;
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const label = (prefix: string, value: string, t: (key: MessageKey) => string): string => t(`${prefix}.${value}` as MessageKey);

/* ── Detail (§41.3) ───────────────────────────────────────────────────── */

function DiffTable({ entries }: { entries: DiffEntry[] }) {
  const { t } = useT();
  const changed = entries.filter((entry) => entry.kind !== "unchanged");
  if (entries.length === 0) return <p className="mc-note mc-note--muted">{t("audit.detail.noSnapshots")}</p>;
  if (changed.length === 0) return <p className="mc-note mc-note--muted">{t("audit.detail.noChanges")}</p>;
  return (
    <div className="au-diff" role="table" aria-label={t("audit.detail.diff")}>
      <div className="au-diff__row au-diff__row--head" role="row">
        <span role="columnheader">{t("audit.diff.field")}</span>
        <span role="columnheader">{t("audit.diff.before")}</span>
        <span role="columnheader">{t("audit.diff.after")}</span>
      </div>
      {changed.map((entry) => (
        <div key={entry.path} className={`au-diff__row au-diff__row--${entry.kind}`} role="row">
          <span role="cell" className="mc-mono">
            {entry.path} <span className="au-diff__kind">{t(`audit.diff.${entry.kind}` as MessageKey)}</span>
          </span>
          <span role="cell" className="mc-mono au-diff__before">
            {entry.kind === "added" ? MISSING : formatDiffValue(entry.before)}
          </span>
          <span role="cell" className="mc-mono au-diff__after">
            {entry.kind === "removed" ? MISSING : formatDiffValue(entry.after)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChildEvent({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const { t } = useT();
  const query = useAuditEvent(id);
  const event = query.data?.data;
  return (
    <li className="au-child">
      <Button size="sm" variant="ghost" onClick={() => onOpen(id)} aria-label={t("audit.detail.openChild", { id })}>
        {event ? event.action : query.isError ? t("audit.detail.childUnavailable") : "…"}
      </Button>
      <span className="mc-mono mc-muted">{id}</span>
      {event ? <TagPill tone={RESULT_TONE[event.result]}>{label("audit.result", event.result, t)}</TagPill> : null}
    </li>
  );
}

export function AuditDetail({ event, onOpenEvent }: { event: AuditEvent; onOpenEvent: (id: string) => void }) {
  const { t, locale } = useT();
  const router = useRouter();
  const { toast } = useToast();
  const formatters = useFormatters();
  const hashChain = useCapability("audit", "hashChain");
  const diff = useMemo(() => diffSnapshots(event.before, event.after), [event.before, event.after]);
  const context = event.context && Object.keys(event.context).length > 0 ? JSON.stringify(event.context, null, 2) : null;
  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: t("common.copied"), tone: "green" });
    } catch {
      toast({ title: t("audit.detail.copyFailed"), tone: "red" });
    }
  };
  return (
    <div className="mc-stack" data-testid="audit-detail">
      <section className="mc-stack mc-stack--tight" aria-label={t("audit.detail.event")}>
        <h3 className="mc-subtitle">{t("audit.detail.event")}</h3>
        <div className="mc-row">
          <TagPill tone="cyan">{label("audit.category", event.category, t)}</TagPill>
          <StatusChip tone={SEVERITY_TONE[event.severity]}>{label("audit.severity", event.severity, t)}</StatusChip>
          <StatusChip tone={RESULT_TONE[event.result]}>{label("audit.result", event.result, t)}</StatusChip>
        </div>
        <p className="mc-mono au-action">{event.action}</p>
        <dl className="mc-kvlist">
          <KeyValue label={t("audit.col.time")}>{formatters.dateTime(event.occurredAt)}</KeyValue>
          <KeyValue label={t("audit.col.actor")}>{`${event.actor.name ?? event.actor.id} (${t(`audit.actor.${event.actor.type}` as MessageKey)})`}</KeyValue>
          <KeyValue label={t("audit.col.duration")} mono reason={t("audit.detail.noDuration")}>
            {event.durationMs === null ? null : formatMs(event.durationMs, locale)}
          </KeyValue>
          <KeyValue label={t("audit.detail.errorCode")} mono>
            {event.errorCode ?? null}
          </KeyValue>
          <KeyValue label={t("audit.filter.agent")} mono>
            {event.agentId ?? null}
          </KeyValue>
          <KeyValue label={t("audit.filter.tool")} mono>
            {event.tool ?? null}
          </KeyValue>
          <KeyValue label={t("audit.detail.model")}>{event.model ?? null}</KeyValue>
          <KeyValue label={t("audit.detail.reasoning")}>{event.reasoningLevel ? t(`audit.reasoning.${event.reasoningLevel}` as MessageKey) : null}</KeyValue>
          <KeyValue label={t("audit.detail.correlation")} mono>
            <span className="au-copy">
              {event.correlationId}
              <Button size="sm" variant="ghost" icon={<Copy size={12} strokeWidth={1.5} />} aria-label={t("audit.detail.copyCorrelation")} onClick={() => void copy(event.correlationId)} />
            </span>
          </KeyValue>
        </dl>
      </section>

      <section className="mc-stack mc-stack--tight" aria-label={t("audit.detail.source")}>
        <h3 className="mc-subtitle">{t("audit.detail.source")}</h3>
        <dl className="mc-kvlist">
          <KeyValue label={t("audit.filter.adapter")} mono>
            {event.adapterId ?? event.source.adapterId}
          </KeyValue>
          <KeyValue label={t("audit.detail.system")} mono>
            {event.source.system}
          </KeyValue>
          <KeyValue label={t("audit.detail.synced")}>{formatters.dateTime(event.source.lastSyncedAt)}</KeyValue>
        </dl>
      </section>

      <section className="mc-stack mc-stack--tight" aria-label={t("audit.detail.links")}>
        <h3 className="mc-subtitle">{t("audit.detail.links")}</h3>
        <div className="mc-row">
          {event.approvalId ? (
            <Button size="sm" variant="ghost" icon={<ShieldCheck size={13} strokeWidth={1.5} />} onClick={() => router.push(`/approvals?approval=${encodeURIComponent(event.approvalId ?? "")}`)}>
              {t("audit.detail.openApproval")}
            </Button>
          ) : (
            <span className="mc-note mc-note--muted">{t("audit.detail.noApproval")}</span>
          )}
          {event.taskId ? (
            <Button size="sm" variant="ghost" icon={<ExternalLink size={13} strokeWidth={1.5} />} onClick={() => router.push(`/tasks?task=${encodeURIComponent(event.taskId ?? "")}`)}>
              {t("audit.detail.openTask")}
            </Button>
          ) : null}
        </div>
      </section>

      <section className="mc-stack mc-stack--tight" aria-label={t("audit.detail.diff")}>
        <h3 className="mc-subtitle">{t("audit.detail.diff")}</h3>
        <DiffTable entries={diff} />
      </section>

      <section className="mc-stack mc-stack--tight" aria-label={t("audit.detail.context")}>
        <h3 className="mc-subtitle">{t("audit.detail.context")}</h3>
        {context ? (
          <pre className="mc-pre" tabIndex={0}>
            {context}
          </pre>
        ) : (
          <p className="mc-note mc-note--muted">{t("audit.detail.noContext")}</p>
        )}
        <p className="mc-note mc-note--muted">{t("audit.detail.redacted")}</p>
      </section>

      <section className="mc-stack mc-stack--tight" aria-label={t("audit.detail.children")}>
        <h3 className="mc-subtitle">
          <Link2 size={12} strokeWidth={1.5} aria-hidden="true" /> {t("audit.detail.children")}
        </h3>
        {event.childEventIds.length === 0 ? (
          <p className="mc-note mc-note--muted">{t("audit.detail.noChildren")}</p>
        ) : (
          <ul className="mc-list">
            {event.childEventIds.map((id) => (
              <ChildEvent key={id} id={id} onOpen={onOpenEvent} />
            ))}
          </ul>
        )}
      </section>

      <section className="mc-stack mc-stack--tight" aria-label={t("audit.detail.artifacts")}>
        <h3 className="mc-subtitle">
          <FileText size={12} strokeWidth={1.5} aria-hidden="true" /> {t("audit.detail.artifacts")}
        </h3>
        {event.artifactIds.length === 0 ? (
          <p className="mc-note mc-note--muted">{t("audit.detail.noArtifacts")}</p>
        ) : (
          <ul className="mc-list">
            {event.artifactIds.map((id) => (
              <li key={id} className="au-child">
                <span className="mc-mono">{id}</span>
                {id.startsWith("file_") ? (
                  <Button size="sm" variant="ghost" onClick={() => router.push(`/files?file=${encodeURIComponent(id)}`)}>
                    {t("audit.detail.openFile")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {hashChain ? (
        <section className="mc-stack mc-stack--tight" aria-label={t("audit.detail.integrity")}>
          <h3 className="mc-subtitle">
            <Fingerprint size={12} strokeWidth={1.5} aria-hidden="true" /> {t("audit.detail.integrity")}
          </h3>
          <dl className="mc-kvlist mc-kvlist--single">
            <KeyValue label={t("audit.detail.hash")} mono>
              <span title={event.hash}>{shortHash(event.hash)}</span>
            </KeyValue>
            <KeyValue label={t("audit.detail.prevHash")} mono reason={t("audit.detail.firstEvent")}>
              {event.prevHash ? <span title={event.prevHash}>{shortHash(event.prevHash)}</span> : null}
            </KeyValue>
            <KeyValue label={t("audit.detail.sequence")} mono>
              {String(event.sequence)}
            </KeyValue>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/* ── Filters (§41.2) ──────────────────────────────────────────────────── */

function FilterForm({ form, onChange, onReset, dirty }: { form: FormState; onChange: (patch: Partial<FormState>) => void; onReset: () => void; dirty: boolean }) {
  const { t } = useT();
  const agents = useAgents();
  const adapters = useAdapters();
  const text = (key: TextFilterKey, labelKey: MessageKey, placeholderKey?: MessageKey) => (
    <TextField label={t(labelKey)} value={form[key]} placeholder={placeholderKey ? t(placeholderKey) : undefined} onChange={(event) => onChange({ [key]: event.target.value })} />
  );
  const resetBlocked = dirty ? undefined : t("audit.filter.resetIdle");
  return (
    <form className="au-filters" role="search" aria-label={t("audit.filter.title")} onSubmit={(event) => event.preventDefault()}>
      {text("action", "audit.filter.action", "audit.filter.actionPlaceholder")}
      <Select
        label={t("audit.filter.category")}
        value={form.category}
        onChange={(event) => onChange({ category: event.target.value as FormState["category"] })}
        options={[{ value: "", label: t("common.all") }, ...CATEGORIES.map((value) => ({ value, label: label("audit.category", value, t) }))]}
      />
      <Select
        label={t("audit.filter.severity")}
        value={form.severity}
        onChange={(event) => onChange({ severity: event.target.value as FormState["severity"] })}
        options={[{ value: "", label: t("common.all") }, ...SEVERITIES.map((value) => ({ value, label: label("audit.severity", value, t) }))]}
      />
      <Select
        label={t("audit.filter.result")}
        value={form.result}
        onChange={(event) => onChange({ result: event.target.value as FormState["result"] })}
        options={[{ value: "", label: t("common.all") }, ...RESULTS.map((value) => ({ value, label: label("audit.result", value, t) }))]}
      />
      {text("actor", "audit.filter.actor", "audit.filter.actorPlaceholder")}
      <Select
        label={t("audit.filter.agent")}
        value={form.agentId}
        onChange={(event) => onChange({ agentId: event.target.value })}
        options={[{ value: "", label: t("common.all") }, ...(agents.data?.items ?? []).map((agent) => ({ value: agent.id, label: agent.name }))]}
      />
      {text("taskId", "audit.filter.task", "audit.filter.taskPlaceholder")}
      {text("tool", "audit.filter.tool", "audit.filter.toolPlaceholder")}
      <Select
        label={t("audit.filter.adapter")}
        value={form.adapterId}
        onChange={(event) => onChange({ adapterId: event.target.value })}
        options={[
          { value: "", label: t("common.all") },
          ...(adapters.data?.items ?? []).map((adapter) => ({ value: adapter.manifest.id, label: adapter.manifest.name })),
          // A deep link may name an adapter the list does not contain (yet); keep it selectable instead of dropping it.
          ...(form.adapterId && !(adapters.data?.items ?? []).some((adapter) => adapter.manifest.id === form.adapterId) ? [{ value: form.adapterId, label: form.adapterId }] : []),
        ]}
      />
      <TextField type="datetime-local" label={t("audit.filter.from")} value={form.from} onChange={(event) => onChange({ from: event.target.value })} />
      <TextField type="datetime-local" label={t("audit.filter.to")} value={form.to} onChange={(event) => onChange({ to: event.target.value })} />
      <div className="au-filters__reset">
        <Button size="sm" variant="ghost" icon={<RotateCcw size={13} strokeWidth={1.5} />} disabled={resetBlocked !== undefined} title={resetBlocked} onClick={onReset}>
          {t("audit.filter.reset")}
        </Button>
      </div>
    </form>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function formFromParams(params: URLSearchParams): FormState {
  return {
    ...EMPTY_FORM,
    action: params.get("action") ?? "",
    actor: params.get("actor") ?? "",
    taskId: params.get("taskId") ?? "",
    tool: params.get("tool") ?? "",
    agentId: params.get("agentId") ?? "",
    adapterId: params.get("adapter") ?? "",
  };
}

function AuditContent() {
  const { t, locale } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const formatters = useFormatters();
  const canExport = useCapability("audit", "export");
  const hashChain = useCapability("audit", "hashChain");
  const exporter = useAuditExport();
  const narrow = useMediaQuery("(max-width: 700px)");
  const [filtersOpen, setFiltersOpen] = useState<boolean | null>(null);
  const showFilters = filtersOpen ?? !narrow;
  const [form, setForm] = useState<FormState>(() => formFromParams(params));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const debouncedForm = useDebounced(form, 300);
  const filters = useMemo(() => buildAuditFilters(debouncedForm, limit), [debouncedForm, limit]);
  const query = useAuditEvents(filters);
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);
  const selectedId = params.get("event");
  const selectedFromList = items.find((event) => event.id === selectedId);
  const detailQuery = useAuditEvent(selectedId && !selectedFromList ? selectedId : null);
  const selected = selectedFromList ?? detailQuery.data?.data;
  const chain = useMemo(() => checkChain(items), [items]);

  const state = useQueryPanelState(query, {
    module: "audit",
    empty: query.isSuccess && items.length === 0,
    emptyTitle: dirty ? t("audit.empty.filtered") : t("audit.empty.title"),
    emptyDescription: dirty ? t("audit.empty.filteredDescription") : t("audit.empty.description"),
    emptyIcon: <History {...ICON} />,
    freshness: query.data?.freshness,
  });

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("event", id);
      else next.delete("event");
      const qs = next.toString();
      router.replace(qs ? `/audit?${qs}` : "/audit", { scroll: false });
    },
    [params, router],
  );

  const columns = useMemo<DataTableColumn<AuditEvent>[]>(
    () => [
      { id: "time", header: t("audit.col.time"), width: "160px", sortable: true, sortValue: (e) => e.occurredAt, cell: (e) => <span title={e.occurredAt}>{formatters.dateTime(e.occurredAt)}</span> },
      { id: "actor", header: t("audit.col.actor"), width: "minmax(110px, 1fr)", sortable: true, sortValue: (e) => e.actor.name ?? e.actor.id, cell: (e) => e.actor.name ?? e.actor.id },
      { id: "action", header: t("audit.col.action"), width: "minmax(160px, 1.6fr)", sortable: true, sortValue: (e) => e.action, cell: (e) => <span className="mc-mono au-clip">{e.action}</span> },
      { id: "category", header: t("audit.col.category"), width: "130px", sortable: true, sortValue: (e) => e.category, cell: (e) => <TagPill tone="cyan">{label("audit.category", e.category, t)}</TagPill> },
      { id: "severity", header: t("audit.col.severity"), width: "125px", sortable: true, sortValue: (e) => SEVERITIES.indexOf(e.severity), cell: (e) => <StatusChip tone={SEVERITY_TONE[e.severity]}>{label("audit.severity", e.severity, t)}</StatusChip> },
      { id: "result", header: t("audit.col.result"), width: "135px", sortable: true, sortValue: (e) => e.result, cell: (e) => <StatusChip tone={RESULT_TONE[e.result]}>{label("audit.result", e.result, t)}</StatusChip> },
      { id: "duration", header: t("audit.col.duration"), width: "90px", align: "right", mono: true, sortable: true, sortValue: (e) => e.durationMs, cell: (e) => formatMs(e.durationMs, locale) },
      { id: "adapter", header: t("audit.col.adapter"), width: "minmax(110px, 1fr)", hideInCards: true, cell: (e) => <span className="mc-mono au-clip mc-muted">{e.adapterId ?? e.source.adapterId}</span> },
    ],
    [t, locale, formatters],
  );

  const runExport = (format: AuditExportFormat): void => {
    exporter.mutate(
      { format, from: toIso(form.from), to: toIso(form.to) },
      {
        onSuccess: (result) => {
          const mime = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "application/x-ndjson";
          saveText(result.body, `audit-export-${new Date().toISOString().slice(0, 10)}.${format}`, mime);
          toast({ title: t("audit.export.done", { format: format.toUpperCase() }), tone: "green" });
        },
      },
    );
  };

  const integrity = (() => {
    if (!hashChain) return null;
    if (items.length < 2) return { tone: "muted" as const, icon: <ShieldCheck size={13} strokeWidth={1.5} />, text: t("audit.integrity.tooFew") };
    if (chain.broken.length > 0) return { tone: "red" as const, icon: <ShieldAlert size={13} strokeWidth={1.5} />, text: t("audit.integrity.broken", { sequence: chain.broken[0] ?? 0 }) };
    return { tone: "green" as const, icon: <ShieldCheck size={13} strokeWidth={1.5} />, text: t("audit.integrity.ok", { count: chain.linked }) };
  })();

  return (
    <div className="mc-page au-page">
      <PanelFrame
        title={t("audit.filter.title")}
        subtitle={narrow ? undefined : t("audit.filter.subtitle")}
        icon={<History {...ICON} />}
        actions={
          narrow ? (
            <Button size="sm" variant="ghost" aria-expanded={showFilters} aria-controls="audit-filters" onClick={() => setFiltersOpen(!showFilters)}>
              {showFilters ? t("audit.filter.hide") : dirty ? t("audit.filter.showActive") : t("audit.filter.show")}
            </Button>
          ) : null
        }
        state={{ kind: "ready" }}
      >
        <div id="audit-filters" hidden={!showFilters}>
          <FilterForm form={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} onReset={() => { setForm(EMPTY_FORM); setLimit(PAGE_SIZE); }} dirty={dirty} />
        </div>
      </PanelFrame>
      <PanelFrame
        title={t("audit.list.title")}
        subtitle={t("audit.list.subtitle", { count: items.length })}
        icon={<History {...ICON} />}
        actions={<StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />}
        state={state}
        skeletonRows={8}
      >
        <div className="mc-stack">
          <div className="mc-toolbar au-bar">
            {integrity ? (
              <StatusChip tone={integrity.tone} icon={integrity.icon} dot={false} data-testid="audit-integrity" title={t("audit.integrity.hint")}>
                {integrity.text}
              </StatusChip>
            ) : null}
            <span className="mc-spacer" />
            <span className="mc-muted au-bar__label">{t("audit.export.label")}</span>
            {(["json", "ndjson", "csv"] as const).map((format) => (
              <Button
                key={format}
                size="sm"
                variant="ghost"
                icon={<Download size={13} strokeWidth={1.5} />}
                disabled={!canExport}
                loading={exporter.isPending && exporter.variables?.format === format}
                title={canExport ? undefined : t("audit.export.unavailable")}
                onClick={() => runExport(format)}
              >
                {format.toUpperCase()}
              </Button>
            ))}
          </div>
          <p className="mc-note mc-note--muted">{canExport ? t("audit.export.scope") : t("audit.export.unavailable")}</p>
          <DataTable<AuditEvent>
            label={t("audit.list.title")}
            columns={columns}
            rows={items}
            getRowId={(e) => e.id}
            height={560}
            rowHeight={42}
            manualSort={false}
            selectedId={selectedId ?? undefined}
            onRowActivate={(e) => select(e.id)}
            cardBreakpoint={860}
            totalCount={query.data?.pageInfo.totalCount}
            empty={<EmptyState compact title={t("audit.empty.title")} />}
            countLabel={(shown, total) => t("audit.list.count", { shown, total })}
          />
          {query.data?.pageInfo.hasNextPage ? (
            <div className="au-more">
              <Button size="sm" variant="ghost" loading={query.isFetching} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                {t("audit.list.more")}
              </Button>
            </div>
          ) : null}
        </div>
      </PanelFrame>
      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) select(null);
        }}
        title={selected?.action ?? t("audit.detail.title")}
        subtitle={selected?.id}
        icon={<History size={18} strokeWidth={1.5} />}
        width={560}
      >
        {selected ? <AuditDetail event={selected} onOpenEvent={select} /> : null}
      </Drawer>
    </div>
  );
}

export function AuditPage() {
  return (
    <Suspense fallback={null}>
      <AuditContent />
    </Suspense>
  );
}
