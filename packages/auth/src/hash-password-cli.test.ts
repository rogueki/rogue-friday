import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('./cli/hash-password.ts', import.meta.url));

function run(input: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli], { input, encoding: 'utf8', timeout: 60_000 });
}

describe('hash-password CLI', () => {
  it('prints only the hash line when a script captures stdout (owner reset, I-055)', () => {
    const result = run('Testpasswort-123456\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^FRIDAY_OWNER_PASSWORD_HASH='scrypt\$[^']+'\n$/);
    expect(result.stderr).not.toContain('.env');
  });

  it('rejects a short password on stderr without a hash', () => {
    const result = run('zu-kurz\n');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('mindestens 12 Zeichen');
  });
});
