import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index';

// The GitHub update never rewrites dashboard.yaml/adapters.yaml, so every config an installer ever wrote must keep
// loading with the current schema; otherwise the dashboard would not start after an update.
const installer = readFileSync(resolve(__dirname, '../../../installer/install-friday.ps1'), 'utf8').replace(/\r\n/g, '\n');
const PORTS: Record<string, number> = { CommandCenter: 3100, Dashboard: 9119, HermesApi: 8642, Voice: 43790, Qwen: 43791 };

function hereString(name: string): string {
  const start = installer.indexOf(`$${name} = @"\n`);
  const end = start < 0 ? -1 : installer.indexOf('\n"@', start);
  if (start < 0 || end < 0) throw new Error(`installer template $${name} not found`);
  return installer.slice(installer.indexOf('\n', start) + 1, end);
}

function render(template: string): string {
  const text = template
    .replace(/\$\(\$Ports\.(\w+)\)/g, (_, port: string) => {
      if (!(port in PORTS)) throw new Error(`unknown installer port ${port}`);
      return String(PORTS[port]);
    })
    .replaceAll('$rootYaml', 'D:/Friday')
    .replaceAll('${storageDrive}', 'D')
    .replaceAll('$cloudModeYaml', 'false')
    .replaceAll('$AN', 'Friday')
    .replaceAll('$WP', 'hey friday')
    .replaceAll('$Distro', 'FRIDAY-2');
  const leftover = /\$\(|\$[A-Za-z]/.exec(text);
  if (leftover) throw new Error(`unrendered installer variable near: ${text.slice(leftover.index, leftover.index + 40)}`);
  return text;
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function load(dashboard: string, adapters: string) {
  const dir = mkdtempSync(join(tmpdir(), 'friday-installer-config-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'dashboard.yaml'), dashboard);
  writeFileSync(join(dir, 'adapters.yaml'), adapters);
  return loadConfig({ cwd: dir, configDir: dir, env: { NODE_ENV: 'production' } });
}

const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

describe('installer-written configuration', () => {
  it('loads the dashboard.yaml and adapters.yaml the current installer writes', () => {
    const config = load(render(hereString('dashboardYaml')), render(hereString('adaptersYaml')));
    expect(config.dataMode).toBe('live');
    expect(config.server.port).toBe(PORTS.CommandCenter);
  });

  it('still loads the files written by the installer of 2026-10-31 (kept unchanged by the GitHub update)', () => {
    const config = load(fixture('installer-2026-10-31.dashboard.yaml'), fixture('installer-2026-10-31.adapters.yaml'));
    expect(config.dataMode).toBe('live');
  });
});
