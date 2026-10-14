import type { Channel, ChannelKind, DraftStatus, Thread } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";
import type { MessageKey } from "@/i18n";

export type ThreadStatus = Thread["status"];

export const THREAD_STATUSES: readonly ThreadStatus[] = ["open", "waiting", "replied", "archived"];
export const CHANNEL_KINDS: readonly ChannelKind[] = ["email", "telegram", "whatsapp", "sms", "phone", "other"];

export const threadStatusKey = (status: ThreadStatus): MessageKey => `communication.threadStatus.${status}` as MessageKey;
export const draftStatusKey = (status: DraftStatus): MessageKey => `communication.draftStatus.${status}` as MessageKey;

export const THREAD_STATUS_TONE: Record<ThreadStatus, Tone> = { open: "cyan", waiting: "amber", replied: "green", archived: "muted" };
export const DRAFT_STATUS_TONE: Record<DraftStatus, Tone> = { draft: "cyan", pending_approval: "amber", approved: "green", sent: "green", failed: "red", discarded: "muted" };

/** What a channel permits, derived from the channel flags only (module capabilities are layered on top by `useChannelAccess`). */
export function channelAllows(channel: Channel | undefined, action: "read" | "draft" | "send"): boolean {
  if (!channel) return false;
  if (channel.status === "offline" || channel.status === "not_configured") return false;
  if (channel.status === "read_only" && action !== "read") return false;
  return channel.capabilities[action];
}

export function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

/** First and last names of the people on a thread, without the owner, for compact rows. */
export function participantNames(thread: Pick<Thread, "participants">, limit = 3): string {
  const names = thread.participants.filter((participant) => participant.role !== "owner").map((participant) => participant.name);
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown} +${names.length - limit}` : shown;
}
