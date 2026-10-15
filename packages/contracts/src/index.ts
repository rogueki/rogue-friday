import { fileURLToPath } from "node:url";

/** Wire contract version; mirrors package.json, info.version of both API documents and every envelope. */
export const CONTRACT_VERSION = "2.0.0";

const root = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url));

/** Absolute locations of the contract sources, for tooling that needs the files (servers, mock engines, tests). */
export const contractPaths = {
  openapi: root("openapi/friday-api.yaml"),
  asyncapi: root("asyncapi/friday-events.yaml"),
  schemas: root("schemas"),
  examples: root("examples"),
} as const;
