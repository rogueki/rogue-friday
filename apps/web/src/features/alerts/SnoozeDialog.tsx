"use client";

import type { Notification } from "@friday/sdk";
import { Button, Dialog, Select, TextField } from "@friday/ui";
import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { useSettings } from "@/lib/api/domains/settings";

const PRESETS = [15, 60, 240, 1440] as const;
const CUSTOM = "custom";
const MAX_MINUTES = 7 * 24 * 60;

export interface SnoozeDialogProps {
  notification: Notification | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (notification: Notification, minutes: number) => void;
}

export function SnoozeDialog({ notification, busy, onClose, onConfirm }: SnoozeDialogProps) {
  return notification ? <SnoozeBody key={notification.id} notification={notification} busy={busy} onClose={onClose} onConfirm={onConfirm} /> : null;
}

function SnoozeBody({ notification, busy, onClose, onConfirm }: SnoozeDialogProps & { notification: Notification }) {
  const { t } = useT();
  const settings = useSettings();
  const [choice, setChoice] = useState<string>(String(PRESETS[1]));
  const [custom, setCustom] = useState("30");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const configured = settings.data?.data.notifications.snoozeDefaultMinutes;
    if (configured) setChoice(PRESETS.includes(configured as (typeof PRESETS)[number]) ? String(configured) : CUSTOM);
    if (configured && !PRESETS.includes(configured as (typeof PRESETS)[number])) setCustom(String(configured));
  }, [settings.data?.data.notifications.snoozeDefaultMinutes]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const minutes = choice === CUSTOM ? Number(custom) : Number(choice);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
      setError(t("alerts.snooze.error", { max: MAX_MINUTES }));
      return;
    }
    onConfirm(notification, minutes);
  };

  const label = (minutes: number): string =>
    minutes < 60 ? t("alerts.snooze.minutes", { count: minutes }) : minutes < 1440 ? t("alerts.snooze.hours", { count: minutes / 60 }) : t("alerts.snooze.day");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("alerts.snooze.title")}
      description={t("alerts.snooze.description", { title: notification.title })}
      size="sm"
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="snooze-form" loading={busy}>
            {t("alerts.action.snooze")}
          </Button>
        </>
      }
    >
      <form id="snooze-form" className="mk-form" onSubmit={submit} noValidate>
        <Select
          label={t("alerts.snooze.duration")}
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          options={[...PRESETS.map((minutes) => ({ value: String(minutes), label: label(minutes) })), { value: CUSTOM, label: t("alerts.snooze.custom") }]}
        />
        {choice === CUSTOM ? (
          <TextField label={t("alerts.snooze.customMinutes")} type="number" inputMode="numeric" min={1} max={MAX_MINUTES} value={custom} onChange={(event) => setCustom(event.target.value)} error={error} />
        ) : null}
        {error && choice !== CUSTOM ? <p className="mk-form__error">{error}</p> : null}
        {notification.priority === "P0" || notification.priority === "P1" ? <p className="mk-note">{t("alerts.snooze.urgentHint")}</p> : null}
      </form>
    </Dialog>
  );
}
