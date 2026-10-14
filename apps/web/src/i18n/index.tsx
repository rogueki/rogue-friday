"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { de } from "./de";
import { en } from "./en";

export type Locale = "de" | "en";
export type MessageKey = keyof typeof de;
export type MessageVars = Record<string, string | number>;

const dictionaries: Record<Locale, Record<MessageKey, string>> = { de, en };

/** Pure translation (also used outside React, e.g. in tests). Missing keys fall back to German, then to the key. */
export function translate(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const template = dictionaries[locale][key] ?? de[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export type TranslateFn = (key: MessageKey, vars?: MessageVars) => string;

interface I18nValue {
  locale: Locale;
  t: TranslateFn;
}

const defaultValue: I18nValue = { locale: "de", t: (key, vars) => translate("de", key, vars) };
const I18nContext = createContext<I18nValue>(defaultValue);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => ({ locale, t: (key, vars) => translate(locale, key, vars) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** German is the default; English is switched in the settings (profile.locale). */
export function useT(): I18nValue {
  return useContext(I18nContext);
}

export { de, en };
