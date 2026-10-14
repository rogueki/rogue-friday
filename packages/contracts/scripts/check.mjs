// CI gate (PLAN §7.4): lint + validate + generated-code freshness + breaking-change detection.
import { runBreakingCheck } from "./breaking.mjs";
import { checkGenerated } from "./check-generated.mjs";
import { lintAll } from "./lint.mjs";
import { validateAll } from "./validate.mjs";

const problems = [];

async function step(name, fn) {
  const started = Date.now();
  try {
    const failures = await fn();
    const elapsed = Date.now() - started;
    if (failures.length > 0) {
      problems.push(...failures.map((failure) => `[${name}] ${failure}`));
      console.error(`FAIL ${name} (${elapsed} ms)`);
    } else {
      console.log(`ok   ${name} (${elapsed} ms)`);
    }
  } catch (error) {
    problems.push(`[${name}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    console.error(`FAIL ${name}`);
  }
}

await step("lint", async () => (await lintAll()).failures);
await step("validate", async () => validateAll().failures);
await step("check-generated", async () =>
  (await checkGenerated()).map((name) => `${name} is stale; run pnpm contracts:generate`),
);
await step("breaking", async () => {
  const result = runBreakingCheck();
  if (result.error) return [result.error];
  if (result.ok) return [];
  return [
    ...result.changes.map((c) => `${c.kind}: ${c.message}`),
    "bump the major version of info.version to accept these changes",
  ];
});

if (problems.length > 0) {
  console.error(`\n${problems.join("\n")}\n\ncontracts:check FAILED`);
  process.exit(1);
}
console.log("contracts:check passed");
