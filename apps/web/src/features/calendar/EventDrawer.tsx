"use client";

import type { CalendarBriefing, CalendarConflict, CalendarEvent, CalendarProposalType } from "@friday/sdk";
import { Button, Drawer, StatusChip, TagPill } from "@friday/ui";
import { AlarmClock, CalendarClock, CalendarX2, Mail, Reply, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n";
import { useCalendarBriefings, useCalendarConflicts, useCalendarEvent } from "@/lib/api/domains/calendar";
import { useCapability } from "@/lib/capabilities";
import { severityFromWire } from "../shared/presentation";
import { DataBadges } from "../memory/kit/Badges";
import { useFormat } from "../memory/kit/hooks";
import { QueryBoundary } from "../memory/kit/QueryBoundary";
import { conflictKindKey, RESPONSE_TONE, responseKey, STATUS_TONE, statusKey } from "./labels";

export interface EventDrawerProps {
  id: string | null;
  onClose: () => void;
  onPropose: (type: CalendarProposalType, event: CalendarEvent) => void;
}

export function EventDrawer({ id, onClose, onPropose }: EventDrawerProps) {
  const { t } = useT();
  const query = useCalendarEvent(id);
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={query.data?.data.title ?? t("calendar.drawer.title")}
      subtitle={query.data ? statusLabel(query.data.data, t) : undefined}
      closeLabel={t("common.close")}
      width={540}
    >
      <QueryBoundary query={query}>{(response) => <EventDetail event={response.data} freshness={response.freshness} onPropose={onPropose} />}</QueryBoundary>
    </Drawer>
  );
}

const statusLabel = (event: CalendarEvent, t: ReturnType<typeof useT>["t"]): string => t(statusKey(event.status));

function EventDetail({ event, freshness, onPropose }: { event: CalendarEvent; freshness: { state: "fresh" | "stale" | "unknown" | "offline-cache"; asOf: string | null }; onPropose: EventDrawerProps["onPropose"] }) {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  const conflicts = useCalendarConflicts();
  const briefings = useCalendarBriefings();
  const canPropose = useCapability("calendar", "propose");
  const flags = {
    reschedule: useCapability("calendar", "reschedule"),
    cancel: useCapability("calendar", "cancel"),
    invite: useCapability("calendar", "invite"),
    respond: useCapability("calendar", "respond"),
  };
  const can = { reschedule: canPropose && flags.reschedule, cancel: canPropose && flags.cancel, invite: canPropose && flags.invite, respond: canPropose && flags.respond };

  const eventConflicts: CalendarConflict[] = (conflicts.data?.items ?? []).filter((conflict) => conflict.eventIds.includes(event.id) || event.conflictIds.includes(conflict.id));
  const briefing: CalendarBriefing | undefined = (briefings.data?.items ?? []).find((candidate) => candidate.eventId === event.id || candidate.id === event.briefingId);
  const zone = event.timeZone;
  const sameZone = !format.timeZone || zone === format.timeZone;
  const startLocal = format.dateTime(event.start);
  const when = event.allDay ? t("calendar.drawer.allDayOn", { date: format.date(event.start) }) : `${startLocal} – ${format.time(event.end)}`;
  const zoneTime = new Intl.DateTimeFormat(format.locale, { hour: "2-digit", minute: "2-digit", timeZone: zone, hour12: format.hour12 });

  return (
    <div className="mk-stack cal-detail" data-event-id={event.id}>
      <DataBadges sources={[event.source]} freshness={freshness} />
      <div className="mk-actions">
        <StatusChip tone={STATUS_TONE[event.status]}>{t(statusKey(event.status))}</StatusChip>
        {eventConflicts.length > 0 || event.conflictIds.length > 0 ? <StatusChip tone="red">{t("calendar.conflict.marker")}</StatusChip> : null}
      </div>
      <dl className="mk-dl">
        <dt>{t("calendar.field.when")}</dt>
        <dd>{when}</dd>
        <dt>{t("calendar.field.zone")}</dt>
        <dd>
          {format.timeZone ?? t("calendar.zone.browser")}
          {!sameZone && !event.allDay ? (
            <span className="mk-muted">
              {" "}
              · {t("calendar.zone.eventLocal", { time: `${zoneTime.format(new Date(event.start))}–${zoneTime.format(new Date(event.end))}`, zone })}
            </span>
          ) : null}
        </dd>
        {event.location ? (
          <>
            <dt>{t("calendar.field.location")}</dt>
            <dd>{event.location}</dd>
          </>
        ) : null}
        <dt>{t("calendar.field.reminders")}</dt>
        <dd>
          {event.reminderMinutes.length === 0 ? (
            t("calendar.reminders.none")
          ) : (
            <span className="mk-tags">
              {event.reminderMinutes
                .slice()
                .sort((a, b) => b - a)
                .map((minutes) => (
                  <TagPill key={minutes} tone="cyan" icon={<AlarmClock size={11} aria-hidden="true" />}>
                    {reminderLabel(minutes, t)}
                  </TagPill>
                ))}
            </span>
          )}
        </dd>
      </dl>
      {event.description ? (
        <div className="mk-block">
          <p>{event.description}</p>
        </div>
      ) : null}

      <section>
        <h3 className="mk-section-title">{t("calendar.attendees.title", { count: event.attendees.length })}</h3>
        {event.attendees.length === 0 ? (
          <p className="mk-note">{t("calendar.attendees.none")}</p>
        ) : (
          <ul className="mk-list">
            {event.attendees.map((attendee) => {
              const context = briefing?.attendeeContext.find((entry) => entry.name === attendee.name);
              return (
                <li key={`${attendee.name}:${attendee.email ?? ""}`} className="mk-block cal-attendee">
                  <span className="cal-attendee__head">
                    <span className="mk-strong">{attendee.name}</span>
                    <StatusChip tone={RESPONSE_TONE[attendee.response]}>{t(responseKey(attendee.response))}</StatusChip>
                  </span>
                  {attendee.email ? <span className="mk-mono">{attendee.email}</span> : null}
                  {context ? <span className="mk-note">{context.notes}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {eventConflicts.length > 0 ? (
        <section>
          <h3 className="mk-section-title">{t("calendar.conflicts.title")}</h3>
          <ul className="mk-list">
            {eventConflicts.map((conflict) => (
              <li key={conflict.id} className={`mk-block mk-block--${severityFromWire(conflict.severity) === "critical" ? "red" : "amber"}`}>
                <p className="mk-strong">{t(conflictKindKey(conflict.kind))}</p>
                <p>{conflict.description}</p>
                {conflict.suggestedResolution ? <p className="mk-muted">{t("calendar.conflicts.suggestion", { text: conflict.suggestedResolution })}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mk-section-title">{t("calendar.briefing.title")}</h3>
        {briefing ? (
          <div className="mk-block">
            <p>{briefing.summary}</p>
            {briefing.talkingPoints.length > 0 ? (
              <ul className="cal-points">
                {briefing.talkingPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
            <p className="mk-muted">{t("calendar.briefing.generated", { when: format.dateTime(briefing.generatedAt) })}</p>
          </div>
        ) : (
          <p className="mk-note">{t("calendar.briefing.none")}</p>
        )}
      </section>

      <section>
        <h3 className="mk-section-title">{t("calendar.links.title")}</h3>
        <dl className="mk-dl">
          <dt>{t("calendar.links.mails")}</dt>
          <dd>
            {event.linkedThreadIds.length === 0 ? (
              t("calendar.links.none")
            ) : (
              <span className="mk-tags">
                {event.linkedThreadIds.map((threadId) => (
                  <Button key={threadId} size="sm" variant="ghost" icon={<Mail size={13} />} onClick={() => router.push(`/communication?thread=${encodeURIComponent(threadId)}`)}>
                    {t("calendar.links.openMail")}
                  </Button>
                ))}
              </span>
            )}
          </dd>
          <dt>{t("calendar.links.tasks")}</dt>
          <dd>
            {event.linkedTaskIds.length === 0 ? (
              t("calendar.links.none")
            ) : (
              <span className="mk-tags">
                {event.linkedTaskIds.map((taskId) => (
                  <Button key={taskId} size="sm" variant="ghost" onClick={() => router.push(`/tasks?task=${encodeURIComponent(taskId)}`)}>
                    {t("calendar.links.openTask")}
                  </Button>
                ))}
              </span>
            )}
          </dd>
        </dl>
      </section>

      <div className="mk-actions" role="group" aria-label={t("calendar.actions")}>
        <Button size="sm" variant="ghost" icon={<CalendarClock size={14} />} disabled={!can.reschedule || event.status === "cancelled"} title={!can.reschedule ? t("calendar.proposal.notAllowed") : undefined} onClick={() => onPropose("reschedule", event)}>
          {t("calendar.proposal.type.reschedule")}
        </Button>
        <Button size="sm" variant="ghost" icon={<CalendarX2 size={14} />} disabled={!can.cancel || event.status === "cancelled"} title={!can.cancel ? t("calendar.proposal.notAllowed") : undefined} onClick={() => onPropose("cancel", event)}>
          {t("calendar.proposal.type.cancel")}
        </Button>
        <Button size="sm" variant="ghost" icon={<UserPlus size={14} />} disabled={!can.invite || event.status === "cancelled"} title={!can.invite ? t("calendar.proposal.notAllowed") : undefined} onClick={() => onPropose("invite", event)}>
          {t("calendar.proposal.type.invite")}
        </Button>
        <Button size="sm" variant="ghost" icon={<Reply size={14} />} disabled={!can.respond || event.status === "cancelled"} title={!can.respond ? t("calendar.proposal.notAllowed") : undefined} onClick={() => onPropose("respond", event)}>
          {t("calendar.proposal.type.respond")}
        </Button>
      </div>
      <p className="mk-note">{t("calendar.proposal.approvalRule")}</p>
    </div>
  );
}

function reminderLabel(minutes: number, t: ReturnType<typeof useT>["t"]): string {
  if (minutes === 0) return t("calendar.reminders.atStart");
  if (minutes >= 1440 && minutes % 1440 === 0) return t("calendar.reminders.days", { count: minutes / 1440 });
  if (minutes >= 60 && minutes % 60 === 0) return t("calendar.reminders.hours", { count: minutes / 60 });
  return t("calendar.reminders.minutes", { count: minutes });
}
