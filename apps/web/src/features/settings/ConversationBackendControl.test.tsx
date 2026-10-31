// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConversationBackendControl } from "./ConversationBackendControl";

const { mockMutation } = vi.hoisted(() => ({ mockMutation: { mutate: vi.fn(), isPending: false } }));

vi.mock("@/lib/api/domains/voice", () => ({ useSetVoiceConversationKey: () => mockMutation }));

beforeEach(() => {
  mockMutation.mutate.mockReset();
});

it("blockiert Qwen ohne hinterlegten Schlüssel", () => {
  const onSelect = vi.fn();
  const view = render(<ConversationBackendControl value="local" status={{ backend: "local", keyConfigured: false, lastError: null }} readOnly={false} onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText("Gespräch"), { target: { value: "qwen" } });
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Token-Plan-Schlüssel");
  view.unmount();
});

it("gibt Qwen bei hinterlegtem Schlüssel weiter", () => {
  const onSelect = vi.fn();
  const view = render(<ConversationBackendControl value="local" status={{ backend: "local", keyConfigured: true, lastError: null }} readOnly={false} onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText("Gespräch"), { target: { value: "qwen" } });
  expect(onSelect).toHaveBeenCalledWith("qwen");
  view.unmount();
});

it("nennt den Grund, wenn Qwen ausfällt", () => {
  const view = render(<ConversationBackendControl value="qwen" status={{ backend: "qwen", keyConfigured: true, lastError: "quota" }} readOnly={false} onSelect={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toContain("Kontingent aufgebraucht");
  view.unmount();
});

it("nimmt einen neuen Schlüssel erst ab acht Zeichen an", () => {
  const view = render(<ConversationBackendControl value="local" status={{ backend: "local", keyConfigured: false, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  const input = screen.getByLabelText("Alibaba-Token-Plan-Schlüssel");
  const button = screen.getByRole("button", { name: "Prüfen und speichern" }) as HTMLButtonElement;
  fireEvent.change(input, { target: { value: "kurz1" } });
  expect(button.disabled).toBe(true);
  fireEvent.change(input, { target: { value: "good-key-1234" } });
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(mockMutation.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: "good-key-1234" }),
    expect.anything(),
  );
  view.unmount();
});

it("zeigt das Feld bei hinterlegtem Schlüssel erst nach Ersetzen", () => {
  const view = render(<ConversationBackendControl value="qwen" status={{ backend: "qwen", keyConfigured: true, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  expect(screen.queryByLabelText("Alibaba-Token-Plan-Schlüssel")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Schlüssel ersetzen" }));
  expect(screen.getByLabelText("Alibaba-Token-Plan-Schlüssel")).not.toBeNull();
  view.unmount();
});

it("zeigt in der Nur-Lese-Ansicht weder Feld noch Ersetzen-Schaltfläche", () => {
  const view = render(<ConversationBackendControl value="qwen" status={{ backend: "qwen", keyConfigured: true, lastError: null }} readOnly onSelect={vi.fn()} />);
  expect(screen.queryByLabelText("Alibaba-Token-Plan-Schlüssel")).toBeNull();
  expect(screen.queryByRole("button", { name: "Schlüssel ersetzen" })).toBeNull();
  view.unmount();
});

it("zeigt die Ablehnung der Schlüsselprüfung an", () => {
  const view = render(<ConversationBackendControl value="local" status={{ backend: "local", keyConfigured: false, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Alibaba-Token-Plan-Schlüssel"), { target: { value: "good-key-1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Prüfen und speichern" }));
  const callbacks = mockMutation.mutate.mock.calls[0]?.[1] as { onError?: (error: Error) => void } | undefined;
  act(() => {
    callbacks?.onError?.(new Error("Qwen Audio hat den Schlüssel abgelehnt."));
  });
  expect(screen.getByRole("alert").textContent).toContain("Qwen Audio hat den Schlüssel abgelehnt.");
  view.unmount();
});
