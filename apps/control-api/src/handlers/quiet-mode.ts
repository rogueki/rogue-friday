import {
  CONTRACT_VERSION,
  type QuietHoursRequest,
  type QuietModeRequest,
  type QuietModeResponse,
  type QuietModeState,
  type QuietModeSummary,
  type QuietModeSummaryResponse,
  type QuietNoticeRequest,
  type QuietNoticeResponse,
  type QuietNoticeResult,
} from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";

const envelope = <T>(data: T) => ({
  contractVersion: CONTRACT_VERSION,
  data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() },
});

const response = (data: QuietModeState): QuietModeResponse => envelope(data);
const summaryResponse = (data: QuietModeSummary): QuietModeSummaryResponse => envelope(data);
const noticeResponse = (data: QuietNoticeResult): QuietNoticeResponse => envelope(data);

export const quietModeHandlers: Partial<Record<OperationId, Handler>> = {
  async getQuietMode(ctx) {
    return { status: 200, body: response(ctx.runtime.quietMode.state()) };
  },
  async setQuietMode(ctx) {
    const { until, level } = ctx.body as QuietModeRequest;
    const data = ctx.runtime.quietMode.set(until, level);
    ctx.audit.action = "notifications.quiet_mode_set";
    ctx.audit.after = { until: data.until, level: data.level };
    return { status: 200, body: response(data) };
  },
  async clearQuietMode(ctx) {
    const data = ctx.runtime.quietMode.clear();
    ctx.audit.action = "notifications.quiet_mode_cleared";
    return { status: 200, body: response(data) };
  },
  async getQuietModeSummary(ctx) {
    return { status: 200, body: summaryResponse(ctx.runtime.quietMode.summary()) };
  },
  async recordQuietNotice(ctx) {
    const body = ctx.body as QuietNoticeRequest;
    const data = await ctx.runtime.quietMode.notice(body);
    ctx.audit.action = "notifications.quiet_notice";
    // Never audit the notice title or text, only its classification and outcome.
    ctx.audit.after = { class: body.class, delivery: data.delivery };
    return { status: 200, body: noticeResponse(data) };
  },
  async setQuietHours(ctx) {
    const body = ctx.body as QuietHoursRequest;
    const data = ctx.runtime.quietMode.setSchedule(body);
    ctx.audit.action = "notifications.quiet_hours_set";
    ctx.audit.after = { enabled: body.enabled, from: body.from, to: body.to };
    return { status: 200, body: response(data) };
  },
};
