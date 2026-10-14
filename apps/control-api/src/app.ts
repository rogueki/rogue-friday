import "reflect-metadata";
import { NestFactory, HttpAdapterHost } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Server } from "node:http";
import type { FastifyInstance } from "fastify";
import { configureHttp } from "./http/server";
import { ApiPipeline } from "./http/pipeline";
import { createRuntime, type CreateRuntimeOptions } from "./runtime/create-runtime";
import type { Runtime } from "./runtime/types";

/** Injection tokens. Every provider is wired with explicit tokens so the app runs unchanged under tsx and tsup. */
export const RUNTIME = Symbol("RUNTIME");
export const API_PIPELINE = Symbol("API_PIPELINE");
export const HTTP_LAYER = Symbol("HTTP_LAYER");

/**
 * Owns the HTTP wiring and the application's lifetime. Nest calls `onModuleInit` before it listens (routes, hooks and
 * the WebSocket upgrade handler are installed there) and `onApplicationShutdown` for a graceful stop of adapters,
 * sockets and the database.
 */
class HttpLayer {
  constructor(
    private readonly runtime: Runtime,
    private readonly pipeline: ApiPipeline,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter.getInstance() as FastifyInstance;
    const guards = configureHttp(fastify, this.runtime, this.pipeline);
    this.runtime.hub.attach(this.adapterHost.httpAdapter.getHttpServer() as Server, {
      hostAllowed: (request) => guards.hostAllowed(request.headers),
      originAllowed: (request) => guards.originAllowed(request.headers),
      authenticate: (request) => {
        const principal = this.runtime.auth.authenticate(request.headers.cookie);
        return principal ? { userId: principal.userId, role: principal.role, sessionIdHash: principal.session.idHash } : null;
      },
    });
    await this.runtime.start();
  }

  /** Runs first on `app.close()`, before Fastify waits for open connections (WebSockets would block it). */
  async onModuleDestroy(): Promise<void> {
    await this.runtime.hub.disconnectAll();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runtime.close();
  }
}

export interface ControlApi {
  app: NestFastifyApplication;
  runtime: Runtime;
  fastify: FastifyInstance;
}

export interface CreateAppOptions extends CreateRuntimeOptions {
  /** Reuse an existing runtime instead of creating one (tests). */
  runtime?: Runtime;
}

export async function createControlApi(options: CreateAppOptions): Promise<ControlApi> {
  const runtime = options.runtime ?? (await createRuntime(options));

  // A fresh class per app: Nest keys modules by class + metadata, and tests create many apps in one process.
  class AppModule {}
  Module({
    providers: [
      { provide: RUNTIME, useValue: runtime },
      { provide: API_PIPELINE, useFactory: (rt: Runtime) => new ApiPipeline(rt), inject: [RUNTIME] },
      {
        provide: HTTP_LAYER,
        useFactory: (rt: Runtime, pipeline: ApiPipeline, host: HttpAdapterHost) => new HttpLayer(rt, pipeline, host),
        inject: [RUNTIME, API_PIPELINE, HttpAdapterHost],
      },
    ],
  })(AppModule);

  const adapter = new FastifyAdapter({ bodyLimit: 5 * 1024 * 1024, trustProxy: false, routerOptions: { maxParamLength: 256 } } as never);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { logger: false, abortOnError: false });
  return { app, runtime, fastify: adapter.getInstance() as unknown as FastifyInstance };
}
