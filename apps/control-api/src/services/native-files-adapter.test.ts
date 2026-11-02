import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AdapterRegistry, type AdapterFactory, type FileDownload, type FilePort } from "@friday/adapter-core";
import { createCorrelationId } from "@friday/sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNativeFilesFactory, fileIdOf, NATIVE_FILES_PROVIDER_ID, type NativeFileRoot,
} from "./native-files-adapter";

const roots: string[] = [];
const registries: AdapterRegistry[] = [];

function fixture(): { root: string; data: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), "friday-native-files-"));
  roots.push(root);
  return { root, data: join(root, "data"), outside: join(root, "outside") };
}

function write(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const stamp = (path: string, iso: string): void => utimesSync(path, new Date(iso), new Date(iso));

async function openRegistry(factory: AdapterFactory<"files">): Promise<{ registry: AdapterRegistry; port: FilePort }> {
  const registry = new AdapterRegistry({ allowlist: [NATIVE_FILES_PROVIDER_ID] });
  registries.push(registry);
  registry.registerFactory(NATIVE_FILES_PROVIDER_ID, factory);
  await registry.initialize({ mode: "live",
    adapters: { files: { provider: NATIVE_FILES_PROVIDER_ID, enabled: true, retry: false, circuitBreaker: false } } });
  return { registry, port: registry.getPort("files") };
}

const start = (data: string): Promise<{ registry: AdapterRegistry; port: FilePort }> =>
  openRegistry(createNativeFilesFactory(() => data));

const startWith = (data: string, fileRoots: readonly NativeFileRoot[]): Promise<{ registry: AdapterRegistry; port: FilePort }> =>
  openRegistry(createNativeFilesFactory(() => data, fileRoots));

const call = (): { correlationId: string; actor: { type: "user"; id: string } } =>
  ({ correlationId: createCorrelationId(), actor: { type: "user" as const, id: "usr_test" } });

async function readStream(body: FileDownload["body"]): Promise<string> {
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.shutdownAll();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("NativeFilesAdapter", () => {
  it("lists only files of the allowed roots, newest first", async () => {
    const { data } = fixture();
    const presentation = "1a2b3c4d-0000-4000-8000-000000000001.pptx";
    const job = join(data, "content-studio", "jobs", "0f0f0f0f-0000-4000-8000-000000000002");
    write(join(data, "private", "powerpoint", presentation), "PPTX");
    write(join(data, "private", "powerpoint", "1a2b3c4d-0000-4000-8000-000000000001.json"),
      JSON.stringify({ id: "1a2b3c4d-0000-4000-8000-000000000001", title: "Quartalsplan Nordwind", slideCount: 3,
        createdAt: "2026-10-30T10:00:00Z" }));
    // Journal sidecar of the same stem must not show up as a file.
    write(join(data, "private", "powerpoint", `voice-${"a".repeat(64)}.json`), "{}");
    write(join(job, "artifact.mp4"), "MP4");
    write(join(job, "visual.bin"), "BIN");
    write(join(job, "voice.mp3.partial"), "PARTIAL");
    // Secrets and runtime state live next to the roots and must never be listed.
    write(join(data, "auth.key"), "KEY");
    write(join(data, "dashboard.sqlite"), "DB");
    write(join(data, ".env"), "ENV");
    write(join(data, "config", "adapters.yaml"), "yaml: true");
    write(join(data, "memory", "outbox.sqlite"), "DB");
    write(join(data, "private", "secret.txt"), "SECRET");
    write(join(data, "logs", "api.log"), "LOG");
    stamp(join(data, "private", "powerpoint", presentation), "2026-10-30T10:00:00Z");
    stamp(join(job, "artifact.mp4"), "2026-10-31T10:00:00Z");

    const { port } = await start(data);
    const page = await port.listFiles({}, call());
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.name)).toEqual(["artifact.mp4", "Quartalsplan Nordwind.pptx"]);
    expect(page.pageInfo.totalCount).toBe(2);

    const [video, deck] = page.items;
    expect(deck?.id).toBe(fileIdOf("powerpoint", presentation));
    expect(deck?.id).toMatch(/^file_[0-9A-Za-z]{26}$/);
    expect(deck?.category).toBe("presentations");
    expect(deck?.location).toBe("Präsentationen");
    expect(deck?.tags).toEqual(["powerpoint"]);
    expect(deck?.mimeType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(deck?.previewKind).toBe("none");
    expect(deck?.sizeBytes).toBe(4);
    expect(deck?.version).toBe(1);
    expect(deck?.taskId).toBeNull();
    expect(deck?.checksum).toBeNull();
    expect(deck?.source.adapterId).toBe("friday-files");
    expect(video?.category).toBe("generated");
    expect(video?.location).toBe("Content Studio/0f0f0f0f-0000-4000-8000-000000000002");
    expect(video?.mimeType).toBe("video/mp4");

    for (const item of page.items) {
      for (const forbidden of ["auth", "sqlite", ".env", "secret", "adapters", "api.log"]) {
        expect(item.name.toLocaleLowerCase("de")).not.toContain(forbidden);
        expect(item.location.toLocaleLowerCase("de")).not.toContain(forbidden);
      }
    }

    const again = await port.listFiles({}, call());
    expect(again.items.map((item) => item.id)).toEqual(page.items.map((item) => item.id));
  });

  it("filters by category, tag, keyword and pages with a cursor", async () => {
    const { data } = fixture();
    const job = join(data, "content-studio", "jobs", "0f0f0f0f-0000-4000-8000-000000000002");
    write(join(data, "private", "powerpoint", "eins.pptx"), "1");
    write(join(data, "private", "powerpoint", "zwei.pptx"), "2");
    write(join(data, "private", "powerpoint", "drei.pptx"), "3");
    write(join(job, "artifact.mp4"), "MP4");
    stamp(join(data, "private", "powerpoint", "eins.pptx"), "2026-10-01T10:00:00Z");
    stamp(join(data, "private", "powerpoint", "zwei.pptx"), "2026-10-02T10:00:00Z");
    stamp(join(data, "private", "powerpoint", "drei.pptx"), "2026-10-03T10:00:00Z");
    stamp(join(job, "artifact.mp4"), "2026-10-04T10:00:00Z");

    const { port } = await start(data);
    expect((await port.listFiles({ category: ["presentations"] }, call())).items).toHaveLength(3);
    expect((await port.listFiles({ tag: "content-studio" }, call())).items.map((item) => item.name))
      .toEqual(["artifact.mp4"]);
    // The keyword is matched case-insensitively against name, location and tags.
    expect((await port.listFiles({ q: "ARTIFACT" }, call())).items.map((item) => item.name))
      .toEqual(["artifact.mp4"]);
    const noTask = await port.listFiles({ taskId: "task_00000000000000000000000000" }, call());
    expect(noTask.items).toHaveLength(0);
    expect(noTask.pageInfo.totalCount).toBe(0);

    const first = await port.listFiles({ limit: 2 }, call());
    expect(first.items).toHaveLength(2);
    expect(first.pageInfo.totalCount).toBe(4);
    expect(first.pageInfo.hasNextPage).toBe(true);
    const second = await port.listFiles({ limit: 2, cursor: first.pageInfo.nextCursor }, call());
    expect(second.items).toHaveLength(2);
    expect(second.pageInfo.hasNextPage).toBe(false);
    expect(second.pageInfo.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(4);
    await expect(port.listFiles({ cursor: "kaputt" }, call())).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects ids outside the allowed roots and path traversal", async () => {
    const { data, outside } = fixture();
    write(join(data, "auth.key"), "KEY");
    write(join(outside, "leak.pptx"), "LEAK");
    mkdirSync(join(data, "private", "powerpoint"), { recursive: true });
    const { port } = await start(data);

    for (const id of ["../../auth.key", "file_../../../../etc/passwd", fileIdOf("powerpoint", "../../auth.key"),
      fileIdOf("powerpoint", "..\\..\\auth.key")])
      await expect(port.getFile({ id }, call())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(port.downloadFile!({ id: "file_00000000000000000000000000" }, call()))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    // A junction inside a root points outside the data dir and must be skipped, never followed.
    symlinkSync(outside, join(data, "private", "powerpoint", "escape"), "junction");
    expect((await port.listFiles({}, call())).items.map((item) => item.name)).not.toContain("leak.pptx");
    await expect(port.getFile({ id: fileIdOf("powerpoint", "escape/leak.pptx") }, call()))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    let linked = false;
    try {
      symlinkSync(join(outside, "leak.pptx"), join(data, "private", "powerpoint", "link.pptx"), "file");
      linked = true;
    } catch {
      // Windows without the symlink privilege.
    }
    if (linked)
      expect((await port.listFiles({}, call())).items.map((item) => item.name)).not.toContain("link.pptx");

    // The root itself is a junction: nothing below it may be listed.
    const second = fixture();
    mkdirSync(join(second.data, "content-studio"), { recursive: true });
    mkdirSync(join(second.outside, "job"), { recursive: true });
    write(join(second.outside, "job", "artifact.mp4"), "x");
    symlinkSync(second.outside, join(second.data, "content-studio", "jobs"), "junction");
    const escaped = await start(second.data);
    expect((await escaped.port.listFiles({}, call())).items).toHaveLength(0);
  });

  it("previews text, markdown and images within the size caps and downloads the bytes", async () => {
    const { data } = fixture();
    const markdown = "# Plan\n\nInhalt";
    write(join(data, "docs", "notiz.txt"), "a".repeat(5000));
    write(join(data, "docs", "plan.md"), markdown);
    write(join(data, "docs", "bild.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    write(join(data, "docs", "folien.pptx"), "PPTX");
    const { port } = await startWith(data, [
      { key: "docs", relativePath: ["docs"], label: "Dokumente", category: "reports",
        extensions: [".txt", ".md", ".png", ".pptx"] },
    ]);
    expect((await port.listFiles({}, call())).items).toHaveLength(4);

    const notiz = await port.getFilePreview!({ id: fileIdOf("docs", "notiz.txt") }, call());
    expect(notiz.data.kind).toBe("text");
    expect(notiz.data.contentType).toBe("text/plain");
    expect(notiz.data.sandboxed).toBe(true);
    expect(notiz.data.truncated).toBe(true);
    expect(notiz.data.text).toHaveLength(4000);

    const planId = fileIdOf("docs", "plan.md");
    const plan = await port.getFilePreview!({ id: planId }, call());
    expect(plan.data.kind).toBe("markdown");
    expect(plan.data.text).toBe(markdown);
    expect(plan.data.truncated).toBe(false);

    const bild = await port.getFilePreview!({ id: fileIdOf("docs", "bild.png") }, call());
    expect(bild.data.kind).toBe("image");
    expect(bild.data.url).toBe(`/api/v1/files/${fileIdOf("docs", "bild.png")}/download`);
    expect(bild.data.truncated).toBe(false);

    const folien = await port.getFilePreview!({ id: fileIdOf("docs", "folien.pptx") }, call());
    expect(folien.data.kind).toBe("none");

    const download = await port.downloadFile!({ id: planId }, call());
    expect(download.filename).toBe("plan.md");
    expect(download.contentType).toBe("text/markdown");
    expect(download.sizeBytes).toBe(Buffer.byteLength(markdown));
    expect(await readStream(download.body)).toBe(markdown);
    await expect(port.downloadFile!({ id: planId, version: 2 }, call()))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is read-only and online for a readable data dir", async () => {
    const { root, data } = fixture();
    mkdirSync(data, { recursive: true });
    const { registry, port } = await start(data);
    const adapters = registry.listAdapters();
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.provider).toBe(NATIVE_FILES_PROVIDER_ID);
    expect(adapters[0]?.manifest.name).toBe("Friday-Dateien (lokal)");
    expect(adapters[0]?.health.status).toBe("online");
    expect(registry.aggregateCapabilities().modules.files)
      .toMatchObject({ read: true, preview: true, download: true, delete: false, upload: false, rename: false });
    const id = "file_00000000000000000000000000";
    await expect(port.deleteFile!({ id } as never, call() as never)).rejects.toMatchObject({ code: "CAPABILITY_MISSING" });
    await expect(port.renameFile!({ id } as never, call() as never)).rejects.toMatchObject({ code: "CAPABILITY_MISSING" });

    const missing = new AdapterRegistry({ allowlist: [NATIVE_FILES_PROVIDER_ID] });
    registries.push(missing);
    missing.registerFactory(NATIVE_FILES_PROVIDER_ID, createNativeFilesFactory(() => join(root, "fehlt")));
    await missing.initialize({ mode: "live",
      adapters: { files: { provider: NATIVE_FILES_PROVIDER_ID, enabled: true, retry: false, circuitBreaker: false } } });
    const health = await missing.checkHealth(NATIVE_FILES_PROVIDER_ID);
    expect(health.status).not.toBe("online");
    expect(health.lastError?.code).toBe("DATA_DIR_UNAVAILABLE");
  });

  it("is refused in mock mode", async () => {
    const { data } = fixture();
    const registry = new AdapterRegistry({ allowlist: [NATIVE_FILES_PROVIDER_ID] });
    registries.push(registry);
    registry.registerFactory(NATIVE_FILES_PROVIDER_ID, createNativeFilesFactory(() => data));
    const report = await registry.initialize({ mode: "mock",
      adapters: { files: { provider: NATIVE_FILES_PROVIDER_ID, enabled: true, retry: false, circuitBreaker: false } } });
    expect(report[0]?.error).toBeDefined();
  });
});
