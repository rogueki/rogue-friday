import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { jsonResponse, renderWithProviders } from "@/test/render";
import { MailAccountWizard } from "./MailAccountWizard";

const freshness = { state: "fresh", asOf: "2026-10-22T10:00:00Z" };

async function bodyOf(input: RequestInfo | URL, init: RequestInit | undefined): Promise<unknown> {
  const raw = init?.body;
  if (typeof raw === "string") return JSON.parse(raw);
  if (raw instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(raw));
  if (raw instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(new Uint8Array(raw)));
  if (input instanceof Request) {
    const text = await input.clone().text();
    return text ? JSON.parse(text) : undefined;
  }
  return undefined;
}

function checkResponse(ok: boolean, reason: "ok" | "auth" | "tls" | "network" | "protocol" | "unavailable") {
  return { contractVersion: "2.0.0", data: { ok, reason }, freshness };
}

function harness(options: { check?: (protocol: string) => Response | Promise<Response>; created?: () => void } = {}) {
  const paths: string[] = [];
  const bodies: unknown[] = [];
  const headers: (string | null)[] = [];
  const created = options.created ?? (() => {});
  const view = renderWithProviders(<MailAccountWizard onCreated={created} />, { fetchImpl: async (input, init) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const method = input instanceof Request ? input.method : (init?.method ?? "GET");
    paths.push(`${method} ${path}`);
    const requestBody = await bodyOf(input, init);
    if (requestBody !== undefined) bodies.push(requestBody);
    if (path.endsWith("/settings/mail-connection-test")) {
      const body = requestBody as { protocol: string };
      return options.check ? await options.check(body.protocol) : jsonResponse(checkResponse(true, "ok"));
    }
    if (path.endsWith("/default")) {
      headers.push(new Headers(input instanceof Request ? input.headers : init?.headers).get("if-match"));
      return jsonResponse({ contractVersion: "2.0.0", freshness, data: { revision: 4, defaultAccountId: "mail-1" } });
    }
    if (path.endsWith("/integrations/mail/accounts") && method === "GET") {
      return jsonResponse({ contractVersion: "2.0.0", freshness, data: { revision: 3, defaultAccountId: null, accounts: [] } });
    }
    if (path.endsWith("/integrations/mail/accounts") && method === "POST") {
      return jsonResponse({ contractVersion: "2.0.0", freshness, data: {
        id: "mail-1", displayName: "Geschäft", email: "erik@gmx.de", senderName: "Erik", aliases: [], signature: "",
        imapHost: "imap.gmx.net", imapPort: 993, imapSecurity: "tls", imapLogin: "erik@gmx.de", smtpHost: "mail.gmx.net",
        smtpPort: 587, smtpSecurity: "start-tls", smtpLogin: "erik@gmx.de", sentFolder: "Sent", draftsFolder: "Drafts",
        trashFolder: "Trash", archiveFolder: "Archive", spamFolder: "Spam", authMode: "password", oauthClientId: "",
        oauthTenant: "", revision: 1, secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false },
      } });
    }
    return jsonResponse({}, 404);
  } });
  return { ...view, paths, bodies, headers, created };
}

async function enterAddress(address: string) {
  fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), { target: { value: address } });
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
}

afterEach(() => setApiClient(null));

describe("mail account wizard", () => {
  it("walks address, sender, servers, login, checks, folders and summary before storing once", async () => {
    const onCreated = vi.fn();
    const { paths, bodies, headers } = harness({ created: onCreated });

    await enterAddress("erik@gmx.de");
    expect(await screen.findByText(/Erkannt: GMX/)).toBeTruthy();
    next();

    fireEvent.change(screen.getByLabelText("Kontoname"), { target: { value: "Geschäft" } });
    fireEvent.change(screen.getByLabelText("Absendername"), { target: { value: "Erik" } });
    fireEvent.change(screen.getByLabelText(/Alias-Adressen/), { target: { value: "erik@beispiel.example, info@gmx.de" } });
    next();

    expect((screen.getByLabelText("IMAP-Server") as HTMLInputElement).value).toBe("imap.gmx.net");
    fireEvent.change(screen.getByLabelText("IMAP-Server"), { target: { value: "imap.gmx.net" } });
    next();

    fireEvent.change(screen.getByLabelText("Passwort / App-Passwort"), { target: { value: "synthetisches-passwort" } });
    next();

    fireEvent.click(screen.getByRole("button", { name: "IMAP-Verbindung prüfen" }));
    expect(await screen.findByText(/IMAP: Verbindung und Anmeldung bestätigt/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "SMTP-Verbindung prüfen" }));
    expect(await screen.findByText(/SMTP: Verbindung und Anmeldung bestätigt/)).toBeTruthy();
    next();

    expect((screen.getByLabelText("Gesendet-Ordner") as HTMLInputElement).value).toBe("Sent");
    next();

    expect(screen.getByText(/Schritt 7 von 7: Zusammenfassung/)).toBeTruthy();
    expect(screen.getByText("erik@gmx.de")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Weiter" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Postfach übernehmen" }));
    expect(await screen.findByText(/Postfach angelegt/)).toBeTruthy();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    const posted = bodies.at(-1) as Record<string, unknown>;
    expect(posted).toMatchObject({ displayName: "Geschäft", email: "erik@gmx.de", senderName: "Erik",
      aliases: ["erik@beispiel.example", "info@gmx.de"], imapHost: "imap.gmx.net", imapPort: 993,
      smtpHost: "mail.gmx.net", smtpPort: 587, authMode: "password",
      secrets: { imapPassword: "synthetisches-passwort", smtpPassword: "synthetisches-passwort" } });
    expect(paths.filter((path) => path === "POST /api/v1/integrations/mail/accounts")).toHaveLength(1);
    expect(paths).toContain("GET /api/v1/integrations/mail/accounts");
    expect(paths).toContain("POST /api/v1/integrations/mail/accounts/mail-1/default");
    expect(headers).toEqual(["3"]);
    expect(paths.filter((path) => /send|sendmail/.test(path))).toHaveLength(0);
  });

  it("skips the default switch when the owner unchecks it", async () => {
    const { paths } = harness();
    await enterAddress("erik@gmx.de");
    next();
    fireEvent.change(screen.getByLabelText("Kontoname"), { target: { value: "Geschäft" } });
    fireEvent.change(screen.getByLabelText("Absendername"), { target: { value: "Erik" } });
    next();
    next();
    fireEvent.change(screen.getByLabelText("Passwort / App-Passwort"), { target: { value: "geheim" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "IMAP-Verbindung prüfen" }));
    await screen.findByText(/IMAP: Verbindung und Anmeldung bestätigt/);
    fireEvent.click(screen.getByRole("button", { name: "SMTP-Verbindung prüfen" }));
    await screen.findByText(/SMTP: Verbindung und Anmeldung bestätigt/);
    next();
    const toggle = screen.getByLabelText(/Dieses Konto als Standard/);
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    next();
    expect(screen.getByText("nein")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Postfach übernehmen" }));
    await screen.findByText(/Postfach angelegt/);
    expect(paths).not.toContain("GET /api/v1/integrations/mail/accounts");
    expect(paths).not.toContain("POST /api/v1/integrations/mail/accounts/default");
  });

  it("never guesses servers for an unknown domain and keeps the step closed", async () => {
    harness();
    await enterAddress("erik@beispiel.example");
    expect(await screen.findByText(/Kein Vorschlag für diese Domain/)).toBeTruthy();
    next();
    fireEvent.change(screen.getByLabelText("Kontoname"), { target: { value: "Privat" } });
    fireEvent.change(screen.getByLabelText("Absendername"), { target: { value: "Erik" } });
    next();
    expect((screen.getByLabelText("IMAP-Server") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("SMTP-Server") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/Host und Port müssen gültig sein/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
  });

  it("rejects an incomplete address and an empty sender before continuing", async () => {
    harness();
    await enterAddress("erik@");
    expect(await screen.findByText(/vollständige E-Mail-Adresse/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
    await enterAddress("erik@beispiel.example");
    next();
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
  });

  it("keeps the test step closed after a rejected login and offers no silent skip", async () => {
    harness({ check: () => jsonResponse(checkResponse(false, "auth")) });
    await enterAddress("erik@gmx.de");
    next();
    fireEvent.change(screen.getByLabelText("Kontoname"), { target: { value: "Geschäft" } });
    fireEvent.change(screen.getByLabelText("Absendername"), { target: { value: "Erik" } });
    next();
    next();
    fireEvent.change(screen.getByLabelText("Passwort / App-Passwort"), { target: { value: "falsch" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "IMAP-Verbindung prüfen" }));
    expect(await screen.findByText(/IMAP: Anmeldung abgelehnt/)).toBeTruthy();
    expect(screen.queryByLabelText(/Ohne Prüfung fortfahren/)).toBeNull();
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
  });

  it("states an unavailable environment and requires an explicit override", async () => {
    harness({ check: () => jsonResponse({ error: { code: "ADAPTER_UNAVAILABLE", message: "Bridge fehlt" }, severity: "error",
      retryable: false, correlationId: "corr_00000000000000000000000000", contractVersion: "2.0.0" }, 503) });
    await enterAddress("erik@gmx.de");
    next();
    fireEvent.change(screen.getByLabelText("Kontoname"), { target: { value: "Geschäft" } });
    fireEvent.change(screen.getByLabelText("Absendername"), { target: { value: "Erik" } });
    next();
    next();
    fireEvent.change(screen.getByLabelText("Passwort / App-Passwort"), { target: { value: "geheim" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "IMAP-Verbindung prüfen" }));
    expect(await screen.findByText(/nur in der installierten F\.R\.I\.D\.A\.Y\.-Umgebung verfügbar/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "SMTP-Verbindung prüfen" }));
    await waitFor(() => expect(screen.getAllByText(/nur in der installierten/)).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Ohne Prüfung fortfahren/));
    expect(screen.getByRole("button", { name: "Weiter" })).not.toBeDisabled();
  });
});