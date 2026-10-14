import { createId, type IdPrefix } from "@jarvis/adapter-core";

/**
 * Deterministic contract ids (`<prefix>_<26 chars>`) for resources that have no id in the foreign system.
 * `vol`, `mdl` are contract prefixes (schemas storage-volume, model-provider) that `ID_PREFIXES` of the adapter
 * core does not list yet; `createId` only needs the prefix string.
 */
export type SystemIdPrefix = "svc" | "vol" | "mdl";
export const contractId = (prefix: SystemIdPrefix, seed: string): string =>
  createId(prefix as IdPrefix, seed);
