import { test, expect, open } from "./support/fixtures";
import type { Locator, Page } from "@playwright/test";

/** PLAN §51.5 command bar, §43.4: write commands answer with a server preview and run only after an explicit confirmation. */
const bar = (page: Page): Locator => page.getByRole("textbox", { name: "Befehl eingeben" });
const preview = (page: Page): Locator => page.locator('[role="dialog"], [role="alertdialog"]').filter({ hasText: "Du bist dabei" });

test("a write command shows the server preview, cancelling executes nothing, confirming creates the approval", async ({ page, api }) => {
  await open(page, "/approvals");
  const pendingBefore = ((await api.get("/approvals?status=pending&limit=50")).body.items as unknown[]).length;
  const posts: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/commands")) posts.push(request.postDataJSON() as Record<string, unknown>);
  });

  await bar(page).fill("Sende eine E-Mail an Frau Becker");
  await bar(page).press("Enter");
  const dialog = preview(page);
  await expect(dialog).toContainText("Du bist dabei, eine E-Mail an Frau Becker zu senden.");
  expect(posts[0]).toMatchObject({ text: "Sende eine E-Mail an Frau Becker", source: "text" });
  expect(posts[0]!.confirm, "the first request is only a preview").toBeFalsy();

  await dialog.getByRole("button", { name: /Abbrechen|Schließen/ }).first().click();
  await expect(dialog).toBeHidden();
  expect(((await api.get("/approvals?status=pending&limit=50")).body.items as unknown[]).length, "nothing happened yet").toBe(pendingBefore);

  await bar(page).fill("Sende eine E-Mail an Frau Becker");
  await bar(page).press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Bestätigen" }).click();
  await expect(dialog).toBeHidden();
  const confirmed = posts.at(-1)!;
  expect(confirmed.confirm).toBe(true);
  expect(confirmed.previewId, "confirmed repeat carries the preview id").toBeTruthy();
  await expect.poll(async () => ((await api.get("/approvals?status=pending&limit=50")).body.items as unknown[]).length).toBe(pendingBefore + 1);
});

test("a read-only command runs directly (no preview) and offers to open the result view", async ({ page }) => {
  await open(page, "/");
  await bar(page).fill("Suche im Gedächtnis nach Lieferzeit");
  await bar(page).press("Enter");
  await expect(preview(page)).toHaveCount(0);
  const toast = page.getByRole("status").filter({ hasText: "Befehl ausgeführt" });
  await expect(toast).toContainText("Treffer im Gedächtnis");
  await toast.getByRole("button", { name: "Öffnen" }).click();
  await expect(page).toHaveURL(/\/memory\/?\?q=Lieferzeit/);
});

test("a payment-like command is classified tier 3 by the server and needs the explicit confirmation", async ({ page, api }) => {
  await open(page, "/");
  const before = ((await api.get("/approvals?status=pending&limit=50")).body.items as unknown[]).length;
  await bar(page).fill("Überweise 500 Euro an Nordlicht IT-Systeme");
  await bar(page).press("Enter");
  const dialog = preview(page);
  await expect(dialog).toContainText("Zahlung oder Bestellung");
  await expect(dialog).toContainText("Risikostufe 3");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  expect(((await api.get("/approvals?status=pending&limit=50")).body.items as unknown[]).length, "cancelled preview changes nothing").toBe(before);
});

test("a forbidden command is rejected with a clear message and changes nothing", async ({ page, api }) => {
  await open(page, "/");
  const tasksBefore = (await api.get("/tasks?limit=200")).body.items.length;
  await bar(page).fill("Lösche alles");
  await bar(page).press("Enter");
  await expect(page.getByText("Diese Aktion ist aus Sicherheitsgründen nicht erlaubt.").first()).toBeVisible();
  expect((await api.get("/tasks?limit=200")).body.items.length).toBe(tasksBefore);
});

test("the palette sends free text as a command (\"F.R.I.D.A.Y. fragen\") and a task preview needs confirmation", async ({ page, api }) => {
  await open(page, "/tasks");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Befehlspalette" });
  await palette.getByRole("combobox").fill("Lege eine neue Aufgabe an: Reisekosten Oktober prüfen");
  await page.keyboard.press("Enter");
  const dialog = preview(page);
  await expect(dialog).toContainText("Reisekosten Oktober prüfen");
  await dialog.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByText("Aufgabe wurde angelegt.").first()).toBeVisible();
  const created = (await api.get(`/tasks?q=${encodeURIComponent("Reisekosten Oktober prüfen")}`)).body.items as Array<{ title: string }>;
  expect(created.map((task) => task.title)).toContain("Reisekosten Oktober prüfen");
});

test("quick actions on the overview run their command (Executive Briefing)", async ({ page }) => {
  await open(page, "/");
  await page.getByRole("button", { name: "Executive Briefing" }).click();
  await expect(page.getByText(/Befehl ausgeführt|Ich kümmere mich darum/).first()).toBeVisible();
});
