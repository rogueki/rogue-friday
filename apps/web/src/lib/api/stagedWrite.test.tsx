import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FridayApiError } from "@friday/sdk";
import {
  StagedWriteConfirmHost,
  useRunStagedWrite,
  useStagedWriteBusy,
} from "@/lib/api/stagedWrite";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/settings", () => ({ useAppSettings: () => ({ settings: undefined, isLoading: false, locale: "de", timeZone: "Europe/Berlin", hour12: false }) }));

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
}));

/** A preview-required FridayApiError as the SDK surfaces it: 403 APPROVAL_REQUIRED with stage `preview` (see stagingOf). */
const previewRequired = (previewId: string, previewText: string): FridayApiError =>
  new FridayApiError(
    {
      code: "APPROVAL_REQUIRED",
      message: "Vorschau erforderlich.",
      severity: "warning",
      retryable: false,
      correlationId: "corr_0000000000000000000000fo1",
      details: { stage: "preview", previewId, previewText },
    },
    403,
  );

function Trigger() {
  const run = useRunStagedWrite();
  const busy = useStagedWriteBusy();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        void run({
          send: async (previewId) => {
            if (!previewId) {
              // A real preview answer arrives after a round trip, long enough for the trigger to render disabled.
              await new Promise((resolve) => setTimeout(resolve, 20));
              // Chromium drops focus from the disabled trigger before the preview answer; jsdom cannot blur a disabled control,
              // so the test moves focus away explicitly - the dialog then opens without the trigger focused.
              (document.querySelector("[data-testid=elsewhere]") as HTMLElement | null)?.focus();
              throw previewRequired("prv_focus", "Auslösen bestätigen?");
            }
            return {};
          },
          successMessage: "Ausgelöst.",
          subject: "Auslösen",
          invalidateKeys: [],
        })
      }
    >
      Auslösen
    </button>
  );
}

it("returns focus to the trigger after the confirmation closes", async () => {
  const user = userEvent.setup();
  renderWithProviders(<><Trigger /><div tabIndex={-1} data-testid="elsewhere">Ablage</div><StagedWriteConfirmHost /></>, {});
  const button = screen.getByRole("button", { name: "Auslösen" });
  await user.click(button);
  await screen.findByRole("alertdialog");
  expect(button).not.toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(button).toHaveFocus(), { timeout: 2000 });
});

