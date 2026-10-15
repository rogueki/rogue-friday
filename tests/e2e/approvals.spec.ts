import { test, expect, open, freezeDate } from "./support/fixtures";
import type { Page, Request } from "@playwright/test";

/** PLAN §51.5 Approval flow, §32.5: single-use X-Approval-Token, tier 3 needs a fresh re-authentication. */
const TIER2 = "Lieferantengespräch von Donnerstag auf Freitag verschieben";
const TIER3 = "Rechnung 2026-1142 der Nordlicht IT-Systeme GmbH bezahlen";

async function openApproval(page: Page, action: string): Promise<void> {
  // Expiry is shown relative to the browser clock; the seed data lives on 14.10.2026, so pin "now" into that day.
  await freezeDate(page);
  await open(page, "/approvals");
  await page.getByRole("article", { name: `Freigabe: ${action}` }).getByRole("button", { name: "Prüfen" }).click();
  await expect(page.getByRole("dialog", { name: "Freigabe" })).toBeVisible();
}

const decision = (request: Request): boolean => /\/approvals\/appr_[^/]+\/approve$/.test(request.url()) && request.method() === "POST";

test("tier 2: review in the drawer, approve with the single-use X-Approval-Token", async ({ page, api }) => {
  await openApproval(page, TIER2);
  const drawer = page.getByRole("dialog", { name: "Freigabe" });
  await expect(drawer.getByText("Stufe 2 · erhöht")).toBeVisible();
  await expect(drawer.getByRole("region", { name: "Vorschau" })).toContainText("Fr 23.10.2026, 09:30–10:30");

  await drawer.getByRole("button", { name: "Genehmigen", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Freigabe erteilen" });
  await expect(confirm.getByText(TIER2)).toBeVisible();
  await expect(confirm.getByLabel("Passwort zur erneuten Anmeldung")).toHaveCount(0); // tier 2: no re-auth
  const sent = page.waitForRequest(decision);
  await confirm.getByRole("button", { name: "Freigabe erteilen" }).click();
  const request = await sent;
  const headers = await request.allHeaders();
  expect(headers["x-approval-token"], "approval token travels as request header").toBeTruthy();
  expect(headers["if-match"]).toBe("1");
  expect(headers["idempotency-key"]).toBeTruthy();

  await expect(page.getByText("Freigabe erteilt").first()).toBeVisible();
  const id = new URL(request.url()).pathname.split("/").at(-2)!;
  const approval = (await api.get(`/approvals/${id}`)).body.data;
  expect(["approved", "executed"]).toContain(approval.status);
  expect(approval.action).toBe(TIER2);
});

test("the approve endpoint refuses a missing or reused approval token", async ({ api }) => {
  const list = (await api.get("/approvals?status=pending&riskTier=2&limit=50")).body.items as Array<{ id: string; version: number }>;
  const target = list[0]!;
  const noToken = await api.post(`/approvals/${target.id}/approve`, {}, { "If-Match": String(target.version) });
  expect(noToken.status, "no X-Approval-Token").toBeGreaterThanOrEqual(400);
  expect(noToken.status).toBeLessThan(500);

  const fetched = await api.get(`/approvals/${target.id}`);
  const token = fetched.headers.get("x-approval-token");
  expect(token).toBeTruthy();
  const ok = await api.post(`/approvals/${target.id}/approve`, {}, { "If-Match": String(target.version), "X-Approval-Token": token! });
  expect(ok.status).toBe(200);
  const replay = await api.post(`/approvals/${target.id}/approve`, {}, { "If-Match": String(target.version), "X-Approval-Token": token! });
  expect(replay.status, "token is single-use / approval already decided").toBeGreaterThanOrEqual(400);
});

test("tier 3: the confirm button stays disabled without a password, then approving sends a re-auth token", async ({ page, api }) => {
  await openApproval(page, TIER3);
  const drawer = page.getByRole("dialog", { name: "Freigabe" });
  await expect(drawer.getByText("Stufe 3 · kritisch")).toBeVisible();
  await drawer.getByRole("button", { name: "Genehmigen", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Freigabe erteilen" });
  const password = confirm.getByLabel("Passwort zur erneuten Anmeldung");
  await expect(password).toBeVisible();
  const submit = confirm.getByRole("button", { name: "Freigabe erteilen" });
  await expect(submit).toBeDisabled();
  const pending = (await api.get("/approvals?status=pending&riskTier=3&limit=50")).body.items as Array<{ action: string }>;
  expect(pending.map((item) => item.action), "still pending without a password").toContain(TIER3);

  // Dev auth (this stack) accepts any non-empty password by design (auth-service.ts); wrong-password refusal is covered
  // by the control-api auth tests against the scrypt hash, which a mock/dev stack cannot exercise.
  await password.fill("dev");
  await expect(submit).toBeEnabled();
  const sent = page.waitForRequest(decision);
  await submit.click();
  const body = (await sent).postDataJSON() as { reauthToken?: string };
  expect(body.reauthToken, "re-auth token in the approve body").toBeTruthy();
  await expect(page.getByText("Freigabe erteilt").first()).toBeVisible();
  const after = (await api.get("/approvals?status=pending&riskTier=3&limit=50")).body.items as Array<{ action: string }>;
  expect(after.map((item) => item.action)).not.toContain(TIER3);
});

test("tier 3 approve without a re-auth token is refused by the API", async ({ api }) => {
  const [target] = (await api.get("/approvals?status=pending&riskTier=3&limit=50")).body.items as Array<{ id: string; version: number }>;
  const token = (await api.get(`/approvals/${target!.id}`)).headers.get("x-approval-token")!;
  const refused = await api.post(`/approvals/${target!.id}/approve`, {}, { "If-Match": String(target!.version), "X-Approval-Token": token });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(refused.status).toBeLessThan(500);
});

test("rejecting an approval with a reason executes nothing", async ({ page, api }) => {
  await openApproval(page, TIER2);
  await page.getByRole("dialog", { name: "Freigabe" }).getByRole("button", { name: "Ablehnen" }).click();
  const dialog = page.getByRole("dialog", { name: "Freigabe ablehnen" });
  await dialog.getByLabel("Begründung (optional)").fill("Termin passt nicht");
  await dialog.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await expect(page.getByText("Freigabe abgelehnt").first()).toBeVisible();
  const rejected = (await api.get("/approvals?status=rejected&limit=20")).body.items as Array<{ action: string; decisionComment: string }>;
  expect(rejected.find((item) => item.action === TIER2)?.decisionComment).toBe("Termin passt nicht");
});
