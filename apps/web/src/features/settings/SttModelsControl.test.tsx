// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SttModelsControl } from "./SttModelsControl";

vi.mock("@/lib/api/client", () => ({ getCsrfToken: () => "csrf" }));
afterEach(() => vi.unstubAllGlobals());

it("lists cached models and downloads only on an explicit click without applying settings", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const models = [{ id: "base", cached: true }, { id: "small", cached: false }, { id: "medium", cached: false }];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    return { ok: true, json: async () => ({ localMode: true, models, job: null }) };
  }));
  const view = render(<SttModelsControl selected="small" readOnly={false} />);
  expect(await screen.findByText(/base: lokal vorhanden/)).toBeTruthy();
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Herunterladen" })[0]!);
  await waitFor(() => expect(calls.some((call) => call.url.endsWith("/download") &&
    call.method === "POST" && JSON.parse(call.body ?? "{}").model === "small")).toBe(true));
  expect(calls.some((call) => call.url.includes("/settings"))).toBe(false);
  view.unmount();
});
