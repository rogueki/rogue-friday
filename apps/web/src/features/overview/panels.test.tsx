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
    expect(screen.getByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.getByText("Zeitüberschreitung")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adapter konfigurieren" })).toBeInTheDocument();
    expect(screen.queryByText("Coding-Agent")).toBeNull();
    // The attention feed has its own source and still renders (rows are virtualized, jsdom has no layout: check the count).
    expect(screen.getByRole("list", { name: "Aufmerksamkeit und Live-Aktivität" })).toHaveAttribute("aria-rowcount", "1");
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
