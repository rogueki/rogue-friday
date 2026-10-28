import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "@friday/sdk";
import { redactAuditEvent } from "../src/services/audit-redaction";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const SECRET = "sk-live-9f3b0c1d-do-not-export";
const QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    occurredAt: new Date().toISOString(),
    actor: { type: "user", id: "owner", name: "Owner" },
    category: "security",
    action: "governance.probe",
    severity: "warning",
    result: "success",
    durationMs: 1,
    correlationId: "corr_01M5MT52GK74M713ATWAE820JM",
    source: { adapterId: "control-api", system: "control-api", lastSyncedAt: new Date().toISOString() },
    before: null,
    after: { apiKey: SECRET, qrCode: QR, audioEmbedding: [0.11, 0.22], plain: "sichtbar" },
    artifactIds: [],
    childEventIds: [],
    ...overrides,
  } as unknown as Parameters<TestApi["runtime"]["audit"]["record"]>[0];
}

describe("audit redaction (unit)", () => {
  it("replaces credentials and drops embedding payloads while keeping a visible marker", () => {
    const event = redactAuditEvent(draft() as unknown as AuditEvent);
    const after = event.after as Record<string, unknown>;
    expect(after.apiKey).toBe("[redigiert]");
    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(JSON.stringify(event)).not.toContain("iVBORw0KGgo");
    expect(after).not.toHaveProperty("qrCode");
    expect(after).not.toHaveProperty("audioEmbedding");
    expect(after.plain).toBe("sichtbar");
  });

  it("redacts nested payloads and leaves ordinary fields alone", () => {
    const event = redactAuditEvent(
      draft({
        after: { account: { name: "Mail", accessToken: "ya29.SECRET-TOKEN" }, note: "ok" },
      }) as unknown as AuditEvent,
    );
    expect(JSON.stringify(event)).not.toContain("ya29.SECRET-TOKEN");
    expect((event.after as { account: { name: string; accessToken: string } }).account.name).toBe("Mail");
  });
});

describe("audit export governance", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });

  afterEach(async () => {
    await api.close();
  });

  it("exports redacted while storage keeps the original record and a valid chain", async () => {
    api.runtime.audit.record(draft());
    const appendedRow = api.runtime.db.prepare("SELECT id FROM audit_log WHERE correlation_id = ?").get("corr_01M5MT52GK74M713ATWAE820JM") as { id: string };
    expect(appendedRow.id).toBeTruthy();

    for (const format of ["ndjson", "csv", "json"]) {
      // limit hoch, damit der zuletzt angehaengte Eintrag sicher im Export liegt
      const exported = await owner.get(`/api/v1/audit/export?format=${format}&limit=500`);
      expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.body).not.toContain(SECRET);
      expect(exported.body).not.toContain(QR);
      if (format !== "csv") expect(exported.body).toContain("[redigiert]");
    }

    const stored = api.runtime.db
      .prepare("SELECT json FROM audit_log WHERE correlation_id = ?")
      .get("corr_01M5MT52GK74M713ATWAE820JM") as { json: string } | undefined;
    expect(stored?.json).toContain(SECRET);
    expect(api.runtime.audit.verifyNow().valid).toBe(true);
  });

  it("keeps the export owner-only", async () => {
    const operator = api.client();
    await operator.loginDev("operator");
    const asOperator = await operator.get("/api/v1/audit/export");
    expect(asOperator.statusCode).toBe(403);

    const viewer = api.client();
    await viewer.loginDev("viewer");
    const asViewer = await viewer.get("/api/v1/audit/export");
    expect(asViewer.statusCode).toBe(403);

    const list = await viewer.get("/api/v1/audit/events?limit=5");
    expect(list.statusCode).toBe(200);
  });

  it("shows alerts only when a real notification source delivers them", async () => {
    const overview = await owner.get("/api/v1/overview");
    expect(overview.statusCode).toBe(200);
    const attention = (overview.json().data?.attention ?? []) as Array<{ kind: string }>;
    // In der Testkonfiguration liefert keine Notifications-Quelle P0/P1-Meldungen: es gibt keine erfundenen Alarme.
    expect(attention.filter((entry) => entry.kind === "alert")).toEqual([]);
  });
});