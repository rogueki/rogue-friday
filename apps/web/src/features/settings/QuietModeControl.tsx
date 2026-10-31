"use client";

import type { QuietModeState } from "@friday/sdk";
import { Button, Select } from "@friday/ui";
import { useState } from "react";
import { useT, type MessageKey } from "@/i18n";
import { useClearQuietMode, useQuietMode, useQuietModeSummary, useSetQuietMode } from "@/lib/api/domains/notifications";
import { useAppSettings } from "@/lib/settings";

type Translate = (key: MessageKey) => string;

const DURATIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "30", labelKey: "quietMode.duration.30" },
  { value: "60", labelKey: "quietMode.duration.60" },
  { value: "120", labelKey: "quietMode.duration.120" },
  { value: "240", labelKey: "quietMode.duration.240" },
  { value: "tomorrow", labelKey: "quietMode.duration.tomorrow" },
];

const LEVELS: { value: "silent" | "voice_off"; labelKey: MessageKey }[] = [
  { value: "silent", labelKey: "quietMode.level.silent" },
  { value: "voice_off", labelKey: "quietMode.level.voice_off" },
];

/** Clock time (HH:MM) of `until` in the dashboard time zone. */
export function quietModeTime(until: QuietModeState["until"], locale: string, timeZone: string | undefined): string {
  if (!until) return "";
  const date = new Date(until);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
}

/** "Ruhemodus bis 15:40" for a temporary pause, "Nachtruhe bis 07:00" for the nightly schedule. */
export function quietModeStatusLabel(
  source: QuietModeState["source"],
  until: QuietModeState["until"],
  t: Translate,
  locale: string,
  timeZone: string | undefined,
): string {
  const label = t(source === "schedule" ? "quietMode.status.schedule" : "quietMode.status.temporary");
  const time = quietModeTime(until, locale, timeZone);
  return time ? `${label} ${time}` : label;
}

function summaryClassLabel(className: string, t: Translate): string {
  switch (className) {
    case "agent_questions":
      return t("quietMode.summary.class.agent_questions");
    case "task_results":
      return t("quietMode.summary.class.task_results");
    case "approvals":
      return t("quietMode.summary.class.approvals");
    case "appointments":
      return t("quietMode.summary.class.appointments");
    default:
      return className;
  }
}

/** `until` for the chosen duration: now plus minutes, or the next 07:00 in the browser's time zone. */
function untilFromDuration(duration: string): string {
  const now = new Date();
  if (duration === "tomorrow") {
    const next = new Date(now);
    next.setHours(7, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  return new Date(now.getTime() + Number(duration) * 60_000).toISOString();
}

export function QuietModeControl({ readOnly, defaultLevel }: { readOnly: boolean; defaultLevel?: "silent" | "voice_off" }) {
  const { t, locale } = useT();
  const { timeZone } = useAppSettings();
  const quietMode = useQuietMode();
  const quietModeSummary = useQuietModeSummary();
  const setQuietMode = useSetQuietMode();
  const clearQuietMode = useClearQuietMode();
  const [duration, setDuration] = useState("60");
  const [level, setLevel] = useState<"silent" | "voice_off">(defaultLevel ?? "silent");
  const state = quietMode.data?.data;
  const summaryItems = quietModeSummary.data?.data.items ?? [];
  const error = setQuietMode.error?.message ?? clearQuietMode.error?.message;
  const statusText = state?.active
    ? `${quietModeStatusLabel(state.source, state.until, t, locale, timeZone)} · ${t(
        state.level === "voice_off" ? "quietMode.level.short.voice_off" : "quietMode.level.short.silent",
      )}`
    : t("quietMode.status.inactive");
  return (
    <div>
      <p role="status">{statusText}</p>
      {summaryItems.length > 0 ? (
        <section>
          <h3>{t("quietMode.summary.title")}</h3>
          <ul>
            {summaryItems.map((item, index) => {
              const time = quietModeTime(item.at, locale, timeZone);
              const delivery =
                item.delivery === "sent"
                  ? t("quietMode.summary.delivery.sent")
                  : item.delivery === "uncertain"
                    ? t("quietMode.summary.delivery.uncertain")
                    : null;
              return (
                <li key={`${item.class}-${item.at}-${index}`}>
                  {time ? <time dateTime={item.at}>{time}</time> : null} · {summaryClassLabel(item.class, t)}: {item.title}
                  {delivery ? ` · ${delivery}` : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {readOnly ? null : (
        <>
          <Select
            label={t("quietMode.level.label")}
            value={level}
            options={LEVELS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            onChange={(event) => setLevel(event.target.value as "silent" | "voice_off")}
          />
          <Select
            label={t("quietMode.duration.label")}
            value={duration}
            options={DURATIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            onChange={(event) => setDuration(event.target.value)}
          />
          <div>
            <Button
              type="button"
              size="sm"
              disabled={setQuietMode.isPending}
              onClick={() => setQuietMode.mutate({ until: untilFromDuration(duration), level })}
            >
              {t("quietMode.start")}
            </Button>
            {state?.temporaryUntil ? (
              <Button type="button" size="sm" variant="ghost" disabled={clearQuietMode.isPending} onClick={() => clearQuietMode.mutate({})}>
                {t("quietMode.stop")}
              </Button>
            ) : null}
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </>
      )}
    </div>
  );
}
