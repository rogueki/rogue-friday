"use client";

import { EmptyState, HudPanel } from "@friday/ui";
import { NAV_PAGES, type NavPageId } from "@/features/shell/navModel";
import { useT, type MessageKey } from "@/i18n";

/**
 * Placeholder body of a module page. A module agent replaces the page file with the real module (see docs/ARCHITECTURE.md,
 * "Adding a module page"); until then every route renders a proper header and an explicit empty state.
 */
export function ModulePlaceholder({ page }: { page: Exclude<NavPageId, "overview"> }) {
  const { t } = useT();
  const entry = NAV_PAGES.find((candidate) => candidate.id === page);
  return (
    <div className="web-page">
      <HudPanel
        title={t((entry?.labelKey ?? "nav.overview") as MessageKey)}
        subtitle={t(`page.${page}.description` as MessageKey)}
        icon={entry?.icon}
        padding="lg"
        className="web-page__panel"
      >
        <EmptyState title={t("module.loading")} description={t("module.loading.description")} />
      </HudPanel>
    </div>
  );
}
