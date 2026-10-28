// Audits every menu, select and menu-like control of a page and writes findings plus an inventory to test-results/menu-audit.
import { expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { open } from "./fixtures";

export interface Finding {
  page: string;
  context: string;
  control: string;
  rule: string;
  detail: string;
}

export interface InventoryEntry {
  page: string;
  context: string;
  kind: "select" | "combobox" | "tablist" | "disabled-button";
  name: string;
  options: string[];
  effects: Record<string, string>;
}

const OUT_DIR = join("test-results", "menu-audit");
const DESTRUCTIVE = /l(ö|oe)sch|entfern|stopp|beend|abmeld|zur(ü|ue)cksetz|senden|ausf(ü|ue)hr|genehmig|ablehn|deaktiv|abbrech|widerruf|verwerf|neu starten|neustart|deinstall|trennen/i;
const CLOSE_NAME = /schlie(ß|ss)en|abbrechen|close/i;
const MAX_OPENERS = 25;
const MAX_OPTIONS = 8;
const MAX_PER_FAMILY = 2;
const familyCounts = new Map<string, number>();
let auditCounter = 0;
let selectDialogCount = 0;

const clean = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
// Playwright call logs list the calls first and the cause ("... intercepts pointer events", "element is not stable",
// "element was detached") last, so keep the head and the tail when truncating to stay on the cause.
const message = (error: unknown): string => {
  const text = (error instanceof Error ? error.message : String(error)).replace(ANSI, "");
  return text.length <= 700 ? text : `${text.slice(0, 160)} … ${text.slice(-520)}`;
};

export function routeSlug(route: string): string {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  return trimmed ? trimmed.replace(/\//g, "-") : "overview";
}

function mainRegion(page: Page): Locator {
  return page.getByRole("main", { name: "Hauptinhalt" });
}

async function dialogState(page: Page): Promise<string> {
  const state = await page.evaluate(() => ({
    dialogs: Array.from(document.querySelectorAll("[role=dialog], [role=alertdialog]"))
      .filter((el) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed")
      .map((el) => el.getAttribute("aria-label") || el.querySelector("h1,h2,h3,h4")?.textContent?.trim() || el.id || "?"),
    active: `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 40) ?? ""}`,
    focusInsideDialog: !!document.activeElement?.closest("[role=dialog], [role=alertdialog]"),
  })).catch(() => null);
  return JSON.stringify(state);
}

async function accessibleName(target: Locator): Promise<string> {
  const name = await target
    .evaluate((el) => {
      const label = (el as HTMLInputElement).labels?.[0];
      let labels = "";
      if (label) {
        const clone = label.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("select, option").forEach((child) => child.remove());
        labels = clone.textContent ?? "";
      }
      const labelledBy = el.getAttribute("aria-labelledby");
      const reference = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
            .join(" ")
        : "";
      return labels || el.getAttribute("aria-label") || reference || el.textContent || "";
    }, undefined, { timeout: 2000 })
    .catch(() => "");
  return clean(name);
}

async function disabledReason(target: Locator): Promise<string> {
  const reason = await target
    .evaluate((el) => {
      const describedBy = el.getAttribute("aria-describedby");
      const described = describedBy
        ? describedBy
            .split(/\s+/)
            .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
            .join(" ")
        : "";
      return described || el.getAttribute("title") || "";
    }, undefined, { timeout: 5_000 })
    .catch(() => "");
  return clean(reason);
}

async function snapshot(page: Page): Promise<{ url: string; text: string }> {
  const text = await mainRegion(page)
    .innerText()
    .catch(() => "");
  return { url: page.url(), text: text.slice(0, 20_000) };
}

// A select whose value only takes effect through an action in its form, dialog or section is a form field and not
// an ineffective option; the submit button may sit in the dialog footer outside the <form> or be bound via form="<id>".
async function hasSubmitButton(select: Locator): Promise<boolean> {
  return select
    .evaluate((el) => {
      const containers: Element[] = [];
      const addContainer = (node: Element | null): void => {
        if (node && !containers.includes(node)) containers.push(node);
      };
      addContainer(el.closest("[role=dialog], [role=alertdialog]"));
      addContainer(el.closest("form"));
      addContainer(el.closest("fieldset, [role=group], section, [role=region]"));
      const form = el.closest("form");
      return containers.some((container) => {
        const buttons = Array.from(container.querySelectorAll("button"));
        if (form && container === form && form.id) {
          buttons.push(...Array.from(document.querySelectorAll<HTMLButtonElement>(`button[form="${CSS.escape(form.id)}"]`)));
        }
        return buttons.some((button) => {
          const isSubmit = button.getAttribute("type") === "submit";
          const isNamed = /speichern|anlegen|erstellen|uebernehmen|übernehmen|weiter|hinzuf|prüfen|pruefen|starten|senden|suchen|vorschlagen|generieren|abrufen|anwenden/i.test(button.textContent ?? "");
          if (!isSubmit && !isNamed) return false;
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      });
    }, undefined, { timeout: 5_000 })
    .catch(() => false);
}

async function auditSelect(
  page: Page,
  select: Locator,
  label: string,
  context: string,
  findings: Finding[],
  inventory: InventoryEntry[],
): Promise<void> {
  const auditId = `s${++auditCounter}`;
  // the incoming locator skips marked selects, so all further reads go through the marker.
  await select.evaluate((el, id) => el.setAttribute("data-menu-audit", id), auditId, { timeout: 5_000 });
  const stable = page.locator(`[data-menu-audit="${auditId}"]`);
  const info = await stable.evaluate((el) => {
    const node = el as HTMLSelectElement;
    const label = node.labels?.[0];
    let labels = "";
    if (label) {
      const clone = label.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("select, option").forEach((child) => child.remove());
      labels = clone.textContent ?? "";
    }
    const labelledBy = node.getAttribute("aria-labelledby");
    const reference = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => node.ownerDocument.getElementById(id)?.textContent ?? "")
          .join(" ")
      : "";
    const describedBy = node.getAttribute("aria-describedby");
    const described = describedBy
      ? describedBy
          .split(/\s+/)
          .map((id) => node.ownerDocument.getElementById(id)?.textContent ?? "")
          .join(" ")
      : "";
    return {
      name: labels || node.getAttribute("aria-label") || reference,
      described,
      title: node.getAttribute("title") ?? "",
      disabled: node.disabled,
      value: node.value,
      options: Array.from(node.options).map((option) => ({
        label: (option.textContent ?? "").trim(),
        value: option.value,
        disabled: option.disabled,
      })),
    };
  }, undefined, { timeout: 5_000 });
  const name = clean(info.name);
  const control = name || "select";
  const effects: Record<string, string> = {};
  inventory.push({ page: label, context, kind: "select", name, options: info.options.map((option) => option.label), effects });
  if (!name) findings.push({ page: label, context, control, rule: "select-no-name", detail: "" });
  for (const option of info.options) {
    if (!option.label) findings.push({ page: label, context, control, rule: "option-no-label", detail: option.value });
  }
  if (info.options.length === 0) findings.push({ page: label, context, control, rule: "select-empty", detail: "" });
  if (info.disabled) {
    if (!clean(info.described || info.title)) {
      findings.push({ page: label, context, control, rule: "disabled-no-reason", detail: "" });
    }
    return;
  }

  // Per-item selects (e.g. "Status ändern: <Titel>" on every card) share one behaviour; exercising two is enough.
  const family = `${label}|${context}|${name.split(": ")[0]}`;
  const seen = (familyCounts.get(family) ?? 0) + 1;
  familyCounts.set(family, seen);
  if (seen > MAX_PER_FAMILY) {
    effects["*"] = "family-sample";
    return;
  }

  const targets = info.options.filter((option) => !option.disabled && option.value !== info.value).slice(0, MAX_OPTIONS);
  let dialogCaptured = false;
  for (const option of targets) {
    let requests = 0;
    const onRequest = (request: { url(): string }): void => {
      if (request.url().includes("/api/v1/")) requests += 1;
    };
    page.on("request", onRequest);
    const before = await snapshot(page);
    const dialogsBefore = await page.locator("[role=dialog]:visible, [role=alertdialog]:visible").count();
    let failure: string | null = null;
    try {
      await stable.selectOption(option.value, { timeout: 2000 });
      await page.waitForTimeout(600);
    } catch (error) {
      failure = message(error);
    }
    const dialogsAfter = await page.locator("[role=dialog]:visible, [role=alertdialog]:visible").count();
    const after = await snapshot(page);
    page.off("request", onRequest);
    if ((await stable.count()) === 0) break;

    let effect: string;
    if (dialogsAfter > dialogsBefore) effect = "dialog";
    else if (failure) effect = "none";
    else if (after.url !== before.url) effect = "url";
    else if (after.text !== before.text) effect = "content";
    else if (requests > 0) effect = "request";
    else if (await hasSubmitButton(stable)) effect = "form-field";
    else effect = "none";

    const optionName = option.label || option.value;
    effects[optionName] = effect;
    if (effect === "none") {
      findings.push({
        page: label,
        context,
        control,
        rule: "option-no-effect",
        detail: failure ? `${optionName} (${failure})` : optionName,
      });
    }
    if (effect === "dialog") {
      if (!dialogCaptured) {
        dialogCaptured = true;
        selectDialogCount += 1;
        const dialog = page.locator("[role=dialog]:visible, [role=alertdialog]:visible").last();
        await dialog
          .screenshot({
            path: join(
              OUT_DIR,
              `${routeSlug(page.url() ? new URL(page.url()).pathname : "page")}--select-dialog-${selectDialogCount}.png`,
            ),
          })
          .catch(() => undefined);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
      const openAfterEscape = await page.locator("[role=dialog]:visible, [role=alertdialog]:visible").count();
      if (openAfterEscape > dialogsBefore) {
        const lastDialog = page.locator("[role=dialog]:visible, [role=alertdialog]:visible").last();
        await lastDialog
          .getByRole("button", { name: /abbrechen|schlie(ß|ss)en|verwerfen|close/i })
          .first()
          .click({ timeout: 2000 })
          .catch(() => undefined);
      }
      const stillOpen = await page.locator("[role=dialog]:visible, [role=alertdialog]:visible").count();
      if (stillOpen > dialogsBefore) {
        findings.push({ page: label, context, control, rule: "dialog-no-escape", detail: `${optionName} | ${await dialogState(page)}` });
        break;
      }
      continue;
    }
    try {
      if ((await stable.inputValue()) !== option.value) {
        findings.push({ page: label, context, control, rule: "option-not-selectable", detail: optionName });
      }
    } catch {
      // the select disappeared after the change, the interaction itself is already reported
    }
    try {
      await stable.selectOption(info.value, { timeout: 2000 });
      await page.waitForTimeout(200);
    } catch (error) {
      findings.push({ page: label, context, control, rule: "restore-failed", detail: message(error) });
    }
  }
}

async function auditCombobox(
  page: Page,
  combobox: Locator,
  label: string,
  context: string,
  findings: Finding[],
  inventory: InventoryEntry[],
): Promise<void> {
  const name = await accessibleName(combobox);
  const control = name || "combobox";
  let options: string[];
  try {
    await combobox.click({ timeout: 2000 });
    await page.waitForTimeout(300);
  } catch {
    // not clickable: the empty-list finding below still records the control
  }
  try {
    options = (await page.locator("[role=option]:visible").allInnerTexts()).map(clean).filter((text) => text.length > 0);
  } catch {
    options = [];
  }
  if (options.length === 0) findings.push({ page: label, context, control, rule: "combobox-empty", detail: "" });
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(300);
  const stillOpen = await page
    .locator("[role=listbox]:visible")
    .count()
    .catch(() => 0);
  if (stillOpen > 0) findings.push({ page: label, context, control, rule: "combobox-no-escape", detail: "" });
  inventory.push({ page: label, context, kind: "combobox", name, options, effects: {} });
}

async function auditTablist(
  page: Page,
  tablist: Locator,
  label: string,
  context: string,
  findings: Finding[],
  inventory: InventoryEntry[],
): Promise<void> {
  const tabs = tablist.locator("[role=tab]");
  const total = await tabs.count();
  const names: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const tab = tabs.nth(index);
    const name = await accessibleName(tab);
    names.push(name);
    try {
      await tab.click({ timeout: 5000 });
      // A loaded CI runner can take longer than a frame to commit the selection; a user still sees it at once.
      const selected = await expect
        .poll(() => tab.getAttribute("aria-selected"), { timeout: 2000 })
        .toBe("true")
        .then(() => true, () => false);
      if (!selected) {
        findings.push({ page: label, context, control: name || "tab", rule: "tab-not-selectable", detail: "" });
      }
    } catch (error) {
      findings.push({ page: label, context, control: name || "tab", rule: "tab-not-selectable", detail: message(error) });
    }
  }
  inventory.push({ page: label, context, kind: "tablist", name: await accessibleName(tablist), options: names, effects: {} });
}

async function auditDisabledButtons(
  scope: Locator,
  label: string,
  context: string,
  findings: Finding[],
  inventory: InventoryEntry[],
): Promise<void> {
  const buttons = scope.locator("button:disabled, [aria-disabled=true]");
  const total = await buttons.count();
  for (let index = 0; index < total; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    const name = await accessibleName(button);
    const reason = await disabledReason(button);
    if (!reason) findings.push({ page: label, context, control: name || "button", rule: "disabled-no-reason", detail: "" });
    inventory.push({ page: label, context, kind: "disabled-button", name, options: [], effects: {} });
  }
}

async function auditScope(
  page: Page,
  scope: Locator,
  context: string,
  label: string,
  findings: Finding[],
  inventory: InventoryEntry[],
): Promise<void> {
  // Visit each visible select once; audited ones carry data-menu-audit, so re-ordering cannot skip or repeat one.
  let rerenders = 0;
  for (let guard = 0; guard < 300; guard += 1) {
    const next = scope.locator("select:not([data-menu-audit]):visible").first();
    if ((await next.count()) === 0) break;
    try {
      await auditSelect(page, next, label, context, findings, inventory);
    } catch (error) {
      // The list re-rendered under the audit; skip one round instead of hanging on a vanished element.
      if (++rerenders > 3) {
        findings.push({ page: label, context, control: "select", rule: "audit-unstable", detail: message(error) });
        break;
      }
    }
  }

  const comboboxes = scope.locator("[role=combobox]:not(select)");
  const comboboxCount = await comboboxes.count();
  for (let index = 0; index < comboboxCount; index += 1) {
    const combobox = comboboxes.nth(index);
    if (!(await combobox.isVisible().catch(() => false))) continue;
    await auditCombobox(page, combobox, label, context, findings, inventory);
  }

  const tablists = scope.locator("[role=tablist]");
  const tablistCount = await tablists.count();
  for (let index = 0; index < tablistCount; index += 1) {
    const tablist = tablists.nth(index);
    if (!(await tablist.isVisible().catch(() => false))) continue;
    await auditTablist(page, tablist, label, context, findings, inventory);
  }

  await auditDisabledButtons(scope, label, context, findings, inventory);
}

async function dialogName(dialog: Locator): Promise<string> {
  const label = clean(await dialog.getAttribute("aria-label").catch(() => null));
  if (label) return label;
  const heading = clean(
    await dialog
      .locator("h1, h2, h3, h4, h5, h6")
      .first()
      .innerText()
      .catch(() => ""),
  );
  return heading || "dialog";
}

export async function auditPage(
  page: Page,
  label: string,
  route: string,
): Promise<{ findings: Finding[]; inventory: InventoryEntry[]; skippedOpeners: string[] }> {
  const slug = routeSlug(route);
  mkdirSync(OUT_DIR, { recursive: true });
  await open(page, route);
  await page.screenshot({ path: join(OUT_DIR, `${slug}.png`), fullPage: true });

  const findings: Finding[] = [];
  const inventory: InventoryEntry[] = [];
  const skippedOpeners: string[] = [];
  await auditScope(page, mainRegion(page), "page", label, findings, inventory);

  const buttons = mainRegion(page).locator("button");
  const buttonCount = await buttons.count();
  const openers: Array<{ locator: Locator; name: string }> = [];
  for (let index = 0; index < buttonCount && openers.length < MAX_OPENERS; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    if (!(await button.isEnabled().catch(() => false))) continue;
    // The page may have re-rendered with fewer buttons since counting; a vanished one is simply skipped.
    const name = await accessibleName(button).catch(() => null);
    if (name === null) continue;
    if (DESTRUCTIVE.test(name)) continue;
    openers.push({ locator: button, name });
  }

  let dialogCount = 0;
  let blockedByOpenDialogReported = false;
  let openerShotTaken = false;
  for (const opener of openers) {
    let control = "button";
    // Index locators drift when a view switch is remembered across reloads; the accessible name is the stable identity.
    let target: Locator = opener.locator;
    try {
      // Uses the same name computation as the opener collection; Playwright's role name joins nested text differently.
      const findByName = async (): Promise<Locator | null> => {
        const all = mainRegion(page).locator("button");
        const count = await all.count();
        for (let index = 0; index < count; index += 1) {
          const candidate = all.nth(index);
          if ((await accessibleName(candidate)) === opener.name) return candidate;
        }
        return null;
      };
      // nth() locators re-resolve after DOM changes, so the name is re-checked before every click.
      const ready = async (): Promise<{ ok: boolean; renamed: boolean }> => {
        const current = await accessibleName(target).catch(() => null);
        const renamed = current === null || current !== opener.name;
        const ok =
          current !== null &&
          !renamed &&
          !DESTRUCTIVE.test(current) &&
          (await target.isVisible().catch(() => false)) &&
          (await target.isEnabled().catch(() => false));
        return { ok, renamed };
      };
      let result = await ready();
      if (!result.ok && result.renamed) {
        const found = await findByName();
        if (found) target = found;
        result = await ready();
        if (!result.ok) {
          await open(page, route);
          const reopened = await findByName();
          if (reopened) target = reopened;
          result = await ready();
        }
      }
      if (!result.ok) {
        if (result.renamed) skippedOpeners.push(opener.name);
        continue;
      }
      control = opener.name || "button";
      // A "Du bist dabei:" confirmation is an alertdialog, so count both roles before opening anything.
      const dialogsBefore = await page
        .locator("[role=dialog]:visible, [role=alertdialog]:visible")
        .count()
        .catch(() => 0);
      // Elements can still be animating briefly after a dialog closes or a view switches; Playwright then reports
      // "not stable" even though a user would click successfully at that moment.
      await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
      await target.click({ timeout: 5000 });
      // The last opened layer is on top, so it is the one to inspect and close.
      const dialog = page.locator("[role=dialog]:visible, [role=alertdialog]:visible").last();
      const appeared = await dialog
        .waitFor({ state: "visible", timeout: 1500 })
        .then(() => true)
        .catch(() => false);
      const dialogsAfter = appeared
        ? await page
            .locator("[role=dialog]:visible, [role=alertdialog]:visible")
            .count()
            .catch(() => 0)
        : dialogsBefore;
      if (appeared && dialogsAfter > dialogsBefore) {
        dialogCount += 1;
        const name = await dialogName(dialog);
        await dialog.screenshot({ path: join(OUT_DIR, `${slug}--dialog-${dialogCount}.png`) }).catch(() => undefined);
        await auditScope(page, dialog, `dialog:${name}`, label, findings, inventory);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(1000);
        const stillOpen = await page
          .locator("[role=dialog]:visible, [role=alertdialog]:visible")
          .count()
          .catch(() => 0);
        if (stillOpen > dialogsBefore) {
          findings.push({ page: label, context: `dialog:${name}`, control: name, rule: "dialog-no-escape", detail: ` | ${await dialogState(page)}` });
          const close = dialog.getByRole("button", { name: CLOSE_NAME }).first();
          if (await close.isVisible().catch(() => false)) {
            await close.click({ timeout: 2000 }).catch(() => undefined);
          } else {
            await dialog
              .getByRole("button", { name: /abbrechen/i })
              .first()
              .click({ timeout: 2000 })
              .catch(() => undefined);
          }
        }
      } else {
        // An opener without a dialog can switch filters, view or sorting; the following nth() locators only
        // refer to the initial state, so return to it before checking the next opener.
        await open(page, route);
      }
    } catch (error) {
      findings.push({ page: label, context: "page", control, rule: "opener-error", detail: message(error) });
      if (!openerShotTaken) {
        openerShotTaken = true;
        await page.screenshot({ path: join(OUT_DIR, `${slug}--opener-error.png`), fullPage: true }).catch(() => undefined);
      }
      if (!blockedByOpenDialogReported) {
        const openDialogs = await page
          .locator("[role=dialog]:visible, [role=alertdialog]:visible")
          .count()
          .catch(() => 0);
        if (openDialogs > 0) {
          const state = await dialogState(page);
          blockedByOpenDialogReported = true;
          await page.keyboard.press("Escape").catch(() => undefined);
          await page.waitForTimeout(600);
          findings.push({
            page: label,
            context: "page",
            control,
            rule: "blocked-by-open-dialog",
            detail: `before: ${state} | afterEscape: ${await dialogState(page)}`,
          });
        }
      }
    }
  }

  return { findings, inventory, skippedOpeners };
}

export function writeReport(
  slug: string,
  data: { findings: Finding[]; inventory: InventoryEntry[]; skippedOpeners?: string[] },
): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${slug}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  const lines = [
    `# Menu-Audit ${slug}`,
    "",
    `Findings: ${data.findings.length}`,
    "",
    ...data.findings.map((finding) => `- [${finding.rule}] ${finding.page} / ${finding.context} / ${finding.control}: ${finding.detail}`),
    "",
    `Inventory: ${data.inventory.length}`,
    "",
    ...data.inventory.map((entry) => {
      const effects = Object.entries(entry.effects)
        .map(([option, effect]) => `${option}=${effect}`)
        .join(", ");
      return `- [${entry.kind}] ${entry.context} / ${entry.name}: ${entry.options.join(", ")}${effects ? ` (${effects})` : ""}`;
    }),
    "",
    ...(data.skippedOpeners?.length
      ? [`Skipped openers: ${data.skippedOpeners.length}`, "", ...data.skippedOpeners.map((name) => `- ${name}`), ""]
      : []),
  ];
  writeFileSync(join(OUT_DIR, `${slug}.menu-audit.md`), lines.join("\n"), "utf8");
}

