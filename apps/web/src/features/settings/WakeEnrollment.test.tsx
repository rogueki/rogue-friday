// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WakeEnrollment } from "./WakeEnrollment";

const mocks = vi.hoisted(() => ({ capture: vi.fn(async () => "cGNt"), csrf: vi.fn(() => "csrf") }));
vi.mock("@/features/voice-page/LinuxEnrollment", () => ({ captureEnrollmentPcm: mocks.capture }));
vi.mock("@/lib/api/client", () => ({ getCsrfToken: mocks.csrf }));
afterEach(() => vi.unstubAllGlobals());

it("guides recording and training without applying a phrase until explicit settings save", async () => {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const required = { wake: 1, short: 0, negatives: 0, speech: 0 };
  const counts = { wake: 0, short: 0, negatives: 0, speech: 0 };
  const base = { jobId: "a".repeat(32), phrase: "Testwort", shortPhrase: null, required, counts, quality: null, error: null };
  let state: "idle" | "capturing" | "ready" = "idle";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split("/wake-enrollment")[1] ?? "";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ path, body });
    if (path === "/start") state = "capturing";
    if (path === "/samples") counts.wake = 1;
    if (path === "/train") state = "ready";
    return { ok: true, json: async () => state === "idle" ? { ...base, state, jobId: null, phrase: null } :
      { ...base, state, counts: { ...counts }, quality: state === "ready" ? "gut" : null } };
  }));
  render(<WakeEnrollment phrase="Testwort" activePhrase="Hey Friday" readOnly={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Aktivierungsphrase einlernen" }));
  fireEvent.click(screen.getByRole("button", { name: "Aufnahme starten" }));
  await waitFor(() => expect(calls.some(({ path, body }) => path === "/start" && body?.phrase === "Testwort")).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: /Probe aufnehmen/ }));
  await waitFor(() => expect(calls.some(({ path }) => path === "/samples")).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: "Modell trainieren" }));
  await waitFor(() => expect(screen.getByText(/Jetzt die Einstellungen speichern/)).toBeTruthy());
  expect(calls.some(({ path }) => path === "/settings")).toBe(false);
});
