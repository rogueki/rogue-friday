"use client";

import type { Attendee, CalendarEvent, CalendarProposalRequest, CalendarProposalType } from "@friday/sdk";
import { Button, Dialog, Select, TextField } from "@friday/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { useCreateCalendarProposal } from "@/lib/api/domains/calendar";
import { useCapability } from "@/lib/capabilities";
import { TextArea } from "../memory/kit/fields";
import { useFormat } from "../memory/kit/hooks";
import { fromLocalInput, toLocalInput } from "./dates";
import { PROPOSAL_CAPABILITY, PROPOSAL_TYPES, proposalTypeKey } from "./labels";

export interface ProposalDefaults {
  type?: CalendarProposalType;
  eventId?: string | null;
  /** Start of a free slot to prefill "create" (ISO). */
  start?: string;
  end?: string;
}

export interface ProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: readonly CalendarEvent[];
  defaults?: ProposalDefaults;
}

interface Errors {
  eventId?: string;
  title?: string;
  start?: string;
  end?: string;
  attendees?: string;
  reason?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parses "Name <mail@host>" / "mail@host" lines into attendees (invalid lines are reported, not dropped). */
export function parseAttendees(raw: string): { attendees: Attendee[]; invalid: string[] } {
  const attendees: Attendee[] = [];
  const invalid: string[] = [];
  for (const line of raw.split(/[\n;]/).map((entry) => entry.trim()).filter(Boolean)) {
    const match = /^(.*?)\s*<([^>]+)>$/.exec(line);
    const email = (match ? match[2] : line)?.trim() ?? "";
    const name = (match ? match[1] : "")?.trim() || email;
    if (EMAIL.test(email)) attendees.push({ name, email, response: "needs_action" });
    else invalid.push(line);
  }
  return { attendees, invalid };
}

/** Remount per open so every proposal starts from its defaults. */
export function ProposalDialog(props: ProposalDialogProps) {
  return props.open ? <ProposalBody {...props} /> : null;
}

function ProposalBody({ onOpenChange, events, defaults }: ProposalDialogProps) {
  const { t } = useT();
  const router = useRouter();
  const { timeZone } = useFormat();
  const create = useCreateCalendarProposal();
  const caps = {
    create: useCapability("calendar", "create"),
    reschedule: useCapability("calendar", "reschedule"),
    cancel: useCapability("calendar", "cancel"),
    invite: useCapability("calendar", "invite"),
    respond: useCapability("calendar", "respond"),
  };
  const canPropose = useCapability("calendar", "propose");
  const allowed = (type: CalendarProposalType): boolean => canPropose && caps[PROPOSAL_CAPABILITY[type]];
  const firstAllowed = PROPOSAL_TYPES.find(allowed) ?? "create";

  const [type, setType] = useState<CalendarProposalType>(defaults?.type && allowed(defaults.type) ? defaults.type : firstAllowed);
  const [eventId, setEventId] = useState(defaults?.eventId ?? "");
  const event = events.find((candidate) => candidate.id === eventId);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => (defaults?.start ? toLocalInput(new Date(defaults.start), timeZone) : event ? toLocalInput(new Date(event.start), timeZone) : ""));
  const [end, setEnd] = useState(() => (defaults?.end ? toLocalInput(new Date(defaults.end), timeZone) : event ? toLocalInput(new Date(event.end), timeZone) : ""));
  const [attendeesRaw, setAttendeesRaw] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [result, setResult] = useState<{ approvalId: string | null } | null>(null);

  const needsEvent = type !== "create";
  const needsTime = type === "create" || type === "reschedule";

  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    const found: Errors = {};
    if (needsEvent && !event) found.eventId = t("calendar.proposal.error.event");
    if (type === "create" && title.trim() === "") found.title = t("calendar.proposal.error.title");
    const startDate = fromLocalInput(start, timeZone);
    const endDate = fromLocalInput(end, timeZone);
    if (needsTime) {
      if (!startDate) found.start = t("calendar.proposal.error.start");
      if (!endDate) found.end = t("calendar.proposal.error.end");
      else if (startDate && endDate.getTime() <= startDate.getTime()) found.end = t("calendar.proposal.error.order");
    }
    const parsed = parseAttendees(attendeesRaw);
    if (type === "invite" && (parsed.attendees.length === 0 || parsed.invalid.length > 0)) {
      found.attendees = parsed.invalid.length > 0 ? t("calendar.proposal.error.attendeesInvalid", { entries: parsed.invalid.join(", ") }) : t("calendar.proposal.error.attendees");
    }
    if (reason.trim() === "") found.reason = t("calendar.proposal.error.reason");
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const request: CalendarProposalRequest = {
      type,
      reason: reason.trim(),
      ...(needsEvent && event ? { eventId: event.id } : {}),
      ...(type === "create" ? { title: title.trim() } : {}),
      ...(needsTime && startDate && endDate ? { start: startDate.toISOString(), end: endDate.toISOString() } : {}),
      ...(type === "invite" ? { attendees: parsed.attendees } : {}),
    };
    create.mutate(request, { onSuccess: (response) => setResult({ approvalId: response.data.approvalId }) });
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t("calendar.proposal.title")}
      description={result ? undefined : t("calendar.proposal.description")}
      size="lg"
      closeLabel={t("common.close")}
      footer={
        result ? (
          <>
            {result.approvalId ? (
              <Button onClick={() => router.push(`/approvals?approval=${encodeURIComponent(result.approvalId ?? "")}`)}>{t("calendar.proposal.openApproval")}</Button>
            ) : null}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="proposal-form" loading={create.isPending} disabled={!allowed(type)}>
              {t("calendar.proposal.submit")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <p className="mk-block mk-block--green mk-note" role="status">
          {result.approvalId ? t("calendar.proposal.doneApproval") : t("calendar.proposal.done")}
        </p>
      ) : (
        <form id="proposal-form" className="mk-form" onSubmit={submit} noValidate>
          <Select
            label={t("calendar.proposal.type")}
            value={type}
            onChange={(selection) => setType(selection.target.value as CalendarProposalType)}
            options={PROPOSAL_TYPES.map((value) => ({ value, label: allowed(value) ? t(proposalTypeKey(value)) : `${t(proposalTypeKey(value))} (${t("calendar.proposal.unavailable")})`, disabled: !allowed(value) }))}
          />
          {!allowed(type) ? <p className="mk-form__error">{t("calendar.proposal.notAllowed")}</p> : null}
          {needsEvent ? (
            <Select
              label={t("calendar.proposal.event")}
              value={eventId}
              error={errors.eventId}
              onChange={(selection) => {
                const next = selection.target.value;
                setEventId(next);
                const chosen = events.find((candidate) => candidate.id === next);
                if (chosen && needsTime) {
                  setStart(toLocalInput(new Date(chosen.start), timeZone));
                  setEnd(toLocalInput(new Date(chosen.end), timeZone));
                }
              }}
              options={[{ value: "", label: t("calendar.proposal.eventPlaceholder") }, ...events.filter((candidate) => candidate.status !== "cancelled").map((candidate) => ({ value: candidate.id, label: candidate.title }))]}
            />
          ) : null}
          {type === "create" ? <TextField label={t("calendar.proposal.titleField")} value={title} onChange={(change) => setTitle(change.target.value)} error={errors.title} required /> : null}
          {needsTime ? (
            <div className="mk-grid-2">
              <TextField label={t("calendar.proposal.start")} type="datetime-local" value={start} onChange={(change) => setStart(change.target.value)} error={errors.start} required />
              <TextField label={t("calendar.proposal.end")} type="datetime-local" value={end} onChange={(change) => setEnd(change.target.value)} error={errors.end} required />
            </div>
          ) : null}
          {needsTime ? <p className="mk-note">{t("calendar.proposal.zoneHint", { zone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone })}</p> : null}
          {type === "invite" ? <TextArea label={t("calendar.proposal.attendees")} value={attendeesRaw} onChange={(change) => setAttendeesRaw(change.target.value)} rows={3} error={errors.attendees} hint={t("calendar.proposal.attendeesHint")} /> : null}
          <TextArea label={t("calendar.proposal.reason")} value={reason} onChange={(change) => setReason(change.target.value)} rows={3} error={errors.reason} required />
          <p className="mk-note">{t("calendar.proposal.approvalRule")}</p>
        </form>
      )}
    </Dialog>
  );
}
