import { describe, expect, it } from "vitest";
import { resolveDefaultPageStartup, type DefaultPageStartupInput, type DefaultPageStartupState } from "./defaultPageStartup";

const ready: DefaultPageStartupInput = {
  pathname: "/",
  settingsReady: true,
  onboardingRequired: false,
  onboardingPending: false,
  onboardingVisible: false,
  defaultPage: "tasks",
  contentStudioEnabled: false,
};

const state = (initialPathname = "/"): DefaultPageStartupState => ({ initialPathname, handled: false });

describe("resolveDefaultPageStartup", () => {
  it("waits for settings, then honors the saved start page once", () => {
    const waiting = resolveDefaultPageStartup(state(), { ...ready, settingsReady: false });
    expect(waiting).toMatchObject({ redirectTo: null, state: { handled: false } });

    const startup = resolveDefaultPageStartup(waiting.state, ready);
    expect(startup).toMatchObject({ redirectTo: "/tasks", state: { handled: true } });
    // After the redirect, choosing Overview later is a user route change, not another startup.
    expect(resolveDefaultPageStartup(startup.state, { ...ready, pathname: "/" })).toMatchObject({ redirectTo: null, state: { handled: true } });
  });

  it("does not apply a start page to an initial deep link or later home navigation", () => {
    const initial = resolveDefaultPageStartup(state("/calendar"), { ...ready, pathname: "/calendar" });
    expect(initial).toMatchObject({ redirectTo: null, state: { handled: true } });
    expect(resolveDefaultPageStartup(initial.state, ready)).toMatchObject({ redirectTo: null, state: { handled: true } });
  });

  it("lets pending and visible onboarding take precedence over the saved route", () => {
    const pending = resolveDefaultPageStartup(state(), { ...ready, onboardingRequired: true, onboardingPending: true });
    expect(pending).toMatchObject({ redirectTo: null, state: { handled: false } });
    const visible = resolveDefaultPageStartup(pending.state, { ...ready, onboardingRequired: true, onboardingVisible: true });
    expect(visible).toMatchObject({ redirectTo: null, state: { handled: false } });
    expect(resolveDefaultPageStartup(visible.state, ready)).toMatchObject({ redirectTo: "/tasks", state: { handled: true } });
  });

  it("keeps a navigation made before settings become ready", () => {
    const moved = resolveDefaultPageStartup(state(), { ...ready, settingsReady: false, pathname: "/overview" });
    expect(moved).toMatchObject({ redirectTo: null, state: { handled: true } });
  });
});
