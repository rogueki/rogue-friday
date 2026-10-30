import type { VoiceEnrollment, VoiceMetrics, VoiceProfile, VoiceStatus } from "@friday/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { errorBody, listOf, NOW, routedFetch, single, SOURCE } from "@/features/system/testSupport";
import { validateSampleTarget } from "./EnrollmentFlow";
import { buildStatusRows, VoicePage } from "./VoicePage";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/voice", useSearchParams: () => new URLSearchParams() }));

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

  it("names the voice path that owns audio", async () => {
    const fake = routedFetch(routes({ "GET /api/v1/voice/status": single(status({ audioPath: { transport: "device", host: "linux" } })) }));
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    expect((await screen.findAllByText("Linux-Sprachdienst (lokale Geräte)")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sprachpfad").length).toBeGreaterThan(0);
  });

  it("marks a selected device that is no longer connected as unreachable instead of showing its id", async () => {
    const fake = routedFetch(routes({ "GET /api/v1/voice/status": single(status({ audioInputDeviceId: "vdev_gone" })) }));
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    expect((await screen.findAllByText("Gewähltes Gerät nicht gefunden")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nicht erreichbar").length).toBeGreaterThan(0);
    expect(screen.queryByText("vdev_gone")).toBeNull();
  });

  it("says the voice service waits for its audio device instead of showing the microphone as off", async () => {
    const fake = routedFetch(routes({ "GET /api/v1/voice/status": single(status({ audioDeviceWaiting: true, microphone: { state: "off", active: false, deviceId: null, inputLevel: 0 } })) }));
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    expect((await screen.findAllByText("Wartet auf Audiogerät")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Friday nimmt es automatisch wieder auf/).length).toBeGreaterThan(0);
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
    const fake = routedFetch(routes({ "GET /api/v1/voice/status": single(status({ mode: "speaking" })), "POST /api/v1/voice/stop": { contractVersion: "2.0.0", accepted: true, status: "completed", correlationId: "corr_1", message: "Gestoppt" } }));
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

describe("status rows without fresh data (DASH-11.05)", () => {
  const t = ((key: string) => key) as never;

  it("claims neither a speaker decision nor a trusted session from cached data", () => {
    const rows = buildStatusRows(status(), [], t, "de-DE", "x", false);
    for (const id of ["speaker", "recognizedSpeaker", "trustedSession"]) {
      const row = rows.find((entry) => entry.id === id);
      expect(row?.value).toBe("voicePage.status.unknown");
      expect(row?.detail).toBe("voicePage.status.notCurrent");
      expect(row?.tone).toBe("muted");
    }
    expect(rows.find((entry) => entry.id === "stt")?.value).toBe("faster-whisper");
  });

  it("keeps the recognized speaker while the data is live", () => {
    const rows = buildStatusRows(status(), [], t, "de-DE", "x");
    expect(rows.find((entry) => entry.id === "recognizedSpeaker")?.value).toBe("Erik Brandt");
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

  it("shows the speaker profile's samples, quality and threshold as stored (I-033)", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ enroll: false }) });
    await screen.findByTestId("enrollment-readonly");
    const card = document.querySelector(".vp-profile") as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("Erik Brandt")).toBeInTheDocument();
    const text = (card as HTMLElement).textContent ?? "";
    expect(text).toMatch(/Samples\s*24/);
    expect(text).toMatch(/Qualität\s*93\s*%/);
    expect(text).toMatch(/Threshold\s*72\s*%/);
  });

  it("names an unknown profile state instead of claiming that no profile exists", async () => {
    const unknown = { ...listOf([]), freshness: { state: "unknown", asOf: null } };
    const fake = routedFetch(routes({ "GET /api/v1/voice/profiles": unknown }));
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ enroll: false }) });
    expect(await screen.findByText("Profilstand unbekannt")).toBeInTheDocument();
    expect(screen.queryByText("Noch kein Sprecherprofil")).toBeNull();
  });

  it("still says that no profile exists when the service reports none", async () => {
    const fake = routedFetch(routes({ "GET /api/v1/voice/profiles": listOf([]) }));
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ enroll: false }) });
    expect(await screen.findByText("Noch kein Sprecherprofil")).toBeInTheDocument();
    expect(screen.queryByText("Profilstand unbekannt")).toBeNull();
  });

  const job = (partial: Partial<VoiceEnrollment> = {}): VoiceEnrollment => ({
    id: "venr_01JAAAAAAAAAAAAAAAAAAAAAAA",
    profileId: "vprof_1",
    status: "queued",
    samplesCaptured: 0,
    samplesRequired: 12,
    progress: { mode: "determinate", value: 0 },
    quality: null,
    startedAt: NOW,
    updatedAt: NOW,
    finishedAt: null,
    message: "Einrichtung wird vorbereitet.",
    source: SOURCE,
    ...partial,
  });

  it("starts an enrollment through POST /voice/profiles/{id}/enroll with the chosen options and follows the job to completion", async () => {
    const user = userEvent.setup();
    let polls = 0;
    const fake = routedFetch(
      routes({
        "POST /api/v1/voice/profiles/vprof_1/enroll": () => new Response(JSON.stringify(single(job())), { status: 202, headers: { "content-type": "application/json", Location: "/api/v1/voice/enrollments/venr_01JAAAAAAAAAAAAAAAAAAAAAAA" } }),
        "GET /api/v1/voice/enrollments/venr_01JAAAAAAAAAAAAAAAAAAAAAAA": () => {
          polls += 1;
          return polls < 2
            ? single(job({ status: "capturing", samplesCaptured: 5, progress: { mode: "determinate", value: 0.42 }, message: "Bitte sprich Satz 6 von 12 laut und deutlich." }))
            : single(job({ status: "completed", samplesCaptured: 12, progress: { mode: "determinate", value: 1 }, quality: 0.95, finishedAt: NOW, message: "Das Sprachprofil wurde aktualisiert." }));
        },
      }),
    );
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ enroll: true }) });
    await user.click(await screen.findByRole("button", { name: "Enrollment starten" }));
    const dialog = await screen.findByRole("dialog", { name: /einlernen/ });
    const samples = within(dialog).getByLabelText("Anzahl Samples");
    await user.clear(samples);
    await user.type(samples, "8");
    await user.click(within(dialog).getByRole("switch", { name: /Schwelle neu kalibrieren/ }));
    await user.click(within(dialog).getByRole("button", { name: "Einrichtung starten" }));
    await waitFor(() => expect(fake.calls.some((call) => call.method === "POST" && call.path.endsWith("/enroll"))).toBe(true));
    const post = fake.calls.find((call) => call.path.endsWith("/enroll"));
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ sampleTarget: 8, recalibrate: false });
    expect(post?.headers.get("Idempotency-Key")).toBeTruthy();
    const running = await screen.findByTestId("enrollment-job");
    expect(running).toHaveAttribute("data-status", "capturing");
    expect(within(running).getByText("5 von 12 Samples")).toBeInTheDocument();
    expect(within(running).getByText("Bitte sprich Satz 6 von 12 laut und deutlich.")).toBeInTheDocument();
    expect(within(running).getByRole("progressbar", { name: "Fortschritt der Einrichtung" })).toHaveValue(42);
    // the poll continues until the job is final
    await waitFor(() => expect(screen.getByTestId("enrollment-job")).toHaveAttribute("data-status", "completed"), { timeout: 5000 });
    expect(screen.getByText(/Das Profil wurde aktualisiert, Qualität jetzt/)).toBeInTheDocument();
    const callsAfter = fake.calls.filter((call) => call.path.includes("/enrollments/")).length;
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(fake.calls.filter((call) => call.path.includes("/enrollments/")).length).toBe(callsAfter);
    await user.click(within(screen.getByTestId("enrollment-job")).getByRole("button", { name: "Ausblenden" }));
    expect(screen.queryByTestId("enrollment-job")).toBeNull();
  }, 15_000);

  it("validates the sample count before anything is sent", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ enroll: true }) });
    await user.click(await screen.findByRole("button", { name: "Enrollment starten" }));
    const dialog = await screen.findByRole("dialog", { name: /einlernen/ });
    const samples = within(dialog).getByLabelText("Anzahl Samples");
    for (const bad of ["2", "51", "abc", ""]) {
      await user.clear(samples);
      if (bad) await user.type(samples, bad);
      expect(within(dialog).getByRole("button", { name: "Einrichtung starten" })).toBeDisabled();
    }
    expect(within(dialog).getByText("Bitte eine ganze Zahl zwischen 3 und 50 eingeben.")).toBeInTheDocument();
    expect(validateSampleTarget("3")).toBeNull();
    expect(validateSampleTarget("50")).toBeNull();
    expect(fake.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("shows a failed job honestly and keeps the profile unchanged", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(
      routes({
        "POST /api/v1/voice/profiles/vprof_1/enroll": () => new Response(JSON.stringify(single(job())), { status: 202, headers: { "content-type": "application/json" } }),
        "GET /api/v1/voice/enrollments/venr_01JAAAAAAAAAAAAAAAAAAAAAAA": single(job({ status: "failed", message: "Mikrofon nicht erreichbar", finishedAt: NOW })),
      }),
    );
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ enroll: true }) });
    await user.click(await screen.findByRole("button", { name: "Enrollment starten" }));
    await user.click(within(await screen.findByRole("dialog", { name: /einlernen/ })).getByRole("button", { name: "Einrichtung starten" }));
    const failed = await screen.findByText("Mikrofon nicht erreichbar");
    expect(failed).toBeInTheDocument();
    expect(screen.getByText(/Die Einrichtung wurde nicht abgeschlossen/)).toBeInTheDocument();
  });

  it("shows raw recording off by default; delete history is disabled with the reason when the capability is missing", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    const privacy = (await screen.findByText("Rohaufnahmen speichern")).closest("li") as HTMLElement;
    expect(within(privacy).getByText("Aus")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Voice-History löschen/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Nicht verfügbar: Capability voice.deleteHistory fehlt.");
  });

  it("deletes the voice history only after an explicit confirmation, with confirm=true", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(
      routes({
        "DELETE /api/v1/voice/history": { contractVersion: "2.0.0", accepted: true, status: "completed", correlationId: "corr_01JTESTTESTTESTTESTTESTTES", message: "38 Verlaufseinträge wurden gelöscht." },
      }),
    );
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ deleteHistory: true }) });
    await user.click(await screen.findByRole("button", { name: /Voice-History löschen/ }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Das Löschen ist endgültig und nicht umkehrbar.")).toBeInTheDocument();
    expect(fake.calls.some((call) => call.method === "DELETE")).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(fake.calls.some((call) => call.method === "DELETE")).toBe(true));
    const call = fake.calls.find((entry) => entry.method === "DELETE");
    expect(call?.search).toBe("?confirm=true");
    expect(call?.headers.get("Idempotency-Key")).toBeTruthy();
    expect(await screen.findByText("Voice-History gelöscht")).toBeInTheDocument();
    expect(screen.getByText("38 Verlaufseinträge wurden gelöscht.")).toBeInTheDocument();
  });

  it("keeps the confirmation closed and reports the error when the server refuses", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes({ "DELETE /api/v1/voice/history": () => errorBody("FORBIDDEN", "Für diese Aktion ist mindestens die Rolle owner erforderlich.", 403) }));
    renderWithProviders(<VoicePage />, { fetchImpl: fake.fetch, capabilities: caps({ deleteHistory: true }) });
    await user.click(await screen.findByRole("button", { name: /Voice-History löschen/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByText("Voice-History gelöscht")).toBeNull();
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
