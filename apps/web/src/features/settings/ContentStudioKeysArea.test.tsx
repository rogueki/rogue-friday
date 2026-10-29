import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { capabilitiesOf, jsonResponse, renderWithProviders } from "@/test/render";
import { ContentStudioKeysArea } from "./ContentStudioKeysArea";
import { createFakeApi } from "./testApi";

vi.mock("./SettingsDrafts", () => ({ useSettingsDrafts: () => ({ readOnly: false }) }));

type KeyState = { kie: boolean; elevenlabs: boolean; capcut: boolean };

function setup(data: KeyState) {
  const api = createFakeApi({
    extra: (call) => call.method === "GET" && call.path === "/settings/content-studio-keys"
      ? jsonResponse({ contractVersion: "2.0.0", data })
      : undefined,
  });
  const view = renderWithProviders(<ContentStudioKeysArea />, { fetchImpl: api.fetchImpl, capabilities: capabilitiesOf({ system: { read: true } }) });
  return { api, ...view };
}

describe("ContentStudioKeysArea", () => {
  it("only offers key fields for providers that are actually connected", async () => {
    setup({ kie: false, elevenlabs: false, capcut: false });

    expect(await screen.findByLabelText("kie.ai API-Schlüssel")).toBeTruthy();
    expect(screen.getByLabelText("ElevenLabs API-Schlüssel")).toBeTruthy();
    expect(screen.queryByLabelText("CapCut API-Schlüssel")).toBeNull();
    expect(await screen.findByText("Nicht angebunden")).toBeTruthy();
  });

  it("keeps an old CapCut key removable without a key field", async () => {
    setup({ kie: false, elevenlabs: false, capcut: true });

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Gespeicherten Schlüssel löschen" })).toHaveLength(3));
    const capcutEntry = screen.getByText("CapCut").closest(".st-studio-key") as HTMLElement;
    expect(within(capcutEntry).queryByLabelText("CapCut API-Schlüssel")).toBeNull();
    expect(within(capcutEntry).getByRole("button", { name: "Gespeicherten Schlüssel löschen" })).toBeTruthy();
  });
});
