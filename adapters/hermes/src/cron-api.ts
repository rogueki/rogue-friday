import { AdapterError } from "@friday/adapter-core";
import type { AuthedClient } from "./clients";

/** Wire shapes of the Hermes cron dashboard API (`hermes_cli/web_routers/cron.py`). */

export interface CronSchedule {
  kind: string;
  expr?: string | null;
  display?: string | null;
  run_at?: string | null;
}

export interface CronRepeat {
  times: number | null;
  completed: number;
}

export interface CronJob {
  id: string;
  name: string;
  prompt?: string;
  skills?: string[];
  model?: string | null;
  provider?: string | null;
  script?: string | null;
  no_agent?: boolean;
  schedule: CronSchedule;
  schedule_display?: string | null;
  repeat?: CronRepeat;
  enabled: boolean;
  state?: string;
  paused_reason?: string | null;
  created_at?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  deliver?: string;
  workdir?: string | null;
  enabled_toolsets?: string[] | null;
  profile_name?: string;
}

export interface CronRun {
  id: string;
  title?: string;
  preview?: string;
  started_at?: number | null;
  ended_at?: number | null;
  input_tokens?: number;
  output_tokens?: number;
  message_count?: number;
  tool_call_count?: number;
}

export interface CronRunList {
  runs: CronRun[];
  limit?: number;
}

export interface CronDeliveryTarget {
  id: string;
  name?: string;
  home_target_set?: boolean;
}

export interface CronJobCreate {
  schedule: string;
  name?: string;
  prompt?: string;
  deliver?: string;
  repeat?: number | string | null;
  skills?: string[] | null;
  model?: string | null;
  provider?: string | null;
  script?: string | null;
  no_agent?: boolean;
  workdir?: string | null;
  paused?: boolean;
  paused_reason?: string | null;
}

const path = (template: string, values: Record<string, string>): string =>
  template.replace(/:([a-z]+)/g, (_, key: string) => encodeURIComponent(values[key] ?? ""));

/**
 * Client for the cron endpoints of the Hermes dashboard. Authenticates with the dashboard session token, exactly like
 * the Kanban API, so no extra credential is needed.
 */
export class CronApi {
  constructor(private readonly client: AuthedClient) {}

  private async send<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    route: string,
    options: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      signal?: AbortSignal;
      retry?: false;
    } = {},
  ): Promise<T> {
    const query = Object.entries(options.query ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&");
    const response = await this.client.request<T>({
      method,
      path: query ? `${route}?${query}` : route,
      body: options.body,
      signal: options.signal,
      ...(options.retry === false ? { retry: false as const } : {}),
    });
    if (response.status >= 400) {
      throw new AdapterError({
        code: response.status === 404 ? "NOT_FOUND" : response.status === 401 ? "UNAUTHENTICATED" : "INTERNAL",
        message: `Hermes-Cron antwortete mit ${response.status}.`,
        retryable: response.status >= 500,
        details: { status: response.status },
      });
    }
    return response.body as T;
  }

  listJobs(profile = "all", signal?: AbortSignal): Promise<CronJob[]> {
    return this.send<CronJob[]>("GET", "/api/cron/jobs", { query: { profile }, signal });
  }

  getJob(id: string, signal?: AbortSignal): Promise<CronJob> {
    return this.send<CronJob>("GET", path("/api/cron/jobs/:id", { id }), { signal });
  }

  listRuns(id: string, limit: number, signal?: AbortSignal): Promise<CronRunList> {
    return this.send<CronRunList>("GET", path("/api/cron/jobs/:id/runs", { id }), { query: { limit }, signal });
  }

  createJob(body: CronJobCreate, signal?: AbortSignal): Promise<CronJob> {
    return this.send<CronJob>("POST", "/api/cron/jobs", { body, signal });
  }

  updateJob(id: string, updates: Record<string, unknown>, signal?: AbortSignal): Promise<CronJob> {
    return this.send<CronJob>("PUT", path("/api/cron/jobs/:id", { id }), { body: { updates }, signal });
  }

  pause(id: string, signal?: AbortSignal): Promise<CronJob> {
    return this.send<CronJob>("POST", path("/api/cron/jobs/:id/pause", { id }), { body: {}, signal });
  }

  resume(id: string, signal?: AbortSignal): Promise<CronJob> {
    return this.send<CronJob>("POST", path("/api/cron/jobs/:id/resume", { id }), { body: {}, signal });
  }

  /**
   * Triggers one run. Deliberately single-attempt: a timeout leaves the outcome unknown, and repeating the call could
   * start the same automation twice. The caller reports the unknown state instead of guessing.
   */
  trigger(id: string, signal?: AbortSignal): Promise<CronJob> {
    return this.send<CronJob>("POST", path("/api/cron/jobs/:id/trigger", { id }), {
      body: {},
      signal,
      retry: false,
    });
  }

  remove(id: string, signal?: AbortSignal): Promise<{ ok?: boolean }> {
    return this.send<{ ok?: boolean }>("DELETE", path("/api/cron/jobs/:id", { id }), { signal });
  }

  deliveryTargets(signal?: AbortSignal): Promise<{ targets: CronDeliveryTarget[] }> {
    return this.send<{ targets: CronDeliveryTarget[] }>("GET", "/api/cron/delivery-targets", { signal });
  }
}