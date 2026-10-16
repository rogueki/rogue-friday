import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createRuntimeSecrets } from "../src/runtime/adapter-wiring";

it("encrypts ICS and CalDAV credentials and restores them only with the local key", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
  const key = randomBytes(32);
  const secrets = createRuntimeSecrets(db, key);
  const values = { feedUrl: "https://example.com/private.ics", calendarUrl: "https://example.com/dav/calendar/", username: "account", password: "app-password" };
  for (const [field, value] of Object.entries(values)) secrets.set("caldav-calendar", field, value);
  const stored = JSON.stringify(db.prepare("SELECT key, value FROM kv").all());
  for (const value of Object.values(values)) expect(stored).not.toContain(value);
  const restored = createRuntimeSecrets(db, key);
  for (const [field, value] of Object.entries(values)) expect(restored.get("caldav-calendar", field)).toBe(value);
  expect(createRuntimeSecrets(db, randomBytes(32)).has("caldav-calendar", "password")).toBe(false);
  db.close();
});
