"use client";

import type { NotificationSettings } from "@friday/sdk";
import { Select, Switch } from "@friday/ui";
import { useT, type MessageKey } from "@/i18n";
import { useMessengerTargets } from "@/lib/api/domains/notifications";
import { FieldGrid } from "./controls";

type Level = "silent" | "voice_off";
type SummaryAt = "end" | "first_interaction";
type ImportantClass = "agent_questions" | "task_results" | "approvals" | "appointments";

const LEVELS: { value: Level; labelKey: MessageKey }[] = [
  { value: "silent", labelKey: "quietMode.level.silent" },
  { value: "voice_off", labelKey: "quietMode.level.voice_off" },
];

const SUMMARY_AT_OPTIONS: { value: SummaryAt; labelKey: MessageKey }[] = [
  { value: "first_interaction", labelKey: "quietSettings.summary.first_interaction" },
  { value: "end", labelKey: "quietSettings.summary.end" },
];

const IMPORTANT_CLASSES: { value: ImportantClass; labelKey: MessageKey }[] = [
  { value: "agent_questions", labelKey: "quietSettings.important.agent_questions" },
  { value: "task_results", labelKey: "quietSettings.important.task_results" },
  { value: "approvals", labelKey: "quietSettings.important.approvals" },
  { value: "appointments", labelKey: "quietSettings.important.appointments" },
];

const DEFAULT_IMPORTANT_CLASSES: ImportantClass[] = ["agent_questions", "approvals"];

export function QuietSettingsFields({
  value,
  readOnly,
  update,
}: {
  value: NotificationSettings;
  readOnly: boolean;
  update: (patch: Partial<NotificationSettings>) => void;
}) {
  const { t } = useT();
  const targets = useMessengerTargets(!readOnly);
  const level = value.quietHours.level ?? "silent";
  const summaryAt = value.quietHours.summaryAt ?? "first_interaction";
  const temporaryLevel = value.quietMode?.level ?? "silent";
  const importantClasses = value.importantClasses ?? DEFAULT_IMPORTANT_CLASSES;
  const targetItems = targets.data?.data.items ?? [];
  const toggleImportant = (className: ImportantClass, enabled: boolean) => {
    const next = IMPORTANT_CLASSES.map((option) => option.value).filter((option) =>
      option === className ? enabled : importantClasses.includes(option),
    );
    update({ importantClasses: next });
  };
  const stateLabels = [t("settings.state.on"), t("settings.state.off")] as const;
  return (
    <div>
      <FieldGrid columns={3}>
      <Select
        label={t("quietSettings.level.label")}
        value={level}
        options={LEVELS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
        onChange={(event) => update({ quietHours: { ...value.quietHours, level: event.target.value as Level } })}
        disabled={readOnly}
      />
      <Select
        label={t("quietSettings.summary.label")}
        value={summaryAt}
        options={SUMMARY_AT_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
        onChange={(event) => update({ quietHours: { ...value.quietHours, summaryAt: event.target.value as SummaryAt } })}
        disabled={readOnly}
      />
      <Select
        label={t("quietSettings.quietMode.label")}
        value={temporaryLevel}
        options={LEVELS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
        onChange={(event) => update({ quietMode: { level: event.target.value as Level } })}
        disabled={readOnly}
      />
      </FieldGrid>
      <section aria-label={t("quietSettings.important.title")}>
        <p className="st-muted">{t("quietSettings.important.title")}</p>
        <FieldGrid columns={2}>
        {IMPORTANT_CLASSES.map((option) => (
          <Switch
            key={option.value}
            label={t(option.labelKey)}
            checked={importantClasses.includes(option.value)}
            disabled={readOnly}
            stateLabels={stateLabels}
            onCheckedChange={(enabled) => toggleImportant(option.value, enabled)}
          />
        ))}
        </FieldGrid>
      </section>
      <Select
        label={t("quietSettings.textTarget.label")}
        value={value.quietTextTargetId ?? ""}
        options={[
          { value: "", label: t("quietSettings.textTarget.none") },
          ...targetItems.map((item) => ({ value: item.id, label: `${item.platform}: ${item.recipient}` })),
        ]}
        onChange={(event) => update({ quietTextTargetId: event.target.value || null })}
        disabled={readOnly}
      />
      {targetItems.length === 0 ? <p>{t("quietSettings.textTarget.empty")}</p> : null}
    </div>
  );
}