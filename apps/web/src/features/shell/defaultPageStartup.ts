import { defaultPageRedirect } from "./navModel";

export interface DefaultPageStartupState {
  initialPathname: string;
  handled: boolean;
}

export interface DefaultPageStartupInput {
  pathname: string;
  settingsReady: boolean;
  onboardingRequired: boolean;
  onboardingPending: boolean;
  onboardingVisible: boolean;
  defaultPage: string | undefined;
  contentStudioEnabled: boolean;
}

/** Apply a saved start page once, and only for a session that began on the home route. */
export function resolveDefaultPageStartup(
  state: DefaultPageStartupState,
  input: DefaultPageStartupInput,
): { state: DefaultPageStartupState; redirectTo: string | null } {
  if (state.handled) return { state, redirectTo: null };

  // A deep link or navigation away before settings arrive is an explicit route choice.
  if (state.initialPathname !== "/" || input.pathname !== "/") {
    return { state: { ...state, handled: true }, redirectTo: null };
  }
  if (!input.settingsReady || (input.onboardingRequired && input.onboardingPending) || input.onboardingVisible) {
    return { state, redirectTo: null };
  }

  return {
    state: { ...state, handled: true },
    redirectTo: defaultPageRedirect("/", input.defaultPage, input.contentStudioEnabled),
  };
}
