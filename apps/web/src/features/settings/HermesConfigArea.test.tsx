import { screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { routedFetch, single } from "../memory/kit/testSupport";
import { HermesConfigArea } from "./HermesConfigArea";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams("area=hermesConfig"),
}));

afterEach(() => setApiClient(null));

const CONFIG = "GET /api/v1/settings/hermes-config";
const ACCESS = "GET /api/v1/settings/hermes-access";
const CRON = "GET /api/v1/settings/hermes-cron/jobs";

const CRON_JOBS = {
  profile: "default",
  profileTimezone: "Europe/Berlin",
  storeRevision: "a".repeat(64),
  sourceRevision: "d923a5eb" + "0".repeat(32),
  schedulerRunning: false,
  count: 0,
  jobs: [],
  truncated: false,
};

function statusWith(provider: string, baseUrl: string | null) {
  return {
    installed: true,
    sourceRevision: "d923a5eb" + "0".repeat(32),
    revision: 7,
    checkedAt: "2026-10-14T08:15:00Z",
    fields: [
      { key: "model.provider", type: "string", family: "models", consumer: "x", value: provider,
        explicit: true, writable: true, verification: "unverified", reasonCode: "runtime_receipt_unavailable" },
      { key: "model.default", type: "string", family: "models", consumer: "x", value: "deepseek-v4-pro",
        explicit: true, writable: true, verification: "unverified", reasonCode: "runtime_receipt_unavailable" },
      { key: "model.base_url", type: "string", family: "models", consumer: "x", value: baseUrl,
        explicit: true, writable: true, verification: "unverified", reasonCode: "runtime_receipt_unavailable" },
    ],
    secretStates: [
      { key: "model.api_key", configFileSet: false, effectiveConfigured: null },
      { key: "OPENROUTER_API_KEY", configFileSet: false, effectiveConfigured: null },
      { key: "OPENAI_API_KEY", configFileSet: false, effectiveConfigured: null },
      { key: "ANTHROPIC_API_KEY", configFileSet: false, effectiveConfigured: null },
    ],
    families: [],
    inventory: { scope: "profile", skillsComplete: true, pluginsComplete: true,
      modelProvidersComplete: true, reasons: [] },
    modelProviders: [],
    skills: [],
    plugins: [],
    mcpComplete: true,
    mcpServers: [],
    write: null,
  };
}

function routes(status: ReturnType<typeof statusWith>) {
  return {
    [CONFIG]: () => single(status),
    [ACCESS]: () => single({ providers: [] }),
    [CRON]: () => single(CRON_JOBS),
  };
}

it("keeps the base URL locked with a stated reason until the provider is custom", async () => {
  renderWithProviders(<HermesConfigArea />, { fetchImpl: routedFetch(routes(statusWith("openrouter", null))).fetch });
  const field = await screen.findByLabelText("Basis-URL des eigenen Anbieters");
  expect(field).toBeDisabled();
  expect(field).toHaveAccessibleDescription(/zuerst die Hermes-Anbieterkennung/);
});

it("offers the base URL for the custom provider and explains the key binding", async () => {
  const baseUrl = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
  renderWithProviders(<HermesConfigArea />, { fetchImpl: routedFetch(routes(statusWith("custom", baseUrl))).fetch });
  const field = await screen.findByLabelText("Basis-URL des eigenen Anbieters");
  expect(field).toBeEnabled();
  expect(field).toHaveAttribute("type", "url");
  expect(field).toHaveValue(baseUrl);
  expect(field).toHaveAccessibleDescription(/OPENAI_BASE_URL/);
});
