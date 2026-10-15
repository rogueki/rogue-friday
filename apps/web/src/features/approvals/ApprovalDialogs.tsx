"use client";

import type { Approval, ApprovalPreview } from "@friday/sdk";
import { Button, Dialog, TagPill, TextField, useToast } from "@friday/ui";
import { Check, KeyRound, MessageSquareQuote, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useT, type MessageKey } from "@/i18n";
import { useRequestApprovalContext } from "@/lib/api/domains/approvals";
import { AUTH_TONE, TIER_TONE, needsReauth, type DecisionFailure } from "./model";
import { useApprovalDecision } from "./useApprovalDecision";
import "./approvals.css";

/** Multi-line field in the style of the UI library's text fields (the library has no textarea). */
export function TextAreaField({ label, value, onChange, disabled, rows = 3, maxLength, hint, autoFocusRef }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; rows?: number; maxLength?: number; hint?: string; autoFocusRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const id = useId();
  return (
    <div className={disabled ? "jv-field jv-field--disabled" : "jv-field"}>
      <label htmlFor={id} className="jv-field__label">
        {label}
      </label>
      <div className="jv-field__control">
        <textarea ref={autoFocusRef} id={id} className="jv-field__input ap-textarea" rows={rows} maxLength={maxLength} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="jv-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function failureMessage(failure: DecisionFailure, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  switch (failure.kind) {
    case "token-expired":
      return t("approvals.error.tokenExpired");
    case "token-invalid":
      return t("approvals.error.tokenInvalid");
    case "token-missing":
      return t("approvals.error.tokenMissing");
    case "reauth-required":
      return t("approvals.error.reauthRequired");
    case "wrong-password":
      return t("approvals.error.wrongPassword");
    case "conflict":
      return `${t("approvals.error.conflict")} ${failure.message}`;
    case "forbidden":
      return `${t("approvals.error.forbidden")} ${failure.message}`;
    case "rate-limited":
      return `${t("approvals.error.rateLimited")} ${failure.message}`;
    default:
      return failure.correlationId ? `${failure.message} (${failure.correlationId})` : failure.message;
  }
}

function Failure({ failure }: { failure: DecisionFailure | null }) {
  const { t } = useT();
  if (!failure) return null;
  return (
    <p className="ap-error" role="alert">
      {failureMessage(failure, t)}
    </p>
  );
}

const sameFields = (a: ApprovalPreview["fields"], b: ApprovalPreview["fields"]): boolean => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

export interface DecisionDialogProps {
  approval: Approval;
  /** `edit` = "Bearbeiten und freigeben": the preview can be changed before it is approved. */
  mode: "approve" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Du bist dabei: …" confirmation of an approve (PLAN §43.4, §32.5): shows what will happen, asks for the password on
 * tier 3, and runs the token / re-auth / idempotency flow of `useApprovalDecision`. The decision is never optimistic.
 */
export function ApprovalDecisionDialog({ approval, mode, open, onOpenChange }: DecisionDialogProps) {
  const { t } = useT();
  const { toast } = useToast();
  const flow = useApprovalDecision();
  const reauthNeeded = needsReauth(approval);
  const [comment, setComment] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState(approval.preview.title);
  const [body, setBody] = useState(approval.preview.body);
  const [fields, setFields] = useState(approval.preview.fields ?? []);
  const [failure, setFailure] = useState<DecisionFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const focusRef = useRef<HTMLInputElement | null>(null);

  // A new dialog session is a new decision: new idempotency key, empty password and the current preview as the start.
  useEffect(() => {
    if (!open) return;
    flow.newIntent();
    setComment("");
    setPassword("");
    setTitle(approval.preview.title);
    setBody(approval.preview.body);
    setFields(approval.preview.fields ?? []);
    setFailure(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const edited = useMemo<ApprovalPreview>(() => ({ ...approval.preview, title: title.trim(), body, fields: fields.length > 0 ? fields : undefined }), [approval.preview, title, body, fields]);
  const changed = title.trim() !== approval.preview.title || body !== approval.preview.body || !sameFields(fields, approval.preview.fields);
  const canSubmit = !busy && (!reauthNeeded || password.length > 0) && (mode === "approve" || (changed && title.trim().length > 0));

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setFailure(null);
    const result = await flow.decide(approval, { comment: comment.trim() || undefined, password: reauthNeeded ? password : undefined, editedPreview: mode === "edit" ? edited : undefined });
    setBusy(false);
    if (result.ok) {
      setPassword("");
      onOpenChange(false);
      toast({ title: t("approvals.toast.approved"), description: approval.action, tone: "green", duration: 5000 });
      return;
    }
    setFailure(result.failure);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? t("approvals.edit.title") : t("approvals.approve.title")}
      description={
        <>
          <strong>{t("approvals.approve.youAre")}</strong> {approval.action}
        </>
      }
      tone={approval.riskTier === 3 ? "red" : "amber"}
      size="md"
      dismissible={!busy}
      initialFocusRef={focusRef}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<Check size={14} />} loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            {mode === "edit" ? t("approvals.edit.confirm") : t("approvals.approve.confirm")}
          </Button>
        </>
      }
    >
      <form
        className="web-form ap-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="ap-form__tags">
          <TagPill tone={TIER_TONE[approval.riskTier]}>{t(`approvals.tier.${approval.riskTier}` as MessageKey)}</TagPill>
          <TagPill tone={AUTH_TONE[approval.requiredAuth]} icon={reauthNeeded ? <KeyRound size={12} /> : undefined}>
            {t(`approvals.auth.${approval.requiredAuth}` as MessageKey)}
          </TagPill>
        </div>
        {mode === "edit" ? (
          <fieldset className="ap-form__edit" disabled={busy}>
            <legend>{t("approvals.edit.legend")}</legend>
            <TextField ref={focusRef} label={t("approvals.edit.previewTitle")} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} />
            <TextAreaField label={t("approvals.edit.previewBody")} value={body} onChange={setBody} rows={6} />
            {fields.map((field, index) => (
              <TextField key={`${field.label}-${index}`} label={field.label} value={field.value} onChange={(event) => setFields((current) => current.map((entry, i) => (i === index ? { ...entry, value: event.target.value } : entry)))} />
            ))}
            {!changed ? <p className="jv-field__hint">{t("approvals.edit.unchanged")}</p> : null}
          </fieldset>
        ) : (
          <div className="ap-form__summary">
            <span className="ap-card__preview-kind">{t(`approvals.preview.${approval.preview.kind}` as MessageKey)}</span>
            <span>{approval.preview.title}</span>
          </div>
        )}
        <TextAreaField label={t("approvals.field.comment")} value={comment} onChange={setComment} disabled={busy} rows={2} maxLength={500} />
        {reauthNeeded ? (
          <TextField
            ref={mode === "approve" ? focusRef : undefined}
            type="password"
            autoComplete="current-password"
            label={t("approvals.reauth.label")}
            hint={t("approvals.reauth.hint")}
            icon={<KeyRound size={14} />}
            value={password}
            disabled={busy}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        ) : null}
        <Failure failure={failure} />
      </form>
    </Dialog>
  );
}

export interface RejectDialogProps {
  approval: Approval;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApprovalRejectDialog({ approval, open, onOpenChange }: RejectDialogProps) {
  const { t } = useT();
  const { toast } = useToast();
  const flow = useApprovalDecision();
  const [comment, setComment] = useState("");
  const [failure, setFailure] = useState<DecisionFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const focusRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    flow.newIntent();
    setComment("");
    setFailure(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const result = await flow.rejectApproval(approval, comment.trim());
    setBusy(false);
    if (result.ok) {
      onOpenChange(false);
      toast({ title: t("approvals.toast.rejected"), description: approval.action, tone: "amber", duration: 5000 });
      return;
    }
    setFailure(result.failure);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("approvals.reject.title")}
      description={
        <>
          <strong>{t("approvals.approve.youAre")}</strong> {t("approvals.reject.statement", { action: approval.action })}
        </>
      }
      tone="red"
      size="sm"
      dismissible={!busy}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" icon={<X size={14} />} loading={busy} onClick={() => void submit()}>
            {t("approvals.reject.confirm")}
          </Button>
        </>
      }
    >
      <div className="web-form ap-form">
        <TextAreaField autoFocusRef={focusRef} label={t("approvals.reject.reason")} value={comment} onChange={setComment} disabled={busy} rows={3} maxLength={500} />
        <Failure failure={failure} />
      </div>
    </Dialog>
  );
}

export interface ContextDialogProps {
  approval: Approval;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApprovalContextDialog({ approval, open, onOpenChange }: ContextDialogProps): ReactNode {
  const { t } = useT();
  const { toast } = useToast();
  const request = useRequestApprovalContext();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuestion("");
      setError(null);
    }
  }, [open]);

  const submit = (): void => {
    const trimmed = question.trim();
    if (trimmed.length < 3) return;
    setError(null);
    request.mutateAsync({ id: approval.id, question: trimmed }).then(
      () => {
        onOpenChange(false);
        toast({ title: t("approvals.toast.contextRequested"), description: approval.action, tone: "cyan", duration: 5000 });
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : t("approvals.error.generic")),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("approvals.context.title")}
      description={t("approvals.context.description")}
      size="sm"
      dismissible={!request.isPending}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={request.isPending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<MessageSquareQuote size={14} />} loading={request.isPending} disabled={question.trim().length < 3} onClick={submit}>
            {t("approvals.context.send")}
          </Button>
        </>
      }
    >
      <div className="web-form ap-form">
        <TextAreaField autoFocusRef={focusRef} label={t("approvals.context.question")} value={question} onChange={setQuestion} disabled={request.isPending} rows={4} maxLength={1000} />
        {error ? (
          <p className="ap-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
