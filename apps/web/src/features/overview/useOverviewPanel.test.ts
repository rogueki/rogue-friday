import type { Overview } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { sectionStatus } from "./useOverviewPanel";

const overviewWith = (sections: Overview["degradedSections"]): Overview => ({ degradedSections: sections }) as unknown as Overview;
const unconfiguredMail = { section: "E-Mail & Kommunikation", adapterId: "unconfigured-communication", status: "offline", reason: "Kein Adapter konfiguriert." } as const;

describe("sectionStatus", () => {
  // Live report 2026-11-02: the live-intelligence panel ("Meldungen & Alarme") said "Nicht verbunden" because no mail
  // adapter existed, although its alerts come from Friday itself.
  it("ignores an unconfigured secondary module of a panel", () => {
    const status = sectionStatus(overviewWith([unconfiguredMail]), ["attention", "alerts", "approvals", "mail", "tasks"]);
    expect(status.offline).toBeUndefined();
  });

  it("still reports the panel's own module as unconfigured", () => {
    expect(sectionStatus(overviewWith([unconfiguredMail]), ["mail"]).offline?.adapterId).toBe("unconfigured-communication");
  });

  it("still reports an outage of a configured secondary adapter", () => {
    const outage = { section: "E-Mail & Kommunikation", adapterId: "imap-mail", status: "offline", reason: "Zeitüberschreitung" } as const;
    expect(sectionStatus(overviewWith([outage]), ["attention", "alerts", "mail"]).offline?.adapterId).toBe("imap-mail");
  });
});
