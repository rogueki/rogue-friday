// Renders every story of the built Storybook in Chromium and reports page errors, console errors and axe violations.
//   node scripts/audit.mjs                       -> serves storybook-static/ itself (run `pnpm build` first)
//   options: --only <substring of story id>, --json <file>, --shots <dir> (PNG per story), --concurrency <n>,
//            --executable <chromium path>, --motion off|reduced|full (default off)
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const only = opt('only', '');
const jsonOut = opt('json', '');
const shotsDir = opt('shots', '');
const concurrency = Number(opt('concurrency', '4'));
const motion = opt('motion', 'off');
const executablePath = opt('executable', process.env.CHROMIUM_PATH || undefined);
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json' };

function serveStatic(dir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][\\/])+/, '');
    if (rel.endsWith('/') || rel === '') rel = join(rel, 'index.html');
    const file = join(dir, rel);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen(server)));
}

const dir = join(root, 'storybook-static');
if (!existsSync(join(dir, 'iframe.html'))) throw new Error('storybook-static missing: run `pnpm --filter @friday/storybook build` first');
const server = await serveStatic(dir);
const base = `http://127.0.0.1:${server.address().port}`;

const index = await (await fetch(`${base}/index.json`)).json();
const stories = Object.values(index.entries)
  .filter((entry) => entry.type === 'story' && (!only || entry.id.includes(only)))
  .map((entry) => entry.id);

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const results = [];

async function audit(context, id) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  const url = `${base}/iframe.html?id=${id}&viewMode=story&globals=${encodeURIComponent(`motion:${motion}`)}`;
  await page.goto(url, { waitUntil: 'load' });
  let rendered = true;
  try {
    await page.waitForSelector('#storybook-root > *', { timeout: 20000 });
  } catch {
    rendered = false;
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  let violations = [];
  // Stories are fragments, not documents: the page-level rules (landmarks around everything, an h1) do not apply.
  const pageLevelRules = ['region', 'page-has-heading-one', 'landmark-one-main', 'bypass'];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const axe = await new AxeBuilder({ page })
        .include('#storybook-root')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        .disableRules(pageLevelRules)
        .analyze();
      violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') ?? '' }));
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The a11y addon of the preview runs axe on its own after render; wait for it instead of failing.
      if (message.includes('already running') && attempt < 5) {
        await page.waitForTimeout(1000);
        continue;
      }
      errors.push(`axe: ${message.split('\n')[0]}`);
      break;
    }
  }
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${id}.png`) });
  await page.close();
  return { id, rendered, errors, violations };
}

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const queue = [...stories];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const result = await audit(context, id);
        results.push(result);
        const flag = !result.rendered || result.errors.length ? '!' : result.violations.length ? '~' : '✓';
        console.log(`${flag} ${id}${result.violations.length ? `  axe: ${result.violations.map((v) => `${v.id}×${v.nodes}`).join(', ')}` : ''}${result.errors.length ? `  errors: ${result.errors.length}` : ''}`);
      }
    }),
  );
} finally {
  await browser.close();
  server.close();
}

results.sort((a, b) => a.id.localeCompare(b.id));
const byRule = new Map();
for (const r of results) for (const v of r.violations) byRule.set(v.id, [...(byRule.get(v.id) ?? []), { story: r.id, nodes: v.nodes, impact: v.impact, sample: v.sample }]);
console.log(`\n${results.length} stories, ${results.filter((r) => !r.rendered).length} not rendered, ${results.filter((r) => r.errors.length).length} with page/console errors, ${results.filter((r) => r.violations.length).length} with axe violations`);
for (const [rule, hits] of byRule) console.log(`  ${rule}: ${hits.length} stories, e.g. ${hits[0].story} -> ${hits[0].sample}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
