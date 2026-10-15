import { test, expect, open } from "./support/fixtures";

/** PLAN §51.5 Task flow: create -> move -> cancel with confirmation. Every UI step is verified against the API. */
const TITLE = "E2E Quartalsablage prüfen";

test("create a task, move it to another status and cancel it after a confirmation", async ({ page, api }) => {
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
  const card = page.getByRole("article", { name: new RegExp(`^${TITLE}`) });
  await expect(card).toHaveAttribute("aria-label", `${TITLE}, Todo, P1`);

  const created = (await api.get(`/tasks?q=${encodeURIComponent(TITLE)}`)).body.items.find((task: { title: string }) => task.title === TITLE);
  expect(created, "task exists on the server").toMatchObject({ status: "todo", priority: "P1" });

  // move: Todo -> Bereit
  await card.getByRole("combobox", { name: new RegExp(`^Status ändern: ${TITLE}`) }).selectOption({ label: "Bereit" });
  await expect(page.getByRole("article", { name: new RegExp(`^${TITLE}`) })).toHaveAttribute("aria-label", `${TITLE}, Bereit, P1`);
  await expect.poll(async () => (await api.get(`/tasks/${created.id}`)).body.data.status).toBe("ready");

  // cancel: the drawer asks first; "Abbrechen" in the confirmation dialog backs out without effect
  await page.getByRole("button", { name: TITLE, exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Aufgabe" });
  await expect(drawer.getByRole("heading", { name: TITLE })).toBeVisible();
  await drawer.getByRole("button", { name: "Abbrechen", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Aufgabe abbrechen?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Weiterlaufen lassen" }).click();
  await expect(confirm).toBeHidden();
  expect((await api.get(`/tasks/${created.id}`)).body.data.status).toBe("ready");

  await drawer.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Aufgabe abbrechen?" }).getByRole("button", { name: "Aufgabe abbrechen" }).click();
  await expect.poll(async () => (await api.get(`/tasks/${created.id}`)).body.data.status).toBe("cancelled");
  await expect(drawer.getByText("Abgebrochen").first()).toBeVisible();
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
