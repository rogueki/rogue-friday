// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SttModelsControl } from "./SttModelsControl";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/lib/api/domains/sttModels", () => ({
  sttModelsApi: {
    status: mocks.status,
    download: mocks.download,
    cancel: mocks.cancel,
  },
}));

afterEach(() => vi.resetAllMocks());

it("lists cached models and downloads only on an explicit click without applying settings", async () => {
  const models = [{ id: "base", cached: true, downloadable: true }, { id: "small", cached: false, downloadable: true },
    { id: "large-v3", cached: true, downloadable: true }];
  const onSelect = vi.fn();
  mocks.status.mockResolvedValue({ localMode: true, models, job: null });
  mocks.download.mockResolvedValue({ localMode: true, models, job: null });
  const view = render(<SttModelsControl selected="small" language="de" readOnly={false} onSelect={onSelect} />);
  expect(await screen.findByText(/base: lokal vorhanden/)).toBeTruthy();
  expect(mocks.download).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Auswählen" })[1]!);
  expect(onSelect).toHaveBeenCalledWith("large-v3");
  fireEvent.click(screen.getAllByRole("button", { name: "Herunterladen" })[0]!);
  await waitFor(() => expect(mocks.download).toHaveBeenCalledWith("small"));
  expect(mocks.cancel).not.toHaveBeenCalled();
  view.unmount();
});

it("shows the chosen model and can return to the installed model", async () => {
  const models = [{ id: "small", cached: true, downloadable: true }, { id: "medium", cached: false, downloadable: true }];
  const onSelect = vi.fn();
  mocks.status.mockResolvedValue({ localMode: true, models, job: null });
  const view = render(<SttModelsControl selected="small" language="de" readOnly={false} onSelect={onSelect} />);
  expect(await screen.findByText(/ausgewählt/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Installiertes Modell übernehmen" }));
  expect(onSelect).toHaveBeenCalledWith(null);
  expect(screen.queryByRole("button", { name: "Auswählen" })).toBeNull();
  view.unmount();
});
