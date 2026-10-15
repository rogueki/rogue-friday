"use client";

import type { Layout, LayoutWidget } from "@friday/sdk";
import { Button, EmptyState, Select, StatusChip, Switch, TextField } from "@friday/ui";
import { Copy, Download, Eye, EyeOff, FileUp, LayoutGrid, Plus, RotateCcw, Save, Undo2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PanelFrame, type PanelState } from "@/components/PanelFrame";
import { DEFAULT_OVERVIEW_LAYOUT, WIDGET_IDS, resolveOverviewLayout } from "@/features/overview/layout";
import { useT, type MessageKey } from "@/i18n";
import { useImportLayout, useLayouts } from "@/lib/api/domains/settings";
import { FieldGrid, NumberField, Section, TextAreaField } from "./controls";
import { jsonEqual } from "./schemaLogic";
import { useSettingsDrafts } from "./SettingsDrafts";
import { addWidget, downloadJson, layoutColumns, layoutOverlaps, layoutRows, moveWidget, parseLayoutImport, resizeWidget, slugify, updateWidget } from "./settingsLogic";

const CELL_HEIGHT = 22;
const GAP = 4;

interface DragState {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  origin: LayoutWidget;
  base: Layout;
}

const widgetKey = (id: string): MessageKey => `settings.layout.widget.${id}` as MessageKey;

/** Layout editor (PLAN §42.5): move/resize/hide widgets of the overview, presets, reset, export/import as JSON. */
export function LayoutArea() {
  const { t } = useT();
  const { settings, readOnly, setExternalDirty } = useSettingsDrafts();
  const layouts = useLayouts();
  const save = useImportLayout();
  const activeId = settings?.dashboard.activeLayoutId;
  const source = useMemo(() => resolveOverviewLayout(layouts.data?.items, activeId), [layouts.data?.items, activeId]);

  const [draft, setDraft] = useState<Layout>(source);
  /** Stored state the draft is compared with; follows `source` while the user has not edited anything. */
  const [baseline, setBaseline] = useState<Layout>(source);
  const [selected, setSelected] = useState<string>(source.widgets[0]?.id ?? "");
  const [presetId, setPresetId] = useState<string>(source.layoutId);
  const [importText, setImportText] = useState("");
  const [importProblems, setImportProblems] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<DragState | null>(null);

  const dirty = !jsonEqual(draft, baseline);
  useEffect(() => {
    if (jsonEqual(source, baseline)) return;
    // Layouts arrive after the first render and can change elsewhere: adopt them as long as nothing was edited here.
    if (jsonEqual(draft, baseline)) {
      setDraft(source);
      setBaseline(source);
      setPresetId(source.layoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to server changes only
  }, [source]);
  useEffect(() => {
    setExternalDirty("layout", dirty);
    return () => setExternalDirty("layout", false);
  }, [dirty, setExternalDirty]);

  const columns = layoutColumns(draft);
  const rows = layoutRows(draft);
  const overlaps = useMemo(() => layoutOverlaps(draft), [draft]);
  const widget = draft.widgets.find((candidate) => candidate.id === selected);
  const presets = useMemo(() => {
    const items = layouts.data?.items ?? [];
    return items.some((layout) => layout.layoutId === DEFAULT_OVERVIEW_LAYOUT.layoutId) ? items : [DEFAULT_OVERVIEW_LAYOUT, ...items];
  }, [layouts.data?.items]);
  const missing = WIDGET_IDS.filter((id) => !draft.widgets.some((candidate) => candidate.id === id));

  const change = (next: Layout): void => {
    setNotice(null);
    setSaveError(null);
    setDraft(next);
  };

  const begin = (event: ReactPointerEvent<HTMLElement>, entry: LayoutWidget): void => {
    setSelected(entry.id);
    if (readOnly || event.button !== 0) return;
    const resize = (event.target as HTMLElement).closest("[data-resize]") !== null;
    drag.current = { id: entry.id, mode: resize ? "resize" : "move", startX: event.clientX, startY: event.clientY, origin: entry, base: draft };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const track = (event: ReactPointerEvent<HTMLElement>): void => {
    const state = drag.current;
    const grid = gridRef.current;
    if (!state || !grid) return;
    const cellW = (grid.getBoundingClientRect().width + GAP) / columns;
    const dx = Math.round((event.clientX - state.startX) / cellW);
    const dy = Math.round((event.clientY - state.startY) / (CELL_HEIGHT + GAP));
    setNotice(null);
    setDraft(state.mode === "move" ? updateWidget(state.base, state.id, { x: state.origin.x + dx, y: state.origin.y + dy }) : updateWidget(state.base, state.id, { w: state.origin.w + dx, h: state.origin.h + dy }));
  };
  const end = (): void => {
    drag.current = null;
  };

  const onKey = (event: KeyboardEvent<HTMLElement>, entry: LayoutWidget): void => {
    if (readOnly) return;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = delta[event.key];
    if (step) {
      event.preventDefault();
      change(event.shiftKey ? resizeWidget(draft, entry.id, step[0], step[1]) : moveWidget(draft, entry.id, step[0], step[1]));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      change(updateWidget(draft, entry.id, { visible: false }));
    }
  };

  const doSave = async (asCopy: boolean): Promise<void> => {
    setSaveError(null);
    let layout = draft;
    if (asCopy) {
      const base = slugify(draft.name ?? draft.layoutId) || "layout";
      let id = base === draft.layoutId ? `${base}-kopie` : base;
      for (let n = 2; presets.some((preset) => preset.layoutId === id); n += 1) id = `${base}-${n}`;
      layout = { ...draft, layoutId: id, name: draft.name && base !== draft.layoutId ? draft.name : `${draft.name ?? draft.layoutId} (Kopie)` };
    }
    try {
      const response = await save.mutateAsync({ layout, activate: true });
      setNotice(t("settings.layout.saved", { name: response.data.name ?? response.data.layoutId }));
      const stored = resolveOverviewLayout([response.data], response.data.layoutId);
      setDraft(stored);
      setBaseline(stored);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("settings.save.failed"));
    }
  };

  const runImport = (): void => {
    const parsed = parseLayoutImport(importText);
    if (!parsed.ok) {
      setImportProblems(parsed.errors);
      return;
    }
    setImportProblems(parsed.warnings.length ? parsed.warnings : null);
    setNotice(t("settings.layout.imported", { name: parsed.value.name ?? parsed.value.layoutId }));
    setImportText("");
    setDraft(resolveOverviewLayout([parsed.value], parsed.value.layoutId));
    setSelected(parsed.value.widgets[0]?.id ?? "");
  };

  let state: PanelState;
  if (layouts.isPending) state = { kind: "loading" };
  else if (layouts.isError) state = { kind: "error", error: layouts.error, onRetry: () => void layouts.refetch(), retrying: layouts.isFetching };
  else state = { kind: "ready", freshness: layouts.data?.freshness, onRefresh: () => void layouts.refetch() };

  return (
    <PanelFrame state={state} title={t("settings.layout.title")} subtitle={t("settings.layout.subtitle")} icon={<LayoutGrid size={16} />} skeletonRows={4} className="st-panel">
      <div className="st-toolbar">
        <Select
          label={t("settings.layout.preset")}
          value={presetId}
          disabled={readOnly}
          options={presets.map((preset) => ({ value: preset.layoutId, label: preset.name ?? preset.layoutId }))}
          onChange={(event) => setPresetId(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          disabled={readOnly}
          onClick={() => {
            const preset = presets.find((candidate) => candidate.layoutId === presetId);
            if (preset) change(resolveOverviewLayout([preset], preset.layoutId));
          }}
        >
          {t("settings.layout.loadPreset")}
        </Button>
        <Button type="button" variant="ghost" icon={<RotateCcw size={14} />} disabled={readOnly} onClick={() => change({ ...DEFAULT_OVERVIEW_LAYOUT, layoutId: draft.layoutId, name: draft.name ?? DEFAULT_OVERVIEW_LAYOUT.name })}>
          {t("settings.layout.reset")}
        </Button>
        <Button type="button" variant="ghost" icon={<Download size={14} />} onClick={() => downloadJson(`${draft.layoutId}.layout.json`, draft)}>
          {t("settings.layout.export")}
        </Button>
      </div>

      <div className="st-layout">
        <div className="st-layout__canvas">
          <div
            ref={gridRef}
            className="st-grid-canvas"
            role="group"
            aria-label={t("settings.layout.canvas", { columns })}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: `${CELL_HEIGHT}px`, gap: `${GAP}px`, minHeight: rows * (CELL_HEIGHT + GAP) }}
          >
            {draft.widgets.map((entry) => {
              const overlapping = overlaps.some((pair) => pair.includes(entry.id));
              return (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={entry.id === selected}
                  aria-label={t("settings.layout.widgetAria", { name: t(widgetKey(entry.id)), x: entry.x, y: entry.y, w: entry.w, h: entry.h })}
                  className="st-widget"
                  data-selected={entry.id === selected || undefined}
                  data-hidden={!entry.visible || undefined}
                  data-overlap={overlapping || undefined}
                  style={{ gridColumn: `${entry.x + 1} / span ${entry.w}`, gridRow: `${entry.y + 1} / span ${entry.h}` }}
                  onPointerDown={(event) => begin(event, entry)}
                  onPointerMove={track}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onFocus={() => setSelected(entry.id)}
                  onKeyDown={(event) => onKey(event, entry)}
                >
                  <span className="st-widget__name">{t(widgetKey(entry.id))}</span>
                  <span className="st-widget__size st-mono">
                    {entry.w}×{entry.h}
                  </span>
                  {entry.visible ? null : <EyeOff size={13} aria-hidden="true" className="st-widget__off" />}
                  {readOnly ? null : <span data-resize className="st-widget__resize" aria-hidden="true" />}
                </div>
              );
            })}
          </div>
          <p className="st-muted st-layout__hint">{t("settings.layout.keyboardHint")}</p>
          {overlaps.length > 0 ? (
            <p className="st-warning" role="status">
              {t("settings.layout.overlap", { count: overlaps.length })}
            </p>
          ) : null}
        </div>

        <aside className="st-layout__side" aria-label={t("settings.layout.inspector")}>
          {widget ? (
            <Section title={t(widgetKey(widget.id))} description={t("settings.layout.inspectorDesc")}>
              <FieldGrid>
                <NumberField label={t("settings.layout.x")} integer min={0} max={columns - widget.w} value={widget.x} disabled={readOnly} onValueChange={(x) => x !== null && change(updateWidget(draft, widget.id, { x }))} />
                <NumberField label={t("settings.layout.y")} integer min={0} value={widget.y} disabled={readOnly} onValueChange={(y) => y !== null && change(updateWidget(draft, widget.id, { y }))} />
                <NumberField label={t("settings.layout.w")} integer min={1} max={columns} value={widget.w} disabled={readOnly} onValueChange={(w) => w !== null && change(updateWidget(draft, widget.id, { w }))} />
                <NumberField label={t("settings.layout.h")} integer min={1} value={widget.h} disabled={readOnly} onValueChange={(h) => h !== null && change(updateWidget(draft, widget.id, { h }))} />
              </FieldGrid>
              <Switch label={t("settings.layout.visible")} checked={widget.visible} disabled={readOnly} stateLabels={[t("settings.nav.shown"), t("settings.nav.hidden")]} onCheckedChange={(visible) => change(updateWidget(draft, widget.id, { visible }))} />
            </Section>
          ) : (
            <EmptyState compact title={t("settings.layout.noSelection")} />
          )}
          <Section title={t("settings.layout.widgets")}>
            <ul className="st-widgetlist">
              {draft.widgets.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="st-widgetlist__item" aria-current={entry.id === selected ? "true" : undefined} onClick={() => setSelected(entry.id)}>
                    {entry.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                    <span>{t(widgetKey(entry.id))}</span>
                  </button>
                  <button
                    type="button"
                    className="st-iconbtn"
                    disabled={readOnly}
                    aria-label={entry.visible ? t("settings.layout.hide", { name: t(widgetKey(entry.id)) }) : t("settings.layout.show", { name: t(widgetKey(entry.id)) })}
                    onClick={() => change(updateWidget(draft, entry.id, { visible: !entry.visible }))}
                  >
                    {entry.visible ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  </button>
                </li>
              ))}
              {missing.map((id) => (
                <li key={id}>
                  <span className="st-widgetlist__item st-muted">
                    <EyeOff size={14} aria-hidden="true" />
                    <span>{t(widgetKey(id))}</span>
                  </span>
                  <button type="button" className="st-iconbtn" disabled={readOnly} aria-label={t("settings.layout.add", { name: t(widgetKey(id)) })} onClick={() => change(addWidget(draft, id))}>
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </aside>
      </div>

      <Section title={t("settings.layout.importTitle")} description={t("settings.layout.importDesc")}>
        {readOnly ? (
          <p className="st-muted">{t("settings.readOnly")}</p>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="st-file"
              aria-label={t("settings.layout.importFile")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void file.text().then((text) => { setImportText(text); setImportProblems(null); });
              }}
            />
            <TextAreaField label={t("settings.layout.importJson")} value={importText} rows={5} placeholder='{ "layoutId": "mein-layout", "widgets": [ … ] }' onValueChange={(text) => { setImportText(text); setImportProblems(null); }} />
            <div className="st-row">
              <Button type="button" variant="ghost" icon={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>
                {t("settings.theme.import.choose")}
              </Button>
              <Button type="button" icon={<Upload size={14} />} disabled={importText.trim() === ""} onClick={runImport}>
                {t("settings.layout.importRun")}
              </Button>
            </div>
            {importProblems ? (
              <div className="st-errorlist" role="alert">
                <strong>{t("settings.layout.importProblems")}</strong>
                <ul>
                  {importProblems.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </Section>

      {saveError ? <p className="st-error" role="alert">{saveError}</p> : null}
      {notice ? <p className="st-success" role="status">{notice}</p> : null}
      <div className="st-actions">
        <TextField label={t("settings.layout.name")} value={draft.name ?? ""} disabled={readOnly} onChange={(event) => change({ ...draft, name: event.target.value })} className="st-actions__name" />
        {dirty ? <StatusChip tone="amber" pulse>{t("settings.unsaved")}</StatusChip> : null}
        <Button type="button" variant="ghost" icon={<Undo2 size={15} />} disabled={!dirty || save.isPending} onClick={() => { setDraft(baseline); setNotice(null); }}>
          {t("settings.discard")}
        </Button>
        <Button type="button" variant="ghost" icon={<Copy size={15} />} disabled={readOnly || save.isPending} onClick={() => void doSave(true)}>
          {t("settings.layout.saveCopy")}
        </Button>
        <Button type="button" icon={<Save size={15} />} loading={save.isPending} disabled={readOnly || !dirty} onClick={() => void doSave(false)}>
          {t("settings.layout.save")}
        </Button>
      </div>
    </PanelFrame>
  );
}
