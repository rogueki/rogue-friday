"use client";

import type { CommandHistoryEntry } from "@jarvis/sdk";
import { CommandPalette, useToast, type CommandItem } from "@jarvis/ui";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CalendarDays,
  CircleHelp,
  Database,
  FileText,
  FlaskConical,
  History,
  MessageCircleQuestion,
  Mic,
  Pause,
  Play,
  Plus,
  Settings,
  Square,
  Workflow,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { orderNavPages } from "@/features/shell/navModel";
import { EXECUTIVE_BRIEFING_COMMAND, useVoiceUi } from "@/features/voice/useVoiceUi";
import { useT } from "@/i18n";
import { agentQueries } from "@/lib/api/domains/agents";
import { useMeta } from "@/lib/api/domains/core";
import { automationQueries, useTestAutomation } from "@/lib/api/domains/automations";
import { useCommandControl, useCommandHistory } from "@/lib/api/domains/commands";
import { fileQueries } from "@/lib/api/domains/files";
import { searchMemory } from "@/lib/api/domains/memory";
import { queryKeys } from "@/lib/api/queryKeys";
import { useCapability } from "@/lib/capabilities";
import { useAppSettings } from "@/lib/settings";
import { useUiStore } from "@/lib/uiStore";
import { useRunCommand } from "./commandRunner";
import { useCreateTaskDialog } from "./CreateTaskDialog";

const ICON = { size: 16, strokeWidth: 1.5 } as const;
const SEARCH_DEBOUNCE_MS = 250;
const MIN_SEARCH_LENGTH = 2;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Ctrl+K and "/" open the palette from anywhere except text inputs (PLAN §43.1). */
export function usePaletteShortcuts(): void {
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target !== null && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);
}

function historyLabel(entry: CommandHistoryEntry, protectedLabel: string): string {
  return entry.redacted ? protectedLabel : entry.text;
}

export function GlobalCommandPalette() {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const { settings } = useAppSettings();
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const openCreateTask = useCreateTaskDialog((s) => s.setOpen);
  const run = useRunCommand();
  const voice = useVoiceUi();
  const stop = useCommandControl("stop");
  const pause = useCommandControl("pause");
  const resume = useCommandControl("resume");
  const testAutomation = useTestAutomation();

  const canExecute = useCapability("commands", "execute");
  const canStop = useCapability("commands", "stop");
  const canPause = useCapability("commands", "pause");
  const canResume = useCapability("commands", "resume");
  const canHistory = useCapability("commands", "history");
  const canCreateTask = useCapability("tasks", "create");
  const canSearchMemory = useCapability("memory", "search");
  const canReadAgents = useCapability("agents", "read");
  const canReadFiles = useCapability("files", "read");
  // The scenario console only exists in development/QA (PLAN §44.6), so the palette only offers it then.
  const devScenarios = Boolean(useMeta().data?.features.devScenarios);
  const canTestAutomation = useCapability("automations", "test");

  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const search = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const searching = open && search.length >= MIN_SEARCH_LENGTH;

  const memoryHits = useQuery({
    queryKey: queryKeys.memory.search(search, 5),
    queryFn: () => searchMemory({ query: search, limit: 5 }),
    enabled: searching && canSearchMemory,
    staleTime: 15_000,
  });
  const agentHits = useQuery({ ...agentQueries.list({ q: search, limit: 5 }), enabled: searching && canReadAgents });
  const fileHits = useQuery({ ...fileQueries.list({ q: search, limit: 5 }), enabled: searching && canReadFiles });
  const automations = useQuery({ ...automationQueries.list({ enabled: true, limit: 8 }), enabled: open && canTestAutomation });
  const history = useCommandHistory(8, open && canHistory);

  const groups = useMemo(
    () => ({
      jarvis: t("palette.group.jarvis"),
      actions: t("palette.group.actions"),
      nav: t("palette.group.navigation"),
      search: t("palette.group.search"),
      automations: t("palette.group.automations"),
      history: t("palette.group.history"),
    }),
    [t],
  );

  const { items, handlers } = useMemo(() => {
    const list: CommandItem[] = [];
    const actions = new Map<string, () => void>();
    const add = (item: CommandItem, action: () => void): void => {
      list.push(item);
      actions.set(item.id, action);
    };
    const missing = t("command.capabilityMissing");
    const text = query.trim();

    // F.R.I.D.A.Y.
    add(
      {
        id: "ask",
        label: text ? t("palette.ask.query", { query: text }) : t("palette.ask"),
        description: text ? undefined : t("palette.ask.hint"),
        icon: <MessageCircleQuestion {...ICON} />,
        group: groups.jarvis,
        keywords: [t("palette.ask"), "fragen", "ask", text],
        disabled: !canExecute || !text,
        disabledReason: !canExecute ? missing : t("palette.ask.hint"),
      },
      () => void run({ text, source: "palette" }),
    );
    add(
      { id: "briefing", label: t("bottom.briefing"), icon: <Zap {...ICON} />, group: groups.jarvis, keywords: ["briefing", "zusammenfassung"], disabled: !canExecute, disabledReason: missing },
      () => void run({ text: EXECUTIVE_BRIEFING_COMMAND, source: "palette" }),
    );

    // Actions
    add(
      { id: "task.create", label: t("palette.task.create"), icon: <Plus {...ICON} />, group: groups.actions, keywords: ["aufgabe", "task", "neu"], disabled: !canCreateTask, disabledReason: missing },
      () => openCreateTask(true),
    );
    add(
      { id: "voice", label: voice.state === "listening" || voice.state === "speaking" ? t("palette.voice.stop") : t("palette.voice.start"), icon: <Mic {...ICON} />, group: groups.actions, keywords: ["sprache", "voice", "mikrofon"], shortcut: "Space", disabled: !voice.canToggle, disabledReason: missing },
      voice.toggle,
    );
    add(
      {
        id: "stop",
        label: t("palette.stop"),
        icon: <Square {...ICON} />,
        group: groups.actions,
        keywords: ["stopp", "stop", "abbrechen"],
        critical: true,
        disabled: !canStop,
        disabledReason: missing,
        preview: { title: t("palette.stop.preview"), lines: [t("palette.stop.line")], warning: t("palette.stop.warning") },
      },
      () => stop.mutate({ scope: "all" }),
    );
    add(
      {
        id: "pause",
        label: t("palette.pause"),
        icon: <Pause {...ICON} />,
        group: groups.actions,
        keywords: ["pause", "anhalten"],
        critical: true,
        disabled: !canPause,
        disabledReason: missing,
        preview: { title: t("palette.pause.preview"), lines: [t("palette.pause.line")] },
      },
      () => pause.mutate({ scope: "all" }),
    );
    add(
      { id: "resume", label: t("palette.resume"), icon: <Play {...ICON} />, group: groups.actions, keywords: ["fortsetzen", "resume", "weiter"], disabled: !canResume, disabledReason: missing },
      () => resume.mutate({ scope: "all" }),
    );
    add({ id: "calendar", label: t("palette.calendar"), icon: <CalendarDays {...ICON} />, group: groups.actions, keywords: ["kalender", "termine"] }, () => router.push("/calendar"));
    add({ id: "settings", label: t("palette.settings"), icon: <Settings {...ICON} />, group: groups.actions, keywords: ["einstellungen", "settings", "konfiguration"] }, () => router.push("/settings"));
    if (devScenarios) {
      add({ id: "dev-scenarios", label: t("devScenarios.palette"), icon: <FlaskConical {...ICON} />, group: groups.actions, keywords: ["szenario", "scenario", "konsole", "mock", "dev", "qa"] }, () => router.push("/dev/scenarios"));
    }

    // Navigation to every page
    for (const page of orderNavPages(settings?.navigation.order, undefined)) {
      add(
        { id: `nav.${page.id}`, label: t("palette.goto", { page: t(page.labelKey) }), icon: page.icon, group: groups.nav, keywords: [t(page.labelKey), page.id] },
        () => router.push(page.route),
      );
    }

    // Search results (memory, agents, files)
    for (const hit of memoryHits.data?.items ?? []) {
      const id = hit.memory.id;
      add(
        { id: `memory.${id}`, label: hit.memory.title ?? hit.memory.content.slice(0, 60), description: t("palette.result.memory"), icon: <Database {...ICON} />, group: groups.search, keywords: [text] },
        () => router.push(`/memory?memory=${encodeURIComponent(id)}`),
      );
    }
    for (const agent of agentHits.data?.items ?? []) {
      add(
        { id: `agent.${agent.id}`, label: agent.name, description: t("palette.result.agent"), icon: <Bot {...ICON} />, group: groups.search, keywords: [text] },
        () => router.push(`/agents?agent=${encodeURIComponent(agent.id)}`),
      );
    }
    for (const file of fileHits.data?.items ?? []) {
      add(
        { id: `file.${file.id}`, label: file.name, description: t("palette.result.file"), icon: <FileText {...ICON} />, group: groups.search, keywords: [text] },
        () => router.push(`/files?file=${encodeURIComponent(file.id)}`),
      );
    }

    // Start automation (writing, therefore confirmed twice: palette preview + server preview)
    for (const automation of automations.data?.items ?? []) {
      add(
        {
          id: `automation.${automation.id}`,
          label: t("palette.automation.run", { name: automation.name }),
          icon: <Workflow {...ICON} />,
          group: groups.automations,
          keywords: [automation.name, "automation"],
          critical: true,
          disabled: !canTestAutomation,
          disabledReason: missing,
          preview: { title: t("palette.automation.preview", { name: automation.name }), lines: automation.actions.map((a) => a.description) },
        },
        () =>
          testAutomation.mutate(
            { id: automation.id, dryRun: false },
            { onSuccess: () => toast({ title: t("palette.automation.started", { name: automation.name }), tone: "green" }) },
          ),
      );
    }

    // History (sensitive entries arrive redacted from the server; nothing is stored in the browser)
    for (const entry of history.data?.items ?? []) {
      const repeatable = entry.repeatable && !entry.redacted;
      add(
        {
          id: `history.${entry.id}`,
          label: historyLabel(entry, t("palette.history.protected")),
          description: t("palette.history.repeat"),
          icon: <History {...ICON} />,
          group: groups.history,
          keywords: [entry.text],
          disabled: !repeatable || !canExecute,
          disabledReason: entry.redacted ? t("palette.history.protectedReason") : missing,
        },
        () => void run({ text: entry.text, source: "palette" }),
      );
    }

    if (list.length === 0) add({ id: "none", label: t("palette.none"), icon: <CircleHelp {...ICON} />, disabled: true }, () => undefined);
    return { items: list, handlers: actions };
  }, [
    query, t, groups, canExecute, canCreateTask, canStop, canPause, canResume, canTestAutomation, voice, settings?.navigation.order, devScenarios,
    memoryHits.data, agentHits.data, fileHits.data, automations.data, history.data, run, router, openCreateTask, stop, pause, resume, testAutomation, toast,
  ]);

  const groupOrder = useMemo(
    () => (query.trim() ? [groups.jarvis, groups.search, groups.nav, groups.actions, groups.automations, groups.history] : [groups.jarvis, groups.actions, groups.nav, groups.automations, groups.history]),
    [groups, query],
  );

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      items={items}
      query={query}
      onQueryChange={setQuery}
      onSelect={(item) => handlers.get(item.id)?.()}
      placeholder={t("palette.placeholder")}
      label={t("palette.label")}
      emptyLabel={t("palette.empty")}
      groupOrder={groupOrder}
      labels={{
        navigate: t("palette.navigate"),
        select: t("palette.select"),
        close: t("common.close"),
        confirmTitle: t("palette.confirmTitle"),
        confirm: t("command.confirm"),
        back: t("palette.back"),
        results: (n: number) => t("palette.results", { count: n }),
        previewEmpty: t("palette.previewEmpty"),
      }}
    />
  );
}

