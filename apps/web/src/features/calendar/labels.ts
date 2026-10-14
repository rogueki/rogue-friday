import type { Attendee, CalendarEvent, CalendarProposalType } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";
import type { MessageKey } from "@/i18n";
import type { Civil } from "./dates";

export type CalendarView = "day" | "week" | "month" | "agenda";
export const VIEWS: readonly CalendarView[] = ["day", "week", "month", "agenda"];
export const isView = (value: string | null): value is CalendarView => value !== null && (VIEWS as readonly string[]).includes(value);

export const PROPOSAL_TYPES: readonly CalendarProposalType[] = ["create", "reschedule", "cancel", "invite", "respond"];

export const viewKey = (view: CalendarView): MessageKey => `calendar.view.${view}` as MessageKey;
export const proposalTypeKey = (type: CalendarProposalType): MessageKey => `calendar.proposal.type.${type}` as MessageKey;
export const responseKey = (response: Attendee["response"]): MessageKey => `calendar.response.${response}` as MessageKey;
export const statusKey = (status: CalendarEvent["status"]): MessageKey => `calendar.status.${status}` as MessageKey;
export const conflictKindKey = (kind: string): MessageKey => `calendar.conflict.kind.${kind}` as MessageKey;

export const RESPONSE_TONE: Record<Attendee["response"], Tone> = { accepted: "green", declined: "red", tentative: "amber", needs_action: "muted" };
export const STATUS_TONE: Record<CalendarEvent["status"], Tone> = { confirmed: "green", tentative: "amber", cancelled: "muted" };

/** Capability of `calendar.<action>` that a proposal type needs on top of `calendar.propose`. */
export const PROPOSAL_CAPABILITY: Record<CalendarProposalType, "create" | "reschedule" | "cancel" | "invite" | "respond"> = {
  create: "create",
  reschedule: "reschedule",
  cancel: "cancel",
  invite: "invite",
  respond: "respond",
};

/** Formats a civil day with `Intl` (zone-independent: noon UTC of that date, rendered in UTC). */
export function formatCivil(civil: Civil, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(civil.y, civil.m - 1, civil.d, 12)));
}

/** "+02:00" style label of a zone's current offset. */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
