/**
 * Copy the built Android debug APKs (one per flavor) into server/apk/ and
 * write a version.json stamped with the current time.
 *
 * Committed to git the same way as server/web-dist.zip: the server serves
 * them straight from that directory, so shipping an app update to every
 * device is `npx cap sync android && gradlew assembleDebug`, `npm run
 * pack:apk`, commit, `git pull && docker compose up -d --build` on the
 * server — no scp, no per-device file transfer. Each device then downloads
 * its own flavor's APK from Settings → App updates.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'server', 'apk');
const flavors = ['carbon', 'compat', 'full'];

mkdirSync(outDir, { recursive: true });

let packed = 0;
for (const flavor of flavors) {
  const src = join(root, 'android', 'app', 'build', 'outputs', 'apk', flavor, 'debug', `app-${flavor}-debug.apk`);
  if (!existsSync(src)) {
    console.warn(`Skipping ${flavor} — ${src} not found (build it first).`);
    continue;
  }
  copyFileSync(src, join(outDir, `${flavor}.apk`));
  packed++;
}

if (!packed) {
  console.error('No APKs found — run `npx cap sync android` and the Gradle build first.');
  process.exit(1);
}

// Minutes-since-epoch: monotonically increasing, no state to track between runs.
const versionCode = Math.floor(Date.now() / 60000);
const versionName = new Date().toISOString().slice(0, 16).replace('T', ' ');
writeFileSync(join(outDir, 'version.json'), JSON.stringify({ versionCode, versionName }, null, 2) + '\n');

console.log(`Packed ${packed} APK(s) -> server/apk/ (versionCode ${versionCode}, ${versionName})`);
