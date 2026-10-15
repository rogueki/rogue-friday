"use client";

import { FRIDAY_EVENT_TYPES } from "@friday/sdk";
import { Button, Dialog, IconButton, Select, StatusChip, Switch, TextField } from "@friday/ui";
import { Check, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useT, type MessageKey } from "@/i18n";
import { useCreateAutomation, useUpdateAutomation, type AutomationDto as Automation } from "@/lib/api/domains/automations";
import { actionTypeKey, channelKey, operatorKey, triggerTypeKey } from "./labels";
import {
  ACTION_TYPES,
  APPROVAL_BY_DEFAULT,
  CHANNELS,
  CHANNEL_ACTIONS,
  MAX_ACTIONS,
  MAX_CONDITIONS,
  MAX_ESCALATION,
  OPERATORS,
  TRIGGER_TYPES,
  WIZARD_STEPS,
  draftFromAutomation,
  emptyDraft,
  firstInvalidStep,
  newAction,
  newCondition,
  newEscalation,
  toRequest,
  validateStep,
  type ActionType,
  type ChannelId,
  type Describer,
  type Operator,
  type TriggerType,
  type WizardDraft,
  type WizardErrors,
  type WizardStep,
} from "./wizardModel";

export interface AutomationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing automation = edit (PATCH with If-Match, increments the version); absent = create. */
  automation?: Automation;
  onSaved?: (automation: Automation) => void;
}

/** Remount per open (`key`) so the wizard always starts from the current definition. */
export function AutomationWizard(props: AutomationWizardProps) {
  return props.open ? <WizardBody {...props} /> : null;
}

function WizardBody({ onOpenChange, automation, onSaved }: AutomationWizardProps) {
  const { t } = useT();
  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const [draft, setDraft] = useState<WizardDraft>(() => (automation ? draftFromAutomation(automation) : emptyDraft()));
  const [step, setStep] = useState<WizardStep>("trigger");
  const [errors, setErrors] = useState<WizardErrors>({});
  const editing = automation !== undefined;
  const busy = create.isPending || update.isPending;
  const stepIndex = WIZARD_STEPS.indexOf(step);

  const describer = useMemo<Describer>(
    () => ({
      trigger: (value) =>
        value.triggerType === "event"
          ? t("automations.describe.trigger.event", { event: value.event })
          : value.triggerType === "schedule"
            ? t("automations.describe.trigger.schedule", { schedule: value.schedule })
            : t(triggerTypeKey(value.triggerType)),
      condition: (condition) => t("automations.describe.condition", { field: condition.field, operator: t(operatorKey(condition.operator)), value: condition.value }),
      action: (action) => (action.channel ? t("automations.describe.action.channel", { action: t(actionTypeKey(action.type)), channel: t(channelKey(action.channel)) }) : t(actionTypeKey(action.type))),
      escalation: (entry, minutes) => t("automations.describe.escalation", { minutes, channel: t(channelKey(entry.channel)) }),
    }),
    [t],
  );

  const patch = (changes: Partial<WizardDraft>): void => setDraft((current) => ({ ...current, ...changes }));
  const err = (path: string): string | undefined => {
    const key = errors[path];
    return key ? t(key as MessageKey) : undefined;
  };

  const goNext = (): void => {
    const found = validateStep(step, draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setStep(WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, stepIndex + 1)] ?? "review");
  };
  const goBack = (): void => {
    setErrors({});
    setStep(WIZARD_STEPS[Math.max(0, stepIndex - 1)] ?? "trigger");
  };
  const jumpTo = (target: WizardStep): void => {
    // Going back is always free; going forward requires every step in between to be valid.
    if (WIZARD_STEPS.indexOf(target) <= stepIndex) {
      setErrors({});
      setStep(target);
      return;
    }
    for (const candidate of WIZARD_STEPS.slice(0, WIZARD_STEPS.indexOf(target))) {
      const found = validateStep(candidate, draft);
      if (Object.keys(found).length > 0) {
        setStep(candidate);
        setErrors(found);
        return;
      }
    }
    setErrors({});
    setStep(target);
  };

  const save = (): void => {
    const invalid = firstInvalidStep(draft);
    if (invalid) {
      setStep(invalid);
      setErrors(validateStep(invalid, draft));
      return;
    }
    const request = toRequest(draft, describer);
    if (automation) {
      update.mutate(
        { id: automation.id, version: automation.version, patch: request },
        {
          onSuccess: (response) => {
            onSaved?.(response.data);
            onOpenChange(false);
          },
        },
      );
    } else {
      create.mutate(request, {
        onSuccess: (response) => {
          onSaved?.(response.data);
          onOpenChange(false);
        },
      });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={editing ? t("automations.wizard.editTitle") : t("automations.wizard.createTitle")}
      description={editing ? t("automations.wizard.editDescription", { next: automation.version + 1 }) : t("automations.wizard.createDescription")}
      size="lg"
      closeLabel={t("common.close")}
      className="aut-wizard"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          {stepIndex > 0 ? (
            <Button variant="ghost" onClick={goBack} disabled={busy}>
              {t("memory.kit.back")}
            </Button>
          ) : null}
          {step !== "review" ? (
            <Button onClick={goNext}>{t("memory.kit.next")}</Button>
          ) : (
            <Button icon={<Check size={14} />} onClick={save} loading={busy}>
              {editing ? t("automations.wizard.saveEdit") : t("automations.wizard.saveCreate")}
            </Button>
          )}
        </>
      }
    >
      <ol className="aut-steps" aria-label={t("automations.wizard.steps")}>
        {WIZARD_STEPS.map((name, index) => (
          <li key={name} className={`aut-steps__item${name === step ? " aut-steps__item--current" : ""}${index < stepIndex ? " aut-steps__item--done" : ""}`} aria-current={name === step ? "step" : undefined}>
            <button type="button" onClick={() => jumpTo(name)} disabled={busy}>
              <span className="aut-steps__num">{index < stepIndex ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : index + 1}</span>
              <span>{t(`automations.step.${name}` as MessageKey)}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mk-form aut-wizard__body" role="group" aria-label={t(`automations.step.${step}` as MessageKey)}>
        {step === "trigger" ? <TriggerStep draft={draft} patch={patch} err={err} /> : null}
        {step === "conditions" ? <ConditionsStep draft={draft} patch={patch} err={err} /> : null}
        {step === "actions" ? <ActionsStep draft={draft} patch={patch} err={err} /> : null}
        {step === "escalation" ? <EscalationStep draft={draft} patch={patch} err={err} /> : null}
        {step === "review" ? <ReviewStep draft={draft} patch={patch} describer={describer} /> : null}
      </div>
    </Dialog>
  );
}

interface StepProps {
  draft: WizardDraft;
  patch: (changes: Partial<WizardDraft>) => void;
  err: (path: string) => string | undefined;
}

function TriggerStep({ draft, patch, err }: StepProps) {
  const { t } = useT();
  return (
    <>
      <TextField label={t("automations.field.name")} value={draft.name} onChange={(event) => patch({ name: event.target.value })} error={err("name")} required maxLength={120} />
      <TextField label={t("automations.field.description")} value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
      <Select
        label={t("automations.field.triggerType")}
        value={draft.triggerType}
        onChange={(event) => patch({ triggerType: event.target.value as TriggerType })}
        options={TRIGGER_TYPES.map((type) => ({ value: type, label: t(triggerTypeKey(type)) }))}
        hint={t(`automations.trigger.${draft.triggerType}.hint` as MessageKey)}
      />
      {draft.triggerType === "event" ? (
        <>
          <TextField label={t("automations.field.event")} list="aut-events" value={draft.event} onChange={(event) => patch({ event: event.target.value })} error={err("trigger.event")} required spellCheck={false} hint={t("automations.field.eventHint")} />
          <datalist id="aut-events">
            {FRIDAY_EVENT_TYPES.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
        </>
      ) : null}
      {draft.triggerType === "schedule" ? (
        <div className="mk-grid-2">
          <TextField label={t("automations.field.schedule")} value={draft.schedule} onChange={(event) => patch({ schedule: event.target.value })} error={err("trigger.schedule")} required spellCheck={false} hint={t("automations.field.scheduleHint")} />
          <TextField label={t("automations.field.timeZone")} value={draft.timeZone} onChange={(event) => patch({ timeZone: event.target.value })} error={err("trigger.timeZone")} spellCheck={false} />
        </div>
      ) : null}
      <TextField
        label={draft.triggerType === "condition" ? t("automations.field.triggerCondition") : t("automations.field.triggerNote")}
        value={draft.triggerNote}
        onChange={(event) => patch({ triggerNote: event.target.value })}
        error={err("trigger.note")}
        required={draft.triggerType === "condition"}
        hint={draft.triggerType === "condition" ? undefined : t("automations.field.triggerNoteHint")}
      />
    </>
  );
}

function ConditionsStep({ draft, patch, err }: StepProps) {
  const { t } = useT();
  const setCondition = (index: number, changes: Partial<WizardDraft["conditions"][number]>): void =>
    patch({ conditions: draft.conditions.map((condition, position) => (position === index ? { ...condition, ...changes } : condition)) });
  return (
    <>
      <p className="mk-note">{t("automations.step.conditions.hint")}</p>
      {draft.conditions.length === 0 ? <p className="mk-block mk-note">{t("automations.flow.noConditions")}</p> : null}
      {draft.conditions.map((condition, index) => (
        <fieldset key={condition.key} className="aut-fieldset">
          <legend>{t("automations.condition.n", { n: index + 1 })}</legend>
          <div className="aut-fieldset__grid">
            <TextField label={t("automations.field.conditionField")} value={condition.field} onChange={(event) => setCondition(index, { field: event.target.value })} error={err(`conditions.${index}.field`)} spellCheck={false} placeholder="thread.priority" />
            <Select label={t("automations.field.operator")} value={condition.operator} onChange={(event) => setCondition(index, { operator: event.target.value as Operator })} options={OPERATORS.map((operator) => ({ value: operator, label: t(operatorKey(operator)) }))} />
            <TextField label={t("automations.field.conditionValue")} value={condition.value} onChange={(event) => setCondition(index, { value: event.target.value })} error={err(`conditions.${index}.value`)} spellCheck={false} />
            <IconButton label={t("automations.condition.remove", { n: index + 1 })} icon={<Trash2 size={15} strokeWidth={1.5} />} size="sm" onClick={() => patch({ conditions: draft.conditions.filter((_, position) => position !== index) })} />
          </div>
        </fieldset>
      ))}
      {err("conditions") ? <p className="mk-form__error">{err("conditions")}</p> : null}
      <div>
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} disabled={draft.conditions.length >= MAX_CONDITIONS} onClick={() => patch({ conditions: [...draft.conditions, newCondition()] })}>
          {t("automations.condition.add")}
        </Button>
      </div>
    </>
  );
}

function ActionsStep({ draft, patch, err }: StepProps) {
  const { t } = useT();
  const setAction = (index: number, changes: Partial<WizardDraft["actions"][number]>): void =>
    patch({ actions: draft.actions.map((action, position) => (position === index ? { ...action, ...changes } : action)) });
  return (
    <>
      <p className="mk-note">{t("automations.step.actions.hint")}</p>
      {err("actions") ? <p className="mk-form__error" role="alert">{err("actions")}</p> : null}
      {draft.actions.map((action, index) => (
        <fieldset key={action.key} className="aut-fieldset">
          <legend>{t("automations.action.n", { n: index + 1 })}</legend>
          <div className="aut-fieldset__grid">
            <Select
              label={t("automations.field.actionType")}
              value={action.type}
              onChange={(event) => {
                const type = event.target.value as ActionType;
                setAction(index, { type, channel: CHANNEL_ACTIONS.has(type) ? (action.channel || (type === "call" ? "phone" : "dashboard")) : "", requiresApproval: APPROVAL_BY_DEFAULT.has(type) });
              }}
              options={ACTION_TYPES.map((type) => ({ value: type, label: t(actionTypeKey(type)) }))}
            />
            {CHANNEL_ACTIONS.has(action.type) ? (
              <Select label={t("automations.field.channel")} value={action.channel} onChange={(event) => setAction(index, { channel: event.target.value as ChannelId })} error={err(`actions.${index}.channel`)} options={CHANNELS.map((channel) => ({ value: channel, label: t(channelKey(channel)) }))} />
            ) : (
              <span />
            )}
            <TextField label={t("automations.field.params")} value={action.params} onChange={(event) => setAction(index, { params: event.target.value })} error={err(`actions.${index}.params`)} spellCheck={false} placeholder='{"agent": "Task-Agent"}' />
            <IconButton label={t("automations.action.remove", { n: index + 1 })} icon={<Trash2 size={15} strokeWidth={1.5} />} size="sm" onClick={() => patch({ actions: draft.actions.filter((_, position) => position !== index) })} />
          </div>
          <Switch label={t("automations.field.requiresApproval")} description={t("automations.field.requiresApprovalHint")} checked={action.requiresApproval} onCheckedChange={(checked) => setAction(index, { requiresApproval: checked })} stateLabels={[t("memory.kit.on"), t("memory.kit.off")]} />
        </fieldset>
      ))}
      <div>
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} disabled={draft.actions.length >= MAX_ACTIONS} onClick={() => patch({ actions: [...draft.actions, newAction()] })}>
          {t("automations.action.add")}
        </Button>
      </div>
    </>
  );
}

function EscalationStep({ draft, patch, err }: StepProps) {
  const { t } = useT();
  const setStep = (index: number, changes: Partial<WizardDraft["escalation"][number]>): void =>
    patch({ escalation: draft.escalation.map((entry, position) => (position === index ? { ...entry, ...changes } : entry)) });
  const last = Number(draft.escalation.at(-1)?.afterMinutes ?? 0);
  return (
    <>
      <p className="mk-note">{t("automations.step.escalation.hint")}</p>
      {draft.escalation.length === 0 ? <p className="mk-block mk-note">{t("automations.flow.noEscalation")}</p> : null}
      {draft.escalation.map((entry, index) => (
        <fieldset key={entry.key} className="aut-fieldset">
          <legend>{t("automations.escalation.n", { n: index + 1 })}</legend>
          <div className="aut-fieldset__grid">
            <TextField label={t("automations.field.afterMinutes")} type="number" inputMode="numeric" min={1} value={entry.afterMinutes} onChange={(event) => setStep(index, { afterMinutes: event.target.value })} error={err(`escalation.${index}.after`)} />
            <Select label={t("automations.field.channel")} value={entry.channel} onChange={(event) => setStep(index, { channel: event.target.value as ChannelId })} options={CHANNELS.map((channel) => ({ value: channel, label: t(channelKey(channel)) }))} />
            <span />
            <IconButton label={t("automations.escalation.remove", { n: index + 1 })} icon={<Trash2 size={15} strokeWidth={1.5} />} size="sm" onClick={() => patch({ escalation: draft.escalation.filter((_, position) => position !== index) })} />
          </div>
          <Switch label={t("automations.field.stopOnAck")} checked={entry.stopOnAcknowledge} onCheckedChange={(checked) => setStep(index, { stopOnAcknowledge: checked })} stateLabels={[t("memory.kit.on"), t("memory.kit.off")]} />
        </fieldset>
      ))}
      {err("escalation") ? <p className="mk-form__error">{err("escalation")}</p> : null}
      <div>
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} disabled={draft.escalation.length >= MAX_ESCALATION} onClick={() => patch({ escalation: [...draft.escalation, newEscalation(last)] })}>
          {t("automations.escalation.add")}
        </Button>
      </div>
    </>
  );
}

function ReviewStep({ draft, patch, describer }: { draft: WizardDraft; patch: StepProps["patch"]; describer: Describer }) {
  const { t } = useT();
  const invalid = firstInvalidStep(draft);
  return (
    <>
      {invalid ? <p className="mk-block mk-block--red mk-note" role="alert">{t("automations.review.invalid", { step: t(`automations.step.${invalid}` as MessageKey) })}</p> : null}
      <dl className="mk-dl">
        <dt>{t("automations.field.name")}</dt>
        <dd>{draft.name}</dd>
        <dt>{t("automations.flow.trigger")}</dt>
        <dd>{draft.triggerNote.trim() || describer.trigger(draft)}</dd>
        <dt>{t("automations.flow.conditions")}</dt>
        <dd>{draft.conditions.length === 0 ? t("automations.flow.noConditions") : draft.conditions.map((condition) => describer.condition(condition)).join("; ")}</dd>
        <dt>{t("automations.flow.actions")}</dt>
        <dd>{draft.actions.length === 0 ? "—" : draft.actions.map((action) => `${describer.action(action)}${action.requiresApproval ? ` (${t("automations.flow.needsApproval")})` : ""}`).join("; ")}</dd>
        <dt>{t("automations.flow.escalation")}</dt>
        <dd>{draft.escalation.length === 0 ? t("automations.flow.noEscalation") : draft.escalation.map((entry) => describer.escalation(entry, Number(entry.afterMinutes))).join("; ")}</dd>
      </dl>
      <Switch label={t("automations.review.enable")} description={t("automations.review.enableHint")} checked={draft.enabled} onCheckedChange={(checked) => patch({ enabled: checked })} stateLabels={[t("memory.kit.on"), t("memory.kit.off")]} />
      <StatusChip tone="blue" dot={false}>
        {t("automations.review.versionNote")}
      </StatusChip>
    </>
  );
}
