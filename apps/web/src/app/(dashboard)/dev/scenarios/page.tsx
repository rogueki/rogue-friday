"use client";

import { ScenarioConsolePage } from "@/features/dev-scenarios/ScenarioConsole";

/** `/dev/scenarios`: inside the dashboard shell so the live orb and event stream stay visible; hidden unless `features.devScenarios`. */
export default function Page() {
  return <ScenarioConsolePage />;
}
