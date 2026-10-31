import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linuxEnrollmentApi, type LinuxEnrollmentStatus } from "@/lib/api/domains/linuxEnrollment";
import { LinuxEnrollment } from "./LinuxEnrollment";

vi.mock("@/lib/api/domains/linuxEnrollment", () => ({
  linuxEnrollmentApi: {
    status: vi.fn(),
    addSample: vi.fn(),
    train: vi.fn(),
  },
}));

function enrollmentStatus(overrides: Partial<LinuxEnrollmentStatus> = {}): LinuxEnrollmentStatus {
  return {
    contractVersion: "2.0.0",
    available: true,
    state: "pending",
    phrase: "Hey Friday",
    shortPhrase: null,
    counts: { wake: 0, short: 0, negatives: 0, speech: 0 },
    required: { wake: 1, short: 0, negatives: 0, speech: 0 },
    error: null,
    ...overrides,
  };
}

describe("LinuxEnrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(linuxEnrollmentApi.status).mockResolvedValue(enrollmentStatus());
  });

  it("lädt den Status und sendet eine Probe über die SDK-Domain", async () => {
    const capture = vi.fn().mockResolvedValue("cGNt");
    vi.mocked(linuxEnrollmentApi.addSample).mockResolvedValue(
      enrollmentStatus({ counts: { wake: 1, short: 0, negatives: 0, speech: 0 } }),
    );

    render(<LinuxEnrollment capture={capture} />);

    expect(await screen.findByText("Browser-Stimme einrichten")).toBeTruthy();
    await waitFor(() => expect(linuxEnrollmentApi.status).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Einrichten" }));
    fireEvent.click(await screen.findByRole("button", { name: "Probe aufnehmen (Aktivierungsphrase)" }));

    await waitFor(() => expect(linuxEnrollmentApi.addSample).toHaveBeenCalledWith({ kind: "wake", pcmBase64: "cGNt" }));
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
