"use client";

import type { Channel } from "@friday/sdk";
import { Button, Dialog, Select, TextField, useToast } from "@friday/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { seedDraftCache, useCachedDraft, useCreateDraft } from "@/lib/api/domains/communication";
import { TextArea } from "../memory/kit/fields";
import { DraftEditor } from "./DraftEditor";
import { channelKindKey } from "../memory/kit/channelStatus";
import { useChannelAccess } from "./useChannelAccess";

export interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: readonly Channel[];
  /** Preselected channel (the channel currently filtered in the inbox). */
  channelId?: string;
}

/**
 * New message: step 1 creates the draft (always allowed where the channel can draft), step 2 is the draft editor where sending
 * can only be *requested*. The contract has no list of unthreaded drafts, so the editor stays in this dialog.
 */
export function ComposeDialog(props: ComposeDialogProps) {
  return props.open ? <ComposeBody {...props} /> : null;
}

const looksLikeAddress = (kind: Channel["kind"], value: string): boolean => (kind === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) : value.trim().length > 0);

function ComposeBody({ onOpenChange, channels, channelId }: ComposeDialogProps) {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const access = useChannelAccess();
  const create = useCreateDraft();
  const usable = channels.filter((channel) => access.canDraftOn(channel));
  const [channel, setChannel] = useState(() => usable.find((candidate) => candidate.id === channelId)?.id ?? usable[0]?.id ?? "");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<{ address?: string; body?: string }>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  const selected = usable.find((candidate) => candidate.id === channel);
  const created = useCachedDraft(createdId);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!selected) return;
    const found: typeof errors = {};
    if (!looksLikeAddress(selected.kind, address.trim())) found.address = selected.kind === "email" ? t("communication.compose.error.email") : t("communication.compose.error.address");
    if (body.trim() === "") found.body = t("communication.draft.emptyBody");
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate(
      { channelId: selected.id, threadId: null, to: [{ name: name.trim() || address.trim(), address: address.trim() }], subject: subject.trim(), body: body.trim() },
      {
        onSuccess: (response) => {
          seedDraftCache(queryClient, response);
          setCreatedId(response.data.id);
          toast({ title: t("communication.draftCreated"), description: t("communication.draftCreated.description"), tone: "green" });
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t("communication.compose.title")}
      description={createdId ? t("communication.compose.step2") : t("communication.compose.step1")}
      size="lg"
      closeLabel={t("common.close")}
      footer={
        createdId ? (
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form="compose-form" loading={create.isPending} disabled={!selected}>
              {t("communication.compose.create")}
            </Button>
          </>
        )
      }
    >
      {createdId && created.data ? (
        <DraftEditor key={`${created.data.data.id}:${created.data.data.version}`} draft={created.data.data} channel={selected} />
      ) : usable.length === 0 ? (
        <p className="mk-note">{t("communication.compose.noChannel")}</p>
      ) : (
        <form id="compose-form" className="mk-form" onSubmit={submit} noValidate>
          <Select
            label={t("communication.compose.channel")}
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            options={usable.map((candidate) => ({ value: candidate.id, label: `${candidate.name} (${t(channelKindKey(candidate.kind))})` }))}
          />
          <div className="mk-grid-2">
            <TextField label={t("communication.compose.name")} value={name} onChange={(event) => setName(event.target.value)} />
            <TextField label={t("communication.compose.address")} value={address} onChange={(event) => setAddress(event.target.value)} error={errors.address} required />
          </div>
          <TextField label={t("communication.draft.subject")} value={subject} onChange={(event) => setSubject(event.target.value)} />
          <TextArea label={t("communication.draft.body")} value={body} onChange={(event) => setBody(event.target.value)} rows={7} error={errors.body} required />
          <p className="mk-note">{t("communication.draft.rule")}</p>
        </form>
      )}
    </Dialog>
  );
}
