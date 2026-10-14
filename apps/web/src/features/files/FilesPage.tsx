"use client";

import type { FileCategory, FileItem } from "@jarvis/sdk";
import { isJarvisApiError } from "@jarvis/sdk";
import {
  Button,
  ConfirmDialog,
  Dialog,
  Drawer,
  FilterBar,
  IconTile,
  StatusChip,
  TagPill,
  Tabs,
  useMediaQuery,
  useToast,
  type Tone,
} from "@jarvis/ui";
import { Download, ExternalLink, File as FileGlyph, FileCode, FileImage, FileSpreadsheet, FileText, FolderOpen, Presentation, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { KeyValue, StatusStrip, useFormatters, useQueryPanelState } from "@/features/system/common";
import { saveBlob } from "@/features/system/download";
import { formatBytes } from "@/features/system/format";
import { useT, type MessageKey } from "@/i18n";
import { describeError } from "@/lib/api/queryClient";
import { downloadFileBlob, useDeleteFile, useFile, useFiles, type FileFilters } from "@/lib/api/domains/files";
import { useCapability } from "@/lib/capabilities";
import { FilePreviewPane } from "./FilePreview";
import "./files.css";

const ICON = { size: 18, strokeWidth: 1.5 } as const;
const PAGE_SIZE = 48;

export const FILE_CATEGORIES: readonly FileCategory[] = ["generated", "uploaded", "reports", "presentations", "invoices", "research", "exports", "temporary"];

const CATEGORY_TONE: Record<FileCategory, Tone> = {
  generated: "cyan",
  uploaded: "blue",
  reports: "green",
  presentations: "violet",
  invoices: "amber",
  research: "teal",
  exports: "blue",
  temporary: "muted",
};

export function fileTypeLabel(file: Pick<FileItem, "name" | "mimeType">): string {
  const dot = file.name.lastIndexOf(".");
  if (dot > 0 && dot < file.name.length - 1) return file.name.slice(dot + 1).toUpperCase();
  return file.mimeType.split("/")[1]?.toUpperCase() ?? file.mimeType;
}

function fileGlyph(file: Pick<FileItem, "mimeType" | "name">): ReactNode {
  const mime = file.mimeType;
  if (mime.startsWith("image/")) return <FileImage {...ICON} />;
  if (/spreadsheet|csv|excel/.test(mime)) return <FileSpreadsheet {...ICON} />;
  if (/presentation|powerpoint/.test(mime)) return <Presentation {...ICON} />;
  if (/json|xml|html|javascript|x-ndjson/.test(mime)) return <FileCode {...ICON} />;
  if (mime.startsWith("text/") || mime === "application/pdf" || /word|document/.test(mime)) return <FileText {...ICON} />;
  return <FileGlyph {...ICON} />;
}

const categoryLabel = (category: FileCategory, t: (key: MessageKey) => string): string => t(`files.category.${category}` as MessageKey);

/* ── File card (§37.2) ────────────────────────────────────────────────── */

function FileCard({ file, selected, onSelect }: { file: FileItem; selected: boolean; onSelect: () => void }) {
  const { t, locale } = useT();
  const formatters = useFormatters();
  return (
    <li>
      <button type="button" className={`fl-card${selected ? " fl-card--selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
        <span className="fl-card__head">
          <IconTile icon={fileGlyph(file)} tone={CATEGORY_TONE[file.category]} size="md" />
          <span className="fl-card__title">
            <strong title={file.name}>{file.name}</strong>
            <span className="mc-muted">
              {fileTypeLabel(file)} · {formatBytes(file.sizeBytes, locale)} · {t("files.card.version", { version: file.currentVersion })}
            </span>
          </span>
        </span>
        <span className="fl-card__meta">
          <span>
            {t("files.card.by")} {file.createdBy.name ?? file.createdBy.id}
          </span>
          <span>{t("files.card.modified", { time: formatters.relative(file.updatedAt) })}</span>
          <span className="fl-card__path mc-mono" title={file.location}>
            {file.location}
          </span>
        </span>
        <span className="fl-card__tags">
          <TagPill tone={CATEGORY_TONE[file.category]}>{categoryLabel(file.category, t)}</TagPill>
          {file.previewKind === "none" ? null : <TagPill tone="muted">{t("files.card.preview")}</TagPill>}
          {file.tags.slice(0, 3).map((tag) => (
            <TagPill key={tag} tone="muted">
              #{tag}
            </TagPill>
          ))}
        </span>
      </button>
    </li>
  );
}

/* ── File detail: preview, details, versions, lineage ─────────────────── */

function relationLabel(relation: FileItem["lineage"][number]["relation"], t: (key: MessageKey) => string): string {
  return t(`files.lineage.${relation}` as MessageKey);
}

interface FileDetailProps {
  file: FileItem;
  onClose: () => void;
  onSelectFile: (id: string) => void;
}

export function FileDetail({ file, onClose, onSelectFile }: FileDetailProps) {
  const { t, locale } = useT();
  const router = useRouter();
  const { toast } = useToast();
  const formatters = useFormatters();
  const canDownload = useCapability("files", "download");
  const canPreview = useCapability("files", "preview");
  const canDelete = useCapability("files", "delete");
  const remove = useDeleteFile();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState<number | "current" | null>(null);
  const [openPreview, setOpenPreview] = useState(false);

  const download = async (version?: number): Promise<void> => {
    setDownloading(version ?? "current");
    try {
      const blob = await downloadFileBlob(file.id, version);
      saveBlob(blob, version === undefined || version === file.currentVersion ? file.name : `v${version}-${file.name}`);
    } catch (error) {
      const info = describeError(error);
      toast({ title: t("files.download.failed"), description: info.description, tone: "red" });
    } finally {
      setDownloading(null);
    }
  };

  const requestDelete = (): void => {
    remove.mutate(
      { id: file.id, version: file.version },
      {
        onSuccess: (outcome) => {
          setConfirmDelete(false);
          if (outcome.kind === "approval") {
            const approvalId = outcome.approval.data.id;
            toast({
              title: t("files.delete.approvalRequested"),
              description: t("files.delete.approvalDescription", { name: file.name }),
              tone: "amber",
              action: { label: t("files.delete.openApproval"), onClick: () => router.push(`/approvals?approval=${encodeURIComponent(approvalId)}`) },
            });
          } else {
            toast({ title: t("files.delete.done", { name: file.name }), description: outcome.result.message, tone: "green" });
            onClose();
          }
        },
        onError: () => setConfirmDelete(false),
      },
    );
  };

  const conflict = remove.error && isJarvisApiError(remove.error) && remove.error.code === "CONFLICT";

  const detailsTab = (
    <div className="mc-stack">
      <dl className="mc-kvlist">
        <KeyValue label={t("files.detail.type")}>{`${fileTypeLabel(file)} · ${file.mimeType}`}</KeyValue>
        <KeyValue label={t("files.detail.size")}>{formatBytes(file.sizeBytes, locale)}</KeyValue>
        <KeyValue label={t("files.detail.version")}>{t("files.card.version", { version: file.currentVersion })}</KeyValue>
        <KeyValue label={t("files.detail.creator")}>{file.createdBy.name ?? file.createdBy.id}</KeyValue>
        <KeyValue label={t("files.detail.created")}>{formatters.dateTime(file.createdAt)}</KeyValue>
        <KeyValue label={t("files.detail.modified")}>{formatters.dateTime(file.updatedAt)}</KeyValue>
        <KeyValue label={t("files.detail.location")} mono>
          {file.location}
        </KeyValue>
        <KeyValue label={t("files.detail.checksum")} mono reason={t("files.detail.noChecksum")}>
          {file.checksum}
        </KeyValue>
      </dl>
      <div>
        <h3 className="mc-subtitle">{t("files.detail.tags")}</h3>
        <div className="mc-row">
          {file.tags.length === 0 ? <span className="mc-null">—</span> : file.tags.map((tag) => <TagPill key={tag} tone="muted">#{tag}</TagPill>)}
        </div>
      </div>
      <div>
        <h3 className="mc-subtitle">{t("files.detail.links")}</h3>
        <div className="mc-row">
          {file.taskId ? (
            <Button size="sm" variant="ghost" icon={<ExternalLink size={13} strokeWidth={1.5} />} onClick={() => router.push(`/tasks?task=${encodeURIComponent(file.taskId ?? "")}`)}>
              {t("files.detail.openTask")}
            </Button>
          ) : (
            <span className="mc-note mc-note--muted">{t("files.detail.noTask")}</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink size={13} strokeWidth={1.5} />}
            onClick={() => router.push(file.taskId ? `/audit?taskId=${encodeURIComponent(file.taskId)}` : "/audit")}
          >
            {t("files.detail.openAudit")}
          </Button>
        </div>
      </div>
    </div>
  );

  const versionsTab = (
    <ul className="mc-list">
      {[...file.versions]
        .sort((a, b) => b.version - a.version)
        .map((version) => (
          <li key={version.version} className="fl-version">
            <span className="fl-version__text">
              <strong>{t("files.card.version", { version: version.version })}</strong>
              {version.version === file.currentVersion ? <TagPill tone="green">{t("files.versions.current")}</TagPill> : null}
              <span className="mc-muted">
                {formatters.dateTime(version.createdAt)} · {formatBytes(version.sizeBytes, locale)} · {version.createdBy.name ?? version.createdBy.id}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={13} strokeWidth={1.5} />}
              disabled={!canDownload}
              loading={downloading === version.version}
              aria-label={t("files.versions.download", { version: version.version })}
              title={canDownload ? undefined : t("files.action.unavailable", { capability: "files.download" })}
              onClick={() => void download(version.version)}
            >
              {t("files.action.download")}
            </Button>
          </li>
        ))}
    </ul>
  );

  const lineageTab =
    file.lineage.length === 0 ? (
      <p className="mc-note mc-note--muted">{t("files.lineage.empty")}</p>
    ) : (
      <ul className="mc-list">
        {file.lineage.map((entry, index) => (
          <li key={`${entry.relation}-${entry.fileId ?? entry.taskId ?? index}`} className="fl-lineage">
            <TagPill tone="cyan">{relationLabel(entry.relation, t)}</TagPill>
            <span className="fl-lineage__text">{entry.description}</span>
            {entry.fileId ? (
              <Button size="sm" variant="ghost" onClick={() => onSelectFile(entry.fileId ?? "")}>
                {t("files.lineage.openFile")}
              </Button>
            ) : null}
            {entry.taskId ? (
              <Button size="sm" variant="ghost" onClick={() => router.push(`/tasks?task=${encodeURIComponent(entry.taskId ?? "")}`)}>
                {t("files.detail.openTask")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="fl-detail mc-stack">
      <div className="fl-detail__head">
        <IconTile icon={fileGlyph(file)} tone={CATEGORY_TONE[file.category]} size="lg" />
        <div className="fl-detail__title">
          <h2>{file.name}</h2>
          <span className="mc-muted">
            {categoryLabel(file.category, t)} · {formatBytes(file.sizeBytes, locale)} · {t("files.card.version", { version: file.currentVersion })}
          </span>
        </div>
      </div>
      <div className="mc-toolbar" role="group" aria-label={t("files.actions.title")}>
        <Button
          size="sm"
          variant="primary"
          icon={<FolderOpen size={14} strokeWidth={1.5} />}
          disabled={!canPreview || file.previewKind === "none"}
          title={!canPreview ? t("files.action.unavailable", { capability: "files.preview" }) : file.previewKind === "none" ? t("files.preview.noneDescription") : undefined}
          onClick={() => setOpenPreview(true)}
        >
          {t("files.action.open")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Download size={14} strokeWidth={1.5} />}
          disabled={!canDownload}
          loading={downloading === "current"}
          title={canDownload ? undefined : t("files.action.unavailable", { capability: "files.download" })}
          onClick={() => void download()}
        >
          {t("files.action.download")}
        </Button>
        {canDelete ? (
          <Button size="sm" variant="danger" icon={<Trash2 size={14} strokeWidth={1.5} />} onClick={() => setConfirmDelete(true)}>
            {t("files.action.delete")}
          </Button>
        ) : null}
        {canDelete ? null : <span className="mc-note mc-note--muted">{t("files.action.deleteUnavailable")}</span>}
      </div>
      {conflict ? (
        <div className="mc-box mc-box--amber" role="alert">
          {t("files.delete.conflict")}
        </div>
      ) : null}
      <Tabs
        label={t("files.detail.tabs")}
        items={[
          { id: "preview", label: t("files.tab.preview"), content: <FilePreviewPane file={file} /> },
          { id: "details", label: t("files.tab.details"), content: detailsTab },
          { id: "versions", label: t("files.tab.versions"), count: file.versions.length, content: versionsTab },
          { id: "lineage", label: t("files.tab.lineage"), count: file.lineage.length, content: lineageTab },
        ]}
        defaultValue="preview"
        panelClassName="fl-detail__panel"
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("files.delete.title", { name: file.name })}
        description={t("files.delete.description")}
        details={[t("files.delete.impact1"), t("files.delete.impact2", { count: file.versions.length }), t("files.delete.impact3")]}
        confirmLabel={t("files.delete.confirm")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        loading={remove.isPending}
        onConfirm={requestDelete}
      />
      <FileOpenDialog file={file} open={openPreview} onOpenChange={setOpenPreview} />
    </div>
  );
}

/** "Öffnen": the same sandboxed preview in a large dialog; mounted only while open so the query runs on demand. */
function FileOpenDialog({ file, open, onOpenChange }: { file: FileItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT();
  if (!open) return null;
  return (
    <Dialog open onOpenChange={onOpenChange} title={t("files.open.title", { name: file.name })} size="lg">
      <FilePreviewPane file={file} />
    </Dialog>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function FilesContent() {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const wide = useMediaQuery("(min-width: 1100px)", true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<FileCategory | "">("");
  const [tag, setTag] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const q = useDebounced(search.trim(), 250);
  const filters = useMemo<FileFilters>(
    () => ({ ...(q ? { q } : {}), ...(category ? { category: [category] } : {}), ...(tag ? { tag } : {}), limit }),
    [q, category, tag, limit],
  );
  const query = useFiles(filters);
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const filtered = q !== "" || category !== "" || tag !== "";
  const selectedId = params.get("file");
  const selectedFromList = items.find((file) => file.id === selectedId);
  const detailQuery = useFile(selectedId && !selectedFromList ? selectedId : null);
  const selected = selectedFromList ?? detailQuery.data?.data;

  const tags = useMemo(() => [...new Set(items.flatMap((file) => file.tags))].sort((a, b) => a.localeCompare(b, "de")), [items]);

  const state = useQueryPanelState(query, {
    module: "files",
    empty: query.isSuccess && items.length === 0,
    emptyTitle: filtered ? t("files.empty.filtered") : t("files.empty.title"),
    emptyDescription: filtered ? t("files.empty.filteredDescription") : t("files.empty.description"),
    emptyIcon: <FolderOpen {...ICON} />,
    freshness: query.data?.freshness,
  });

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set("file", id);
      else next.delete("file");
      const qs = next.toString();
      router.replace(qs ? `/files?${qs}` : "/files", { scroll: false });
    },
    [params, router],
  );

  const reset = (): void => {
    setSearch("");
    setCategory("");
    setTag("");
    setLimit(PAGE_SIZE);
  };

  const detail = selected ? <FileDetail file={selected} onClose={() => select(null)} onSelectFile={(id) => select(id)} /> : null;

  return (
    <div className="mc-page fl-page">
      <div className="fl-cats" role="group" aria-label={t("files.categories")}>
        <button type="button" className="fl-chip" aria-pressed={category === ""} onClick={() => setCategory("")}>
          {t("common.all")}
        </button>
        {FILE_CATEGORIES.map((entry) => (
          <button key={entry} type="button" className="fl-chip" aria-pressed={category === entry} onClick={() => setCategory(category === entry ? "" : entry)}>
            {categoryLabel(entry, t)}
          </button>
        ))}
      </div>
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: t("files.search.placeholder"), label: t("files.search.label") }}
        filters={[
          {
            id: "tag",
            label: t("files.filter.tag"),
            value: tag,
            onChange: setTag,
            options: [{ value: "", label: t("files.filter.allTags") }, ...tags.map((entry) => ({ value: entry, label: `#${entry}` }))],
          },
        ]}
        onReset={filtered ? reset : undefined}
        resultCount={items.length}
        totalCount={query.data?.pageInfo.totalCount}
        resetLabel={t("files.filter.reset")}
        actions={<StatusStrip freshness={query.data?.freshness} source={query.data?.sources[0]?.system} />}
      />
      <div className={`fl-split${wide ? " fl-split--wide" : ""}`}>
        <PanelFrame title={t("files.list.title")} subtitle={t("files.list.subtitle")} icon={<FolderOpen {...ICON} />} state={state} skeletonRows={6} className="fl-list-panel">
          <ul className="fl-grid">
            {items.map((file) => (
              <FileCard key={file.id} file={file} selected={file.id === selectedId} onSelect={() => select(file.id)} />
            ))}
          </ul>
          {query.data?.pageInfo.hasNextPage ? (
            <div className="fl-more">
              <Button size="sm" variant="ghost" loading={query.isFetching} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                {t("files.list.more")}
              </Button>
            </div>
          ) : null}
        </PanelFrame>
        {wide ? (
          <PanelFrame
            title={t("files.detail.title")}
            icon={<FileText {...ICON} />}
            level={selected ? 2 : 1}
            state={
              selected
                ? { kind: "ready" }
                : selectedId && detailQuery.isPending
                  ? { kind: "loading" }
                  : selectedId && detailQuery.isError
                    ? { kind: "error", error: detailQuery.error, onRetry: () => void detailQuery.refetch() }
                    : { kind: "empty", title: t("files.detail.select"), description: t("files.detail.selectDescription"), icon: <FileText {...ICON} /> }
            }
            className="fl-detail-panel"
          >
            {detail}
          </PanelFrame>
        ) : (
          <Drawer
            open={Boolean(selected)}
            onOpenChange={(open) => {
              if (!open) select(null);
            }}
            title={selected?.name ?? t("files.detail.title")}
            icon={<FileText size={18} strokeWidth={1.5} />}
            width={520}
          >
            {detail}
          </Drawer>
        )}
      </div>
      {query.data && items.length > 0 ? (
        <StatusChip tone="muted" dot={false}>
          {t("files.count", { count: items.length })}
        </StatusChip>
      ) : null}
    </div>
  );
}

export function FilesPage() {
  return (
    <Suspense fallback={null}>
      <FilesContent />
    </Suspense>
  );
}

