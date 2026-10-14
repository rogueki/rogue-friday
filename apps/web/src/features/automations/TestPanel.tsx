"use client";

import type { AutomationRun } from "@jarvis/sdk";
import type { AutomationDto as Automation } from "@/lib/api/domains/automations";
import { Button } from "@jarvis/ui";
import { FlaskConical, Wand2 } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n";
import { useTestAutomation } from "@/lib/api/domains/automations";
import { useCapability } from "@/lib/capabilities";
import { TextArea } from "../memory/kit/fields";
import { RunDetail } from "./RunHistory";
import { ACTION_TONE } from "./labels";

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
  const test = useTestAutomation();
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
    test.mutate({ id: automation.id, dryRun: true, sampleData: sample }, { onSuccess: (response) => setRun(response.data) });
  };

  const simulated = run?.actionsExecuted.filter((entry) => entry.status === "simulated").length ?? 0;
  return (
    <div className="mk-stack aut-test">
      <p className="mk-block mk-block--green mk-note">{t("automations.test.safe")}</p>
      <TextArea label={t("automations.test.sample")} value={text} onChange={(event) => setText(event.target.value)} rows={6} error={error} hint={t("automations.test.sampleHint")} spellCheck={false} className="aut-test__sample" />
      <div className="mk-actions">
        <Button icon={<FlaskConical size={14} />} disabled={!canTest} loading={test.isPending} title={!canTest ? t("automations.kit.noTest") : undefined} onClick={start}>
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
