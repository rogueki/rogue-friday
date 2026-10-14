import { http, HttpResponse, type HttpHandler } from "msw";
import { handleApiRequest, type ApiHandlerOptions } from "../api/handler";
import { ROUTES, type HttpMethod } from "../api/routes";
import { MockApiError } from "../core/errors";
import type { MockWorld } from "../world/world";

export interface MswHandlerOptions extends ApiHandlerOptions {
  /**
   * Origin of the API, e.g. `http://127.0.0.1:3100`. Empty/undefined matches any origin (`*` wildcard), which is what
   * the browser app (same origin) and Node tests (absolute URLs) need.
   */
  baseUrl?: string;
}

const METHOD_FACTORY: Record<HttpMethod, (path: string, resolver: (info: { request: Request }) => Promise<Response>) => HttpHandler> = {
  GET: (path, resolver) => http.get(path, resolver),
  POST: (path, resolver) => http.post(path, resolver),
  PATCH: (path, resolver) => http.patch(path, resolver),
  PUT: (path, resolver) => http.put(path, resolver),
  DELETE: (path, resolver) => http.delete(path, resolver),
};

/**
 * One msw handler per contract route (every operation of the OpenAPI document) plus a catch-all that answers unknown
 * `/api/v1/*` paths with a contract error. All of them delegate to the same MockWorld services as any other transport.
 */
export function createMswHandlers(world: MockWorld, options: MswHandlerOptions = {}): HttpHandler[] {
  const origin = (options.baseUrl ?? "").replace(/\/+$/, "") || "*";
  const resolve = ({ request }: { request: Request }): Promise<Response> => handleApiRequest(world, request, options);
  const handlers = ROUTES.map((route) => METHOD_FACTORY[route.method](`${origin}/api/v1${route.path}`, resolve));
  handlers.push(
    http.all(`${origin}/api/v1/*`, ({ request }) => {
      const error = new MockApiError({ code: "NOT_FOUND", message: `Die Route ${request.method} ${new URL(request.url).pathname} existiert nicht.` });
      return HttpResponse.json(error.toResponse(world.id("corr")), { status: 404 });
    }),
  );
  return handlers;
}
