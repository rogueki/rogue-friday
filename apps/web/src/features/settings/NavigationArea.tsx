"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Select, StatusChip, Switch } from "@jarvis/ui";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useT } from "@/i18n";
import { NAV_PAGES, type NavPageId } from "@/features/shell/navModel";
import { FieldGrid, Section } from "./controls";
import { useAreaDraft } from "./SettingsDrafts";
import { moveItem, normalizeNavOrder } from "./settingsLogic";
import type { Settings } from "@jarvis/sdk";

interface RowProps {
  id: NavPageId;
  index: number;
  count: number;
  visible: boolean;
  isDefault: boolean;
  locked: boolean;
  readOnly: boolean;
  onMove: (to: number) => void;
  onVisible: (visible: boolean) => void;
}

function NavRow({ id, index, count, visible, isDefault, locked, readOnly, onMove, onVisible }: RowProps) {
  const { t } = useT();
  const page = NAV_PAGES.find((candidate) => candidate.id === id);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: readOnly });
  if (!page) return null;
  const label = t(page.labelKey);
  return (
    <li ref={setNodeRef} className="st-nav__row" data-dragging={isDragging || undefined} data-hidden={!visible || undefined} style={{ transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined, transition }}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="st-nav__handle"
        aria-label={t("settings.nav.drag", { page: label })}
        disabled={readOnly}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <span className="st-nav__icon" aria-hidden="true">
        {page.icon}
      </span>
      <span className="st-nav__label">
        <span>{label}</span>
        <span className="st-nav__pos st-mono">{String(index + 1).padStart(2, "0")}</span>
        {isDefault ? <StatusChip tone="cyan" dot={false}>{t("settings.nav.startPage")}</StatusChip> : null}
      </span>
      <span className="st-nav__moves">
        <button type="button" className="st-iconbtn" aria-label={t("settings.nav.up", { page: label })} disabled={readOnly || index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUp size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className="st-iconbtn" aria-label={t("settings.nav.down", { page: label })} disabled={readOnly || index === count - 1} onClick={() => onMove(index + 1)}>
          <ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </span>
      <Switch
        label={t("settings.nav.visible", { page: label })}
        checked={visible}
        disabled={readOnly || locked}
        stateLabels={[t("settings.nav.shown"), t("settings.nav.hidden")]}
        onCheckedChange={onVisible}
        className="st-nav__switch"
      />
    </li>
  );
}

/** Navigation settings (PLAN §42.4, §26.1): order (drag or keyboard), visible menus, start page, compact/expanded. */
export function NavigationArea() {
  const { t } = useT();
  const { value, update, readOnly } = useAreaDraft("navigation");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  if (!value) return null;

  const allIds = NAV_PAGES.map((page) => page.id as string);
  const order = normalizeNavOrder(value.order, allIds) as NavPageId[];
  const move = (from: number, to: number): void => update({ order: moveItem(order, from, to) });
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id as NavPageId);
    const to = order.indexOf(over.id as NavPageId);
    if (from >= 0 && to >= 0) update({ order: arrayMove(order, from, to) });
  };
  const setVisible = (id: string, visible: boolean): void => update({ hidden: visible ? value.hidden.filter((entry) => entry !== id) : [...new Set([...value.hidden, id])] });

  return (
    <>
      <Section title={t("settings.nav.order")} description={t("settings.nav.orderDesc")}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: { draggable: t("settings.nav.dndInstructions") },
            announcements: {
              onDragStart: ({ active }) => t("settings.nav.dndPicked", { page: pageLabel(active.id as string, t) }),
              onDragOver: ({ active, over }) => (over ? t("settings.nav.dndOver", { page: pageLabel(active.id as string, t), position: order.indexOf(over.id as NavPageId) + 1 }) : undefined),
              onDragEnd: ({ active, over }) => t("settings.nav.dndDropped", { page: pageLabel(active.id as string, t), position: (over ? order.indexOf(over.id as NavPageId) : order.indexOf(active.id as NavPageId)) + 1 }),
              onDragCancel: ({ active }) => t("settings.nav.dndCancelled", { page: pageLabel(active.id as string, t) }),
            },
          }}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ol className="st-nav" aria-label={t("settings.nav.order")}>
              {order.map((id, index) => (
                <NavRow
                  key={id}
                  id={id}
                  index={index}
                  count={order.length}
                  visible={!value.hidden.includes(id)}
                  isDefault={value.defaultPage === id}
                  locked={id === "settings"}
                  readOnly={readOnly}
                  onMove={(to) => move(index, to)}
                  onVisible={(visible) => setVisible(id, visible)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <p className="st-muted">{t("settings.nav.settingsLocked")}</p>
      </Section>
      <Section title={t("settings.nav.behaviour")}>
        <FieldGrid>
          <Select
            label={t("settings.nav.defaultPage")}
            hint={t("settings.nav.defaultPageHint")}
            value={value.defaultPage}
            disabled={readOnly}
            options={NAV_PAGES.map((page) => ({ value: page.id, label: t(page.labelKey) }))}
            onChange={(event) => update({ defaultPage: event.target.value })}
          />
          <Select
            label={t("settings.nav.mode")}
            hint={t("settings.nav.modeHint")}
            value={value.mode}
            disabled={readOnly}
            options={[
              { value: "expanded", label: t("settings.nav.expanded") },
              { value: "compact", label: t("settings.nav.compact") },
            ]}
            onChange={(event) => update({ mode: event.target.value as Settings["navigation"]["mode"] })}
          />
        </FieldGrid>
      </Section>
    </>
  );
}

function pageLabel(id: string, t: ReturnType<typeof useT>["t"]): string {
  const page = NAV_PAGES.find((candidate) => candidate.id === id);
  return page ? t(page.labelKey) : id;
}
