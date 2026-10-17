import { test, expect, open, orbRoot, expectOrbMode, ORB_MODES, type OrbModeName } from "./support/fixtures";

/** PLAN §51.5 Orb state changes: the orb's mode, its visible state label and its aria-live sentence follow the server. */
const LABEL: Record<OrbModeName, { state: string; aria: string }> = {
  booting: { state: "F.R.I.D.A.Y. WIRD INITIALISIERT", aria: "F.R.I.D.A.Y. wird initialisiert." },
  idle: { state: "BEREIT", aria: "F.R.I.D.A.Y. ist bereit." },
  listening: { state: "ICH HÖRE ZU", aria: "F.R.I.D.A.Y. hört zu." },
  transcribing: { state: "SPRACHE WIRD VERARBEITET", aria: "F.R.I.D.A.Y. verarbeitet Sprache." },
  thinking: { state: "ANALYSE", aria: "F.R.I.D.A.Y. analysiert." },
  syncing: { state: "SYNCHRONISIERUNG", aria: "F.R.I.D.A.Y. synchronisiert." },
  working: { state: "ARBEIT LÄUFT", aria: "F.R.I.D.A.Y. arbeitet." },
  speaking: { state: "F.R.I.D.A.Y. SPRICHT", aria: "F.R.I.D.A.Y. spricht." },
  waiting_approval: { state: "FREIGABE ERFORDERLICH", aria: "Freigabe erforderlich." },
  success: { state: "ERLEDIGT", aria: "Aufgabe abgeschlossen." },
  warning: { state: "EINGESCHRÄNKTER BETRIEB", aria: "Eingeschränkter Betrieb." },
  error: { state: "FEHLER", aria: "Fehler aufgetreten." },
  offline: { state: "OFFLINE", aria: "F.R.I.D.A.Y. ist offline." },
  paused: { state: "PAUSIERT", aria: "F.R.I.D.A.Y. ist pausiert." },
};

test("all 14 forced orb modes are mirrored in data-orb-mode, the accessible name and the live region", async ({ page, api }) => {
  await open(page, "/");
  for (const mode of ORB_MODES) {
    await api.forceOrb(mode);
    await expectOrbMode(page, mode);
    await expect(orbRoot(page).getByRole("button", { name: /^Orb: Details öffnen\./ }), mode).toHaveAccessibleName(new RegExp(LABEL[mode].state.replace(/[.]/g, "\\.")));
    await expect(orbRoot(page).getByRole("status"), mode).toContainText(LABEL[mode].aria);
  }
  await api.forceOrb(null);
  await expect(orbRoot(page)).toHaveAttribute("data-orb-mode", /^(idle|working|waiting_approval|warning)$/); // derived again
});

test("voice-pipeline scenario drives the orb listening -> transcribing -> thinking -> speaking -> idle", async ({ page, api }) => {
  await open(page, "/");
  await page.evaluate(() => {
    const target = document.querySelector("[data-orb-root]");
    if (!target) throw new Error("no orb");
    const seen: string[] = [target.getAttribute("data-orb-mode") ?? ""];
    new MutationObserver(() => {
      const mode = target.getAttribute("data-orb-mode") ?? "";
      if (seen.at(-1) !== mode) seen.push(mode);
    }).observe(target, { attributes: true, attributeFilter: ["data-orb-mode"] });
    (window as unknown as { __orbModes: string[] }).__orbModes = seen;
  });
  await api.play("voice-pipeline", 2);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __orbModes: string[] }).__orbModes), { timeout: 30_000, intervals: [250] })
    .toEqual(expect.arrayContaining(["listening", "transcribing", "thinking", "speaking"]));
  await expectOrbMode(page, "idle", 30_000);
  const modes = await page.evaluate(() => (window as unknown as { __orbModes: string[] }).__orbModes);
  const order = ["listening", "transcribing", "thinking", "speaking", "idle"].map((mode) => modes.lastIndexOf(mode));
  expect(order, `mode sequence ${modes.join(" > ")}`).toEqual([...order].sort((a, b) => a - b));
  expect(order.every((index) => index >= 0)).toBe(true);
});

test("the voice page follows the pipeline: Hört zu -> Transkribiert -> Denkt -> Spricht", async ({ page, api }) => {
  await open(page, "/voice");
  await api.play("voice-pipeline", 0.25);
  for (const mode of ["Hört zu", "Transkribiert", "Denkt", "Spricht"]) {
    await expect(page.getByRole("main").getByText(`Modus: ${mode}`)).toBeVisible({ timeout: 20_000 });
  }
});

test("clicking the orb opens the context that belongs to its state (waiting_approval -> approval)", async ({ page, api }) => {
  await api.play("approval-waiting", 10);
  await open(page, "/");
  await expectOrbMode(page, "waiting_approval");
  await orbRoot(page).getByRole("button", { name: /^Orb: Details öffnen\./ }).click();
  const drawer = page.getByRole("dialog", { name: "Freigabe" });
  await expect(drawer).toBeVisible();
  const [pending] = (await api.get("/approvals?status=pending&limit=5")).body.items as Array<{ action: string }>;
  await expect(drawer).toContainText(pending!.action);
});
