"use client";

import { isFridayApiError, type Settings, type SettingsPatch } from "@friday/sdk";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSettings, useUpdateSettings } from "@/lib/api/domains/settings";
import { useSession } from "@/lib/session";
import { useT } from "@/i18n";
import { jsonEqual } from "./schemaLogic";
import { DRAFT_AREAS, type DraftAreaId } from "./settingsLogic";

interface DraftEntry {
  /** Server value of the area when editing started (conflict detection). */
  base: unknown;
  value: unknown;
}

export interface SettingsDraftsValue {
  settings: Settings | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Only the owner may change settings (`PATCH /settings` is owner-only); everybody else sees a read-only view. */
  readOnly: boolean;
  role: string | null;
  dirtyAreas: DraftAreaId[];
  /** Areas that edit their own copy (adapter forms, layout editor) report their unsaved state here. */
  externalDirty: string[];
  isDirty: (area: DraftAreaId) => boolean;
  getValue: <K extends DraftAreaId>(area: K) => Settings[K] | undefined;
  setValue: <K extends DraftAreaId>(area: K, value: Settings[K]) => void;
  discard: (area?: DraftAreaId) => void;
  /** Dirty areas whose stored value changed on the server while the draft was open. */
  conflicts: DraftAreaId[];
  resolveConflicts: (keep: "server" | "mine") => void;
  save: () => Promise<boolean>;
  saving: boolean;
  saveError: string | null;
  clearSaveError: () => void;
  setExternalDirty: (key: string, dirty: boolean) => void;
}

const DraftsContext = createContext<SettingsDraftsValue | null>(null);

export function useSettingsDrafts(): SettingsDraftsValue {
  const value = useContext(DraftsContext);
  if (!value) throw new Error("useSettingsDrafts must be used inside <SettingsDraftsProvider>");
  return value;
}

/** Draft handle of one settings area: edits stay local until the global save bar sends them in one `PATCH /settings`. */
export function useAreaDraft<K extends DraftAreaId>(area: K) {
  const ctx = useSettingsDrafts();
  const value = ctx.getValue(area);
  const set = useCallback((next: Settings[K]) => ctx.setValue(area, next), [ctx, area]);
  const update = useCallback(
    (patch: Partial<Settings[K]>) => {
      const current = ctx.getValue(area);
      if (current !== undefined) ctx.setValue(area, { ...current, ...patch });
    },
    [ctx, area],
  );
  return { value, set, update, dirty: ctx.isDirty(area), readOnly: ctx.readOnly, conflict: ctx.conflicts.includes(area) };
}

export function SettingsDraftsProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const query = useSettings();
  const { role } = useSession();
  const update = useUpdateSettings();
  const settings = query.data?.data;
  const [drafts, setDrafts] = useState<Partial<Record<DraftAreaId, DraftEntry>>>({});
  const [external, setExternal] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDirty = useCallback(
    (area: DraftAreaId): boolean => {
      const entry = drafts[area];
      return Boolean(entry && settings && !jsonEqual(entry.value, settings[area]));
    },
    [drafts, settings],
  );

  const dirtyAreas = useMemo(() => DRAFT_AREAS.filter((area) => isDirty(area)), [isDirty]);
  const externalDirty = useMemo(() => Object.keys(external).filter((key) => external[key]), [external]);
  const conflicts = useMemo(
    () => dirtyAreas.filter((area) => !jsonEqual(drafts[area]?.base, settings?.[area])),
    [dirtyAreas, drafts, settings],
  );

  const getValue = useCallback(
    <K extends DraftAreaId>(area: K): Settings[K] | undefined => (drafts[area] ? (drafts[area]?.value as Settings[K]) : settings?.[area]),
    [drafts, settings],
  );

  const setValue = useCallback(
    <K extends DraftAreaId>(area: K, value: Settings[K]): void => {
      setSaveError(null);
      setDrafts((current) => {
        const base = current[area]?.base ?? settings?.[area];
        return { ...current, [area]: { base, value } };
      });
    },
    [settings],
  );

  const discard = useCallback((area?: DraftAreaId): void => {
    setSaveError(null);
    setDrafts((current) => {
      if (!area) return {};
      const next = { ...current };
      delete next[area];
      return next;
    });
  }, []);

  const resolveConflicts = useCallback(
    (keep: "server" | "mine"): void => {
      setDrafts((current) => {
        const next = { ...current };
        for (const area of conflicts) {
          if (keep === "server") delete next[area];
          else next[area] = { base: settings?.[area], value: current[area]?.value };
        }
        return next;
      });
    },
    [conflicts, settings],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!settings || dirtyAreas.length === 0) return true;
    const patch: Record<string, unknown> = {};
    for (const area of dirtyAreas) patch[area] = drafts[area]?.value;
    setSaving(true);
    setSaveError(null);
    try {
      await update.mutateAsync({ version: settings.version, patch: patch as SettingsPatch });
      setDrafts((current) => {
        const next = { ...current };
        for (const area of dirtyAreas) delete next[area];
        return next;
      });
      return true;
    } catch (error) {
      setSaveError(
        isFridayApiError(error) && error.code === "CONFLICT"
          ? t("settings.save.conflict")
          : isFridayApiError(error)
            ? `${error.message} (${error.correlationId})`
            : t("settings.save.failed"),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [settings, dirtyAreas, drafts, update, t]);

  const setExternalDirty = useCallback((key: string, dirty: boolean): void => {
    setExternal((current) => (Boolean(current[key]) === dirty ? current : { ...current, [key]: dirty }));
  }, []);

  const anyDirty = dirtyAreas.length > 0 || externalDirty.length > 0;
  useEffect(() => {
    if (!anyDirty) return;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [anyDirty]);

  const value = useMemo<SettingsDraftsValue>(
    () => ({
      settings,
      isLoading: query.isPending,
      isError: query.isError && !settings,
      error: query.error,
      refetch: () => void query.refetch(),
      readOnly: role !== "owner",
      role,
      dirtyAreas,
      externalDirty,
      isDirty,
      getValue,
      setValue,
      discard,
      conflicts,
      resolveConflicts,
      save,
      saving,
      saveError,
      clearSaveError: () => setSaveError(null),
      setExternalDirty,
    }),
    [settings, query, role, dirtyAreas, externalDirty, isDirty, getValue, setValue, discard, conflicts, resolveConflicts, save, saving, saveError, setExternalDirty],
  );

  return <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>;
}
