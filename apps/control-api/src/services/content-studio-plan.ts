import { Buffer } from "node:buffer";
import { parseStudioPlan, type ContentPlanState, type StudioPlan } from "@friday/sdk";
import type { Db } from "../db/database";
import { conflict, validationFailed } from "../util/errors";

const MAX_PLAN_BYTES = 2_000_000;

/** SQLite owns the document; revision 0 denotes an empty store. */
export class ContentStudioPlanService {
  constructor(private readonly db: Db) {}

  get(): ContentPlanState {
    const row = this.db.prepare("SELECT revision, json, updated_at FROM content_studio_plan WHERE id = 1")
      .get() as { revision: number; json: string; updated_at: string } | undefined;
    return row
      ? { revision: row.revision, plan: JSON.parse(row.json) as StudioPlan, updatedAt: row.updated_at }
      : { revision: 0, plan: null, updatedAt: null };
  }

  put(value: unknown, expectedRevision: number | undefined): ContentPlanState {
    if (expectedRevision === undefined) throw validationFailed("If-Match mit der aktuellen Planrevision ist erforderlich.", [{ path: "If-Match", message: "erforderlich" }]);
    const serializedInput = JSON.stringify(value);
    if (!serializedInput || Buffer.byteLength(serializedInput, "utf8") > MAX_PLAN_BYTES) {
      throw validationFailed("Der Plan überschreitet 2 MB.");
    }
    let plan: StudioPlan;
    try {
      plan = parseStudioPlan(value);
    } catch (error) {
      throw validationFailed(error instanceof Error ? error.message : "Der Plan ist ungültig.");
    }
    const json = JSON.stringify(plan);
    const updatedAt = new Date().toISOString();
    const nextRevision = expectedRevision + 1;
    const result = expectedRevision === 0
      ? this.db.prepare("INSERT INTO content_studio_plan (id, revision, json, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
        .run(nextRevision, json, updatedAt)
      : this.db.prepare("UPDATE content_studio_plan SET revision = ?, json = ?, updated_at = ? WHERE id = 1 AND revision = ?")
        .run(nextRevision, json, updatedAt, expectedRevision);
    if (result.changes !== 1) throw conflict("Der Plan wurde inzwischen geändert. Bitte neu laden und Änderungen abgleichen.", { currentRevision: this.get().revision });
    return { revision: nextRevision, plan, updatedAt };
  }
}
