import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistantName } from "@/features/branding/useAssistantName";
import { setApiClient } from "@/lib/api/client";
import { AppSettingsProvider } from "@/lib/settings";
import { capabilitiesOf, jsonResponse, renderWithProviders } from "@/test/render";
import { SettingsPage } from "./SettingsPage";
import { settingsHelpFor } from "./SettingsHelp";
import { createFakeApi, makeSettings, type FakeApiOptions } from "./testApi";

// The pages load several resources through the fake API; slow CI machines need more than the 1 s default.
configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 20_000 });

const nav = vi.hoisted(() => ({ search: "area=profile", replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

function BrandProbe() {
  return <output data-testid="brand">{useAssistantName()}</output>;
}

function setup(options: FakeApiOptions & { area?: string } = {}) {
  nav.search = options.area ?? "area=profile";
  const api = createFakeApi(options);
  const view = renderWithProviders(
    <AppSettingsProvider enabled>
      <BrandProbe />
      <SettingsPage />
    </AppSettingsProvider>,
    { fetchImpl: api.fetchImpl, capabilities: capabilitiesOf({ system: { read: true } }) },
  );
  return { api, ...view };
}

const saveButton = () => screen.getByRole("button", { name: "Speichern" });

it("shows an unsupported legacy messenger account and lets the owner select the only deliverable account", async () => {
  const user = userEvent.setup();
  const settings = makeSettings();
  settings.notifications.channels.push({ kind: "telegram", enabled: true, minPriority: "P2", accountId: "old-profile" });
  const { api } = setup({ area: "area=notifications", settings });
  const account = await screen.findByRole("combobox", { name: "Konto-ID" });
  expect(account).toHaveValue("old-profile");
  expect(screen.getByRole("option", { name: /old-profile.*nicht unterstützt/ })).toBeInTheDocument();
  await user.selectOptions(account, "default");
  await user.click(saveButton());
  await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(1));
  expect(api.find("PATCH", "/settings")[0]?.body).toMatchObject({ notifications: { channels: [
    { kind: "dashboard" }, { kind: "telegram", enabled: true, accountId: "default" },
  ] } });
});

beforeEach(() => {
  nav.replace.mockClear();
  nav.push.mockClear();
});
afterEach(() => { setApiClient(null); vi.unstubAllGlobals(); });

it("saves only the selected city and preserves other unsaved dashboard changes", async () => {
  const user = userEvent.setup();
  const { api, unmount } = setup({ area: "area=dashboard", extra: ({ path }) => path === "/location/search" ? Response.json({ data: { items: [
    { label: "Berlin", region: "Berlin", country: "Deutschland", countryCode: "DE", latitude: 52.52, longitude: 13.41 },
  ] } }) : undefined });
  await user.click(await screen.findByRole("switch", { name: "Kompakte Darstellung" }));
  await user.type(screen.getByRole("textbox", { name: "Stadt oder Postleitzahl" }), "10115");
  await user.click(screen.getByRole("button", { name: "Ort suchen" }));
  await user.click(await screen.findByRole("button", { name: "Berlin, Berlin, Deutschland" }));
  await user.click(screen.getByRole("button", { name: "Standort übernehmen und speichern" }));
  await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(1));
  expect(api.find("PATCH", "/settings")[0]?.ifMatch).toBe("3");
  expect(api.find("PATCH", "/settings")[0]?.body).toMatchObject({ dashboard: { compact: false, location: { label: "Berlin, Berlin, Deutschland", latitude: 52.52, longitude: 13.41 } } });
  expect(api.state.settings.dashboard.compact).toBe(false);
  expect(screen.getByRole("switch", { name: "Kompakte Darstellung" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "Speichern" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(2));
  expect(api.find("PATCH", "/settings")[1]?.ifMatch).toBe("4");
  expect(api.state.settings.dashboard).toMatchObject({ compact: true, location: { label: "Berlin, Berlin, Deutschland" } });
  unmount();
  setup({ area: "area=dashboard", settings: api.state.settings });
  expect(await screen.findByText("Gespeichert: Berlin, Berlin, Deutschland")).toBeInTheDocument();
});

it("keeps a chosen city available after a version conflict and saves it on retry", async () => {
  const user = userEvent.setup();
  const { api } = setup({ area: "area=dashboard", conflictOnce: true, extra: ({ path }) => path === "/location/search" ? Response.json({ data: { items: [
    { label: "Köln", country: "Deutschland", countryCode: "DE", latitude: 50.94, longitude: 6.96 },
  ] } }) : undefined });
  await user.type(await screen.findByRole("textbox", { name: "Stadt oder Postleitzahl" }), "Köln");
  await user.click(screen.getByRole("button", { name: "Ort suchen" }));
  await user.click(await screen.findByRole("button", { name: "Köln, Deutschland" }));
  await user.click(screen.getByRole("button", { name: "Standort übernehmen und speichern" }));
  expect(await screen.findByText(/zwischenzeitlich geändert/)).toBeInTheDocument();
  expect(screen.getByText("Ausgewählt: Köln, Deutschland")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Standort übernehmen und speichern" }));
  await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(2));
  expect(api.state.settings.dashboard.location?.label).toBe("Köln, Deutschland");
});

describe("profile and assistant name", () => {
  it("renames the assistant live: the brand reads the saved name without a reload, PATCH carries If-Match", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    expect(await screen.findByLabelText("Name des Assistenten")).toHaveValue("F.R.I.D.A.Y.");
    expect(screen.getByTestId("brand")).toHaveTextContent("F.R.I.D.A.Y.");

    await user.clear(screen.getByLabelText("Name des Assistenten"));
    await user.type(screen.getByLabelText("Name des Assistenten"), "Friday");
    expect(await screen.findByText("Ungespeicherte Änderungen")).toBeInTheDocument();
    // nothing is applied before saving
    expect(screen.getByTestId("brand")).toHaveTextContent("F.R.I.D.A.Y.");

    await user.click(saveButton());
    await waitFor(() => expect(screen.getByTestId("brand")).toHaveTextContent("Friday"));
    const patch = api.find("PATCH", "/settings")[0];
    expect(patch?.ifMatch).toBe("3");
    expect(patch?.body).toMatchObject({ profile: { assistantName: "Friday", displayName: "Erik Brandt" } });
    expect(await screen.findByText(/Alle Änderungen gespeichert/)).toBeInTheDocument();
  });

  it("an empty name removes the optional field so clients fall back to the default", async () => {
    const user = userEvent.setup();
    const { api } = setup({ settings: makeSettings({ profile: { ...makeSettings().profile, assistantName: "Friday" } }) });
    await user.clear(await screen.findByLabelText("Name des Assistenten"));
    await user.click(saveButton());
    await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(1));
    const body = api.find("PATCH", "/settings")[0]?.body as { profile: Record<string, unknown> };
    expect("assistantName" in body.profile).toBe(false);
    await waitFor(() => expect(screen.getByTestId("brand")).toHaveTextContent("F.R.I.D.A.Y."));
  });

  it("shows the unsaved indicator and discards the draft", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText("Anzeigename"), "X");
    expect(screen.getByRole("img", { name: "Ungespeicherte Änderungen" })).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Alle verwerfen" }));
    expect(screen.queryByRole("img", { name: "Ungespeicherte Änderungen" })).toBeNull();
    expect(screen.getByLabelText("Anzeigename")).toHaveValue("Erik Brandt");
    expect(saveButton()).toBeDisabled();
  });

  it("explains a 409 conflict and saves after the reload", async () => {
    const user = userEvent.setup();
    const { api } = setup({ conflictOnce: true });
    await user.type(await screen.findByLabelText("Anzeigename"), "X");
    await user.click(saveButton());
    expect(await screen.findAllByText(/zwischenzeitlich geändert/)).not.toHaveLength(0);
    await user.click(saveButton());
    await waitFor(() => expect(screen.getByText(/Alle Änderungen gespeichert/)).toBeInTheDocument());
    expect(api.find("PATCH", "/settings")).toHaveLength(2);
  });
});

describe("role gating", () => {
  it("is read-only for a viewer: no input is editable and nothing can be saved", async () => {
    setup({ role: "viewer" });
    expect(await screen.findByText(/Nur lesend: Mit der Rolle „Betrachter“/)).toBeInTheDocument();
    expect(screen.getByLabelText("Anzeigename")).toBeDisabled();
    expect(screen.getByLabelText("Name des Assistenten")).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Einstellungen importieren" })).toBeDisabled();
  });
});

describe("navigation settings", () => {
  it("reorders menus with the keyboard-accessible buttons, hides one and saves the whole area", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=navigation" });
    await user.click(await screen.findByRole("button", { name: "Aufgaben nach oben" }));
    const rows = screen.getAllByRole("listitem").filter((li) => li.classList.contains("st-nav__row"));
    expect(rows[0]).toHaveTextContent("Aufgaben");
    expect(rows[1]).toHaveTextContent("Übersicht");

    await user.click(screen.getByRole("switch", { name: "Gedächtnis im Menü anzeigen" }));
    await user.click(saveButton());
    await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(1));
    const navigation = (api.find("PATCH", "/settings")[0]?.body as { navigation: { order: string[]; hidden: string[]; defaultPage: string } }).navigation;
    expect(navigation.order.slice(0, 3)).toEqual(["tasks", "overview", "activity"]);
    expect(navigation.order).toHaveLength(18);
    expect(navigation.order).toContain("content-studio");
    expect(navigation.order).toContain("skills");
    expect(navigation.hidden).toEqual(["memory"]);
  });

  it("keeps Einstellungen reachable: its visibility switch is locked", async () => {
    setup({ area: "area=navigation" });
    expect(await screen.findByRole("switch", { name: "Einstellungen im Menü anzeigen" })).toBeDisabled();
  });
});

describe("adapters (schema-generated form)", () => {
  it("masks secrets, sends them only write-only and clears the input after saving", async () => {
    const user = userEvent.setup();
    const { api, container } = setup({ area: "area=adapters&adapter=mock-communication" });
    const form = await waitFor(() => {
      const element = container.querySelector('[data-adapter-form="mock-communication"]');
      if (!element) throw new Error("form missing");
      return element as HTMLElement;
    });
    expect(within(form).getByText("gesetzt")).toBeInTheDocument();
    const secret = within(form).getByLabelText("Neuer Wert für IMAP-Passwort") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.value).toBe("");

    await user.type(secret, "neues-passwort");
    await user.clear(within(form).getByLabelText(/IMAP-Server/));
    await user.type(within(form).getByLabelText(/IMAP-Server/), "imap.neu.example");
    await user.click(within(form).getByRole("button", { name: "Konfiguration speichern" }));

    await waitFor(() => expect(api.find("PATCH", "/settings/adapters/mock-communication")).toHaveLength(1));
    const call = api.find("PATCH", "/settings/adapters/mock-communication")[0];
    // The adapter's own revision, not the settings version (they drift apart after any adapter change).
    expect(call?.ifMatch).toBe("7");
    expect(call?.body).toMatchObject({ enabled: true, config: { imapHost: "imap.neu.example", latencyMs: 0 }, secrets: { imapPassword: "neues-passwort" } });
    // the secret must never travel inside `config`
    expect(JSON.stringify((call?.body as { config: unknown }).config)).not.toContain("neues-passwort");
    await waitFor(() => expect(secret.value).toBe(""));
    expect(container.innerHTML).not.toContain("neues-passwort");
  });

  it("blocks saving a form that violates the schema", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=adapters&adapter=mock-communication" });
    const host = await screen.findByLabelText(/IMAP-Server/);
    await user.clear(host);
    expect(await screen.findByText("Pflichtfeld")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Konfiguration speichern" })).toBeDisabled();
    expect(api.find("PATCH", "/settings/adapters/mock-communication")).toHaveLength(0);
  });

  it("tests the connection of the stored configuration through POST /settings/adapters/{id}/test", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=adapters&adapter=mock-communication" });
    await user.click(await screen.findByRole("button", { name: "Verbindung testen" }));
    expect(await screen.findByText("Erfolgreich")).toBeInTheDocument();
    expect(screen.getByText("Verbindung erfolgreich getestet.")).toBeInTheDocument();
    expect(api.find("POST", "/settings/adapters/mock-communication/test")).toHaveLength(1);
  });

  it("is owner-only: a viewer sees an explanation instead of credentials", async () => {
    const { api } = setup({ area: "area=adapters", role: "viewer" });
    expect(await screen.findByText("Nur für Eigentümer")).toBeInTheDocument();
    expect(api.find("GET", "/settings/adapters")).toHaveLength(0);
  });
});

describe("theme editor", () => {
  it("rejects a corrupted theme before anything is sent and keeps the default theme", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=theme" });
    const field = await screen.findByLabelText("Theme-JSON");
    await user.click(field);
    await user.paste('{ "id": "kaputt", "name": "Kaputt", "tokens": { "color.primary": "rot" }, "orb": {}, "panels": {} }');
    await user.click(screen.getByRole("button", { name: "Prüfen und importieren" }));
    expect(await screen.findByText("Theme ungültig, nichts wurde importiert:")).toBeInTheDocument();
    expect(screen.getByText("Das bisherige beziehungsweise das Standard-Theme bleibt aktiv.")).toBeInTheDocument();
    expect(api.find("POST", "/settings/themes/import")).toHaveLength(0);
  });

  it("imports a valid theme and activates it", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=theme" });
    const field = await screen.findByLabelText("Theme-JSON");
    await user.click(field);
    await user.paste(
      JSON.stringify({
        id: "mein-theme",
        name: "Mein Theme",
        tokens: { "color.primary": "#22d3ee", "color.background": "#050b14" },
        orb: { preset: "gold", particleDensity: 0.7, fragmentDensity: 0.8, glowIntensity: 0.8, motionSpeed: 1, mouseParallax: true },
        panels: { cornerStyle: "technical-cut", borderIntensity: 0.5, backgroundOpacity: 0.8 },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Prüfen und importieren" }));
    await waitFor(() => expect(api.find("POST", "/settings/themes/import")).toHaveLength(1));
    expect(api.find("POST", "/settings/themes/import")[0]?.body).toMatchObject({ activate: true, theme: { id: "mein-theme", builtIn: false } });
    expect(await screen.findByText("Theme „Mein Theme“ importiert")).toBeInTheDocument();
  });

  it("edits sliders into the draft and stores them with one PATCH", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=theme" });
    const slider = (await screen.findByLabelText("Cyan-Intensität")) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.6" } });
    expect(await screen.findByText("Ungespeicherte Änderungen")).toBeInTheDocument();
    await user.click(saveButton());
    await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(1));
    const theme = (api.find("PATCH", "/settings")[0]?.body as { theme: { cyanIntensity: number; activeThemeId: string } }).theme;
    expect(theme.cyanIntensity).toBeCloseTo(0.6);
    expect(theme.activeThemeId).toBe("friday-navy-cyan");
  });
});

describe("settings export and import", () => {
  it("validates an imported file against the schema before the confirmation", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const input = await screen.findByLabelText("Einstellungsdatei auswählen");
    const invalid = new File(['{ "settings": 1 }'], "x.json", { type: "application/json" });
    await user.upload(input, invalid);
    expect(await screen.findByText("Datei ungültig")).toBeInTheDocument();
    expect(api.find("POST", "/settings/import")).toHaveLength(0);
  });

  it("imports a valid export after confirmation", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    const input = await screen.findByLabelText("Einstellungsdatei auswählen");
    const document = {
      contractVersion: "2.0.0",
      exportedAt: "2026-10-14T08:00:00Z",
      settings: { approvals: makeSettings().approvals },
      themes: [],
      layouts: [],
    };
    await user.upload(input, new File([JSON.stringify(document)], "settings.json", { type: "application/json" }));
    expect(await screen.findByText("Einstellungen importieren?")).toBeInTheDocument();
    expect(screen.getByText("1 Einstellungsbereiche")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Importieren" }));
    await waitFor(() => expect(api.find("POST", "/settings/import")).toHaveLength(1));
    expect(api.find("POST", "/settings/import")[0]?.body).toMatchObject({ settings: { approvals: { defaultExpiryMinutes: 60 } } });
  });
});

describe("settings help", () => {
  it("shows the help of the open area only after pressing Hilfe", async () => {
    const user = userEvent.setup();
    setup();
    const open = await screen.findByRole("button", { name: "Hilfe" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Hilfe" })).toBeNull();

    await user.click(open);
    const close = screen.getByRole("button", { name: "Hilfe schließen" });
    expect(close).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "Hilfe" });
    const first = settingsHelpFor("profile")[0];
    expect(first).toBeDefined();
    expect(within(region).getByRole("heading", { name: first!.title })).toBeInTheDocument();

    await user.click(close);
    expect(screen.queryByRole("region", { name: "Hilfe" })).toBeNull();
    expect(screen.getByRole("button", { name: "Hilfe" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("voice devices", () => {
  const device = (id: string, name: string, kind: "input" | "output", isDefault = false) => ({
    id, name, kind, isDefault, channels: 1, sampleRateHz: 48000, version: 1, createdAt: "2026-10-14T08:00:00Z",
    updatedAt: "2026-10-14T08:00:00Z", labels: ["MME"], status: "online",
    source: { adapterId: "friday-voice-http", system: "friday-voice", externalId: id, lastSyncedAt: "2026-10-14T08:00:00Z" },
  });
  const HEADSET_IN = device(`vdev_${"a".repeat(26)}`, "Headset-Mikrofon", "input");
  const LAPTOP_IN = device(`vdev_${"b".repeat(26)}`, "Laptop-Mikrofon", "input", true);
  const HEADSET_OUT = device(`vdev_${"c".repeat(26)}`, "Headset-Hörer", "output", true);
  const devices = (call: { method: string; path: string }) => call.method === "GET" && call.path === "/voice/devices"
    ? jsonResponse({ contractVersion: "2.0.0", items: [HEADSET_IN, LAPTOP_IN, HEADSET_OUT], pageInfo: { nextCursor: null, hasNextPage: false },
      freshness: { state: "fresh", asOf: "2026-10-14T08:00:00Z" }, sources: [] })
    : undefined;
  const withInput = (inputDeviceId: string) => makeSettings({ voice: { ...makeSettings().voice, inputDeviceId } });

  it("shows exactly one input and one output selection with the saved device active and saves a new output", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=voice", settings: withInput(HEADSET_IN.id), extra: devices });
    const input = await screen.findByLabelText("Eingabegerät");
    await waitFor(() => expect(input).toHaveValue(HEADSET_IN.id));
    expect(screen.getAllByLabelText("Eingabegerät")).toHaveLength(1);
    expect(screen.getAllByLabelText("Ausgabegerät")).toHaveLength(1);
    // System default plus one entry per physical device, not one per host API.
    expect(within(input).getAllByRole("option")).toHaveLength(3);
    const output = screen.getByLabelText("Ausgabegerät");
    expect(within(output).getAllByRole("option")).toHaveLength(2);

    await user.selectOptions(output, HEADSET_OUT.id);
    await user.click(saveButton());
    await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(1));
    expect(api.find("PATCH", "/settings")[0]?.body).toMatchObject({ voice: { inputDeviceId: HEADSET_IN.id, outputDeviceId: HEADSET_OUT.id } });
  });

  it("keeps an unplugged saved device selected and names it instead of switching silently", async () => {
    const unplugged = `vdev_${"d".repeat(26)}`;
    setup({ area: "area=voice", settings: withInput(unplugged), extra: devices });
    const input = await screen.findByLabelText("Eingabegerät");
    await waitFor(() => expect(input).toHaveValue(unplugged));
    const selected = within(input).getAllByRole("option").find((option) => (option as HTMLOptionElement).selected);
    expect(selected?.textContent).toBe("Gewähltes Gerät nicht verbunden");
  });
});

describe("conversation settings", () => {
  it("shows silence and proactive announcements and saves both", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=voice" });
    const silence = await screen.findByRole("slider", { name: "Stille bis Gesprächsende" });
    expect(silence).toHaveValue("20");
    const proactive = screen.getByRole("switch", { name: "Ergebnisse von sich aus ansagen" });
    expect(proactive).toBeChecked();

    fireEvent.change(silence, { target: { value: "45" } });
    await user.click(proactive);
    await user.click(saveButton());
    await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(1));
    expect(api.find("PATCH", "/settings")[0]?.body).toMatchObject({ voice: { conversationSilenceSeconds: 45, proactiveAnnouncements: false } });
  });

  it("saves the Qwen region of the Token Plan", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=voice" });
    await user.selectOptions(await screen.findByLabelText("Qwen-Region"), "cn-beijing");
    await user.click(saveButton());
    await waitFor(() => expect(api.find("PATCH", "/settings")).toHaveLength(1));
    expect(api.find("PATCH", "/settings")[0]?.body).toMatchObject({ voice: { conversationRegion: "cn-beijing" } });
  });
});

describe("voice sample", () => {
  it("posts to /voice/sample when the owner asks for a sample", async () => {
    const user = userEvent.setup();
    const { api } = setup({ area: "area=voice", extra: ({ method, path }) => method === "POST" && path === "/voice/sample"
      ? Response.json({ contractVersion: "2.0.0", accepted: true })
      : undefined });
    await user.click(await screen.findByRole("button", { name: "Hörprobe" }));
    await waitFor(() => expect(api.find("POST", "/voice/sample")).toHaveLength(1));
  });

  it("shows the service message when the sample cannot be played", async () => {
    const user = userEvent.setup();
    setup({ area: "area=voice", extra: ({ method, path }) => method === "POST" && path === "/voice/sample"
      ? Response.json({ error: { code: "ADAPTER_UNAVAILABLE", message: "Der Sprachdienst ist derzeit nicht erreichbar." } }, { status: 503 })
      : undefined });
    await user.click(await screen.findByRole("button", { name: "Hörprobe" }));
    await waitFor(() => expect(screen.getAllByRole("alert").map((node) => node.textContent))
      .toContain("Der Sprachdienst ist derzeit nicht erreichbar."));
  });

  it("disables the sample until a changed voice is saved", async () => {
    const user = userEvent.setup();
    setup({ area: "area=voice" });
    const voice = await screen.findByLabelText("Stimme (TTS)") as HTMLSelectElement;
    await user.selectOptions(voice, voice.value === "classic" ? "friday-female" : "classic");
    expect(screen.getByRole("button", { name: "Hörprobe" })).toBeDisabled();
    expect(screen.getByText(/Erst speichern/)).toBeInTheDocument();
  });
});
