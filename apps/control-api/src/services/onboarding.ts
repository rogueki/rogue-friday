import type { OnboardingState, OnboardingUpdate } from "@friday/sdk";
import type { Db } from "../db/database";
import { conflict, validationFailed } from "../util/errors";

const initialSteps = { intro: "pending", profile: "pending", skills: "pending", accounts: "pending", finish: "pending" } as const;

export class OnboardingService {
  constructor(private readonly db: Db) {}

  get(): OnboardingState {
    const row = this.db.prepare("SELECT revision, json, updated_at FROM owner_onboarding WHERE id = 1")
      .get() as { revision: number; json: string; updated_at: string } | undefined;
    if (!row) return { revision: 0, steps: { ...initialSteps }, goals: [], selectedSkillIds: [], completedAt: null, updatedAt: null };
    const stored = JSON.parse(row.json) as OnboardingState;
    // Older beta clients could complete this step without checking any account. Treat that record as unverified.
    const steps = stored.steps.accounts === "completed" ? { ...stored.steps, accounts: "skipped" as const } : stored.steps;
    return { ...stored, steps, revision: row.revision, updatedAt: row.updated_at };
  }

  put(update: OnboardingUpdate, expectedRevision: number | undefined): OnboardingState {
    if (expectedRevision === undefined) throw validationFailed("If-Match mit der aktuellen Onboarding-Revision ist erforderlich.");
    if (update.steps.accounts === "completed") throw validationFailed("Konten können erst nach einem echten Verbindungstest als eingerichtet gelten. Diesen Schritt vorerst überspringen.");
    const previous = this.get();
    if (previous.revision !== expectedRevision) throw conflict("Onboarding wurde inzwischen geändert.", { currentRevision: previous.revision });
    const updatedAt = new Date().toISOString();
    const complete = Object.values(update.steps).every((step) => step !== "pending");
    const completedAt = complete ? previous.completedAt ?? updatedAt : null;
    const next: OnboardingState = { ...update, revision: expectedRevision + 1, completedAt, updatedAt };
    const result = expectedRevision === 0
      ? this.db.prepare("INSERT INTO owner_onboarding (id, revision, json, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
        .run(next.revision, JSON.stringify(next), updatedAt)
      : this.db.prepare("UPDATE owner_onboarding SET revision = ?, json = ?, updated_at = ? WHERE id = 1 AND revision = ?")
        .run(next.revision, JSON.stringify(next), updatedAt, expectedRevision);
    if (result.changes !== 1) throw conflict("Onboarding wurde inzwischen geändert.", { currentRevision: this.get().revision });
    return next;
  }
}
