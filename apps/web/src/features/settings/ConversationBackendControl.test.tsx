// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConversationBackendControl } from "./ConversationBackendControl";

const { mockMutation, mockAdopt, mockCheck } = vi.hoisted(() => ({
  mockMutation: { mutate: vi.fn(), isPending: false },
  mockAdopt: { mutate: vi.fn(), isPending: false },
  mockCheck: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/lib/api/domains/voice", () => ({
  useSetVoiceConversationKey: () => mockMutation,
  useAdoptVoiceConversationKeyFromBrain: () => mockAdopt,
  useCheckVoiceConversationKey: () => mockCheck,
}));

beforeEach(() => {
  mockMutation.mutate.mockReset();
  mockAdopt.mutate.mockReset();
  mockCheck.mutate.mockReset();
});

it("blockiert Qwen ohne hinterlegten Schlüssel", () => {
  const onSelect = vi.fn();
  const view = render(<ConversationBackendControl value="local" consent={false} status={{ backend: "local", keyConfigured: false, consent: false, lastError: null }} readOnly={false} onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText("Gespräch"), { target: { value: "qwen" } });
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Token-Plan-Schlüssel");
  view.unmount();
});

it("gibt Qwen bei hinterlegtem Schlüssel und Zustimmung weiter", () => {
  const onSelect = vi.fn();
  const view = render(<ConversationBackendControl value="local" consent={true} status={{ backend: "local", keyConfigured: true, consent: true, lastError: null }} readOnly={false} onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText("Gespräch"), { target: { value: "qwen" } });
  expect(onSelect).toHaveBeenCalledWith("qwen", true);
  view.unmount();
});

it("nennt den Grund, wenn Qwen ausfällt", () => {
  const view = render(<ConversationBackendControl value="qwen" consent={true} status={{ backend: "qwen", keyConfigured: true, consent: true, lastError: "quota" }} readOnly={false} onSelect={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toContain("Kontingent aufgebraucht");
  view.unmount();
});

it("nimmt einen neuen Schlüssel erst ab acht Zeichen an", () => {
  const view = render(<ConversationBackendControl value="local" consent={false} status={{ backend: "local", keyConfigured: false, consent: false, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
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
  const view = render(<ConversationBackendControl value="qwen" consent={true} status={{ backend: "qwen", keyConfigured: true, consent: true, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  expect(screen.queryByLabelText("Alibaba-Token-Plan-Schlüssel")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Schlüssel ersetzen" }));
  expect(screen.getByLabelText("Alibaba-Token-Plan-Schlüssel")).not.toBeNull();
  view.unmount();
});

it("zeigt in der Nur-Lese-Ansicht weder Feld noch Ersetzen-Schaltfläche", () => {
  const view = render(<ConversationBackendControl value="qwen" consent={true} status={{ backend: "qwen", keyConfigured: true, consent: true, lastError: null }} readOnly onSelect={vi.fn()} />);
  expect(screen.queryByLabelText("Alibaba-Token-Plan-Schlüssel")).toBeNull();
  expect(screen.queryByRole("button", { name: "Schlüssel ersetzen" })).toBeNull();
  view.unmount();
});

it("zeigt die Ablehnung der Schlüsselprüfung an", () => {
  const view = render(<ConversationBackendControl value="local" consent={false} status={{ backend: "local", keyConfigured: false, consent: false, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Alibaba-Token-Plan-Schlüssel"), { target: { value: "good-key-1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Prüfen und speichern" }));
  const callbacks = mockMutation.mutate.mock.calls[0]?.[1] as { onError?: (error: Error) => void } | undefined;
  act(() => {
    callbacks?.onError?.(new Error("Qwen Audio hat den Schlüssel abgelehnt."));
  });
  expect(screen.getByRole("alert").textContent).toContain("Qwen Audio hat den Schlüssel abgelehnt.");
  view.unmount();
});

it("asks for consent when selecting Qwen with a stored key but no consent", () => {
  const onSelect = vi.fn();
  const view = render(<ConversationBackendControl value="local" consent={false} status={{ backend: "local", keyConfigured: true, consent: false, lastError: null }} readOnly={false} onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText("Gespräch"), { target: { value: "qwen" } });
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Zustimmung zur Datenübertragung");
  view.unmount();
});

it("selects Qwen with consent after ticking the checkbox", () => {
  const onSelect = vi.fn();
  const view = render(<ConversationBackendControl value="local" consent={false} status={{ backend: "local", keyConfigured: true, consent: false, lastError: null }} readOnly={false} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Gespräch"), { target: { value: "qwen" } });
  expect(onSelect).toHaveBeenCalledWith("qwen", true);
  view.unmount();
});

it("withdraws consent and switches to local when unticking while Qwen is active", () => {
  const onSelect = vi.fn();
  const view = render(<ConversationBackendControl value="qwen" consent={true} status={{ backend: "qwen", keyConfigured: true, consent: true, lastError: null }} readOnly={false} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(onSelect).toHaveBeenCalledWith("local", false);
  view.unmount();
});

it("saves a withdrawn consent also while the conversation is local", () => {
  const onSelect = vi.fn();
  const view = render(<ConversationBackendControl value="local" consent={true} status={{ backend: "local", keyConfigured: true, consent: true, lastError: null }} readOnly={false} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(onSelect).toHaveBeenCalledWith("local", false);
  view.unmount();
});

it("shows that Qwen waits for consent when the service reports no consent", () => {
  const view = render(<ConversationBackendControl value="qwen" consent={false} status={{ backend: "qwen", keyConfigured: true, consent: false, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toContain("wartet auf deine Zustimmung");
  view.unmount();
});

it("hides the consent checkbox in read-only mode", () => {
  const view = render(<ConversationBackendControl value="qwen" consent={false} status={{ backend: "qwen", keyConfigured: true, consent: false, lastError: null }} readOnly onSelect={vi.fn()} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  view.unmount();
});

it("blocks the key check while the region change is unsaved", () => {
  const view = render(<ConversationBackendControl value="local" consent={false} status={{ backend: "local", keyConfigured: false, consent: false, lastError: null }} readOnly={false} regionPending onSelect={vi.fn()} />);
  expect(screen.getByRole("alert").textContent).toContain("Zuerst die geänderte Region speichern");
  const input = screen.getByLabelText("Alibaba-Token-Plan-Schlüssel");
  const button = screen.getByRole("button", { name: "Prüfen und speichern" }) as HTMLButtonElement;
  fireEvent.change(input, { target: { value: "good-key-123" } });
  expect(button.disabled).toBe(true);
  view.unmount();
});

it("übernimmt den Schlüssel des Denkmodells und bestätigt das Speichern", () => {
  const view = render(<ConversationBackendControl value="local" consent={false} status={{ backend: "local", keyConfigured: false, consent: false, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Schlüssel des Denkmodells übernehmen" }));
  expect(mockAdopt.mutate).toHaveBeenCalledWith({}, expect.anything());
  const callbacks = mockAdopt.mutate.mock.calls[0]?.[1] as { onSuccess?: () => void } | undefined;
  act(() => {
    callbacks?.onSuccess?.();
  });
  expect(screen.getByText("Schlüssel gespeichert.")).not.toBeNull();
  view.unmount();
});

it("zeigt die Meldung des Denkmodell-Schlüssels an", () => {
  const view = render(<ConversationBackendControl value="local" consent={false} status={{ backend: "local", keyConfigured: false, consent: false, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Schlüssel des Denkmodells übernehmen" }));
  const callbacks = mockAdopt.mutate.mock.calls[0]?.[1] as { onError?: (error: Error) => void } | undefined;
  act(() => {
    callbacks?.onError?.(new Error("Das Denkmodell nutzt keinen Alibaba Token Plan."));
  });
  expect(screen.getByRole("alert").textContent).toContain("Das Denkmodell nutzt keinen Alibaba Token Plan.");
  view.unmount();
});

it("prüft die gespeicherte Qwen-Audio-Verbindung und meldet Erfolg", () => {
  const view = render(<ConversationBackendControl value="qwen" consent={true} status={{ backend: "qwen", keyConfigured: true, consent: true, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  expect(mockCheck.mutate).toHaveBeenCalledWith({}, expect.anything());
  const callbacks = mockCheck.mutate.mock.calls[0]?.[1] as { onSuccess?: (result: { ok: true; reason: null }) => void } | undefined;
  act(() => {
    callbacks?.onSuccess?.({ ok: true, reason: null });
  });
  expect(screen.getByText("Verbindung zu Qwen Audio in Ordnung.")).not.toBeNull();
  view.unmount();
});

it("meldet ein aufgebrauchtes Kontingent bei der Verbindungsprüfung", () => {
  const view = render(<ConversationBackendControl value="qwen" consent={true} status={{ backend: "qwen", keyConfigured: true, consent: true, lastError: null }} readOnly={false} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Verbindung prüfen" }));
  expect(mockCheck.mutate).toHaveBeenCalledWith({}, expect.anything());
  const callbacks = mockCheck.mutate.mock.calls[0]?.[1] as { onSuccess?: (result: { ok: false; reason: "quota" }) => void } | undefined;
  act(() => {
    callbacks?.onSuccess?.({ ok: false, reason: "quota" });
  });
  expect(screen.getByText("Qwen Audio: Kontingent aufgebraucht.")).not.toBeNull();
  view.unmount();
});
