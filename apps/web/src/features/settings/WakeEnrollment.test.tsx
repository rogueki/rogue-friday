// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WakeEnrollment } from "./WakeEnrollment";

const mocks = vi.hoisted(() => ({ capture: vi.fn(async () => "cGNt") }));
vi.mock("@/features/voice-page/LinuxEnrollment", () => ({ captureEnrollmentPcm: mocks.capture }));

const api = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  addSample: vi.fn(),
  train: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("@/lib/api/domains/wakeEnrollment", () => ({ wakeEnrollmentApi: api }));
afterEach(() => { vi.clearAllMocks(); });

it("guides recording and training without applying a phrase until explicit settings save", async () => {
  const calls: Array<{ method: string; phrase?: string; body?: unknown }> = [];
  const required = { wake: 1, short: 0, negatives: 0, speech: 0 };
  const counts = { wake: 0, short: 0, negatives: 0, speech: 0 };
  const base = { contractVersion: "2.0.0", jobId: "a".repeat(32), phrase: "Testwort", shortPhrase: null, required, counts, quality: null, error: null };
  let state: "idle" | "capturing" | "ready" = "idle";
  const snapshot = () => state === "idle" ? { ...base, state, jobId: null, phrase: null }
    : { ...base, state, counts: { ...counts }, quality: state === "ready" ? "gut" : null };
  api.status.mockImplementation(async () => snapshot());
  api.start.mockImplementation(async (phrase: string) => { calls.push({ method: "start", phrase }); state = "capturing"; return snapshot(); });
  api.addSample.mockImplementation(async (body: { kind: string }) => { calls.push({ method: "addSample", body }); counts.wake = 1; return snapshot(); });
  api.train.mockImplementation(async () => { calls.push({ method: "train" }); state = "ready"; return snapshot(); });
  api.discard.mockImplementation(async () => snapshot());
  render(<WakeEnrollment phrase="Testwort" activePhrase="Hey Friday" readOnly={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Aktivierungsphrase einlernen" }));
  fireEvent.click(screen.getByRole("button", { name: "Aufnahme starten" }));
  await waitFor(() => expect(calls.some((call) => call.method === "start" && call.phrase === "Testwort")).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: /Probe aufnehmen/ }));
  await waitFor(() => expect(calls.some((call) => call.method === "addSample")).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: "Modell trainieren" }));
  await waitFor(() => expect(calls.some((call) => call.method === "train")).toBe(true));
  await waitFor(() => expect(screen.getByText(/Jetzt die Einstellungen speichern/)).toBeTruthy());
  // Das Mock-Modul exportiert nur die Enrollment-API; ein Aufruf zum Speichern der Einstellungen ist damit nicht möglich.
  expect(api.discard).not.toHaveBeenCalled();
});
