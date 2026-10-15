// Regenerates the SDK sources into a temp directory and fails if packages/generated-sdk/src/generated is stale.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateAll } from "./generate.mjs";
import { paths } from "./lib/contract.mjs";

const normalize = (text) => text.replace(/\r\n/g, "\n");

/** @returns {Promise<string[]>} names of stale or missing generated files */
export async function checkGenerated() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "friday-generated-"));
  try {
    const files = await generateAll(tmp);
    const stale = [];
    for (const [name, expected] of Object.entries(files)) {
      const target = path.join(paths.sdkGenerated, name);
      if (!fs.existsSync(target)) stale.push(`${name} (missing)`);
      else if (normalize(fs.readFileSync(target, "utf8")) !== normalize(expected)) stale.push(name);
    }
    return stale;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("check-generated.mjs")) {
  const stale = await checkGenerated();
  if (stale.length > 0) {
    console.error(
      `check-generated: STALE ${stale.join(", ")}. Run \`pnpm contracts:generate\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log("check-generated: packages/generated-sdk/src/generated is up to date");
}
