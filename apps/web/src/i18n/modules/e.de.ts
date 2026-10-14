/** Module group E strings (German): availability states (not configured / outage / missing capability) and follow-up fixes. */
export const deE = {
  // ── availability (PLAN §9.3, §1.1 rules 10/11) ──
  "avail.notConfigured.title": "Nicht verbunden",
  "avail.notConfigured.description": "Für „{module}“ ist kein Adapter konfiguriert. Der Rest der Anwendung funktioniert weiter.",
  "avail.offline.title": "Offline",
  "avail.offline.description": "{adapter} nicht erreichbar seit {since}, letzter Erfolg {last}.",
  "avail.offline.descriptionNoSince": "{adapter} nicht erreichbar, letzter Erfolg {last}.",
  "avail.offline.recovering": "{adapter} verbindet sich neu, letzter Erfolg {last}.",
  "avail.offline.never": "noch keiner",
  "avail.offline.reason": "Letzte Meldung: {reason}",
  "avail.offline.cached": "Angezeigt werden zwischengespeicherte Daten.",
  "avail.unsupported.title": "Lesen nicht verfügbar",
  "avail.unsupported.description": "Der Adapter „{adapter}“ bietet {capability} nicht an.",
  "avail.unsupported.descriptionNoAdapter": "Die Fähigkeit {capability} wird nicht angeboten.",
  "avail.adapterFor": "Adapter für {module}",
  "avail.adapterUnknown": "Adapter",

  "calendar.grid.scroll": "mit Pfeiltasten scrollbar",

  // ── voice nav widget ──
  "voice.nav.offline": "Sprachdienst offline",
  "voice.nav.notConfigured": "Sprache nicht verbunden",
  "voice.nav.recovering": "Sprachdienst verbindet sich neu …",

  // ── overview core tiles ──
  "core.offline": "Offline",
  "core.system.degraded": "Eingeschränkt",

  // ── system page ──
  "system.models.names": "Modelle",
  "system.models.more": "+{count} weitere",
  "system.models.noNames": "Keine Modelle gemeldet",
} as const;
