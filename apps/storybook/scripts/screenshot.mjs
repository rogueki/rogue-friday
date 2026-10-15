// Screenshots key stories at 1920x1080 with Playwright (chromium) into apps/storybook/screenshots/.
//   node scripts/screenshot.mjs                 -> serves storybook-static/ itself (run `pnpm build` first)
//   node scripts/screenshot.mjs --base http://localhost:6006   -> uses a running `storybook dev`
//   options: --motion off|reduced|full (default reduced), --only <substring>, --theme <id>
import { chromium } from '@playwright/test';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const motion = opt('motion', 'reduced');
const only = opt('only', '');
const theme = opt('theme', '');
const outDir = join(root, 'screenshots');
mkdirSync(outDir, { recursive: true });

const stories = [
  { id: 'overview-overviewcomposition--overview', file: 'overview-composition' },
  { id: 'overview-overviewcomposition--nav-collapsed', file: 'overview-nav-collapsed' },
  { id: 'overview-overviewcomposition--speaking', file: 'overview-speaking' },
  { id: 'components-panels--levels', file: 'panels-levels' },
  { id: 'components-cards--agent-cards', file: 'cards-agents' },
  { id: 'components-metrics--circular-metrics', file: 'metrics-circular' },
  { id: 'components-shell--top-and-bottom-bars', file: 'shell-bars' },
  { id: 'components-overlays--command-palette-story', file: 'overlay-command-palette' },
  { id: 'components-datatable--normal', file: 'datatable-normal' },
  { id: 'design-system-foundation--colors', file: 'foundation-colors' },
  { id: 'components-voice--voice-control-states', file: 'voice-states' },
  { id: 'components-cards--approval-cards', file: 'cards-approvals' },
  { id: 'components-states--error', file: 'states-error' },
];

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json' };

function serveStatic(dir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
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

let base = opt('base', '');
let server;
if (!base) {
  const dir = join(root, 'storybook-static');
  if (!existsSync(join(dir, 'iframe.html'))) throw new Error('storybook-static missing: run `pnpm --filter @friday/storybook build` first');
  server = await serveStatic(dir);
  base = `http://127.0.0.1:${server.address().port}`;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  for (const story of stories) {
    if (only && !story.id.includes(only) && !story.file.includes(only)) continue;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const globals = [`motion:${motion}`, theme ? `theme:${theme}` : ''].filter(Boolean).join(';');
    const url = `${base}/iframe.html?id=${story.id}&viewMode=story&globals=${encodeURIComponent(globals)}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    try {
      await page.waitForSelector('#storybook-root > *', { timeout: 15000 });
    } catch {
      console.warn(`! ${story.id}: nothing rendered`);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    const file = join(outDir, `${story.file}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`${errors.length ? '!' : '✓'} ${story.id} -> screenshots/${story.file}.png${errors.length ? `  (page errors: ${errors.join(' | ')})` : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  server?.close();
}
