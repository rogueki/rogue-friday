// @vitest-environment jsdom
import type { VoiceStatus } from "@friday/sdk";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { VoiceModeControl } from "./VoiceModeControl";

const { mockStart } = vi.hoisted(() => ({ mockStart: { mutate: vi.fn(), isPending: false } }));

vi.mock("@/lib/api/domains/voice", () => ({ useStartVoiceModeSwitch: () => mockStart }));

const status = (overrides: Partial<VoiceStatus>): VoiceStatus => ({ voiceMode: "local", ...overrides }) as VoiceStatus;

beforeEach(() => {
  mockStart.mutate.mockReset();
});

it("shows the current mode and asks before opening the installer for the other mode", () => {
  const view = render(<VoiceModeControl status={status({ voiceMode: "local" })} readOnly={false} />);
  expect(screen.getByText(/^Aktuell: Lokal/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Zu ElevenLabs wechseln" }));

  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText(/Administratorrechten/)).toBeInTheDocument();
  expect(within(dialog).getByText(/an ElevenLabs gesendet/)).toBeInTheDocument();
  expect(mockStart.mutate).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Installer öffnen" }));
  expect(mockStart.mutate).toHaveBeenCalledWith({ target: "elevenlabs" }, expect.anything());
  view.unmount();
});

it("waits for the new mode after the installer opened and reports the finished change", () => {
  mockStart.mutate.mockImplementation((_vars, options: { onSuccess: () => void }) => options.onSuccess());
  const view = render(<VoiceModeControl status={status({ voiceMode: "elevenlabs" })} readOnly={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Zu lokaler Stimme wechseln" }));
  expect(within(screen.getByRole("alertdialog")).getByText(/mindestens 6 GB/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Installer öffnen" }));
  expect(screen.getByText(/Windows-Abfrage bestätigen/)).toBeInTheDocument();
  // A cancelled UAC prompt must not lock the owner out: the button stays usable.
  expect(screen.getByRole("button", { name: "Zu lokaler Stimme wechseln" })).toBeEnabled();

  view.rerender(<VoiceModeControl status={status({ voiceMode: "local" })} readOnly={false} />);
  expect(screen.getByText("Wechsel abgeschlossen.")).toBeInTheDocument();
  expect(screen.getByText(/^Aktuell: Lokal/)).toBeInTheDocument();
  view.unmount();
});

it("shows the error of a failed start and offers no switch for viewers, Linux hosts or older services", () => {
  mockStart.mutate.mockImplementation((_vars, options: { onError: (error: Error) => void }) =>
    options.onError(new Error("Der Installer fehlt im Installationsordner.")));
  const view = render(<VoiceModeControl status={status({ voiceMode: "local" })} readOnly={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Zu ElevenLabs wechseln" }));
  fireEvent.click(screen.getByRole("button", { name: "Installer öffnen" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Der Installer fehlt im Installationsordner.");
  view.unmount();

  const viewer = render(<VoiceModeControl status={status({ voiceMode: "local" })} readOnly />);
  expect(screen.getByRole("button", { name: "Zu ElevenLabs wechseln" })).toBeDisabled();
  viewer.unmount();

  const linux = render(<VoiceModeControl status={status({ voiceMode: "local", audioPath: { transport: "browser", host: "linux" } })} readOnly={false} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText(/neue Installation/)).toBeInTheDocument();
  linux.unmount();

  const older = render(<VoiceModeControl status={status({ voiceMode: undefined })} readOnly={false} />);
  expect(screen.getByText(/meldet den Sprachbetrieb nicht/)).toBeInTheDocument();
  older.unmount();
});
