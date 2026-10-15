import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, describeSecretRef, loadConfig, looksLikeSecretRef, parseSecretRef, resolveSecret } from './index';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'friday-file-secret-'));
  tempDirs.push(dir);
  return dir;
}

describe('file: secret references', () => {
  it('parses absolute POSIX and Windows paths and rejects relative or empty ones', () => {
    expect(looksLikeSecretRef('file:/etc/key')).toBe(true);
    expect(parseSecretRef('file:C:/Friday/config/hermes_api.key')).toEqual({ scheme: 'file', name: 'C:/Friday/config/hermes_api.key' });
    expect(parseSecretRef('file:C:\\Friday\\config\\hermes_api.key')).toEqual({ scheme: 'file', name: 'C:\\Friday\\config\\hermes_api.key' });
    expect(parseSecretRef('file:/home/user/hermes_api.key')).toMatchObject({ scheme: 'file' });
    expect(parseSecretRef('file:')).toBeNull();
    expect(parseSecretRef('file:relative/key')).toBeNull();
    expect(parseSecretRef('file:./key')).toBeNull();
    expect(parseSecretRef('file:\\\\?\\C:\\key')).toBeNull();
    expect(parseSecretRef(`file:/${'a'.repeat(1100)}`)).toBeNull();
  });

  it('reads the file, strips BOM and surrounding whitespace, and re-reads on every call', () => {
    const path = join(tempDir(), 'hermes_api.key');
    writeFileSync(path, '\uFEFFkey-one\r\n');
    const first = resolveSecret(`file:${path}`);
    expect(first.ok && first.secret.reveal()).toBe('key-one');
    writeFileSync(path, 'key-two\n');
    const second = resolveSecret(`file:${path}`);
    expect(second.ok && second.secret.reveal()).toBe('key-two');
  });

  it('distinguishes missing, empty, oversized and unreadable files without leaking content', () => {
    const dir = tempDir();
    expect(resolveSecret(`file:${join(dir, 'missing.key')}`)).toMatchObject({ ok: false, code: 'FILE_NOT_FOUND' });
    writeFileSync(join(dir, 'empty.key'), ' \n');
    expect(resolveSecret(`file:${join(dir, 'empty.key')}`)).toMatchObject({ ok: false, code: 'FILE_EMPTY' });
    writeFileSync(join(dir, 'big.key'), 'x'.repeat(70 * 1024));
    expect(resolveSecret(`file:${join(dir, 'big.key')}`)).toMatchObject({ ok: false, code: 'FILE_ERROR' });
    // A directory is readable as a path but not as a file.
    expect(resolveSecret(`file:${dir}`)).toMatchObject({ ok: false, code: 'FILE_ERROR' });
    const leaky = resolveSecret('file:/virtual/key', {
      readFile: () => {
        throw Object.assign(new Error('EACCES: leaky-secret-content'), { code: 'EACCES' });
      },
    });
    expect(leaky).toMatchObject({ ok: false, code: 'FILE_ERROR' });
    expect(JSON.stringify(leaky)).not.toContain('leaky-secret-content');
    expect(resolveSecret('file:relative.key')).toMatchObject({ ok: false, code: 'INVALID_REF' });
  });

  it('describeSecretRef reports configured without the value', () => {
    const path = join(tempDir(), 'k');
    writeFileSync(path, 'never-shown');
    const state = describeSecretRef(`file:${path}`);
    expect(state).toEqual({ ref: `file:${path}`, configured: true });
    expect(JSON.stringify(state)).not.toContain('never-shown');
    expect(describeSecretRef(`file:${path}.nope`).configured).toBe(false);
  });

  it('works as an adapter secret in the config and never lands in the config object', () => {
    const dir = tempDir();
    const keyFile = join(dir, 'hermes_api.key');
    writeFileSync(keyFile, 'super-secret-hermes-key\n');
    writeFileSync(join(dir, 'dashboard.yaml'), 'dataMode: hybrid\n');
    writeFileSync(
      join(dir, 'adapters.yaml'),
      [
        'allowlist:',
        '  hermes-activity: "@friday/adapter-hermes"',
        'adapters:',
        '  activity:',
        '    provider: hermes-activity',
        '    enabled: true',
        '    config:',
        `      apiKey: "file:${keyFile.replaceAll('\\', '/')}"`,
        `      apiKeyFile: "${keyFile.replaceAll('\\', '/')}"`,
        '',
      ].join('\n'),
    );
    const config = loadConfig({ configDir: dir, env: {}, cwd: dir });
    expect(config.adapters.activity.config.apiKey).toEqual({ ref: `file:${keyFile.replaceAll('\\', '/')}`, configured: true });
    // The plain *File path field stays a path (credential heuristic exempts it).
    expect(config.adapters.activity.config.apiKeyFile).toBe(keyFile.replaceAll('\\', '/'));
    expect(JSON.stringify(config)).not.toContain('super-secret-hermes-key');
  });

  it('flags a file: reference with a relative path as invalid in the config', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'dashboard.yaml'), 'dataMode: hybrid\n');
    writeFileSync(
      join(dir, 'adapters.yaml'),
      ['allowlist:', '  hermes-activity: "@friday/adapter-hermes"', 'adapters:', '  activity:', '    provider: hermes-activity', '    enabled: true', '    config:', '      apiKey: "file:keys/hermes.key"', ''].join('\n'),
    );
    expect(() => loadConfig({ configDir: dir, env: {}, cwd: dir })).toThrow(ConfigError);
  });

  it('accepts a file: reference for the owner password hash', () => {
    const dir = tempDir();
    const hashFile = join(dir, 'owner.hash');
    writeFileSync(hashFile, 'scrypt$stub\n');
    writeFileSync(join(dir, 'dashboard.yaml'), `dataMode: mock\nauth:\n  mode: local\n  ownerPasswordHash: "file:${hashFile.replaceAll('\\', '/')}"\n`);
    const config = loadConfig({ configDir: dir, env: {}, cwd: dir });
    expect(config.auth.ownerPasswordHash.configured).toBe(true);
  });
});
