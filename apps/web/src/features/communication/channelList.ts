import type { Channel, ChannelKind } from "@friday/sdk";

/**
 * Die sichtbare Standardkanalliste aus DASH-Kontext 2, in genau dieser Reihenfolge: Alle Kanaele (Filter, kein Adapter),
 * E-Mail Postfach, Telegram, WhatsApp, Telefon, Discord. SMS und weitere Hermes-Kanaele bleiben in den Daten erhalten,
 * erscheinen in der Kommunikationsnavigation aber nicht.
 */
export const VISIBLE_CHANNEL_KINDS: readonly ChannelKind[] = ["email", "telegram", "whatsapp", "phone", "discord"];

export interface ChannelPartition {
  /** Sichtbare Kanaele in der Reihenfolge von `VISIBLE_CHANNEL_KINDS`, innerhalb einer Art nach unread/name. */
  visible: Channel[];
  /** Unterdrueckte Kanaele (SMS, other) - weiterhin unter Einstellungen konfigurierbar. */
  hidden: Channel[];
}

export function partitionChannels(channels: readonly Channel[]): ChannelPartition {
  const rank = new Map(VISIBLE_CHANNEL_KINDS.map((kind, index) => [kind, index]));
  const visible: Channel[] = [];
  const hidden: Channel[] = [];
  for (const channel of channels) {
    if (rank.has(channel.kind)) visible.push(channel);
    else hidden.push(channel);
  }
  visible.sort((left, right) => (rank.get(left.kind) ?? 0) - (rank.get(right.kind) ?? 0)
    || right.unreadCount - left.unreadCount
    || left.name.localeCompare(right.name, "de"));
  return { visible, hidden };
}

/** Kanalkennung fuer die Auswahl des Einrichtungsflusses: E-Mail-Postfach, Messenger, Telefon. */
export function channelGroup(kind: ChannelKind | undefined): "email" | "messenger" | "phone" | "none" {
  if (kind === "email") return "email";
  if (kind === "telegram" || kind === "whatsapp" || kind === "discord") return "messenger";
  if (kind === "phone") return "phone";
  return "none";
}