// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConversationBackendControl } from "./ConversationBackendControl";

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
