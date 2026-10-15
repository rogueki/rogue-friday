"use client";

import type { Channel } from "@friday/sdk";
import { useCapability, useCapabilityState, type CapabilityState } from "@/lib/capabilities";
import { channelAllows } from "./labels";

export interface ChannelAccess {
  /** Module-level state of `communication.send` ("read-only" shows "Lesen verfügbar / Senden nicht verfügbar"). */
  sendState: CapabilityState;
  canDraftOn: (channel: Channel | undefined) => boolean;
  canSendOn: (channel: Channel | undefined) => boolean;
}

/**
 * Drafting and sending need three things at once: the module capability, the mail capability for the e-mail channel and the
 * channel's own flags/status (PLAN §9.3, §33.4). Any missing one disables the action; the server checks again.
 */
export function useChannelAccess(): ChannelAccess {
  const draft = useCapability("communication", "draft");
  const send = useCapability("communication", "send");
  const mailDraft = useCapability("mail", "draft");
  const mailSend = useCapability("mail", "send");
  const sendState = useCapabilityState("communication", "send");
  return {
    sendState,
    canDraftOn: (channel) => draft && channelAllows(channel, "draft") && (channel?.kind !== "email" || mailDraft),
    canSendOn: (channel) => send && channelAllows(channel, "send") && (channel?.kind !== "email" || mailSend),
  };
}
