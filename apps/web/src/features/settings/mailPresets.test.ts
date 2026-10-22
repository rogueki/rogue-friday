import { describe, expect, it } from "vitest";
import { detectMailPreset, KNOWN_PROVIDER_DOMAINS, mailboxDomain } from "./mailPresets";

describe("mail server suggestions", () => {
  it("reads the domain from a mixed-case address with surrounding blanks", () => {
    expect(mailboxDomain("  Test.Person@GMX.DE ")).toBe("gmx.de");
    expect(mailboxDomain("ohne-atzeichen")).toBe("");
    expect(mailboxDomain("trailing@")).toBe("");
  });

  it("suggests editable hosts and ports for a known provider", () => {
    const preset = detectMailPreset("erik@web.de");
    expect(preset).toMatchObject({ label: "WEB.DE", imapHost: "imap.web.de", imapPort: 993, imapSecurity: "tls",
      smtpHost: "smtp.web.de", smtpPort: 587, smtpSecurity: "start-tls" });
    expect(preset?.hint).toMatch(/App-Passwort/);
  });

  it("returns a fresh copy so the wizard can edit without changing the table", () => {
    const first = detectMailPreset("a@gmx.de");
    first!.imapHost = "geaendert.example";
    expect(detectMailPreset("b@gmx.de")?.imapHost).toBe("imap.gmx.net");
    expect(detectMailPreset("a@gmx.net")?.label).toBe("GMX");
  });

  it("never guesses for an unknown domain or a lookalike", () => {
    expect(detectMailPreset("erik@beispiel.example")).toBeNull();
    expect(detectMailPreset("erik@gmx.de.example")).toBeNull();
    expect(detectMailPreset("erik@notgmx.de")).toBeNull();
    expect(detectMailPreset("")).toBeNull();
  });

  it("lists every documented provider domain once", () => {
    expect(new Set(KNOWN_PROVIDER_DOMAINS).size).toBe(KNOWN_PROVIDER_DOMAINS.length);
    expect(KNOWN_PROVIDER_DOMAINS).toContain("gmx.de");
    expect(KNOWN_PROVIDER_DOMAINS).toContain("mailbox.org");
  });
});