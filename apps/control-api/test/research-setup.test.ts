import { createServer } from "node:http";
import { expect, it } from "vitest";
import {
  LOCAL_RESEARCH_ENDPOINT,
  PINNED_RESEARCH_IMAGE,
  ResearchSetupService,
  localProbe,
} from "../src/services/research-setup";

it("probes queryless JSON capability without dispatching a search", async () => {
  let mode: "json" | "disabled" | "html" | "wrong" | "redirect" = "json";
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    if (mode === "json")
      response.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"No query"}');
    if (mode === "disabled") response.writeHead(403, { "Content-Type": "text/html" }).end("disabled");
    if (mode === "html")
      response.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Other service</h1>");
    if (mode === "wrong")
      response.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"Different"}');
    if (mode === "redirect") response.writeHead(302, { Location: "http://127.0.0.1/private" }).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const endpoint = `http://127.0.0.1:${address.port}/`;
    expect(await localProbe(endpoint)).toBe(true);
    mode = "disabled";
    expect(await localProbe(endpoint)).toBe(false);
    mode = "html";
    expect(await localProbe(endpoint)).toBe(false);
    mode = "wrong";
    expect(await localProbe(endpoint)).toBe(false);
    mode = "redirect";
    expect(await localProbe(endpoint)).toBe(false);
    expect(paths).toEqual(Array(5).fill("/search?format=json"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("requires the running container to match the pinned image before claiming setup success", async () => {
  const setup = new ResearchSetupService(
    "unused",
    async () => ({
      service: "active",
      http: "ready",
      endpoint: LOCAL_RESEARCH_ENDPOINT,
      image: PINNED_RESEARCH_IMAGE,
      imageVerified: false,
    }),
    async () => true,
  );
  expect(await setup.status()).toMatchObject({ state: "stopped", reason: "WRONG_IMAGE" });
  await expect(setup.install()).rejects.toThrow("nicht erreichbar");
});

it("reports an installation timeout as uncertain so the owner can inspect status before retry", async () => {
  const setup = new ResearchSetupService("unused", async () => {
    throw new Error("research_setup_timeout");
  });
  await expect(setup.install()).rejects.toThrow("kann noch laufen");
});
