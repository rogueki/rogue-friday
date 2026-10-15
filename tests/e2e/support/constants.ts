/** Shared by the stack launcher, the Playwright config and the specs. Test-only values of a throw-away loopback instance. */
export const API_PORT = Number(process.env.FRIDAY_E2E_PORT ?? 3200);
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const API_BASE = `${API_ORIGIN}/api/v1`;
/** Dev accounts of the mock-mode Control API without a configured owner hash (apps/control-api/README.md). */
export const DEV_PASSWORD = "dev";
export type DevRole = "owner" | "operator" | "viewer";
export const devUser = (role: DevRole): string => `dev-${role}`;
/** Fixed mock seed so seed data (tasks, approvals, ...) is identical on every run. */
export const MOCK_SEED = 42;
