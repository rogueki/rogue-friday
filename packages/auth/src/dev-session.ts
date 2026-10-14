import type { CreatedSession, SessionStore } from './sessions';
import type { Role } from './permissions';

export type DataMode = 'mock' | 'hybrid' | 'live';

export class DevAuthNotAllowedError extends Error {
  constructor(reason: string) {
    super(`dev auth mode refused: ${reason}`);
    this.name = 'DevAuthNotAllowedError';
  }
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

export interface DevAuthContext {
  dataMode: DataMode;
  host: string;
}

/** Dev auth skips the login: only acceptable with synthetic data on a loopback-only listener. */
export function assertDevAuthAllowed(context: DevAuthContext): void {
  if (context.dataMode !== 'mock') throw new DevAuthNotAllowedError(`dataMode is "${context.dataMode}", dev auth requires "mock"`);
  if (!isLoopbackHost(context.host)) throw new DevAuthNotAllowedError(`host "${context.host}" is not loopback`);
}

export interface DevIdentity {
  userId: string;
  username: string;
  role: Role;
  mode: 'dev';
}

/** Fixed identity per role (`dev-owner`, `dev-operator`, `dev-viewer`). */
export function createDevIdentity(role: Role, context: DevAuthContext): DevIdentity {
  assertDevAuthAllowed(context);
  return { userId: `dev-${role}`, username: `dev-${role}`, role, mode: 'dev' };
}

/** Creates a real store-backed session for the dev identity so cookie + CSRF flows behave like production. */
export function issueDevSession(store: SessionStore, role: Role, context: DevAuthContext): CreatedSession & { identity: DevIdentity } {
  const identity = createDevIdentity(role, context);
  return { ...store.create({ userId: identity.userId, role }), identity };
}
