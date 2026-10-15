import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRouteTable, renderRouteTableModule } from "../src/http/route-table-builder";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../../packages/contracts/dist/friday-api.bundled.yaml");
const target = join(here, "../src/http/route-table.generated.ts");

if (!existsSync(source)) {
  console.error(`Missing ${source}. Run "pnpm contracts:generate" first.`);
  process.exit(1);
}
const routes = buildRouteTable(readFileSync(source, "utf8"));
writeFileSync(target, renderRouteTableModule(routes));
console.log(`Wrote ${routes.length} operations to ${target}`);
