// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SttModelsControl } from "./SttModelsControl";

vi.mock("@/lib/api/client", () => ({ getCsrfToken: () => "csrf" }));
afterEach(() => vi.unstubAllGlobals());

it("lists cached models and downloads only on an explicit click without applying settings", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const models = [{ id: "base", cached: true, downloadable: true }, { id: "small", cached: false, downloadable: true },
    { id: "large-v3", cached: true, downloadable: true }];
  const onSelect = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    return { ok: true, json: async () => ({ localMode: true, models, job: null }) };
  }));
  const view = render(<SttModelsControl selected="small" language="de" readOnly={false} onSelect={onSelect} />);
  expect(await screen.findByText(/base: lokal vorhanden/)).toBeTruthy();
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Auswählen" })[1]!);
  expect(onSelect).toHaveBeenCalledWith("large-v3");
  fireEvent.click(screen.getAllByRole("button", { name: "Herunterladen" })[0]!);
  await waitFor(() => expect(calls.some((call) => call.url.endsWith("/download") &&
    call.method === "POST" && JSON.parse(call.body ?? "{}").model === "small")).toBe(true));
  expect(calls.some((call) => call.url.includes("/settings"))).toBe(false);
  view.unmount();
});

it("shows the chosen model and can return to the installed model", async () => {
  const models = [{ id: "small", cached: true, downloadable: true }, { id: "medium", cached: false, downloadable: true }];
  const onSelect = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ localMode: true, models, job: null }) })));
  const view = render(<SttModelsControl selected="small" language="de" readOnly={false} onSelect={onSelect} />);
  expect(await screen.findByText(/ausgewählt/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Installiertes Modell übernehmen" }));
  expect(onSelect).toHaveBeenCalledWith(null);
  expect(screen.queryByRole("button", { name: "Auswählen" })).toBeNull();
  view.unmount();
});
