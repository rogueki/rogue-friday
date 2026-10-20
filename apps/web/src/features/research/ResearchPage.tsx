"use client";

import type {
  Progress,
  ResearchArtifact,
  ResearchFinding,
  ResearchProject,
  ResearchSource,
} from "@friday/sdk";
import {
  Button,
  DataTable,
  Drawer,
  EmptyState,
  MetricCard,
  StatusChip,
  TagPill,
  Tabs,
  useToast,
  type DataTableColumn,
  type Tone,
} from "@friday/ui";
import {
  AlertTriangle,
  BookOpen,
  Clock,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  FlaskConical,
  Link2,
  Quote,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PanelFrame } from "@/components/PanelFrame";
import { KeyValue, StatusStrip, useFormatters, useQueryPanelState } from "@/features/system/common";
import { saveText, slugify } from "@/features/system/download";
import { formatCurrencyEur, formatFraction, formatRuntime, MISSING } from "@/features/system/format";
import { PanelStateBody } from "@/features/system/PanelStateBody";
import { useT, type MessageKey } from "@/i18n";
import { useAgents } from "@/lib/api/domains/agents";
import {
  useResearchArtifacts,
  useResearchFindings,
  useResearchProject,
  useResearchProjects,
  useResearchSources,
} from "@/lib/api/domains/research";
import { useCapability } from "@/lib/capabilities";
import { useRunStagedWrite, useStagedWriteBusy } from "@/lib/api/stagedWrite";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { useSession } from "@/lib/session";
import {
  buildResearchJson,
  buildResearchMarkdown,
  findingsForSource,
  mapFindingEvidence,
  type ResearchBundle,
} from "./export";
import "./research.css";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

const STATUS_TONE: Record<ResearchProject["status"], Tone> = {
  planning: "blue",
  running: "cyan",
  review: "amber",
  done: "green",
  failed: "red",
  cancelled: "muted",
};
const FINDING_TONE: Record<ResearchFinding["status"], Tone> = {
  draft: "muted",
  verified: "green",
  disputed: "amber",
  rejected: "red",
};
const SOURCE_TONE: Record<ResearchSource["status"], Tone> = {
  queued: "muted",
  retrieved: "green",
  failed: "red",
  excluded: "amber",
};

const statusLabel = (status: ResearchProject["status"], t: (key: MessageKey) => string): string =>
  t(`research.status.${status}` as MessageKey);

/** Real progress only: an unknown value is stated as unknown, never drawn as 0 % or invented (PLAN §58). */
export function ProgressMeter({ progress }: { progress: Progress }) {
  const { t } = useT();
  if (progress.mode === "determinate" && progress.value !== null) {
    const percent = Math.round(Math.min(1, Math.max(0, progress.value)) * 100);
    return (
      <div className="rs-progress">
        <div
          className="mc-progress"
          role="progressbar"
          aria-label={t("research.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <span className="mc-mono">{percent} %</span>
      </div>
    );
  }
  if (progress.mode === "indeterminate") {
    return (
      <div className="rs-progress">
        <div
          className="mc-progress mc-progress--indeterminate"
          role="progressbar"
          aria-label={t("research.progress")}
          aria-valuetext={t("research.progress.indeterminate")}
        >
          <span />
        </div>
        <span className="mc-muted">{t("research.progress.indeterminate")}</span>
      </div>
    );
  }
  return (
    <span className="mc-null" title={t("research.progress.noneReason")}>
      {t("research.progress.none")}
    </span>
  );
}

/* ── Project list ─────────────────────────────────────────────────────── */

function ProjectList({
  projects,
  activeId,
  onSelect,
}: {
  projects: ResearchProject[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const { t } = useT();
  const formatters = useFormatters();
  return (
    <ul className="mc-list rs-projects">
      {projects.map((project) => (
        <li key={project.id}>
          <button
            type="button"
            className={`rs-project${project.id === activeId ? " rs-project--active" : ""}`}
            aria-pressed={project.id === activeId}
            onClick={() => onSelect(project.id)}
          >
            <span className="rs-project__top">
              <strong>{project.topic}</strong>
              <StatusChip tone={STATUS_TONE[project.status]} pulse={project.status === "running"}>
                {statusLabel(project.status, t)}
              </StatusChip>
            </span>
            <ProgressMeter progress={project.progress} />
            <span className="rs-project__meta mc-muted">
              {t("research.list.counts", { sources: project.sourceCount, findings: project.findingCount })} ·{" "}
              {formatters.relative(project.updatedAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ── Sources view (§36.2) ─────────────────────────────────────────────── */

function SourcesTab({
  sources,
  findings,
  selectedId,
  onSelect,
}: {
  sources: ResearchSource[];
  findings: ResearchFinding[];
  selectedId: string | undefined;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useT();
  const formatters = useFormatters();
  const columns = useMemo<DataTableColumn<ResearchSource>[]>(
    () => [
      {
        id: "title",
        header: t("research.source.title"),
        width: "minmax(180px, 2fr)",
        sortable: true,
        sortValue: (s) => s.title,
        cell: (s) => (
          <span className="rs-src-title">
            <strong>{s.title}</strong>
          </span>
        ),
      },
      {
        id: "domain",
        header: t("research.source.domain"),
        width: "minmax(120px, 1fr)",
        sortable: true,
        sortValue: (s) => s.domain,
        cell: (s) => <span className="mc-mono">{s.domain}</span>,
      },
      {
        id: "retrievedAt",
        header: t("research.source.retrievedAt"),
        width: "130px",
        sortable: true,
        sortValue: (s) => s.retrievedAt,
        cell: (s) =>
          s.retrievedAt ? formatters.relative(s.retrievedAt) : <span className="mc-null">{MISSING}</span>,
      },
      {
        id: "relevance",
        header: t("research.source.relevance"),
        width: "90px",
        align: "right",
        mono: true,
        sortable: true,
        sortValue: (s) => s.relevance,
        cell: (s) => formatFraction(s.relevance, formatters.locale),
      },
      {
        id: "reliability",
        header: t("research.source.reliability"),
        width: "110px",
        align: "right",
        mono: true,
        sortable: true,
        sortValue: (s) => s.reliability,
        cell: (s) => formatFraction(s.reliability, formatters.locale),
      },
      {
        id: "supports",
        header: t("research.source.supports"),
        width: "minmax(180px, 2fr)",
        cell: (s) => (
          <span className="rs-clip" title={s.supportsStatement ?? undefined}>
            {s.supportsStatement ?? MISSING}
          </span>
        ),
      },
      {
        id: "status",
        header: t("research.source.status"),
        width: "120px",
        sortable: true,
        sortValue: (s) => s.status,
        cell: (s) => (
          <TagPill tone={SOURCE_TONE[s.status]}>
            {t(`research.source.status.${s.status}` as MessageKey)}
          </TagPill>
        ),
      },
    ],
    [t, formatters],
  );
  const selected = sources.find((source) => source.id === selectedId);
  return (
    <>
      <DataTable<ResearchSource>
        label={t("research.tab.sources")}
        columns={columns}
        rows={sources}
        getRowId={(s) => s.id}
        height={Math.min(520, 62 + sources.length * 44)}
        rowHeight={44}
        selectedId={selectedId}
        onRowActivate={(s) => onSelect(s.id)}
        cardBreakpoint={820}
        defaultSort={{ columnId: "relevance", direction: "desc" }}
        empty={
          <EmptyState
            compact
            title={t("research.sources.empty")}
            description={t("research.sources.emptyDescription")}
            icon={<BookOpen {...ICON} />}
          />
        }
        countLabel={(shown, total) => t("research.sources.count", { shown, total })}
      />
      <Drawer
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) onSelect(null);
        }}
        title={selected?.title ?? t("research.tab.sources")}
        subtitle={selected?.domain}
        icon={<BookOpen size={18} strokeWidth={1.5} />}
        width={460}
      >
        {selected ? (
          <SourceDetail source={selected} findings={findingsForSource(selected.id, findings)} />
        ) : null}
      </Drawer>
    </>
  );
}

const isHttpUrl = (url: string | undefined): url is string =>
  typeof url === "string" && /^https?:\/\//i.test(url);

function SourceDetail({ source, findings }: { source: ResearchSource; findings: ResearchFinding[] }) {
  const { t, locale } = useT();
  const formatters = useFormatters();
  return (
    <div className="mc-stack">
      <div className="mc-row">
        <TagPill tone={SOURCE_TONE[source.status]}>
          {t(`research.source.status.${source.status}` as MessageKey)}
        </TagPill>
      </div>
      <dl className="mc-kvlist">
        <KeyValue label={t("research.source.domain")} mono>
          {source.domain}
        </KeyValue>
        <KeyValue label={t("research.source.retrievedAt")} reason={t("research.source.notRetrieved")}>
          {source.retrievedAt ? formatters.dateTime(source.retrievedAt) : null}
        </KeyValue>
        <KeyValue label={t("research.source.relevance")} mono>
          {formatFraction(source.relevance, locale)}
        </KeyValue>
        <KeyValue label={t("research.source.reliability")} mono>
          {formatFraction(source.reliability, locale)}
        </KeyValue>
      </dl>
      {source.status === "failed" ? (
        <p className="mc-note mc-note--muted">
          {t("research.source.fetchFailed")}
          {source.fetchError ? ` (${source.fetchError})` : ""}
        </p>
      ) : null}
      <section>
        <h3 className="mc-subtitle">
          <Quote size={12} strokeWidth={1.5} aria-hidden="true" />{" "}
          {t(source.status === "retrieved" ? "research.source.pageExcerpt" : "research.source.excerpt")}
        </h3>
        {source.excerpt ? (
          <blockquote className="rs-quote">{source.excerpt}</blockquote>
        ) : (
          <p className="mc-note mc-note--muted">{t("research.source.noExcerpt")}</p>
        )}
      </section>
      {source.contentText ? (
        <details className="rs-page-content">
          <summary>{t("research.source.pageContent")}</summary>
          <p>{source.contentText}</p>
          {source.contentHash ? <small className="mc-mono">SHA-256: {source.contentHash}</small> : null}
        </details>
      ) : null}
      <section>
        <h3 className="mc-subtitle">{t("research.source.supports")}</h3>
        <p className="mc-note">{source.supportsStatement ?? <span className="mc-null">{MISSING}</span>}</p>
      </section>
      <section>
        <h3 className="mc-subtitle">{t("research.source.citedBy")}</h3>
        {findings.length === 0 ? (
          <p className="mc-note mc-note--muted">{t("research.source.citedByNone")}</p>
        ) : (
          <ul className="mc-list">
            {findings.map((finding) => (
              <li key={finding.id} className="rs-cite">
                {finding.statement}
              </li>
            ))}
          </ul>
        )}
      </section>
      {isHttpUrl(source.url) ? (
        <p className="mc-note">
          <a className="rs-link" href={source.url} target="_blank" rel="noopener noreferrer nofollow">
            <ExternalLink size={13} strokeWidth={1.5} aria-hidden="true" /> {t("research.source.open")}
          </a>
          <span className="mc-muted mc-mono rs-url">{source.url}</span>
        </p>
      ) : null}
    </div>
  );
}

/* ── Findings with evidence (§36.3) ───────────────────────────────────── */

function FindingsTab({
  findings,
  sources,
  onOpenSource,
}: {
  findings: ResearchFinding[];
  sources: ResearchSource[];
  onOpenSource: (id: string) => void;
}) {
  const { t, locale } = useT();
  const evidence = useMemo(() => mapFindingEvidence(findings, sources), [findings, sources]);
  if (evidence.length === 0)
    return (
      <EmptyState
        compact
        title={t("research.findings.empty")}
        description={t("research.findings.emptyDescription")}
        icon={<FlaskConical {...ICON} />}
      />
    );
  return (
    <ol className="mc-list rs-findings">
      {evidence.map(({ finding, supporting, missingSourceIds }, index) => (
        <li key={finding.id} className="rs-finding">
          <div className="rs-finding__head">
            <span className="rs-finding__no mc-mono">{index + 1}</span>
            <p className="rs-finding__statement">{finding.statement}</p>
            <span className="rs-finding__tags">
              <TagPill tone={FINDING_TONE[finding.status]}>
                {t(`research.finding.status.${finding.status}` as MessageKey)}
              </TagPill>
              <TagPill tone="muted">
                {t("research.finding.confidence", { value: formatFraction(finding.confidence, locale) })}
              </TagPill>
            </span>
          </div>
          <div className="rs-finding__evidence">
            <span className="mc-subtitle rs-finding__label">
              <Link2 size={12} strokeWidth={1.5} aria-hidden="true" /> {t("research.finding.supportedBy")}
            </span>
            {supporting.length === 0 && missingSourceIds.length === 0 ? (
              <span className="mc-note mc-note--muted">{t("research.finding.noSources")}</span>
            ) : null}
            {supporting.map((source) => (
              <button
                key={source.id}
                type="button"
                className="rs-sourcechip"
                onClick={() => onOpenSource(source.id)}
                title={source.supportsStatement ?? source.title}
              >
                <strong>{source.domain}</strong>
                <span>{source.title}</span>
                <span className="mc-mono">{formatFraction(source.reliability, locale)}</span>
              </button>
            ))}
            {missingSourceIds.map((id) => (
              <span
                key={id}
                className="rs-sourcechip rs-sourcechip--missing mc-mono"
                title={t("research.finding.missingSource")}
              >
                {id}
              </span>
            ))}
          </div>
          {finding.contradictions.length > 0 ? (
            <ul className="rs-contradictions">
              {finding.contradictions.map((contradiction, n) => (
                <li key={n}>
                  <AlertTriangle size={13} strokeWidth={1.5} aria-hidden="true" /> {contradiction.description}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ContradictionsTab({ findings }: { findings: ResearchFinding[] }) {
  const { t } = useT();
  const entries = findings.filter((finding) => finding.contradictions.length > 0);
  if (entries.length === 0)
    return (
      <EmptyState
        compact
        title={t("research.contradictions.empty")}
        description={t("research.contradictions.emptyDescription")}
        icon={<AlertTriangle {...ICON} />}
      />
    );
  return (
    <ul className="mc-list">
      {entries.map((finding) => (
        <li key={finding.id} className="rs-finding">
          <p className="rs-finding__statement">{finding.statement}</p>
          <ul className="rs-contradictions">
            {finding.contradictions.map((contradiction, n) => (
              <li key={n}>
                <AlertTriangle size={13} strokeWidth={1.5} aria-hidden="true" /> {contradiction.description}
                {contradiction.sourceId ? (
                  <span className="mc-mono mc-muted"> · {contradiction.sourceId}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function ArtifactsTab({ artifacts }: { artifacts: ResearchArtifact[] }) {
  const { t, locale } = useT();
  const router = useRouter();
  if (artifacts.length === 0)
    return <EmptyState compact title={t("research.artifacts.empty")} icon={<FileText {...ICON} />} />;
  return (
    <ul className="mc-list">
      {artifacts.map((artifact) => (
        <li key={artifact.id} className="rs-artifact">
          <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="rs-artifact__name">
            <strong>{artifact.name}</strong>
            <span className="mc-muted">
              {artifact.format.toUpperCase()} ·{" "}
              {artifact.sizeBytes === null
                ? MISSING
                : new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB").format(artifact.sizeBytes) +
                  " B"}
            </span>
          </span>
          {artifact.fileId ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<ExternalLink size={13} strokeWidth={1.5} />}
              onClick={() => router.push(`/files?file=${encodeURIComponent(artifact.fileId ?? "")}`)}
            >
              {t("research.artifact.openFile")}
            </Button>
          ) : (
            <span className="mc-note mc-note--muted">{t("research.artifact.noFile")}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Export (§36.4) ───────────────────────────────────────────────────── */

function ExportBar({ bundle, ready }: { bundle: ResearchBundle | null; ready: boolean }) {
  const { t } = useT();
  const canExport = useCapability("research", "export");
  const disabled = !canExport || !ready || bundle === null;
  const reason = !canExport
    ? t("research.export.unavailable")
    : !ready
      ? t("research.export.notReady")
      : undefined;
  const run = (kind: "md" | "json"): void => {
    if (!bundle) return;
    const base = `recherche-${slugify(bundle.project.topic)}`;
    if (kind === "md")
      saveText(
        buildResearchMarkdown({ ...bundle, exportedAt: new Date().toISOString() }),
        `${base}.md`,
        "text/markdown",
      );
    else
      saveText(
        buildResearchJson({ ...bundle, exportedAt: new Date().toISOString() }),
        `${base}.json`,
        "application/json",
      );
  };
  return (
    <div className="mc-stack">
      <div className="mc-toolbar" role="group" aria-label={t("research.export.title")}>
        <Button
          size="sm"
          variant="primary"
          icon={<Download size={14} strokeWidth={1.5} />}
          disabled={disabled}
          title={reason}
          onClick={() => run("md")}
        >
          {t("research.export.markdown")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<FileJson size={14} strokeWidth={1.5} />}
          disabled={disabled}
          title={reason}
          onClick={() => run("json")}
        >
          {t("research.export.json")}
        </Button>
        {(["PDF", "DOCX", "PPTX"] as const).map((format) => (
          <Button key={format} size="sm" variant="ghost" disabled title={t("research.export.later")}>
            {format} <span className="rs-later">{t("research.export.laterShort")}</span>
          </Button>
        ))}
      </div>
      {reason ? <p className="mc-note mc-note--muted">{reason}</p> : null}
    </div>
  );
}

/* ── Project view (§36.1) ─────────────────────────────────────────────── */

function ProjectView({ project }: { project: ResearchProject }) {
  const { t, locale } = useT();
  const formatters = useFormatters();
  const [tab, setTab] = useState("findings");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const sourcesQuery = useResearchSources(project.id);
  const findingsQuery = useResearchFindings(project.id);
  const artifactsQuery = useResearchArtifacts(project.id);
  const agentsQuery = useAgents();
  const agentNames = useMemo(
    () => Object.fromEntries((agentsQuery.data?.items ?? []).map((agent) => [agent.id, agent.name])),
    [agentsQuery.data],
  );
  const sources = useMemo(() => sourcesQuery.data?.items ?? [], [sourcesQuery.data]);
  const findings = useMemo(() => findingsQuery.data?.items ?? [], [findingsQuery.data]);
  const artifacts = useMemo(() => artifactsQuery.data?.items ?? [], [artifactsQuery.data]);
  const sourcesState = useQueryPanelState(sourcesQuery, { module: "research" });
  const findingsState = useQueryPanelState(findingsQuery, { module: "research" });
  const artifactsState = useQueryPanelState(artifactsQuery, { module: "research" });
  const ready = Boolean(sourcesQuery.data && findingsQuery.data && artifactsQuery.data);
  const bundle: ResearchBundle | null = ready
    ? { project, sources, findings, artifacts, agentNames, exportedAt: "" }
    : null;
  const agents = project.agentIds.map((id) => agentNames[id] ?? id);

  const openSource = useCallback((id: string) => {
    setTab("sources");
    setSourceId(id);
  }, []);

  return (
    <div className="mc-stack">
      <PanelFrame
        title={project.topic}
        subtitle={t("research.project.brief")}
        icon={<FlaskConical {...ICON} />}
        level={2}
        actions={
          <StatusStrip
            freshness={{ state: "fresh", asOf: project.updatedAt }}
            source={project.source.system}
          />
        }
        state={{ kind: "ready" }}
      >
        <div className="mc-stack">
          <p className="mc-note rs-brief">{project.mission}</p>
          <div className="mc-row">
            <StatusChip tone={STATUS_TONE[project.status]} pulse={project.status === "running"}>
              {statusLabel(project.status, t)}
            </StatusChip>
            <span className="rs-progress-wide">
              <ProgressMeter progress={project.progress} />
            </span>
          </div>
          <div className="mc-grid mc-grid--4 rs-metrics">
            <MetricCard
              label={t("research.metric.sources")}
              value={project.sourceCount}
              icon={<BookOpen size={16} strokeWidth={1.5} />}
            />
            <MetricCard
              label={t("research.metric.findings")}
              value={project.findingCount}
              icon={<FlaskConical size={16} strokeWidth={1.5} />}
            />
            <MetricCard
              label={t("research.metric.contradictions")}
              value={project.contradictionCount}
              tone={project.contradictionCount > 0 ? "amber" : "muted"}
              icon={<AlertTriangle size={16} strokeWidth={1.5} />}
            />
            <MetricCard
              label={t("research.metric.artifacts")}
              value={project.artifactCount}
              icon={<FileText size={16} strokeWidth={1.5} />}
            />
          </div>
          <dl className="mc-kvlist">
            <KeyValue label={t("research.project.agents")}>
              {agents.length > 0 ? agents.join(", ") : null}
            </KeyValue>
            <KeyValue label={t("research.project.runtime")} reason={t("research.project.noRuntime")}>
              {project.runtimeMs === null ? null : (
                <span className="mc-row">
                  <Clock size={13} strokeWidth={1.5} aria-hidden="true" /> {formatRuntime(project.runtimeMs)}
                </span>
              )}
            </KeyValue>
            <KeyValue label={t("research.project.cost")} reason={t("research.project.noCost")}>
              {project.costEur === null || project.costEur === undefined
                ? null
                : formatCurrencyEur(project.costEur, locale)}
            </KeyValue>
            <KeyValue label={t("research.project.updated")}>
              {formatters.dateTime(project.updatedAt)}
            </KeyValue>
          </dl>
          <section aria-label={t("research.project.result")}>
            <h3 className="mc-subtitle">{t("research.project.result")}</h3>
            {project.resultSummary ? (
              <p className="mc-note">{project.resultSummary}</p>
            ) : (
              <p className="mc-note mc-note--muted">{t("research.project.noResult")}</p>
            )}
          </section>
        </div>
      </PanelFrame>
      <PanelFrame title={t("research.detail.title")} icon={<BookOpen {...ICON} />} state={{ kind: "ready" }}>
        <Tabs
          label={t("research.detail.tabs")}
          value={tab}
          onValueChange={setTab}
          items={[
            {
              id: "findings",
              label: t("research.tab.findings"),
              count: project.findingCount,
              content: (
                <PanelStateBody state={findingsState}>
                  <FindingsTab findings={findings} sources={sources} onOpenSource={openSource} />
                </PanelStateBody>
              ),
            },
            {
              id: "sources",
              label: t("research.tab.sources"),
              count: project.sourceCount,
              content: (
                <PanelStateBody state={sourcesState}>
                  <SourcesTab
                    sources={sources}
                    findings={findings}
                    selectedId={sourceId ?? undefined}
                    onSelect={setSourceId}
                  />
                </PanelStateBody>
              ),
            },
            {
              id: "contradictions",
              label: t("research.tab.contradictions"),
              count: project.contradictionCount,
              content: (
                <PanelStateBody state={findingsState}>
                  <ContradictionsTab findings={findings} />
                </PanelStateBody>
              ),
            },
            {
              id: "artifacts",
              label: t("research.tab.artifacts"),
              count: project.artifactCount,
              content: (
                <PanelStateBody state={artifactsState}>
                  <ArtifactsTab artifacts={artifacts} />
                </PanelStateBody>
              ),
            },
            {
              id: "export",
              label: t("research.tab.export"),
              content: <ExportBar bundle={bundle} ready={ready} />,
            },
          ]}
        />
      </PanelFrame>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function ResearchProviderSetup() {
  const { t } = useT();
  const { role } = useSession();
  const { toast } = useToast();
  const client = useQueryClient();
  const [endpoint, setEndpoint] = useState("");
  const [saving, setSaving] = useState(false);
  const config = useQuery({
    queryKey: ["research", "provider"],
    enabled: role === "owner",
    queryFn: () => call(getApiClient().GET("/api/v1/research/provider")),
  });
  useEffect(() => {
    if (config.data) setEndpoint(config.data.data.endpoint ?? "");
  }, [config.data]);
  if (role !== "owner") return null;
  const save = async () => {
    setSaving(true);
    try {
      if (!config.data) return;
      await call(
        getApiClient().PATCH("/api/v1/research/provider", {
          params: { header: { "If-Match": String(config.data.data.version) } },
          body: { endpoint: endpoint.trim() },
        }),
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["research", "provider"] }),
        client.invalidateQueries({ queryKey: queryKeys.capabilities }),
      ]);
      toast({ title: t("research.provider.saved"), tone: "green" });
    } catch (error) {
      toast({ title: t("research.provider.failed"), description: String(error), tone: "red" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="rs-create"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor="research-provider">{t("research.provider.title")}</label>
      <div className="mc-toolbar">
        <Button
          type="button"
          disabled={saving}
          onClick={() => setEndpoint("https://en.wikipedia.org/w/rest.php/v1/search/page")}
        >
          {t("research.provider.wikipedia")}
        </Button>
        <input
          id="research-provider"
          type="url"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="http://127.0.0.1:8080/"
          disabled={saving}
        />
        <Button type="submit" disabled={saving}>
          {t("research.provider.save")}
        </Button>
      </div>
      <p className="mc-note mc-note--muted">{t("research.provider.help")}</p>
    </form>
  );
}

function ResearchContent() {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const query = useResearchProjects({ limit: 100 });
  const canCreate = useCapability("research", "create");
  const runStagedWrite = useRunStagedWrite();
  const stagedBusy = useStagedWriteBusy();
  const [topic, setTopic] = useState("");
  const projects = useMemo(() => query.data?.items ?? [], [query.data]);
  const requestedId = params.get("project");
  const active =
    projects.find((project) => project.id === requestedId) ?? (requestedId ? undefined : projects[0]);
  const detailQuery = useResearchProject(requestedId && !active ? requestedId : null);
  const project = active ?? detailQuery.data?.data;
  const state = useQueryPanelState(query, {
    module: "research",
    empty: query.isSuccess && projects.length === 0,
    emptyTitle: t("research.empty.title"),
    emptyDescription: t("research.empty.description"),
    emptyIcon: <FlaskConical {...ICON} />,
    freshness: query.data?.freshness,
  });

  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("project", id);
      router.replace(`/research?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const startResearch = (): void => {
    const requested = topic.trim();
    if (!requested || stagedBusy) return;
    void runStagedWrite({
      send: (previewId) =>
        call(
          getApiClient().POST("/api/v1/research/projects", {
            body: { topic: requested },
            ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}),
          }),
        ),
      successMessage: (response) =>
        (response as { data: ResearchProject }).data.status === "failed"
          ? t("research.create.failed")
          : t("research.create.recorded"),
      successTone: "amber",
      subject: requested,
      invalidateKeys: [queryKeys.research.all],
      onExecuted: (response) => {
        const data = (response as { data: ResearchProject }).data;
        setTopic("");
        select(data.id);
      },
    });
  };

  return (
    <div className="mc-page rs-page">
      <form
        className="rs-create"
        onSubmit={(event) => {
          event.preventDefault();
          startResearch();
        }}
      >
        <label htmlFor="research-topic">{t("research.create.topic")}</label>
        <div className="mc-toolbar">
          <input
            id="research-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            minLength={3}
            maxLength={500}
            disabled={!canCreate || stagedBusy}
            placeholder={t("research.create.placeholder")}
          />
          <Button type="submit" disabled={!canCreate || stagedBusy || topic.trim().length < 3}>
            {t("research.create.start")}
          </Button>
        </div>
        <p className="mc-note mc-note--muted">
          {canCreate ? t("research.create.disclosure") : t("research.create.unavailable")}
        </p>
      </form>
      <ResearchProviderSetup />
      <div className="mc-grid rs-layout">
        <PanelFrame
          title={t("research.list.title")}
          subtitle={t("research.list.subtitle", { count: projects.length })}
          icon={<FlaskConical {...ICON} />}
          state={state}
          skeletonRows={5}
        >
          <div className="mc-strip-row">
            <StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />
          </div>
          <ProjectList projects={projects} activeId={project?.id} onSelect={select} />
        </PanelFrame>
        {project ? (
          <ProjectView key={project.id} project={project} />
        ) : requestedId && detailQuery.isPending ? (
          <PanelFrame title={t("research.detail.title")} state={{ kind: "loading" }} skeletonRows={4} />
        ) : requestedId && detailQuery.isError ? (
          <PanelFrame
            title={t("research.detail.title")}
            state={{ kind: "error", error: detailQuery.error, onRetry: () => void detailQuery.refetch() }}
          />
        ) : projects.length > 0 ? (
          <PanelFrame
            title={t("research.detail.title")}
            state={{ kind: "empty", title: t("research.select") }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function ResearchPage() {
  return (
    <Suspense fallback={null}>
      <ResearchContent />
    </Suspense>
  );
}
