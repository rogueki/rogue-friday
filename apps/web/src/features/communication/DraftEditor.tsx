"use client";

import type { Channel, Draft } from "@friday/sdk";
import { Button, ConfirmDialog, StatusChip, TextField, useToast } from "@friday/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Save, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/i18n";
import { seedDraftCache, useRequestDraftSend, useUpdateDraft } from "@/lib/api/domains/communication";
import { useCapability } from "@/lib/capabilities";
import { TextArea } from "../memory/kit/fields";
import { DRAFT_STATUS_TONE, draftStatusKey } from "./labels";
import { useChannelAccess } from "./useChannelAccess";

export interface DraftEditorProps {
  draft: Draft;
  channel: Channel | undefined;
}

/**
 * Edits one draft and asks for its send approval. Nothing is ever sent from here: "Versand anfragen" only creates an
 * approval that is decided on the approvals page (PLAN §33.5: Entwurf automatisch, Versand mit Freigabe).
 */
export function DraftEditor({ draft, channel }: DraftEditorProps) {
  const { t } = useT();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const access = useChannelAccess();
  const canDraft = useCapability("communication", "draft") && access.canDraftOn(channel);
  const canSend = access.canSendOn(channel);
  const update = useUpdateDraft();
  const requestSend = useRequestDraftSend();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const editable = draft.status === "draft";
  const dirty = subject !== draft.subject || body !== draft.body;
  const empty = body.trim() === "";
  const recipients = draft.to.map((person) => `${person.name} <${person.address}>`).join(", ");

  const save = (done?: () => void): void =>
    update.mutate(
      { id: draft.id, version: draft.version, patch: { subject, body } },
      {
        onSuccess: (response) => {
          seedDraftCache(queryClient, response);
          done?.();
        },
      },
    );

  const sendBlockedReason = !canSend ? t("communication.draft.sendUnavailable") : empty ? t("communication.draft.emptyBody") : undefined;

  return (
    <div className="com-draft" data-draft-id={draft.id} data-draft-status={draft.status}>
      <div className="com-draft__head">
        <StatusChip tone={DRAFT_STATUS_TONE[draft.status]}>{t(draftStatusKey(draft.status))}</StatusChip>
        <span className="mk-muted com-draft__to">{t("communication.draft.to", { recipients })}</span>
      </div>
      <TextField label={t("communication.draft.subject")} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={!editable || !canDraft} />
      <TextArea label={t("communication.draft.body")} value={body} onChange={(event) => setBody(event.target.value)} rows={7} disabled={!editable || !canDraft} />
      {draft.status === "pending_approval" ? (
        <p className="mk-block mk-block--amber mk-note">
          {t("communication.draft.pendingHint")}{" "}
          {draft.approvalId ? (
            <button type="button" className="mk-link" onClick={() => router.push(`/approvals?approval=${encodeURIComponent(draft.approvalId ?? "")}`)}>
              {t("communication.draft.openApproval")}
            </button>
          ) : null}
        </p>
      ) : null}
      {draft.status === "failed" ? <p className="mk-block mk-block--red mk-note">{t("communication.draft.failedHint")}</p> : null}
      {editable ? (
        <>
          <p className="mk-note">{t("communication.draft.rule")}</p>
          <div className="mk-actions">
            <Button size="sm" variant="ghost" icon={<Save size={14} />} disabled={!dirty || !canDraft || empty} loading={update.isPending} onClick={() => save()}>
              {t("communication.draft.save")}
            </Button>
            <Button
              size="sm"
              icon={<Send size={14} />}
              disabled={Boolean(sendBlockedReason) || update.isPending}
              title={sendBlockedReason}
              onClick={() => (dirty ? save(() => setConfirming(true)) : setConfirming(true))}
            >
              {t("communication.draft.requestSend")}
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={!canDraft} onClick={() => setDiscarding(true)}>
              {t("communication.draft.discard")}
            </Button>
            {sendBlockedReason ? <span className="mk-note">{sendBlockedReason}</span> : null}
          </div>
        </>
      ) : null}
      {draft.status === "approved" || draft.status === "sent" ? (
        <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => router.push(draft.approvalId ? `/approvals?approval=${encodeURIComponent(draft.approvalId)}` : "/approvals")}>
          {t("communication.draft.openApproval")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("communication.sendRequest.title")}
        description={t("communication.sendRequest.description")}
        details={[
          t("communication.sendRequest.channel", { channel: channel?.name ?? draft.channelId }),
          t("communication.sendRequest.to", { recipients }),
          t("communication.sendRequest.subject", { subject: draft.subject || subject }),
          t("communication.sendRequest.noAuto"),
        ]}
        confirmLabel={t("communication.sendRequest.confirm")}
        cancelLabel={t("common.cancel")}
        loading={requestSend.isPending}
        onConfirm={() =>
          requestSend.mutate(
            { id: draft.id, version: dirty ? undefined : draft.version },
            {
              onSuccess: (approval) => {
                setConfirming(false);
                seedDraftCache(queryClient, {
                  contractVersion: approval.contractVersion,
                  freshness: approval.freshness,
                  data: { ...draft, subject, body, status: "pending_approval", approvalId: approval.data.id, version: draft.version + 1 },
                });
                toast({
                  title: t("communication.sendRequest.done"),
                  description: t("communication.sendRequest.doneDescription"),
                  tone: "amber",
                  action: { label: t("communication.draft.openApproval"), onClick: () => router.push(`/approvals?approval=${encodeURIComponent(approval.data.id)}`) },
                });
              },
            },
          )
        }
      />
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        tone="danger"
        title={t("communication.discard.title")}
        description={t("communication.discard.description")}
        confirmLabel={t("communication.draft.discard")}
        cancelLabel={t("common.cancel")}
        loading={update.isPending}
        onConfirm={() =>
          update.mutate(
            { id: draft.id, version: draft.version, patch: { status: "discarded" } },
            {
              onSuccess: (response) => {
                seedDraftCache(queryClient, response);
                setDiscarding(false);
              },
            },
          )
        }
      />
    </div>
  );
}
