"use client";

import { useSkillMarkdown } from "@/lib/api/domains/skills";

/** Shows the installed SKILL.md as plain text. Nothing here renders HTML, so markup stays visible, not active. */
export function SkillMarkdown({ id }: { id: string }) {
  const observed = useSkillMarkdown(id);
  if (observed.isPending) return <p role="status">Anleitung wird geladen …</p>;
  if (observed.isError)
    return (
      <p role="alert">
        {observed.error instanceof Error ? observed.error.message : "Die Anleitung konnte nicht geladen werden."}
      </p>
    );
  return (
    <pre aria-label={`SKILL.md ${observed.data.data.id}`} className="sk-markdown">
      {observed.data.data.content}
    </pre>
  );
}