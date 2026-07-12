import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';

/**
 * Unpack the committed web build (server/web-dist.zip, produced by
 * `npm run deploy:web`) into a directory the server can serve. Runs at every
 * startup — the zip is small and this keeps the served files exactly in sync
 * with the repo checkout.
 *
 * Returns the target dir, or null when there is no zip (server stays API-only
 * unless WEB_DIR points somewhere).
 */
export function unpackWebDist(zipPath: string, targetDir: string): string | null {
  if (!existsSync(zipPath)) return null;
  const files = unzipSync(readFileSync(zipPath));
  rmSync(targetDir, { recursive: true, force: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const dest = join(targetDir, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }
  return targetDir;
}
