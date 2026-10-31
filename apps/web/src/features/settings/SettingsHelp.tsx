"use client";

import help from "./settingsHelp.generated.json";

export interface SettingsHelpEntry {
  title: string;
  text: string;
}

const AREAS: Readonly<Record<string, readonly SettingsHelpEntry[]>> = help.areas;

export function settingsHelpFor(area: string): readonly SettingsHelpEntry[] {
  return Object.hasOwn(AREAS, area) ? AREAS[area] ?? [] : [];
}

export function SettingsHelp({ area, id }: { area: string; id: string }) {
  const entries = settingsHelpFor(area);
  if (entries.length === 0) return null;
  return (
    <div id={id} className="st-help" role="region" aria-label="Hilfe">
      {entries.map((entry) => (
        <section key={entry.title}>
          <h3>{entry.title}</h3>
          {entry.text.split(/\n\s*\n/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      ))}
    </div>
  );
}
