import { defineConfig } from "tsup";
import { serverBundle } from "./tsup.config";

// Never shipped: the updater syncs `dist/` only. `msw/browser` is imported dynamically by the browser-only MSW setup
// of @friday/mock-data and never runs on the server.
export default defineConfig(serverBundle({ "e2e-server": "test-support/e2e-server.ts" }, ".e2e-dist", ["msw/browser"]));
