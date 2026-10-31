import { test, expect, open } from "./support/fixtures";
import { API_ORIGIN } from "./support/constants";

/** Phase 12 security gate in a real browser (docs/SECURITY.md §9): cookies, CSP, framing. */
const ROUTES = ["/", "/activity", "/tasks", "/approvals", "/agents", "/memory", "/alerts", "/communication", "/calendar", "/automations", "/research", "/files", "/voice", "/system", "/audit", "/settings"];

test("session cookie is HttpOnly + SameSite=Strict + Path=/ and invisible to scripts; the CSRF cookie is readable", async ({ page }) => {
  await open(page, "/");
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === "friday_session");
  const csrf = cookies.find((cookie) => cookie.name === "friday_csrf");
  expect(session, "session cookie").toBeDefined();
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  // Plain http on loopback: the Secure flag is only set behind TLS (auth.secureCookies), see apps/control-api/test/security-gate.test.ts
  expect(session?.secure).toBe(false);
  expect(csrf).toMatchObject({ httpOnly: false, sameSite: "Strict", path: "/" });
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toContain("friday_session");
  expect(visible).toContain("friday_csrf");
  // host-only: no Domain attribute, so the cookie is not sent to sibling hosts
  expect(session?.domain).toBe("127.0.0.1");
});

test("the CSP is delivered exactly as specified and no page triggers a violation or a console error about it", async ({ page }) => {
  test.setTimeout(240_000);
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply|connect|frame)/i.test(message.text())) violations.push(`${message.type()}: ${message.text()}`);
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  const documentCsp: string[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "document") documentCsp.push(response.headers()["content-security-policy"] ?? "");
  });
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole("main", { name: "Hauptinhalt" })).toBeVisible();
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(seen, `securitypolicyviolation on ${route}`).toEqual([]);
  }
  expect(violations).toEqual([]);
  expect(documentCsp.length).toBeGreaterThan(0);
  for (const csp of documentCsp) {
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "img-src 'self' data: blob:", "connect-src 'self' https://api.bigdatacloud.net ws: wss:", "worker-src 'self' blob:"]) expect(csp).toContain(directive);
    expect(csp).toMatch(/script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')*;/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  }
});

test("the static export has no inline script outside the hashed bootstrap and no inline event handlers", async ({ request }) => {
  for (const route of ["/", "/tasks", "/settings"]) {
    const response = await request.get(`${API_ORIGIN}${route}`);
    const html = await response.text();
    const csp = response.headers()["content-security-policy"] ?? "";
    const hashes = new Set([...csp.matchAll(/'(sha256-[^']+)'/g)].map((match) => match[1]));
    const { createHash } = await import("node:crypto");
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(match[1] ?? "") || (match[2] ?? "").trim() === "") continue;
      if (/type\s*=\s*["']?(application\/json|application\/ld\+json)/i.test(match[1] ?? "")) continue;
      expect(hashes, `inline script on ${route} must be hashed`).toContain(`sha256-${createHash("sha256").update(match[2] ?? "", "utf8").digest("base64")}`);
    }
    expect(html).not.toMatch(/\son(click|load|error|mouseover)\s*=/i);
  }
});

test("the app cannot be framed by another origin", async ({ page }) => {
  // The embedding document lives on a different origin (about:blank / data) than the app on 127.0.0.1.
  await page.goto("about:blank");
  const blocked = await page.evaluate(async (origin) => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const loaded = new Promise<string>((resolve) => {
      frame.addEventListener("load", () => {
        try {
          resolve(frame.contentDocument?.body?.innerText ?? "no-access");
        } catch {
          resolve("cross-origin");
        }
      });
      setTimeout(() => resolve("timeout"), 8000);
    });
    frame.src = `${origin}/`;
    return loaded;
  }, API_ORIGIN);
  // Chromium shows its own error page for a frame that refuses embedding; the app shell must never render inside it.
  const frames = page.frames().filter((frame) => frame !== page.mainFrame());
  for (const frame of frames) {
    const text = await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    expect(text).not.toContain("Hauptinhalt");
    expect(frame.url()).not.toBe(`${API_ORIGIN}/`);
  }
  expect(blocked).not.toContain("F.R.I.D.A.Y");
});

test("a foreign Host header and a foreign Origin are refused by the live server", async ({ request }) => {
  const host = await request.get(`${API_ORIGIN}/api/v1/health`, { headers: { Host: "evil.example" } });
  expect(host.status()).toBe(403);
  const origin = await request.post(`${API_ORIGIN}/api/v1/auth/logout`, { headers: { Origin: "https://evil.example" } });
  expect(origin.status()).toBe(403);
  for (const response of [host, origin]) expect(Object.keys(response.headers()).filter((name) => name.startsWith("access-control-"))).toEqual([]);
});

test("the live server sends the full security header set on pages and API", async ({ request }) => {
  for (const path of ["/", "/api/v1/health"]) {
    const headers = (await request.get(`${API_ORIGIN}${path}`)).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  }
});
