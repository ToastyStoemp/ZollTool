/**
 * Stamp a fresh versionCode/versionName into android/app/build.gradle before
 * building. Run this first, then build the APKs, then `npm run pack:apk` —
 * which reads the version back from build.gradle so server/apk/version.json
 * always matches exactly what's embedded in the APKs it's shipping (not a
 * separately-computed timestamp that can drift a few minutes apart).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gradlePath = join(root, 'android', 'app', 'build.gradle');

// Minutes-since-epoch: monotonically increasing, no state to track between runs.
const versionCode = Math.floor(Date.now() / 60000);
const versionName = new Date().toISOString().slice(0, 16).replace('T', ' ');

let content = readFileSync(gradlePath, 'utf-8');
if (!/versionCode \d+/.test(content) || !/versionName "[^"]*"/.test(content)) {
  console.error('Could not find versionCode/versionName in android/app/build.gradle.');
  process.exit(1);
}
content = content.replace(/versionCode \d+/, `versionCode ${versionCode}`);
content = content.replace(/versionName "[^"]*"/, `versionName "${versionName}"`);
writeFileSync(gradlePath, content);

console.log(`Bumped android/app/build.gradle -> versionCode ${versionCode}, versionName "${versionName}"`);
