import { test, expect, open, patchSettings } from "./support/fixtures";

/** PLAN §51.5 Task flow: create -> move -> cancel with confirmation. Every UI step is verified against the API. */
const TITLE = "E2E Quartalsablage prüfen";

test("create a task, move it to another status and cancel it after a confirmation", async ({ page, api }) => {
  const settings = (await api.get("/settings")).body.data;
  await patchSettings(api, { approvals: { ...settings.approvals, confirmTier2: false } });
  await open(page, "/tasks");

  // create
  await page.getByRole("button", { name: "Neue Aufgabe" }).click();
  const dialog = page.getByRole("dialog", { name: "Neue Aufgabe" });
  const create = dialog.getByRole("button", { name: "Aufgabe anlegen" });
  await expect(create).toBeDisabled(); // no title yet
  await dialog.getByRole("textbox", { name: "Titel der Aufgabe" }).fill(TITLE);
  await dialog.getByRole("combobox", { name: "Priorität" }).selectOption({ label: "P1 · Dringend" });
  await create.click();
  await expect(dialog).toBeHidden();
  const createPreview = page.getByRole("alertdialog", { name: "Du bist dabei:" });
  await expect(createPreview).toBeVisible();
  await createPreview.getByRole("button", { name: "Bestätigen" }).click();
  await expect(createPreview).toBeHidden();
  const card = page.getByRole("article", { name: new RegExp(`^${TITLE}`) });
  await expect(card).toHaveAttribute("aria-label", `${TITLE}, Todo, P1`);

  const created = (await api.get(`/tasks?q=${encodeURIComponent(TITLE)}`)).body.items.find((task: { title: string }) => task.title === TITLE);
  expect(created, "task exists on the server").toMatchObject({ status: "todo", priority: "P1" });

  // move: Todo -> Bereit is a staged write: the server preview is confirmed before anything changes
  await card.getByRole("combobox", { name: new RegExp(`^Status ändern: ${TITLE}`) }).selectOption({ label: "Bereit" });
  const movePreview = page.getByRole("alertdialog", { name: "Du bist dabei:" });
  await expect(movePreview).toBeVisible();
  await expect(movePreview).toContainText(TITLE);
  await movePreview.getByRole("button", { name: "Bestätigen" }).click();
  await expect(movePreview).toBeHidden();
  await expect(page.getByRole("article", { name: new RegExp(`^${TITLE}`) })).toHaveAttribute("aria-label", `${TITLE}, Bereit, P1`);
  await expect.poll(async () => (await api.get(`/tasks/${created.id}`)).body.data.status).toBe("ready");

  // cancel: the drawer button stages the write; dismissing the server preview leaves the task untouched
  await page.getByRole("button", { name: TITLE, exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Aufgabe" });
  await expect(drawer.getByRole("heading", { name: TITLE })).toBeVisible();
  await drawer.getByRole("button", { name: "Abbrechen", exact: true }).click();
  const cancelPreview = page.getByRole("alertdialog", { name: "Du bist dabei:" });
  await expect(cancelPreview).toBeVisible();
  await cancelPreview.getByRole("button", { name: "Abbrechen" }).click();
  await expect(cancelPreview).toBeHidden();
  expect((await api.get(`/tasks/${created.id}`)).body.data.status).toBe("ready");

  await drawer.getByRole("button", { name: "Abbrechen", exact: true }).click();
  const cancelConfirm = page.getByRole("alertdialog", { name: "Du bist dabei:" });
  await expect(cancelConfirm).toBeVisible();
  await cancelConfirm.getByRole("button", { name: "Bestätigen" }).click();
  await expect.poll(async () => (await api.get(`/tasks/${created.id}`)).body.data.status).toBe("cancelled");
  await expect(drawer.getByText("Abgebrochen").first()).toBeVisible();
});

test("task dialog submits a reviewed action to approvals before creating a task", async ({ page, api }) => {
  const title = "E2E Freigabe Archivplanung";
  await open(page, "/tasks");
  await page.getByRole("button", { name: "Neue Aufgabe" }).click();
  const dialog = page.getByRole("dialog", { name: "Neue Aufgabe" });
  await dialog.getByRole("textbox", { name: "Titel der Aufgabe" }).fill(title);
  await dialog.getByRole("button", { name: "Aufgabe anlegen" }).click();
  const preview = page.getByRole("alertdialog", { name: "Du bist dabei:" });
  await expect(preview).toContainText(title);
  await preview.getByRole("button", { name: "Bestätigen" }).click();
  await expect(preview).toBeHidden();
  const pending = await api.get("/approvals?status=pending&limit=100");
  const approval = pending.body.items.find((item: { action: string }) => item.action.includes(title));
  expect(approval, "the dialog action is present in the real approvals API").toBeDefined();
  expect((await api.get(`/tasks?q=${encodeURIComponent(title)}`)).body.items).toHaveLength(0);
  await open(page, `/approvals?approval=${encodeURIComponent(approval.id)}`);
  const drawer = page.getByRole("dialog", { name: "Freigabe" });
  await expect(drawer).toContainText(title);
  await drawer.getByRole("button", { name: "Genehmigen", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Freigabe erteilen" });
  await confirm.getByRole("button", { name: "Freigabe erteilen" }).click();
  await expect.poll(async () => (await api.get(`/tasks?q=${encodeURIComponent(title)}`)).body.items.length).toBe(1);
  expect((await api.get(`/approvals/${approval.id}`)).body.data.status).toBe("executed");
});

test("dismissed task preview does not create an approval or task", async ({ page, api }) => {
  const title = "E2E Abgebrochener Entwurf";
  await open(page, "/tasks");
  await page.getByRole("button", { name: "Neue Aufgabe" }).click();
  const dialog = page.getByRole("dialog", { name: "Neue Aufgabe" });
  await dialog.getByRole("textbox", { name: "Titel der Aufgabe" }).fill(title);
  await dialog.getByRole("button", { name: "Aufgabe anlegen" }).click();
  const preview = page.getByRole("alertdialog", { name: "Du bist dabei:" });
  await expect(preview).toContainText(title);
  await preview.getByRole("button", { name: "Abbrechen" }).click();
  await expect(preview).toBeHidden();
  await expect.poll(async () => (await api.get("/approvals?status=pending&limit=100")).body.items
    .filter((item: { action: string }) => item.action.includes(title)).length).toBe(0);
  expect((await api.get(`/tasks?q=${encodeURIComponent(title)}`)).body.items).toHaveLength(0);
});

test("the task list filters by status and shows exactly the server's matches", async ({ page, api }) => {
  await open(page, "/tasks");
  const total = (await api.get("/tasks?limit=200")).body.items.length;
  await expect(page.getByText(`${total} Treffer`)).toBeVisible();
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption({ label: "Läuft" });
  const running = (await api.get("/tasks?status=running&limit=200")).body.items.length;
  expect(running).toBeGreaterThan(0);
  await expect(page.getByText(`${running} Treffer`)).toBeVisible();
});
