"use client";

import { useT } from "@/i18n";

export { DEFAULT_ASSISTANT_NAME, resolveAssistantName } from "@/i18n";

/** Display name of the assistant (`settings.profile.assistantName`, fallback "F.R.I.D.A.Y."); changes live without a rebuild. */
export function useAssistantName(): string {
  return useT().assistantName;
}
