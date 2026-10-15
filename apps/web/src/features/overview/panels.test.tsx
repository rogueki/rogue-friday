import type { AdapterInfo } from "@friday/sdk";
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAgent, makeOverview, overviewResponse } from "@/test/fixtures";
import { capabilitiesOf, jsonResponse, renderWithProviders } from "@/test/render";
import { setApiClient } from "@/lib/api/client";
import { AttentionPanel, CoreOverviewPanel } from "./CorePanels";
import { ActiveAgentsPanel, QuickCommandsPanel } from "./WidgetPanels";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

afterEach(() => setApiClient(null));

describe("quick commands: capability gating", () => {
  it("enables commands whose capability is granted and disables read-only ones with a reason", () => {
    renderWithProviders(<QuickCommandsPanel />, {
      overview: overviewResponse(makeOverview()),
      capabilities: capabilitiesOf({ tasks: { read: true, create: true }, mail: { read: true, send: false } }),
    });
    const enabled = screen.getByRole("button", { name: /Neue Aufgabe/ });
    expect(enabled).not.toHaveAttribute("aria-disabled");
    const mailRow = screen.getByText("E-Mail prüfen").closest(".jv-row");
    expect(mailRow).toHaveAttribute("aria-disabled", "true");
    expect(mailRow).not.toHaveAttribute("role", "button");
    expect(within(mailRow as HTMLElement).getByText("Nur lesend verfügbar")).toBeInTheDocument();
  });

  it("disables a command the server flagged as disabled and shows the server reason", () => {
    const overview = makeOverview();
    overview.quickCommands = [
      { id: "qc_off", label: "Automationen pausieren", icon: "pause", commandText: "x", targetRoute: null, enabled: false, disabledReason: "Keine Automationen konfiguriert.", requiredCapability: "automations.pauseAll", requiresConfirmation: false },
    ];
    renderWithProviders(<QuickCommandsPanel />, {
      overview: overviewResponse(overview),
      capabilities: capabilitiesOf({ automations: { read: true, pauseAll: true } }),
    });
    expect(screen.getByText("Keine Automationen konfiguriert.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Automationen pausieren/ })).toBeNull();
  });

  it("disables commands whose capability module is missing completely", () => {
    renderWithProviders(<QuickCommandsPanel />, {
      overview: overviewResponse(makeOverview()),
      capabilities: capabilitiesOf({ mail: { read: true, send: true } }),
    });
    expect(screen.getByText("Neue Aufgabe").closest(".jv-row")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("E-Mail prüfen").closest(".jv-row")).not.toHaveAttribute("aria-disabled");
  });
});

describe("overview panels: states", () => {
  it("keeps the other panels rendering when one adapter is offline", () => {
    const overview = makeOverview({
      degradedSections: [{ section: "agents", adapterId: "mock-hermes", status: "offline", reason: "Zeitüberschreitung" }],
    });
    renderWithProviders(
      <>
        <ActiveAgentsPanel />
        <AttentionPanel />
      </>,
      { overview: overviewResponse(overview) },
    );
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/mock-hermes nicht erreichbar/)).toBeInTheDocument();
    expect(screen.getByText(/Letzte Meldung: Zeitüberschreitung/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Erneut versuchen/ })).toBeInTheDocument();
    expect(screen.queryByText("Coding-Agent")).toBeNull();
    // The attention feed has its own source and still renders. Rows are virtualized and jsdom has no layout, so no row is
    // mounted; the feed only renders its list (instead of the empty state) when it has items.
    expect(screen.getByRole("list", { name: "Aufmerksamkeit und Live-Aktivität" })).toBeInTheDocument();
  });

  it("shows a degraded notice above the content for a slow adapter", () => {
    const overview = makeOverview({ degradedSections: [{ section: "agents", adapterId: "mock-hermes", status: "degraded", reason: "Antwortzeit über Schwellwert" }] });
    renderWithProviders(<ActiveAgentsPanel />, { overview: overviewResponse(overview) });
    expect(screen.getByText("Eingeschränkter Betrieb")).toBeInTheDocument();
    expect(screen.getByText("Coding-Agent")).toBeInTheDocument();
  });

  it("shows loading placeholders while the overview is pending", () => {
    renderWithProviders(<ActiveAgentsPanel />);
    expect(screen.getAllByRole("status", { name: "Wird geladen …" }).length).toBeGreaterThan(0);
  });

  it("shows an error with retry and correlation id when the overview request fails", async () => {
    const failing = vi.fn(async () =>
      jsonResponse({ error: { code: "INTERNAL", message: "Kaputt", severity: "error", retryable: false, correlationId: "corr_01JZZZZZZZZZZZZZZZZZZZZZZZ", details: {} } }, 500),
    );
    renderWithProviders(<ActiveAgentsPanel />, { fetchImpl: failing as unknown as typeof fetch });
    expect(await screen.findByText("Daten konnten nicht geladen werden")).toBeInTheDocument();
    expect(screen.getByText("corr_01JZZZZZZZZZZZZZZZZZZZZZZZ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Erneut versuchen/ })).toBeInTheDocument();
  });

  it("shows an empty state when there are no agents", () => {
    renderWithProviders(<ActiveAgentsPanel />, { overview: overviewResponse(makeOverview({ activeAgents: [] })) });
    expect(screen.getByText("Keine aktiven Agenten")).toBeInTheDocument();
  });

  it("marks stale data", () => {
    const stale = { ...overviewResponse(makeOverview({ activeAgents: [makeAgent()] })), freshness: { state: "stale", asOf: "2026-10-14T07:00:00Z" } } as const;
    renderWithProviders(<ActiveAgentsPanel />, { overview: stale as never });
    expect(screen.getByText("Diese Daten sind möglicherweise nicht mehr aktuell.")).toBeInTheDocument();
    expect(screen.getByText("Coding-Agent")).toBeInTheDocument();
  });

  it("renders the core overview rows with live values", () => {
    renderWithProviders(<CoreOverviewPanel />, { overview: overviewResponse(makeOverview()) });
    expect(screen.getByText("10 gespeichert")).toBeInTheDocument();
    expect(screen.getByText("1 aktiv")).toBeInTheDocument();
  });
});

describe("core overview: voice outage versus not configured", () => {
  const voiceAdapter = (status: "online" | "degraded" | "offline"): AdapterInfo => ({
    manifest: { id: "friday-voice-http", name: "Friday Voice", adapterVersion: "1.0.0", contractVersion: "2.0.0", apiVersion: "v1", category: "voice", capabilities: ["voice.read"], configSchemaRef: "x", secretFields: [] },
    health: { adapterId: "friday-voice-http", status, lifecycle: status === "offline" ? "OFFLINE" : "DEGRADED", latencyMs: null, lastSuccessAt: null, lastError: { code: "ADAPTER_UNAVAILABLE", message: "Voice-Dienst nicht erreichbar" }, checkedAt: "2026-10-14T08:15:00Z", consecutiveFailures: 1, circuit: "open" },
    enabled: true,
    provider: "friday-voice-http",
    mode: "live",
  });
  const voiceEntry = (status: "degraded" | "offline", adapterId = "friday-voice-http") => ({ section: "Sprache", adapterId, status, reason: "Der Adapter ist vorübergehend gesperrt (Circuit Breaker offen)." });
  const voiceRow = (): HTMLElement => screen.getByText("Sprache").closest(".jv-row") as HTMLElement;

  it.each(["degraded", "offline"] as const)("shows Offline when the registered voice adapter fails and its section is %s (health monitor lags behind)", (status) => {
    const overview = makeOverview({ voice: null, degradedSections: [voiceEntry(status)] });
    renderWithProviders(<CoreOverviewPanel />, { overview: overviewResponse(overview), adapters: [voiceAdapter("degraded")] });
    expect(within(voiceRow()).getByText("Offline")).toBeInTheDocument();
    expect(within(voiceRow()).queryByText("Nicht verbunden")).toBeNull();
  });

  it("shows Nicht verbunden only when no adapter is configured", () => {
    const overview = makeOverview({ voice: null, degradedSections: [voiceEntry("offline", "unconfigured-voice")] });
    renderWithProviders(<CoreOverviewPanel />, { overview: overviewResponse(overview), adapters: [] });
    expect(within(voiceRow()).getByText("Nicht verbunden")).toBeInTheDocument();
  });
});
