"use client";

import type { FileItem, FilePreview } from "@friday/sdk";
import { EmptyState, Skeleton } from "@friday/ui";
import { FileQuestion, ShieldAlert } from "lucide-react";
import { useT } from "@/i18n";
import { useFilePreview } from "@/lib/api/domains/files";
import { useQueryPanelState } from "@/features/system/common";
import { PanelStateBody } from "@/features/system/PanelStateBody";
import { SafeMarkdown } from "./SafeMarkdown";

/** Only same-origin absolute paths are ever loaded into the preview frame; anything else is refused. */
export function isSameOriginPath(url: string | undefined): url is string {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.includes("\\");
}

/**
 * Renders a `FilePreview` without ever executing untrusted content (PLAN §37.4): text and HTML source are shown as
 * escaped text, Markdown through the safe renderer, images as `<img>`, PDFs inside an iframe with an empty sandbox
 * (no scripts, no same-origin). A preview that the server did not flag as sandboxed is refused.
 */
export function PreviewContent({ file, preview }: { file: Pick<FileItem, "id" | "name">; preview: FilePreview }) {
  const { t } = useT();
  if (!preview.sandboxed) {
    return <EmptyState compact icon={<ShieldAlert size={18} strokeWidth={1.5} />} title={t("files.preview.unsafe")} description={t("files.preview.unsafeDescription")} />;
  }
  const note = preview.truncated ? <p className="mc-note mc-note--muted">{t("files.preview.truncated")}</p> : null;
  switch (preview.kind) {
    case "text":
      return (
        <div className="mc-stack">
          <pre className="mc-pre" data-testid="preview-text" tabIndex={0}>
            {preview.text ?? ""}
          </pre>
          {note}
        </div>
      );
    case "markdown":
      return (
        <div className="mc-stack">
          <div className="fl-preview__md" tabIndex={0} data-testid="preview-markdown">
            <SafeMarkdown source={preview.text ?? ""} />
          </div>
          {note}
        </div>
      );
    case "html":
      return (
        <div className="mc-stack">
          <p className="mc-note mc-note--muted">{t("files.preview.htmlSource")}</p>
          <pre className="mc-pre" data-testid="preview-html-source" tabIndex={0}>
            {preview.text ?? ""}
          </pre>
          {note}
        </div>
      );
    case "image":
      return isSameOriginPath(preview.url) ? (
        <img className="fl-preview__image" src={preview.url} alt={t("files.preview.imageAlt", { name: file.name })} referrerPolicy="no-referrer" loading="lazy" />
      ) : (
        <EmptyState compact icon={<ShieldAlert size={18} strokeWidth={1.5} />} title={t("files.preview.unsafe")} description={t("files.preview.badUrl")} />
      );
    case "pdf":
      return isSameOriginPath(preview.url) ? (
        <div className="mc-stack">
          <iframe className="fl-preview__frame" title={t("files.preview.pdfTitle", { name: file.name })} src={preview.url} sandbox="" referrerPolicy="no-referrer" loading="lazy" />
          <p className="mc-note mc-note--muted">{t("files.preview.pdfHint")}</p>
        </div>
      ) : (
        <EmptyState compact icon={<ShieldAlert size={18} strokeWidth={1.5} />} title={t("files.preview.unsafe")} description={t("files.preview.badUrl")} />
      );
    default:
      return <EmptyState compact icon={<FileQuestion size={18} strokeWidth={1.5} />} title={t("files.preview.none")} description={t("files.preview.noneDescription")} />;
  }
}

/** Loads GET /files/{id}/preview and renders it with the full set of panel states. */
export function FilePreviewPane({ file }: { file: Pick<FileItem, "id" | "name" | "previewKind"> }) {
  const { t } = useT();
  const enabled = file.previewKind !== "none";
  const query = useFilePreview(file.id, enabled);
  const state = useQueryPanelState(query, { module: "files" });
  if (!enabled) {
    return <EmptyState compact icon={<FileQuestion size={18} strokeWidth={1.5} />} title={t("files.preview.none")} description={t("files.preview.noneDescription")} />;
  }
  return (
    <PanelStateBody state={state} skeleton={<Skeleton variant="block" height={160} label={t("common.loading")} />}>
      {query.data ? <PreviewContent file={file} preview={query.data.data} /> : null}
    </PanelStateBody>
  );
}
