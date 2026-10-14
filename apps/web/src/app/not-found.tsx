"use client";

import { Button, EmptyState } from "@jarvis/ui";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n";

export default function NotFound() {
  const { t } = useT();
  const router = useRouter();
  return (
    <div className="web-fullscreen jv-bg-stage">
      <EmptyState
        title={t("notFound.title")}
        description={t("notFound.description")}
        action={<Button onClick={() => router.push("/")}>{t("notFound.home")}</Button>}
      />
    </div>
  );
}
