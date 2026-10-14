"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { de } from "./de";
import { en } from "./en";

export type Locale = "de" | "en";
export type MessageKey = keyof typeof de;
export type MessageVars = Record<string, string | number>;

/** Display name used until `settings.profile.assistantName` is loaded (or when it is unset). */
export const DEFAULT_ASSISTANT_NAME = "F.R.I.D.A.Y.";

/** Resolves the effective display name from a possibly empty setting. */
export function resolveAssistantName(configured: string | null | undefined): string {
  const trimmed = configured?.trim();
  return trimmed ? trimmed : DEFAULT_ASSISTANT_NAME;
}

const dictionaries: Record<Locale, Record<MessageKey, string>> = { de, en };

/** Pure translation (also used outside React, e.g. in tests). Missing keys fall back to German, then to the key. */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: MessageVars,
  assistantName: string = DEFAULT_ASSISTANT_NAME,
): string {
  const template = dictionaries[locale][key] ?? de[key] ?? key;
  const values: MessageVars = { assistant: assistantName, ...vars };
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export type TranslateFn = (key: MessageKey, vars?: MessageVars) => string;

interface I18nValue {
  locale: Locale;
  t: TranslateFn;
  /** Configured display name of the assistant (`{assistant}` in every message). */
  assistantName: string;
}

const defaultValue: I18nValue = {
  locale: "de",
  t: (key, vars) => translate("de", key, vars),
  assistantName: DEFAULT_ASSISTANT_NAME,
};
const I18nContext = createContext<I18nValue>(defaultValue);

export function I18nProvider({
  locale,
  assistantName = DEFAULT_ASSISTANT_NAME,
  children,
}: {
  locale: Locale;
  assistantName?: string;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, assistantName, t: (key, vars) => translate(locale, key, vars, assistantName) }),
    [locale, assistantName],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** German is the default; English is switched in the settings (profile.locale). */
export function useT(): I18nValue {
  return useContext(I18nContext);
}

export { de, en };
