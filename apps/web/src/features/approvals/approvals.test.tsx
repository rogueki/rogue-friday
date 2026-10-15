import { FridayApiError, type ErrorCode } from "@friday/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataOf, listOf, makeApproval, routerFetch, type RouterFetch } from "@/features/tasks/testkit";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { ApprovalsPage } from "./ApprovalsPage";
import { classifyDecisionError, isDecidable, isExpired, needsConfirmation, needsReauth } from "./model";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/approvals",
  useSearchParams: () => nav.params,
}));

const FULL = capabilitiesOf({
  approvals: { read: true, decide: true, requestContext: true, editBeforeApprove: true },
  agents: { read: true },
  tasks: { read: true },
});
const READ_ONLY = capabilitiesOf({ approvals: { read: true, decide: false, requestContext: false, editBeforeApprove: false } });

const error = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => ({
  status,
  body: { error: { code, message, severity: "error", retryable: false, correlationId: "corr_00000000000000000000000077", details } },
});
const IN_ONE_MINUTE = (): string => new Date(Date.now() + 60_000).toISOString();

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.push.mockClear();
  nav.replace.mockClear();
});
afterEach(() => setApiClient(null));

describe("approval model", () => {
  it("derives expiry, confirmation and re-authentication from tier and required auth", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(isExpired({ status: "pending", expiresAt: "2026-10-14T11:00:00Z" }, now)).toBe(true);
    expect(isDecidable({ status: "pending", expiresAt: "2026-10-14T11:00:00Z" }, now)).toBe(false);
    expect(isDecidable({ status: "pending", expiresAt: "2026-10-14T13:00:00Z" }, now)).toBe(true);
    expect(isDecidable({ status: "pending", expiresAt: null }, now)).toBe(true);
    expect(isDecidable({ status: "approved", expiresAt: null }, now)).toBe(false);
    expect(needsReauth({ riskTier: 3, requiredAuth: "none" })).toBe(true);
    expect(needsReauth({ riskTier: 1, requiredAuth: "reauth" })).toBe(true);
    expect(needsReauth({ riskTier: 2, requiredAuth: "confirm" })).toBe(false);
    expect(needsConfirmation({ riskTier: 1, requiredAuth: "none" })).toBe(false);
    expect(needsConfirmation({ riskTier: 2, requiredAuth: "confirm" })).toBe(true);
  });

  it("classifies the errors of the approve flow", () => {
    const api = (code: ErrorCode, details = {}) => new FridayApiError({ code, message: "m", severity: "error", retryable: false, correlationId: "corr_x", details }, 403);
    expect(classifyDecisionError(api("APPROVAL_REQUIRED", { reason: "expired" }), "approve").kind).toBe("token-expired");
    expect(classifyDecisionError(api("APPROVAL_REQUIRED", { reason: "missing_approval_token" }), "approve").kind).toBe("token-missing");
    expect(classifyDecisionError(api("APPROVAL_REQUIRED", { reason: "invalid" }), "approve").kind).toBe("token-invalid");
    expect(classifyDecisionError(api("REAUTH_REQUIRED"), "approve").kind).toBe("reauth-required");
    expect(classifyDecisionError(api("UNAUTHENTICATED"), "reauth").kind).toBe("wrong-password");
    expect(classifyDecisionError(api("CONFLICT"), "approve").kind).toBe("conflict");
    expect(classifyDecisionError(api("FORBIDDEN"), "approve").kind).toBe("forbidden");
    expect(classifyDecisionError(new Error("netz"), "approve")).toEqual({ kind: "other", message: "netz" });
  });
});

describe("ApprovalsPage: list and states", () => {
  const pending = makeApproval({ action: "E-Mail an Frau Becker senden", riskTier: 2, requiredAuth: "confirm" });
  const critical = makeApproval({ action: "Rechnung bezahlen", type: "payment", riskTier: 3, requiredAuth: "reauth", impacts: [{ kind: "money", description: "4.287,60 EUR werden überwiesen.", severity: "critical" }] });

  it("shows loading, then cards with the fields of PLAN §32.2", async () => {
    const api = routerFetch({ "GET /approvals": listOf([pending, critical]), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    expect(screen.getAllByLabelText("Wird geladen …").length).toBeGreaterThan(0);
    const list = await screen.findByRole("list", { name: "Freigaben" });
    const cards = Array.from(list.children) as HTMLElement[]; // direct cells only: the impact lists inside are lists too
    expect(cards).toHaveLength(2);
    const second = within(cards[1]!);
    expect(second.getByText("Rechnung bezahlen")).toBeInTheDocument();
    expect(second.getByText("Stufe 3 · kritisch")).toBeInTheDocument();
    expect(second.getByText("Zahlung")).toBeInTheDocument();
    expect(second.getByText("Erneute Anmeldung nötig")).toBeInTheDocument();
    expect(second.getByText("4.287,60 EUR werden überwiesen.")).toBeInTheDocument();
    expect(second.getByText("Offen")).toBeInTheDocument();
    expect(api.callsTo("GET /approvals")[0]?.query.get("status")).toBe("pending");
  });

  it("requests other statuses and tiers from the API when the filters change", async () => {
    const api = routerFetch({ "GET /approvals": listOf([pending]), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    const user = userEvent.setup();
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    await screen.findByText("E-Mail an Frau Becker senden");
    await user.selectOptions(screen.getByRole("combobox", { name: "Risikostufe" }), "3");
    await waitFor(() => expect(api.callsTo("GET /approvals").some((call) => call.query.get("riskTier") === "3")).toBe(true));
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "rejected");
    await waitFor(() => expect(api.callsTo("GET /approvals").some((call) => call.query.get("status") === "rejected")).toBe(true));
  });

  it("shows empty, offline and error states", async () => {
    const empty = routerFetch({ "GET /approvals": listOf([]), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    const first = renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: empty.fetch });
    expect(await screen.findByText("Keine offenen Freigaben")).toBeInTheDocument();
    first.unmount();

    const down = routerFetch({ "GET /approvals": () => error(503, "ADAPTER_UNAVAILABLE", "Adapter nicht erreichbar."), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    const second = renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: down.fetch });
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/Adapter nicht erreichbar\./)).toBeInTheDocument();
    second.unmount();

    const broken = routerFetch({ "GET /approvals": () => error(500, "INTERNAL", "Interner Fehler"), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: broken.fetch });
    expect(await screen.findByText("Daten konnten nicht geladen werden")).toBeInTheDocument();
    expect(screen.getByText("corr_00000000000000000000000077")).toBeInTheDocument();
  });

  it("is read-only without the decide capability and says so", async () => {
    const api = routerFetch({ "GET /approvals": listOf([pending]), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    renderWithProviders(<ApprovalsPage />, { capabilities: READ_ONLY, fetchImpl: api.fetch });
    await screen.findByText("E-Mail an Frau Becker senden");
    expect(screen.getByText("Lesen verfügbar · Schreiben nicht verfügbar")).toBeInTheDocument();
  });
});

describe("ApprovalDrawer: capability gating", () => {
  const approval = makeApproval({ riskTier: 2, requiredAuth: "confirm" });
  const routes = (): RouterFetch =>
    routerFetch({
      "GET /approvals": listOf([approval]),
      "GET /approvals/:id": () => ({ body: dataOf(approval), headers: { "X-Approval-Token": "tok_1", "X-Approval-Token-Expires": IN_ONE_MINUTE() } }),
      "GET /agents": listOf([]),
      "GET /tasks": listOf([]),
    });

  it("disables decisions without the capability and gives the reason", async () => {
    nav.params = new URLSearchParams(`approval=${approval.id}`);
    renderWithProviders(<ApprovalsPage />, { capabilities: READ_ONLY, fetchImpl: routes().fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    for (const name of [/Genehmigen/, /Ablehnen/, /Bearbeiten und genehmigen/, /Mehr Kontext anfordern/]) {
      const button = await within(drawer).findByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", expect.stringContaining("Nur Lesezugriff"));
    }
  });

  it("shows decided approvals without actions and with the decision", async () => {
    const decided = makeApproval({ status: "approved", decidedAt: "2026-10-14T08:20:00Z", decidedBy: { type: "user", id: "usr_1", name: "Erik" }, decisionComment: "Passt." });
    nav.params = new URLSearchParams(`approval=${decided.id}`);
    const api = routerFetch({ "GET /approvals": listOf([decided]), "GET /approvals/:id": dataOf(decided), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    expect(await within(drawer).findByText("Passt.")).toBeInTheDocument();
    const approve = within(drawer).getByRole("button", { name: /Genehmigen/ });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", "Die Freigabe ist bereits entschieden.");
    // no token is requested for a decided approval beyond the plain detail GET
    expect(api.callsTo("GET /approvals/:id").length).toBeLessThanOrEqual(1);
  });

  it("does not offer a decision once the expiry has passed", async () => {
    const expired = makeApproval({ expiresAt: "2020-01-01T00:00:00Z" });
    nav.params = new URLSearchParams(`approval=${expired.id}`);
    const api = routerFetch({ "GET /approvals": listOf([expired]), "GET /approvals/:id": dataOf(expired), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    const approve = await within(drawer).findByRole("button", { name: /Genehmigen/ });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", "Die Freigabe ist abgelaufen.");
  });
});

describe("approve flow (PLAN §32.5)", () => {
  async function openAndApprove(approval: ReturnType<typeof makeApproval>, routes: Parameters<typeof routerFetch>[0]) {
    nav.params = new URLSearchParams(`approval=${approval.id}`);
    const api = routerFetch({ "GET /approvals": listOf([approval]), "GET /agents": listOf([]), "GET /tasks": listOf([]), ...routes });
    const user = userEvent.setup();
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    // the token request (second GET of the approval) has to be through before a decision makes sense
    await waitFor(() => expect(api.callsTo("GET /approvals/:id").length).toBeGreaterThanOrEqual(2));
    await user.click(await within(drawer).findByRole("button", { name: /Genehmigen/ }));
    const dialog = await screen.findByRole("dialog", { name: "Freigabe erteilen" });
    return { api, user, dialog };
  }

  const tokenRoute = (approval: ReturnType<typeof makeApproval>, tokens: string[]) => {
    let index = 0;
    return () => ({ body: dataOf(approval), headers: { "X-Approval-Token": tokens[Math.min(index++, tokens.length - 1)] ?? "tok", "X-Approval-Token-Expires": IN_ONE_MINUTE() } });
  };

  it("asks for confirmation, then sends X-Approval-Token, If-Match and a fresh Idempotency-Key", async () => {
    const approval = makeApproval({ riskTier: 2, requiredAuth: "confirm" });
    const { api, user, dialog } = await openAndApprove(approval, {
      "GET /approvals/:id": tokenRoute(approval, ["tok_A"]),
      "POST /approvals/:id/approve": () => dataOf({ ...approval, status: "approved", version: 4 }),
    });
    expect(within(dialog).getByText(/Du bist dabei:/)).toBeInTheDocument();
    expect(within(dialog).getByText(approval.action, { exact: false })).toBeInTheDocument();
    expect(api.callsTo("POST /approvals/:id/approve")).toHaveLength(0); // nothing happens before the confirmation
    await user.type(within(dialog).getByLabelText("Kommentar (optional)"), "Freigegeben.");
    await user.click(within(dialog).getByRole("button", { name: "Freigabe erteilen" }));

    await waitFor(() => expect(api.callsTo("POST /approvals/:id/approve")).toHaveLength(1));
    const call = api.callsTo("POST /approvals/:id/approve")[0]!;
    expect(call.headers.get("x-approval-token")).toBe("tok_A");
    expect(call.headers.get("if-match")).toBe("3");
    expect(call.headers.get("idempotency-key")).toMatch(/^idem_/);
    expect(call.body).toEqual({ inputChannel: "dashboard", comment: "Freigegeben." });
    // tier 2 needs no re-authentication
    expect(api.callsTo("POST /auth/reauth")).toHaveLength(0);
    expect(await screen.findByText("Freigabe erteilt")).toBeInTheDocument();
  });

  it("is never optimistic: the card stays open until the server answered", async () => {
    const approval = makeApproval({ riskTier: 2, requiredAuth: "confirm" });
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => (release = resolve));
    const { api, user, dialog } = await openAndApprove(approval, {
      "GET /approvals/:id": tokenRoute(approval, ["tok_A"]),
      "POST /approvals/:id/approve": async () => {
        await gate;
        return dataOf({ ...approval, status: "approved", version: 4 });
      },
    });
    await user.click(within(dialog).getByRole("button", { name: "Freigabe erteilen" }));
    await waitFor(() => expect(api.callsTo("POST /approvals/:id/approve")).toHaveLength(1));
    // request in flight: nothing in the UI claims success yet, the dialog is still there and cannot be dismissed
    expect(screen.queryByText("Freigabe erteilt")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Freigabe erteilen" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Freigaben" });
    expect(within(list).getByText("Offen")).toBeInTheDocument();
    release(undefined);
    expect(await screen.findByText("Freigabe erteilt")).toBeInTheDocument();
  });

  it("tier 3 requires the password first (POST /auth/reauth), sends the reauth token and is never voice-only", async () => {
    const approval = makeApproval({ riskTier: 3, requiredAuth: "reauth", action: "Rechnung bezahlen", type: "payment" });
    const order: string[] = [];
    const { api, user, dialog } = await openAndApprove(approval, {
      "GET /approvals/:id": tokenRoute(approval, ["tok_T"]),
      "POST /auth/reauth": () => {
        order.push("reauth");
        return { contractVersion: "2.0.0", reauthToken: "reauth_1", expiresAt: IN_ONE_MINUTE() };
      },
      "POST /approvals/:id/approve": () => {
        order.push("approve");
        return dataOf({ ...approval, status: "approved", version: 4 });
      },
    });
    const confirm = within(dialog).getByRole("button", { name: "Freigabe erteilen" });
    expect(confirm).toBeDisabled(); // no password yet
    expect(within(dialog).getByText(/nie nur per Sprache/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Passwort zur erneuten Anmeldung/), "geheim");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(api.callsTo("POST /approvals/:id/approve")).toHaveLength(1));
    expect(order).toEqual(["reauth", "approve"]);
    expect(api.callsTo("POST /auth/reauth")[0]?.body).toEqual({ password: "geheim" });
    const approve = api.callsTo("POST /approvals/:id/approve")[0]!;
    expect(approve.headers.get("x-approval-token")).toBe("tok_T");
    expect(approve.body).toEqual({ inputChannel: "dashboard", reauthToken: "reauth_1" });
    expect((approve.body as { inputChannel: string }).inputChannel).not.toBe("voice");
  });

  it("answers a wrong password inline and does not call approve", async () => {
    const approval = makeApproval({ riskTier: 3, requiredAuth: "reauth" });
    const { api, user, dialog } = await openAndApprove(approval, {
      "GET /approvals/:id": tokenRoute(approval, ["tok_T"]),
      "POST /auth/reauth": () => error(401, "UNAUTHENTICATED", "Das Passwort ist nicht korrekt."),
    });
    await user.type(within(dialog).getByLabelText(/Passwort zur erneuten Anmeldung/), "falsch");
    await user.click(within(dialog).getByRole("button", { name: "Freigabe erteilen" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Das Passwort ist nicht korrekt.");
    expect(api.callsTo("POST /approvals/:id/approve")).toHaveLength(0);
  });

  it("explains an expired token, refetches the approval and uses a NEW token on the next try", async () => {
    const approval = makeApproval({ riskTier: 2, requiredAuth: "confirm" });
    let attempts = 0;
    const { api, user, dialog } = await openAndApprove(approval, {
      "GET /approvals/:id": tokenRoute(approval, ["tok_old", "tok_old", "tok_new", "tok_new", "tok_new"]),
      "POST /approvals/:id/approve": () => {
        attempts += 1;
        return attempts === 1 ? error(403, "APPROVAL_REQUIRED", "Token abgelaufen", { reason: "expired" }) : dataOf({ ...approval, status: "approved", version: 4 });
      },
    });
    const getsBefore = api.callsTo("GET /approvals/:id").length;
    await user.click(within(dialog).getByRole("button", { name: "Freigabe erteilen" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Das Freigabe-Token ist abgelaufen. Die Freigabe wurde neu geladen, bitte noch einmal bestätigen.");
    await waitFor(() => expect(api.callsTo("GET /approvals/:id").length).toBeGreaterThan(getsBefore));

    await user.click(within(dialog).getByRole("button", { name: "Freigabe erteilen" }));
    await waitFor(() => expect(api.callsTo("POST /approvals/:id/approve")).toHaveLength(2));
    const [first, second] = api.callsTo("POST /approvals/:id/approve");
    expect(first?.headers.get("x-approval-token")).toBe("tok_old");
    expect(second?.headers.get("x-approval-token")).not.toBe("tok_old");
    // the same decision keeps its idempotency key across a retry
    expect(second?.headers.get("idempotency-key")).toBe(first?.headers.get("idempotency-key"));
  });

  it("explains a consumed token and a conflict", async () => {
    const approval = makeApproval({ riskTier: 2, requiredAuth: "confirm" });
    const consumed = await openAndApprove(approval, {
      "GET /approvals/:id": tokenRoute(approval, ["tok_A", "tok_A", "tok_B"]),
      "POST /approvals/:id/approve": () => error(403, "APPROVAL_REQUIRED", "ungültig", { reason: "invalid" }),
    });
    await consumed.user.click(within(consumed.dialog).getByRole("button", { name: "Freigabe erteilen" }));
    expect(await within(consumed.dialog).findByRole("alert")).toHaveTextContent("ungültig oder wurde schon verwendet");
  });

  it("shows a conflict (decided elsewhere or expired) as such", async () => {
    const approval = makeApproval({ riskTier: 2, requiredAuth: "confirm" });
    const { user, dialog } = await openAndApprove(approval, {
      "GET /approvals/:id": tokenRoute(approval, ["tok_A"]),
      "POST /approvals/:id/approve": () => error(409, "CONFLICT", "Die Freigabe ist nicht mehr offen (approved)."),
    });
    await user.click(within(dialog).getByRole("button", { name: "Freigabe erteilen" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("zwischenzeitlich geändert, entschieden oder ist abgelaufen");
    expect(alert).toHaveTextContent("nicht mehr offen");
  });

  it("approves tier 1 without a confirmation dialog but with the same token flow", async () => {
    const approval = makeApproval({ riskTier: 1, requiredAuth: "none", action: "Notiz speichern" });
    nav.params = new URLSearchParams(`approval=${approval.id}`);
    const api = routerFetch({
      "GET /approvals": listOf([approval]),
      "GET /approvals/:id": tokenRoute(approval, ["tok_1"]),
      "GET /agents": listOf([]),
      "GET /tasks": listOf([]),
      "POST /approvals/:id/approve": () => dataOf({ ...approval, status: "approved", version: 4 }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    await waitFor(() => expect(api.callsTo("GET /approvals/:id").length).toBeGreaterThanOrEqual(2));
    await user.click(await within(drawer).findByRole("button", { name: /Genehmigen/ }));
    await waitFor(() => expect(api.callsTo("POST /approvals/:id/approve")).toHaveLength(1));
    expect(api.callsTo("POST /approvals/:id/approve")[0]?.headers.get("x-approval-token")).toBe("tok_1");
    expect(screen.queryByRole("dialog", { name: "Freigabe erteilen" })).toBeNull();
  });
});

describe("other decisions", () => {
  const approval = makeApproval({ riskTier: 2, requiredAuth: "confirm", editable: true });
  const base = (extra: Parameters<typeof routerFetch>[0] = {}) =>
    routerFetch({
      "GET /approvals": listOf([approval]),
      "GET /approvals/:id": () => ({ body: dataOf(approval), headers: { "X-Approval-Token": "tok_1", "X-Approval-Token-Expires": IN_ONE_MINUTE() } }),
      "GET /agents": listOf([]),
      "GET /tasks": listOf([]),
      ...extra,
    });

  it("rejects with an optional reason, without an approval token", async () => {
    nav.params = new URLSearchParams(`approval=${approval.id}`);
    const api = base({ "POST /approvals/:id/reject": () => dataOf({ ...approval, status: "rejected", version: 4 }) });
    const user = userEvent.setup();
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    await user.click(await within(drawer).findByRole("button", { name: /Ablehnen/ }));
    const dialog = await screen.findByRole("dialog", { name: "Freigabe ablehnen" });
    await user.type(within(dialog).getByLabelText("Begründung (optional)"), "Zu früh.");
    await user.click(within(dialog).getByRole("button", { name: "Ablehnen" }));
    await waitFor(() => expect(api.callsTo("POST /approvals/:id/reject")).toHaveLength(1));
    const call = api.callsTo("POST /approvals/:id/reject")[0]!;
    expect(call.body).toEqual({ inputChannel: "dashboard", comment: "Zu früh." });
    expect(call.headers.get("x-approval-token")).toBeNull();
    expect(call.headers.get("idempotency-key")).toMatch(/^idem_/);
  });

  it("requests more context with a question", async () => {
    nav.params = new URLSearchParams(`approval=${approval.id}`);
    const api = base({ "POST /approvals/:id/request-context": () => dataOf(approval) });
    const user = userEvent.setup();
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    await user.click(await within(drawer).findByRole("button", { name: /Mehr Kontext anfordern/ }));
    const dialog = await screen.findByRole("dialog", { name: "Mehr Kontext anfordern" });
    const send = within(dialog).getByRole("button", { name: "Rückfrage senden" });
    expect(send).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Was fehlt dir zur Entscheidung?"), "Wer ist der Empfänger?");
    await user.click(send);
    await waitFor(() => expect(api.callsTo("POST /approvals/:id/request-context")).toHaveLength(1));
    expect(api.callsTo("POST /approvals/:id/request-context")[0]?.body).toEqual({ question: "Wer ist der Empfänger?" });
  });

  it("edit then approve sends the edited preview and needs a real change", async () => {
    nav.params = new URLSearchParams(`approval=${approval.id}`);
    const api = base({ "POST /approvals/:id/approve": () => dataOf({ ...approval, status: "approved", version: 4 }) });
    const user = userEvent.setup();
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    await waitFor(() => expect(api.callsTo("GET /approvals/:id").length).toBeGreaterThanOrEqual(2));
    await user.click(await within(drawer).findByRole("button", { name: /Bearbeiten und genehmigen/ }));
    const dialog = await screen.findByRole("dialog", { name: "Bearbeiten und genehmigen" });
    const confirm = within(dialog).getByRole("button", { name: "Geänderte Fassung freigeben" });
    expect(confirm).toBeDisabled();
    const title = within(dialog).getByLabelText("Titel");
    await user.clear(title);
    await user.type(title, "Terminbestätigung 22.10.");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(api.callsTo("POST /approvals/:id/approve")).toHaveLength(1));
    const body = api.callsTo("POST /approvals/:id/approve")[0]!.body as { editedPreview: { title: string; body: string; kind: string } };
    expect(body.editedPreview.title).toBe("Terminbestätigung 22.10.");
    expect(body.editedPreview.kind).toBe("email");
    expect(body.editedPreview.body).toBe(approval.preview.body);
  });

  it("disables edit for approvals that are not editable", async () => {
    const fixed = makeApproval({ editable: false });
    nav.params = new URLSearchParams(`approval=${fixed.id}`);
    const api = routerFetch({ "GET /approvals": listOf([fixed]), "GET /approvals/:id": dataOf(fixed), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    const edit = await within(drawer).findByRole("button", { name: /Bearbeiten und genehmigen/ });
    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute("title", "Diese Freigabe kann nicht bearbeitet werden.");
  });

  it("opens the source of an approval", async () => {
    const withSource = makeApproval({ sourceRef: { type: "draft", id: "draft_1", label: "Entwurf" } });
    nav.params = new URLSearchParams(`approval=${withSource.id}`);
    const api = routerFetch({ "GET /approvals": listOf([withSource]), "GET /approvals/:id": dataOf(withSource), "GET /agents": listOf([]), "GET /tasks": listOf([]) });
    const user = userEvent.setup();
    renderWithProviders(<ApprovalsPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const drawer = await screen.findByRole("dialog", { name: "Freigabe" });
    await user.click(await within(drawer).findByRole("button", { name: "Quelle öffnen" }));
    expect(nav.push).toHaveBeenCalledWith("/communication?thread=draft_1");
  });
});
