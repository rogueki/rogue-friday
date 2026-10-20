"use client";

import type { AutomationRun, components } from "@friday/sdk";
import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import { Button } from "@friday/ui";
import { FlaskConical, Wand2 } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { useRunStagedWrite, useStagedWriteBusy } from "@/lib/api/stagedWrite";
import { useCapability } from "@/lib/capabilities";
import { TextArea } from "../memory/kit/fields";
import { RunDetail } from "./RunHistory";
import { ACTION_TONE } from "./labels";

type AutomationRunResponse = components["schemas"]["AutomationRunResponse"];

/** Builds nested mock data (`thread.priority` -> `{ thread: { priority } }`) from the conditions that compare for equality. */
export function sampleFromConditions(automation: Pick<Automation, "conditions">): Record<string, unknown> {
  const sample: Record<string, unknown> = {};
  for (const condition of automation.conditions) {
    if (condition.operator !== "eq" && condition.operator !== "contains" && condition.operator !== "in") continue;
    const path = condition.field.split(".").filter(Boolean);
    const last = path.pop();
    if (!last) continue;
    let cursor = sample;
    for (const segment of path) {
      const next = cursor[segment];
      cursor = next !== null && typeof next === "object" ? (next as Record<string, unknown>) : (cursor[segment] = {}) as Record<string, unknown>;
    }
    const value = condition.value as unknown;
    cursor[last] = condition.operator === "in" && Array.isArray(value) ? value[0] : value;
  }
  return sample;
}

/**
 * Dry run with mock data (PLAN §35.3): the trigger is evaluated against the sample, conditions and actions are walked through
 * as `simulated`, nothing is executed. Only `dryRun: true` is ever sent from here.
 */
export function TestPanel({ automation }: { automation: Automation }) {
  const { t } = useT();
  const canTest = useCapability("automations", "test");
  const runStagedWrite = useRunStagedWrite();
  const stagedBusy = useStagedWriteBusy();
  const [text, setText] = useState(() => JSON.stringify(sampleFromConditions(automation), null, 2));
  const [error, setError] = useState<string | undefined>();
  const [run, setRun] = useState<AutomationRun | null>(null);

  const start = (): void => {
    let sample: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text.trim() === "" ? "{}" : text) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      sample = parsed as Record<string, unknown>;
    } catch {
      setError(t("automations.test.invalid"));
      return;
    }
    setError(undefined);
    // A dry run is a write like any other: the server stages the exact sample and the confirmation binds it.
    void runStagedWrite({
      send: (previewId) =>
        call(getApiClient().POST("/api/v1/automations/{id}/test", {
          body: { dryRun: true, sampleData: sample },
          params: { path: { id: automation.id } },
          ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}) })) as Promise<AutomationRunResponse>,
      successMessage: t("automations.staged.tested"),
      subject: automation.name,
      invalidateKeys: [queryKeys.automations.all],
      onExecuted: (response) => setRun((response as AutomationRunResponse).data),
    });
  };

  const simulated = run?.actionsExecuted.filter((entry) => entry.status === "simulated").length ?? 0;
  return (
    <div className="mk-stack aut-test">
      <p className="mk-block mk-block--green mk-note">{t("automations.test.safe")}</p>
      <TextArea label={t("automations.test.sample")} value={text} onChange={(event) => setText(event.target.value)} rows={6} error={error} hint={t("automations.test.sampleHint")} spellCheck={false} className="aut-test__sample" />
      <div className="mk-actions">
        <Button icon={<FlaskConical size={14} />} disabled={!canTest} loading={stagedBusy} title={!canTest ? t("automations.kit.noTest") : undefined} onClick={start}>
          {t("automations.test.run")}
        </Button>
        <Button size="sm" variant="ghost" icon={<Wand2 size={14} />} onClick={() => setText(JSON.stringify(sampleFromConditions(automation), null, 2))}>
          {t("automations.test.fromConditions")}
        </Button>
        {!canTest ? <span className="mk-note">{t("automations.kit.noTest")}</span> : null}
      </div>
      {run ? (
        <section aria-live="polite">
          <h3 className="mk-section-title">{t("automations.test.result")}</h3>
          <p className="mk-note" data-tone={ACTION_TONE.simulated}>
            {t("automations.test.summary", { simulated, total: run.actionsExecuted.length })}
          </p>
          <RunDetail run={run} automation={automation} />
        </section>
      ) : null}
    </div>
  );
}
