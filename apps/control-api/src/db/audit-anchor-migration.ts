import { hkdfSync } from "node:crypto";
import type { Db } from "./database";
import { AuditAnchor } from "./audit-anchor";
import { AuditStore } from "./audit-store";

/** Re-seal intact JARVIS anchors after the key namespace changed to F.R.I.D.A.Y. */
export function migrateLegacyAuditAnchor(db: Db, masterKey: Buffer, file: string, current: AuditStore): boolean {
  const legacyKey = Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "jarvis/audit-head/v1", 32));
  const legacyAnchor = new AuditAnchor({ db, key: legacyKey, file });
  const anchors = legacyAnchor.read();
  const present = anchors.file.state === "ok" || anchors.db.state === "ok";
  if (!present || anchors.file.state === "invalid" || anchors.db.state === "invalid") return false;
  if (!new AuditStore(db, undefined, legacyAnchor).verify().valid) return false;
  return current.reanchorAfterKeyLoss();
}
