import { CONTRACT_VERSION, type OnboardingUpdate, type SkillActivationRequest } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export const skillsHandlers: Partial<Record<OperationId, Handler>> = {
  async listSkills(ctx) {
    const result = await ctx.runtime.skills.list();
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, data: result.skills, catalogError: result.catalogError, hermesError: result.hermesError,
      freshness: { state: result.fresh ? "fresh" : "unknown", asOf: result.fresh ? new Date().toISOString() : null } } };
  },
  async setSkillActivation(ctx) {
    const skill = await ctx.runtime.skills.toggle(ctx.pathParams.id as string, (ctx.body as SkillActivationRequest).enabled);
    ctx.audit.action = "skills.activation_changed";
    ctx.audit.after = { skillId: skill.id, enabled: skill.enabled };
    return { status: 200, body: single(skill) };
  },
  async getOnboarding(ctx) {
    return { status: 200, body: single(ctx.runtime.onboarding.get()) };
  },
  async putOnboarding(ctx) {
    const previousPreferredName = ctx.runtime.onboarding.get().preferredName?.trim();
    const state = ctx.runtime.onboarding.put(ctx.body as OnboardingUpdate, ctx.mutation.ifMatchVersion);
    // The owner nickname is also the live dashboard/session display name. Keep the existing settings version check.
    const preferredName = state.preferredName?.trim();
    if (preferredName && preferredName !== previousPreferredName && preferredName !== ctx.runtime.settings.area("profile").displayName) {
      ctx.runtime.settings.patch({ profile: { ...ctx.runtime.settings.area("profile"), displayName: preferredName } }, ctx.runtime.settings.version());
      ctx.runtime.world?.refresh();
    }
    ctx.audit.action = "onboarding.updated";
    ctx.audit.after = { revision: state.revision, completed: Boolean(state.completedAt) };
    return { status: 200, body: single(state) };
  },
};
