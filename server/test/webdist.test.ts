import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { unpackWebDist } from '../src/webdist';

describe('unpackWebDist', () => {
  it('unpacks the zip into the target dir, replacing stale files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zolltool-webdist-'));
    try {
      const zipPath = join(dir, 'web-dist.zip');
      const target = join(dir, 'unpacked');
      writeFileSync(
        zipPath,
        zipSync({
          'index.html': strToU8('<title>ZollTool</title>'),
          'assets/index.js': strToU8('console.log(1)'),
        }),
      );

      expect(unpackWebDist(zipPath, target)).toBe(target);
      expect(readFileSync(join(target, 'index.html'), 'utf8')).toContain('ZollTool');
      expect(existsSync(join(target, 'assets', 'index.js'))).toBe(true);

      // Second unpack with different contents fully replaces the old tree
      writeFileSync(zipPath, zipSync({ 'index.html': strToU8('v2') }));
      unpackWebDist(zipPath, target);
      expect(readFileSync(join(target, 'index.html'), 'utf8')).toBe('v2');
      expect(existsSync(join(target, 'assets'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no zip exists', () => {
    expect(unpackWebDist(join(tmpdir(), 'nope-does-not-exist.zip'), join(tmpdir(), 'x'))).toBeNull();
  });
});
