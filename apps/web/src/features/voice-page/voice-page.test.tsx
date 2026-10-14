import type { VoiceMetrics, VoiceProfile, VoiceStatus } from "@jarvis/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { listOf, NOW, routedFetch, single, SOURCE } from "@/features/system/testSupport";
import { VoicePage } from "./VoicePage";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/voice", useSearchParams: () => new URLSearchParams() }));
const runCommand = vi.fn();
vi.mock("@/features/palette/commandRunner", () => ({ useRunCommand: () => runCommand }));

const stat = (currentMs: number | null, avgMs: number | null, p95Ms: number | null, sampleCount: number) => ({ currentMs, avgMs, p95Ms, sampleCount });

function status(partial: Partial<VoiceStatus> = {}): VoiceStatus {
  return {
    updatedAt: NOW,
    source: SOURCE,
    mode: "idle",
    microphone: { state: "idle", active: false, deviceId: "vdev_in", inputLevel: 0.02 },
    wakeWord: { enabled: true, state: "armed", phrase: "Hey Friday" },
    speakerVerification: { enabled: true, state: "verified", recognizedSpeaker: "Erik Brandt", confidence: 0.97 },
    trustedSession: { active: true, expiresAt: NOW },
    stt: { engine: "faster-whisper", state: "ready", latencyMs: 420 },
    tts: { engine: "Piper", state: "ready", latencyMs: null },
    localModel: { name: null, state: "offline", latencyMs: null },
    audioInputDeviceId: "vdev_in",
    audioOutputDeviceId: null,
    pushToTalk: { enabled: true, active: false },
    focusMode: false,
    rawRecordingEnabled: false,
    voiceHistoryEnabled: true,
    ...partial,
  };
}

const metrics: VoiceMetrics = {
  sampledAt: NOW,
  source: SOURCE,
  wakeWordLatency: stat(120, 135, 190, 312),
  speakerVerificationLatency: stat(null, null, null, 0),
  sttLatency: stat(420, null, null, 3),
  routerLatency: stat(null, null, null, 0),
  firstToken: stat(650, 720, 1400, 274),
  ttsFirstAudio: stat(null, 210, 380, 0),
};

const profile: VoiceProfile = { id: "vprof_1", version: 1, createdAt: NOW, updatedAt: NOW, source: SOURCE, displayName: "Erik Brandt", owner: true, sampleCount: 24, quality: 0.93, calibratedAt: null, threshold: 0.72, lastTestAt: null, lastTestResult: "unknown" };
const devices = [{ id: "vdev_in", version: 1, createdAt: NOW, updatedAt: NOW, source: SOURCE, name: "Mikrofon-Array", kind: "input", isDefault: true, status: "online" }];

const routes = (overrides: Record<string, unknown> = {}) => ({
  "GET /api/v1/voice/status": single(status()),
  "GET /api/v1/voice/metrics": single(metrics),
  "GET /api/v1/voice/profiles": listOf([profile]),
  "GET /api/v1/voice/devices": listOf(devices),
  ...overrides,
});

const caps = (voice: Record<string, boolean>) => capabilitiesOf({ voice: { read: true, ...voice } });

beforeEach(() => {
  push.mockReset();
  runCommand.mockReset();
});
afterEach(() => setApiClient(null));

describe("voice status (PLAN §38.1)", () => {
  it("shows every status item, takes the wake phrase from the API and resolves device names", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    expect(await screen.findByText("„Hey Friday“")).toBeInTheDocument();
    for (const title of ["Mikrofon", "Wake Word", "Sprecherprüfung", "Erkannter Sprecher", "Trusted Session", "Spracherkennung (STT)", "Sprachausgabe (TTS)", "Lokales Modell", "Audio-Eingang", "Audio-Ausgang"]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Mikrofon-Array").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Erik Brandt").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kein Gerät gewählt").length).toBeGreaterThan(0);
  });

  it("keeps the microphone activity visible and flips to active when the microphone records", async () => {
    const fake = routedFetch(routes({ "GET /api/v1/voice/status": single(status({ mode: "listening", microphone: { state: "listening", active: true, deviceId: null, inputLevel: 0.4 } })) }));
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    const banner = await screen.findByTestId("mic-activity");
    await waitFor(() => expect(within(banner).getByText("Mikrofon ist aktiv")).toBeInTheDocument());
    expect(banner).toHaveAttribute("role", "status");
  });

  it("shows the unknown microphone state while the status is unavailable", async () => {
    renderWithProviders(<VoicePage />, { fetchImpl: routedFetch({}).fetch, capabilities: caps({}) });
    expect(within(await screen.findByTestId("mic-activity")).getByText("Mikrofonstatus unbekannt")).toBeInTheDocument();
  });

  it("gates stop by capability and runs it when granted", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes({ "GET /api/v1/voice/status": single(status({ mode: "speaking" })), "POST /api/v1/voice/stop": { contractVersion: "1.0.0", accepted: true, status: "completed", correlationId: "corr_1", message: "Gestoppt" } }));
    const view = renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ stop: false }) });
    expect(await screen.findByRole("button", { name: /Sprachausgabe stoppen/ })).toBeDisabled();
    view.unmount();
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ stop: true }) });
    const stop = await screen.findByRole("button", { name: /Sprachausgabe stoppen/ });
    await waitFor(() => expect(stop).toBeEnabled());
    await user.click(stop);
    await waitFor(() => expect(fake.calls.some((call) => call.method === "POST" && call.path === "/api/v1/voice/stop")).toBe(true));
  });
});

describe("live metrics (PLAN §38.2)", () => {
  it("renders null measurements as missing with a reason and never as 0", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    await screen.findByText("Wake-Word-Latenz");
    expect(document.querySelectorAll(".jv-metric__value--missing")).toHaveLength(3);
    expect(screen.getAllByText("Keine Datenquelle: noch keine Messung")).toHaveLength(3);
    expect(screen.getByLabelText(/Sprecherprüfung: nicht verfügbar/)).toBeInTheDocument();
    expect(screen.queryByText(/^0 ms$/)).toBeNull();
    // measured values keep their statistics, the unmeasured avg/p95 of STT are not invented
    expect(screen.getByText(/Ø 135 ms · P95 190 ms · 312 Messungen/)).toBeInTheDocument();
    expect(screen.getByText("3 Messungen")).toBeInTheDocument();
  });
});

describe("enrollment (PLAN §38.3) and privacy (PLAN §38.4)", () => {
  it("is clearly read-only without the enroll capability but still lists profile data honestly", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ enroll: false }) });
    const note = await screen.findByTestId("enrollment-readonly");
    expect(within(note).getByText("Nur lesend")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enrollment starten" })).toBeNull();
    expect(await screen.findByTitle("Noch nicht kalibriert")).toHaveTextContent("—");
    expect(screen.getByTitle("Noch nie getestet")).toHaveTextContent("—");
    expect(screen.getByText("Nicht getestet")).toBeInTheDocument();
  });

  it("offers enrollment through the command bus only with the capability", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ enroll: true }) });
    await user.click(await screen.findByRole("button", { name: "Enrollment starten" }));
    expect(runCommand).toHaveBeenCalledWith({ text: "Voice-Enrollment starten", source: "text" });
  });

  it("shows raw recording off by default and an honest, disabled delete action", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    const privacy = (await screen.findByText("Rohaufnahmen speichern")).closest("li") as HTMLElement;
    expect(within(privacy).getByText("Aus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Voice-History löschen/ })).toBeDisabled();
  });
});

describe("test mode (PLAN §38.5)", () => {
  it("disables all tests without the capability and explains why", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ test: false }) });
    expect(await screen.findByTestId("test-unavailable")).toBeInTheDocument();
    for (const name of ["Wake Word testen", "Speaker testen", "STT testen", "TTS testen", "Full Pipeline Test"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("runs a test with the chosen kind and shows the stage results", async () => {
    const user = userEvent.setup();
    const result = { kind: "tts", success: false, startedAt: NOW, durationMs: 300, stages: [{ name: "Synthese", ok: true, latencyMs: 180, detail: null }, { name: "Ausgabe", ok: false, latencyMs: null, detail: "Kein Ausgabegerät" }], message: "TTS teilweise fehlgeschlagen", correlationId: "corr_1" };
    const fake = routedFetch(routes({ "POST /api/v1/voice/test": single(result) }));
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ test: true }) });
    await user.type(await screen.findByLabelText("Testtext für TTS"), "Hallo Welt");
    await user.click(screen.getByRole("button", { name: "TTS testen" }));
    const output = await screen.findByTestId("voice-test-result");
    expect(within(output).getByText("Test fehlgeschlagen")).toBeInTheDocument();
    expect(within(output).getByText("Kein Ausgabegerät")).toBeInTheDocument();
    expect(within(output).getByText("Synthese")).toBeInTheDocument();
    const call = fake.calls.find((entry) => entry.path === "/api/v1/voice/test");
    expect(JSON.parse(call?.body ?? "{}")).toEqual({ kind: "tts", text: "Hallo Welt" });
  });
});
