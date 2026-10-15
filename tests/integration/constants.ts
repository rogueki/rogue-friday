/** Shared by the stack launcher and the spec. Test-only credentials of a throw-away instance on loopback. */
export const OWNER_USERNAME = "owner";
export const OWNER_PASSWORD = "integration-only-passphrase";
export const API_PORT = Number(process.env.FRIDAY_INTEGRATION_PORT ?? 3100);
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const CONTROL_ORIGIN = `http://127.0.0.1:${process.env.FRIDAY_FAKE_CONTROL_PORT ?? 43699}`;
