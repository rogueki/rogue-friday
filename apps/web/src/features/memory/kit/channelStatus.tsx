import type { ChannelKind, ChannelStatus } from "@jarvis/sdk";
import type { Tone } from "@jarvis/ui";
import { LayoutDashboard, Mail, MessageCircle, MessageSquare, Phone, Plug, Send, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/i18n";

/** Channel status vocabulary of PLAN §33.4: Online, Degraded, Offline, Read-only, Nicht konfiguriert. */
export const CHANNEL_STATUS_TONE: Record<ChannelStatus, Tone> = {
  online: "green",
  degraded: "amber",
  offline: "red",
  read_only: "blue",
  not_configured: "muted",
};

export const channelStatusKey = (status: ChannelStatus): MessageKey => `communication.status.${status}` as MessageKey;

/** Channel kinds of the inbox plus the dashboard itself (escalation channel). */
export type AnyChannelKind = ChannelKind | "dashboard";

export const CHANNEL_ICON: Record<AnyChannelKind, LucideIcon> = {
  email: Mail,
  telegram: Send,
  whatsapp: MessageCircle,
  sms: MessageSquare,
  phone: Phone,
  other: Plug,
  dashboard: LayoutDashboard,
};

export const channelKindKey = (kind: AnyChannelKind): MessageKey => `communication.kind.${kind}` as MessageKey;
