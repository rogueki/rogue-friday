export const ROLES = ['owner', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Mutating / privileged actions. Reads are expressed as `read:<resource>` (see {@link ReadAction}). */
export const WRITE_ACTIONS = [
  'tasks.create',
  'tasks.update',
  'tasks.cancel',
  'tasks.retry',
  'tasks.pause',
  'tasks.resume',
  'agents.pause',
  'agents.resume',
  'agents.stop',
  'approvals.approve',
  'approvals.reject',
  'approvals.requestContext',
  'memory.write',
  'memory.delete',
  'communication.draft',
  'communication.requestSend',
  'calendar.propose',
  'calendar.create',
  'automations.create',
  'automations.update',
  'automations.enable',
  'automations.disable',
  'automations.test',
  'automations.pauseAll',
  'files.delete',
  'voice.test',
  'voice.stop',
  'notifications.ack',
  'notifications.snooze',
  'notifications.resolve',
  'system.healthcheck',
  'system.reconnect',
  'system.restartAdapter',
  'settings.update',
  'settings.import',
  'settings.export',
  'adapters.configure',
  'commands.run',
  'commands.stop',
  'commands.pause',
  'commands.resume',
  'dev.scenarios',
  'audit.export',
] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];

/** `read:tasks`, `read:memory`, ... Every authenticated role may read every resource. */
export type ReadAction = `read:${string}`;
export type Action = WriteAction | ReadAction;

const OPERATOR_ACTIONS: ReadonlySet<WriteAction> = new Set<WriteAction>([
  'tasks.create',
  'tasks.update',
  'tasks.cancel',
  'tasks.retry',
  'tasks.pause',
  'tasks.resume',
  'agents.pause',
  'agents.resume',
  'agents.stop',
  'approvals.approve',
  'approvals.reject',
  'approvals.requestContext',
  'memory.write',
  'memory.delete',
  'communication.draft',
  'communication.requestSend',
  'calendar.propose',
  'automations.create',
  'automations.update',
  'automations.enable',
  'automations.disable',
  'automations.test',
  'automations.pauseAll',
  'files.delete',
  'voice.test',
  'voice.stop',
  'notifications.ack',
  'notifications.snooze',
  'notifications.resolve',
  'commands.run',
  'commands.stop',
  'commands.pause',
  'commands.resume',
]);

/** Owner-only on top of the operator set. */
const OWNER_ONLY_ACTIONS: ReadonlySet<WriteAction> = new Set<WriteAction>([
  'calendar.create',
  'system.healthcheck',
  'system.reconnect',
  'system.restartAdapter',
  'settings.update',
  'settings.import',
  'settings.export',
  'adapters.configure',
  'dev.scenarios',
  'audit.export',
]);

export const DEFAULT_REAUTH_WINDOW_MS = 5 * 60 * 1000;

export type ApprovalTier = 0 | 1 | 2 | 3;
export type ApprovalChannel = 'ui' | 'voice' | 'api';

export interface AuthzContext {
  /** Risk tier of the approval being decided (PLAN §32). Tier 3 needs owner + fresh re-auth, never voice only. */
  approvalTier?: ApprovalTier;
  /** Channel the decision arrives on. Tier 3 is refused on `voice`. */
  channel?: ApprovalChannel;
  /** Epoch ms of the session's last password re-authentication. */
  reauthAt?: number;
  reauthWindowMs?: number;
  now?: number;
  /** `dev.scenarios` is only available when the server runs with the scenario console enabled. */
  devMode?: boolean;
}

export type DenyReason = 'forbidden_role' | 'reauth_required' | 'voice_not_allowed' | 'dev_only' | 'unknown_action';
export type Decision = { allowed: true } | { allowed: false; reason: DenyReason };

export function isReauthFresh(reauthAt: number | undefined, now: number, windowMs = DEFAULT_REAUTH_WINDOW_MS): boolean {
  return reauthAt !== undefined && now - reauthAt >= 0 && now - reauthAt <= windowMs;
}

function isKnownAction(action: string): action is Action {
  return action.startsWith('read:') ? action.length > 5 : (WRITE_ACTIONS as readonly string[]).includes(action);
}

/** Full decision with a machine-readable deny reason; server-side enforcement should use this. */
export function authorize(role: Role, action: Action, context: AuthzContext = {}): Decision {
  if (!isRole(role) || !isKnownAction(action)) return { allowed: false, reason: 'unknown_action' };
  if (action.startsWith('read:')) return { allowed: true };

  const write = action as WriteAction;
  if (write === 'dev.scenarios') {
    if (role !== 'owner') return { allowed: false, reason: 'forbidden_role' };
    return context.devMode === true ? { allowed: true } : { allowed: false, reason: 'dev_only' };
  }
  if (OWNER_ONLY_ACTIONS.has(write)) {
    return role === 'owner' ? { allowed: true } : { allowed: false, reason: 'forbidden_role' };
  }
  if (!OPERATOR_ACTIONS.has(write)) return { allowed: false, reason: 'unknown_action' };
  if (role === 'viewer') return { allowed: false, reason: 'forbidden_role' };

  // Reject and requestContext never execute the action, so only approve is gated on tier 3.
  if (write === 'approvals.approve' && context.approvalTier === 3) {
    if (context.channel === 'voice') return { allowed: false, reason: 'voice_not_allowed' };
    if (role !== 'owner') return { allowed: false, reason: 'forbidden_role' };
    const now = context.now ?? Date.now();
    if (!isReauthFresh(context.reauthAt, now, context.reauthWindowMs)) return { allowed: false, reason: 'reauth_required' };
  }
  return { allowed: true };
}

export function can(role: Role, action: Action, context?: AuthzContext): boolean {
  return authorize(role, action, context).allowed;
}

/** All actions a role may perform without extra context (for UI capability hints). */
export function listAllowedActions(role: Role, context: AuthzContext = {}): WriteAction[] {
  return WRITE_ACTIONS.filter((action) => can(role, action, { ...context, devMode: context.devMode ?? true }));
}
