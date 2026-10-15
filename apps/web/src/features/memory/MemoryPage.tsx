"use client";

import type { Memory, MemoryListResponse, MemorySearchRequest, MemorySearchResponse, MemorySensitivity, MemoryType } from "@friday/sdk";
import { Button, FilterBar, HudPanel, StatusChip, Switch, useToast } from "@friday/ui";
import { Brain, Download, Plus } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { PanelFrame } from "@/components/PanelFrame";
import { useT } from "@/i18n";
import { useCreateMemory, useExportMemory, useMemories, useMemorySearch, type MemoryFilters } from "@/lib/api/domains/memory";
import { useCapability, useCapabilityState } from "@/lib/capabilities";
import { CapabilityNote, DataBadges } from "./kit/Badges";
import { downloadJson, stamp } from "./kit/download";
import { useDebounced, useUrlParam } from "./kit/hooks";
import { effectiveFreshness, usePanelState } from "./kit/panelState";
import { MemoryDrawer } from "./MemoryDrawer";
import { MemoryFormDialog } from "./MemoryFormDialog";
import { MemoryRow } from "./MemoryRow";
import { hasPendingConflict, MEMORY_SENSITIVITIES, MEMORY_TYPES, sensitivityKey, typeKey } from "./labels";
import "./memory.css";

const PAGE_SIZE = 50;
type Flag = "all" | "pinned" | "locked" | "conflict";

export function MemoryPage() {
  return (
    <Suspense fallback={null}>
      <MemoryPageInner />
    </Suspense>
  );
}

function MemoryPageInner() {
  const { t } = useT();
  const [selectedId, setSelectedId] = useUrlParam("memory");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | MemoryType>("all");
  const [sensitivity, setSensitivity] = useState<"all" | MemorySensitivity>("all");
  const [flag, setFlag] = useState<Flag>("all");
  const [semantic, setSemantic] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [creating, setCreating] = useState(false);

  const canSearch = useCapability("memory", "search");
  const canWrite = useCapability("memory", "write");
  const canExport = useCapability("memory", "export");
  const { toast } = useToast();
  const exportAll = useExportMemory();
  const readState = useCapabilityState("memory", "read");
  const writeState = useCapabilityState("memory", "write");
  const create = useCreateMemory();

  const term = useDebounced(search.trim(), 250);
  const useSemantic = semantic && canSearch && term !== "";

  const filters: MemoryFilters = {
    limit,
    ...(type !== "all" ? { type: [type] } : {}),
    ...(sensitivity !== "all" ? { sensitivity: [sensitivity] } : {}),
    ...(flag === "pinned" ? { pinned: true } : {}),
    ...(flag === "locked" ? { locked: true } : {}),
    ...(!useSemantic && term !== "" ? { q: term } : {}),
  };
  const searchRequest: MemorySearchRequest | null = useSemantic
    ? { query: term, semantic: true, limit, ...(type !== "all" ? { types: [type] } : {}), ...(sensitivity !== "all" ? { sensitivity: [sensitivity] } : {}) }
    : null;

  const listQuery = useMemories(filters);
  const searchQuery = useMemorySearch(searchRequest);
  const activeQuery = useSemantic ? searchQuery : listQuery;

  const rows = useMemo(() => {
    if (useSemantic) {
      const hits = searchQuery.data?.items ?? [];
      return hits
        .filter((hit) => (flag === "pinned" ? hit.memory.pinned : flag === "locked" ? hit.memory.locked : true))
        .map((hit) => ({ memory: hit.memory, score: hit.score as number | undefined, highlights: hit.highlights }));
    }
    return (listQuery.data?.items ?? []).map((memory) => ({ memory, score: undefined as number | undefined, highlights: undefined as readonly string[] | undefined }));
  }, [useSemantic, searchQuery.data, listQuery.data, flag]);
  const visible = flag === "conflict" ? rows.filter((row) => hasPendingConflict(row.memory)) : rows;

  const memories: Memory[] = visible.map((row) => row.memory);
  const totalCount = useSemantic ? undefined : listQuery.data?.pageInfo.totalCount;
  const hasNext = !useSemantic && Boolean(listQuery.data?.pageInfo.hasNextPage);
  const filtered = type !== "all" || sensitivity !== "all" || flag !== "all" || term !== "";

  const state = usePanelState<MemoryListResponse | MemorySearchResponse>(activeQuery, {
    module: "memory",
    moduleName: t("nav.memory"),
    adapterId: activeQuery.data?.sources[0]?.adapterId,
    empty: visible.length === 0,
    emptyTitle: filtered ? t("memory.empty.filtered") : t("memory.empty"),
    emptyDescription: filtered ? t("memory.empty.filteredHint") : t("memory.empty.hint"),
    emptyIcon: <Brain size={22} strokeWidth={1.5} />,
    emptyAction: canWrite && !filtered ? (
      <Button size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
        {t("memory.new")}
      </Button>
    ) : undefined,
  });

  const stats = useMemo(
    () => ({
      pinned: memories.filter((memory) => memory.pinned).length,
      locked: memories.filter((memory) => memory.locked).length,
      conflicts: memories.filter(hasPendingConflict).length,
      sensitive: memories.filter((memory) => memory.sensitivity !== "normal").length,
    }),
    [memories],
  );

  const runExport = (): void =>
    exportAll.mutate(
      {},
      {
        onSuccess: (document) => {
          downloadJson(`gedaechtnis-${stamp(new Date(document.exportedAt))}.json`, document);
          toast({
            title: t("memory.export.done", { count: document.count }),
            description: document.omittedRestricted > 0 ? t("memory.export.omitted", { count: document.omittedRestricted }) : t("memory.export.complete"),
            tone: "green",
          });
        },
      },
    );

  const resetFilters = (): void => {
    setSearch("");
    setType("all");
    setSensitivity("all");
    setFlag("all");
    setLimit(PAGE_SIZE);
  };

  const chips = [
    ...(type !== "all" ? [{ id: "type", label: t(typeKey(type)), onRemove: () => setType("all") }] : []),
    ...(sensitivity !== "all" ? [{ id: "sensitivity", label: t(sensitivityKey(sensitivity)), onRemove: () => setSensitivity("all") }] : []),
    ...(flag !== "all" ? [{ id: "flag", label: t(`memory.flag.filter.${flag}` as const), onRemove: () => setFlag("all") }] : []),
  ];

  return (
    <div className="mk-page mem-page">
      <HudPanel
        title={t("nav.memory")}
        subtitle={t("page.memory.description")}
        icon={<Brain size={18} strokeWidth={1.5} />}
        actions={
          <span className="mk-actions">
            <DataBadges sources={activeQuery.data?.sources} freshness={effectiveFreshness<MemoryListResponse | MemorySearchResponse>(activeQuery)} />
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={14} />}
              disabled={readState !== "available" || !canExport}
              loading={exportAll.isPending}
              title={!canExport ? t("memory.export.unavailable") : t("memory.export.hint")}
              onClick={runExport}
            >
              {t("memory.exportList")}
            </Button>
            <Button size="sm" icon={<Plus size={14} />} disabled={!canWrite} title={!canWrite ? t("memory.kit.noWrite") : undefined} onClick={() => setCreating(true)}>
              {t("memory.new")}
            </Button>
          </span>
        }
      >
        <div className="mk-stack">
          <CapabilityNote state={writeState} readText={t("memory.kit.readOnly")} writeText={t("memory.kit.writeUnavailable")} />
          <FilterBar
            search={{ value: search, onChange: (value) => { setSearch(value); setLimit(PAGE_SIZE); }, placeholder: semantic && canSearch ? t("memory.search.semantic") : t("memory.search.keyword"), label: t("memory.search.label") }}
            filters={[
              { id: "type", label: t("memory.field.type"), value: type, onChange: (value) => setType(value as "all" | MemoryType), options: [{ value: "all", label: t("memory.filter.allTypes") }, ...MEMORY_TYPES.map((value) => ({ value, label: t(typeKey(value)) }))] },
              { id: "sensitivity", label: t("memory.field.sensitivity"), value: sensitivity, onChange: (value) => setSensitivity(value as "all" | MemorySensitivity), options: [{ value: "all", label: t("memory.filter.allSensitivities") }, ...MEMORY_SENSITIVITIES.map((value) => ({ value, label: t(sensitivityKey(value)) }))] },
              { id: "flag", label: t("memory.filter.flag"), value: flag, onChange: (value) => setFlag(value as Flag), options: (["all", "pinned", "locked", "conflict"] as const).map((value) => ({ value, label: t(`memory.flag.filter.${value}` as const) })) },
            ]}
            chips={chips}
            onReset={resetFilters}
            resetLabel={t("memory.filter.reset")}
            resultCount={memories.length}
            totalCount={totalCount}
            actions={
              <Switch
                label={t("memory.search.semanticSwitch")}
                checked={semantic && canSearch}
                disabled={!canSearch}
                onCheckedChange={setSemantic}
                stateLabels={[t("memory.kit.on"), t("memory.kit.off")]}
                className="mem-semantic"
              />
            }
          />
          <div className="mem-stats" role="group" aria-label={t("memory.stats")}>
            <StatusChip tone="cyan" dot={false}>{t("memory.stats.shown", { count: memories.length })}</StatusChip>
            <StatusChip tone={stats.pinned ? "cyan" : "muted"} dot={false}>{t("memory.stats.pinned", { count: stats.pinned })}</StatusChip>
            <StatusChip tone={stats.locked ? "amber" : "muted"} dot={false}>{t("memory.stats.locked", { count: stats.locked })}</StatusChip>
            <StatusChip tone={stats.conflicts ? "red" : "muted"} dot={false}>{t("memory.stats.conflicts", { count: stats.conflicts })}</StatusChip>
            <StatusChip tone={stats.sensitive ? "amber" : "muted"} dot={false}>{t("memory.stats.sensitive", { count: stats.sensitive })}</StatusChip>
          </div>
        </div>
      </HudPanel>

      <PanelFrame title={useSemantic ? t("memory.list.searchTitle") : t("memory.list.title")} state={state} skeletonRows={6} className="mem-list-panel">
        <ul className="mk-list" aria-label={t("memory.list.title")}>
          {visible.map((row) => (
            <MemoryRow key={row.memory.id} memory={row.memory} selected={row.memory.id === selectedId} onOpen={(id) => setSelectedId(id, { push: true })} score={row.score} highlights={row.highlights} />
          ))}
        </ul>
        {hasNext ? (
          <div className="mk-more">
            <Button variant="ghost" size="sm" loading={listQuery.isFetching} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
              {t("memory.more")}
            </Button>
          </div>
        ) : null}
      </PanelFrame>

      <MemoryDrawer id={selectedId} onClose={() => setSelectedId(null)} onOpenOther={(id) => setSelectedId(id)} />
      <MemoryFormDialog
        open={creating}
        onOpenChange={setCreating}
        busy={create.isPending}
        onCreate={(request) =>
          create.mutate(request, {
            onSuccess: (response) => {
              setCreating(false);
              setSelectedId(response.data.id, { push: true });
            },
          })
        }
      />
    </div>
  );
}
