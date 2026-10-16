const KEY = "friday-onboarding-later";

export function snoozeOnboarding(): void { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(KEY, "1"); }
export function clearOnboardingSnooze(): void { if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(KEY); }
export function isOnboardingSnoozed(): boolean { return typeof sessionStorage !== "undefined" && sessionStorage.getItem(KEY) === "1"; }
